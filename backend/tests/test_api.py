"""Integration against a real, disposable PostgreSQL database; never Neon by default."""

import os
import uuid
import pytest

if not os.getenv("STATEFORGE_TEST_DATABASE_URL"):
    pytest.skip("Set STATEFORGE_TEST_DATABASE_URL to a disposable PostgreSQL database", allow_module_level=True)
os.environ["DATABASE_URL"] = os.environ["STATEFORGE_TEST_DATABASE_URL"]
from fastapi.testclient import TestClient
from psycopg.errors import RaiseException
from app.config import settings

settings.cache_clear()
from app.main import app  # noqa: E402
from app import db  # noqa: E402
from app.worker import work_once  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def new_user(client):
    email = f"qa-{uuid.uuid4().hex}@example.org"
    response = client.post(
        "/api/auth/register", json={"email": email, "password": "conformance-test-password", "name": "Integration Test"}
    )
    assert response.status_code == 201, response.text
    data = response.json()
    return {"Authorization": f"Bearer {data['token']}"}


def test_real_postgres_end_to_end_and_security(client):
    headers, other = new_user(client), new_user(client)
    assert client.get("/api/projects").status_code == 401
    project = client.post("/api/projects", headers=headers, json={"name": "Disposable integration system"}).json()
    root = f"/api/projects/{project['id']}"
    assert client.get(root, headers=other).status_code == 404
    model = {
        "name": "Integration system",
        "initial": "Idle",
        "states": [
            {"id": "Idle", "label": "Idle", "owner": "controller"},
            {"id": "Done", "label": "Done", "terminal": True},
        ],
        "transitions": [{"id": "Finish", "source": "Idle", "target": "Done", "event": "finish"}],
        "properties": [{"id": "Completion", "name": "Completion", "operator": "AF", "predicate": "state == 'Done'"}],
    }
    version = client.post(
        f"{root}/versions",
        headers=headers,
        json={"model": model, "expected_version": 0, "requirements": "Complete after finish."},
    ).json()
    vid = version["id"]
    assert (
        client.post(f"{root}/versions", headers=headers, json={"model": model, "expected_version": 0}).status_code
        == 409
    )
    assert client.post(f"{root}/runs", headers=headers, json={"version_id": vid}).status_code == 409
    assert client.post(f"{root}/artifacts", headers=headers, json={"version_id": vid}).status_code == 409
    assert client.post(f"{root}/versions/{vid}/approve", headers=headers, json={}).status_code == 200
    queued = client.post(f"{root}/runs", headers=headers, json={"version_id": vid})
    assert queued.status_code == 202
    assert client.post(f"{root}/runs", headers=headers, json={"version_id": vid}).json()["id"] == queued.json()["id"]
    assert work_once("integration-worker")
    snapshot = client.get(root, headers=headers).json()
    assert snapshot["runs"][0]["status"] == "passed"
    artifact_response = client.post(f"{root}/artifacts", headers=headers, json={"version_id": vid})
    assert artifact_response.status_code == 201, artifact_response.text
    artifact = artifact_response.json()
    package = client.get(f"{root}/artifacts/{artifact['id']}/download", headers=headers)
    assert package.status_code == 200 and package.content[:2] == b"PK"
    runtime_response = client.post(
        f"{root}/runtimes",
        headers=headers,
        json={"name": "Disposable runtime", "version_id": vid, "artifact_id": artifact["id"]},
    )
    assert runtime_response.status_code == 201, runtime_response.text
    runtime = runtime_response.json()
    rid = runtime["id"]
    payload = {
        "event_id": uuid.uuid4().hex,
        "event": "unknown",
        "expected_sequence": 0,
        "model_hash": version["model_hash"],
    }
    rejected = client.post(f"{root}/runtimes/{rid}/events", headers=headers, json=payload)
    assert rejected.status_code == 200 and rejected.json()["data"]["status"] == "violation"
    assert rejected.json()["data"]["state"] == "Idle"
    assert client.post(f"/api/ingest/{rid}", json=payload).status_code == 401
    payload.update(event_id=uuid.uuid4().hex, event="finish", expected_sequence=1)
    accepted = client.post(f"/api/ingest/{rid}", headers={"X-Runtime-Key": runtime["ingest_key"]}, json=payload)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["data"]["state"] == "Done" and accepted.json()["sequence"] == 2
    duplicate = client.post(f"/api/ingest/{rid}", headers={"X-Runtime-Key": runtime["ingest_key"]}, json=payload)
    assert duplicate.json()["duplicate"] and duplicate.json()["sequence"] == 2
    payload.update(event_id=uuid.uuid4().hex, expected_sequence=0)
    assert client.post(f"{root}/runtimes/{rid}/events", headers=headers, json=payload).status_code == 409
    payload.update(event_id=uuid.uuid4().hex, expected_sequence=2, model_hash="0" * 64)
    stale = client.post(f"{root}/runtimes/{rid}/events", headers=headers, json=payload).json()
    assert "model_version_mismatch" in stale["data"]["violations"]
    assert len(client.get(f"{root}/runtimes/{rid}/traces", headers=headers).json()) == 3
    strategy = client.post(
        f"{root}/synthesize", headers=headers, json={"version_id": vid, "safe": "True", "goal": "state == 'Done'"}
    )
    assert strategy.status_code == 201, strategy.text
    assert strategy.json()["data"]["status"] == "candidate"
    assert (
        client.post(
            f"{root}/runtimes/{rid}/adapt",
            headers=headers,
            json={"strategy_id": strategy.json()["id"], "expected_sequence": 3},
        ).status_code
        == 200
    )
    assert client.post(f"{root}/runtimes/{rid}/stop", headers=headers, json={}).status_code == 200
    payload.update(expected_sequence=4, model_hash=version["model_hash"])
    assert (
        client.post(f"/api/ingest/{rid}", headers={"X-Runtime-Key": runtime["ingest_key"]}, json=payload).status_code
        == 401
    )
    with pytest.raises(RaiseException):
        with db.connection() as conn:
            conn.execute("UPDATE traces SET event='tamper' WHERE runtime_id=%s", (rid,))
    with pytest.raises(RaiseException):
        with db.connection() as conn:
            conn.execute("UPDATE versions SET model_hash='tamper' WHERE id=%s", (vid,))
    assert client.get(f"{root}/activity", headers=other).status_code == 404
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get(root, headers=headers).status_code == 401


def test_payload_limit_and_missing_resource(client):
    assert client.post("/api/auth/login", content=b" " * (1048576 + 1)).status_code == 413
    assert client.get("/api/health").json()["database"] == "connected"
