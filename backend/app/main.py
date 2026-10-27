import asyncio
import io
import json
import logging
import secrets
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from psycopg.errors import UniqueViolation, InvalidTextRepresentation
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from . import db
from .ai import propose
from .auth import user, hash_password, password_matches, normalize_email, issue_session, hash_token, rate_limit
from .codegen import generate
from .config import settings
from .engine import ENGINE_VERSION, digest, synthesize, transition, Predicate, ModelError, BudgetExceeded
from .schemas import (
    Credentials,
    ProjectInput,
    VersionInput,
    AIInput,
    RunInput,
    SynthesisInput,
    RuntimeInput,
    EventInput,
    AdaptInput,
    Model,
)

log = logging.getLogger("stateforge.api")


@asynccontextmanager
async def lifespan(_):
    db.migrate()
    yield
    db.pool().close()


app = FastAPI(title="StateForge API", version="0.1.0", lifespan=lifespan)
cfg = settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in cfg.cors_origins.split(",") if x.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "Last-Event-ID", "X-Runtime-Key"],
    expose_headers=["Content-Disposition"],
)


class RequestLimits(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.method == "POST":
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 1_048_576:
                    return JSONResponse({"detail": "Request exceeds 1 MB"}, status_code=413)
            request._body = bytes(body)
        response = await call_next(request)
        response.headers.update(
            {
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "strict-origin-when-cross-origin",
                "X-Frame-Options": "DENY",
                "Cache-Control": "no-store",
            }
        )
        if cfg.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(RequestLimits)


@app.exception_handler(InvalidTextRepresentation)
async def invalid_id(_, __):
    return JSONResponse({"detail": "Invalid identifier"}, status_code=422)


@app.exception_handler(ModelError)
async def model_error(_, exc):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.exception_handler(BudgetExceeded)
async def budget_error(_, __):
    return JSONResponse({"detail": "Analysis exceeded its resource budget; no proof was accepted."}, status_code=422)


@app.exception_handler(Exception)
async def unexpected_error(_, exc):
    log.error("Unhandled API failure", exc_info=exc)
    return JSONResponse({"detail": "The server could not complete this request. Inspect server logs."}, status_code=500)


def project_access(project_id, current):
    row = db.one("SELECT * FROM projects WHERE id=%s AND owner_id=%s", (project_id, current["id"]))
    if not row:
        raise HTTPException(404, "Project not found")
    return row


def version_access(project_id, version_id, current):
    project_access(project_id, current)
    row = db.one("SELECT * FROM versions WHERE id=%s AND project_id=%s", (version_id, project_id))
    if not row:
        raise HTTPException(404, "Model version not found")
    return row


def public_user(row):
    return {k: str(row[k]) if k == "id" else row[k] for k in ("id", "name", "email")}


@app.get("/api/health")
def health():
    db.one("SELECT 1")
    return {"status": "ok", "database": "connected", "engine": ENGINE_VERSION}


@app.get("/api/capabilities")
def capabilities(current=Depends(user)):
    return {
        "database": "connected",
        "ai_configured": bool(cfg.openrouter_api_key),
        "ai_model": cfg.openrouter_model,
        "engine": ENGINE_VERSION,
        "operators": ["AG", "AF", "EF", "EG", "AX", "EX", "LTL"],
        "max_configurations": 10000,
        "synthesis": "Finite turn-based safety + reachability game",
        "unsupported": [
            "Nested CTL, LTL next-time X, LTL variable propositions",
            "Timed and probabilistic automata",
            "Hierarchical and parallel statecharts",
            "nuXmv, UPPAAL, SemML adapters",
        ],
    }


@app.post("/api/auth/register", status_code=201)
def register(body: Credentials, request: Request):
    rate_limit(request, "register", 5, 3600)
    if not cfg.allow_registration:
        raise HTTPException(403, "Registration is disabled")
    email = normalize_email(body.email)
    try:
        with db.connection() as conn:
            uid = str(uuid.uuid4())
            row = conn.execute(
                "INSERT INTO users(id,email,name,password_hash) VALUES(%s,%s,%s,%s) RETURNING *",
                (uid, email, body.name.strip() or email.split("@")[0], hash_password(body.password)),
            ).fetchone()
            token = issue_session(conn, uid)
    except UniqueViolation as exc:
        raise HTTPException(409, "An account with that email already exists") from exc
    return {"token": token, "user": public_user(row)}


@app.post("/api/auth/login")
def login(body: Credentials, request: Request):
    rate_limit(request, "login", 15, 900)
    row = db.one("SELECT * FROM users WHERE email=%s", (normalize_email(body.email),))
    # Do equal-cost password work for unknown users to reduce timing enumeration.
    stored = row["password_hash"] if row else "scrypt$" + "00" * 16 + "$" + "00" * 64
    matches = password_matches(body.password, stored)
    if not row or not matches:
        raise HTTPException(401, "Email or password is incorrect")
    with db.connection() as conn:
        token = issue_session(conn, row["id"])
    return {"token": token, "user": public_user(row)}


@app.get("/api/auth/me")
def me(current=Depends(user)):
    return public_user(current)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, current=Depends(user)):
    db.one(
        "DELETE FROM sessions WHERE token_hash=%s RETURNING user_id",
        (hash_token(request.headers["authorization"].split(" ", 1)[1]),),
    )
    return Response(status_code=204)


class PasswordInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


@app.post("/api/auth/password", status_code=204)
def change_password(body: PasswordInput, request: Request, current=Depends(user)):
    rate_limit(request, "password", 5, 900)
    with db.connection() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id=%s FOR UPDATE", (current["id"],)).fetchone()
        if not password_matches(body.current_password, row["password_hash"]):
            raise HTTPException(403, "Current password is incorrect")
        conn.execute("UPDATE users SET password_hash=%s WHERE id=%s", (hash_password(body.new_password), current["id"]))
        conn.execute("DELETE FROM sessions WHERE user_id=%s", (current["id"],))
    return Response(status_code=204)


@app.post("/api/models/validate")
def validate_model(body: Model, current=Depends(user)):
    return body


@app.get("/api/projects")
def projects(current=Depends(user)):
    return db.many(
        "SELECT p.*, (SELECT count(*) FROM versions v WHERE v.project_id=p.id) AS version_count, "
        "(SELECT count(*) FROM runtimes r WHERE r.project_id=p.id AND r.status='active') AS runtime_count "
        "FROM projects p WHERE owner_id=%s ORDER BY created_at DESC",
        (current["id"],),
    )


@app.post("/api/projects", status_code=201)
def create_project(body: ProjectInput, request: Request, current=Depends(user)):
    rate_limit(request, "project.create", 30, 3600)
    with db.connection() as conn:
        row = conn.execute(
            "INSERT INTO projects(id,owner_id,name,description) VALUES(%s,%s,%s,%s) RETURNING *",
            (str(uuid.uuid4()), current["id"], body.name.strip(), body.description),
        ).fetchone()
        db.activity(conn, row["id"], "project.created", {"name": row["name"]})
    return row


@app.get("/api/projects/{pid}")
def project_snapshot(pid: str, current=Depends(user)):
    project = project_access(pid, current)
    return {
        "project": project,
        "versions": db.many("SELECT * FROM versions WHERE project_id=%s ORDER BY number DESC LIMIT 100", (pid,)),
        "runs": db.many("SELECT * FROM runs WHERE project_id=%s ORDER BY created_at DESC LIMIT 100", (pid,)),
        "proposals": db.many("SELECT * FROM proposals WHERE project_id=%s ORDER BY created_at DESC LIMIT 40", (pid,)),
        "artifacts": db.many(
            "SELECT id,version_id,model_hash,content_hash,manifest,created_at FROM artifacts "
            "WHERE project_id=%s ORDER BY created_at DESC LIMIT 100",
            (pid,),
        ),
        "runtimes": db.many(
            "SELECT id,project_id,version_id,artifact_id,name,model_hash,state,values,sequence,status,strategy_id,created_at "
            "FROM runtimes WHERE project_id=%s ORDER BY created_at DESC LIMIT 100",
            (pid,),
        ),
    }


@app.get("/api/projects/{pid}/versions/{vid}")
def get_version(pid: str, vid: str, current=Depends(user)):
    return version_access(pid, vid, current)


@app.post("/api/projects/{pid}/versions", status_code=201)
def save_version(pid: str, body: VersionInput, current=Depends(user)):
    project_access(pid, current)
    # Syntax is validated even when semantic defects are intentionally saved for diagnosis.
    names = {"state", *(v.name for v in body.model.variables)}
    for expression in [
        *(t.guard for t in body.model.transitions),
        *(p.predicate for p in body.model.properties if p.operator != "LTL"),
    ]:
        Predicate(expression, names)
    from .spin import formula

    for prop in body.model.properties:
        if prop.operator == "LTL":
            formula(prop.predicate, body.model.states)
    with db.connection() as conn:
        conn.execute("SELECT id FROM projects WHERE id=%s FOR UPDATE", (pid,))
        latest = conn.execute(
            "SELECT coalesce(max(number),0) AS n FROM versions WHERE project_id=%s", (pid,)
        ).fetchone()["n"]
        if latest != body.expected_version:
            raise HTTPException(409, "A newer model version exists. Refresh before saving your changes.")
        row = conn.execute(
            "INSERT INTO versions(id,project_id,number,model,model_hash,requirements,note) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            (
                str(uuid.uuid4()),
                pid,
                latest + 1,
                Jsonb(body.model.model_dump()),
                digest(body.model.model_dump()),
                body.requirements,
                body.note,
            ),
        ).fetchone()
        db.activity(
            conn,
            pid,
            "version.created",
            {
                "version_id": str(row["id"]),
                "number": latest + 1,
                "model_hash": row["model_hash"],
                "invalidates": "previous downstream artifacts",
            },
        )
    return row


@app.post("/api/projects/{pid}/versions/{vid}/approve")
def approve_version(pid: str, vid: str, current=Depends(user)):
    version_access(pid, vid, current)
    with db.connection() as conn:
        row = conn.execute(
            "UPDATE versions SET approved_at=coalesce(approved_at,now()) WHERE id=%s RETURNING *", (vid,)
        ).fetchone()
        db.activity(conn, pid, "version.approved", {"version_id": vid, "reviewer_id": str(current["id"])})
    return row


@app.post("/api/projects/{pid}/ai", status_code=201)
def ai_proposal(pid: str, body: AIInput, request: Request, current=Depends(user)):
    project_access(pid, current)
    rate_limit(request, "ai", 8, 3600)
    version, run = None, None
    if body.version_id:
        version = version_access(pid, body.version_id, current)
    if body.mode == "repair":
        if not version or not body.run_id:
            raise HTTPException(422, "Repair requires a model version and failing run")
        run = db.one(
            "SELECT * FROM runs WHERE id=%s AND version_id=%s AND project_id=%s AND status='failed'",
            (body.run_id, body.version_id, pid),
        )
        if not run:
            raise HTTPException(422, "A failed run for this exact version is required")
        count = db.one(
            "SELECT count(*) AS n FROM proposals WHERE base_version_id=%s AND kind='repair'", (body.version_id,)
        )["n"]
        if count >= 5:
            raise HTTPException(
                409, "Five repair proposals reached for this version. Review and save a revision first."
            )
    result = propose(body.requirements, version["model"] if version else None, run["result"] if run else None)
    with db.connection() as conn:
        row = conn.execute(
            "INSERT INTO proposals(id,project_id,kind,base_version_id,data) VALUES(%s,%s,%s,%s,%s) RETURNING *",
            (str(uuid.uuid4()), pid, body.mode, body.version_id, Jsonb(result)),
        ).fetchone()
        db.activity(conn, pid, "proposal.created", {"proposal_id": str(row["id"]), "kind": body.mode})
    return row


@app.post("/api/projects/{pid}/runs", status_code=202)
def queue_run(pid: str, body: RunInput, request: Request, current=Depends(user)):
    version = version_access(pid, body.version_id, current)
    rate_limit(request, "verify", 60, 3600)
    if not version["approved_at"]:
        raise HTTPException(409, "Review and approve this model version before verification")
    with db.connection() as conn:
        conn.execute("SELECT id FROM projects WHERE id=%s FOR UPDATE", (pid,))
        existing = conn.execute(
            "SELECT * FROM runs WHERE version_id=%s AND status IN ('queued','running')", (body.version_id,)
        ).fetchone()
        if existing:
            return existing
        row = conn.execute(
            "INSERT INTO runs(id,project_id,version_id) VALUES(%s,%s,%s) RETURNING *",
            (str(uuid.uuid4()), pid, body.version_id),
        ).fetchone()
        db.activity(conn, pid, "run.queued", {"run_id": str(row["id"]), "model_hash": version["model_hash"]})
    return row


@app.post("/api/projects/{pid}/synthesize", status_code=201)
def synthesis(pid: str, body: SynthesisInput, request: Request, current=Depends(user)):
    version = version_access(pid, body.version_id, current)
    rate_limit(request, "synthesis", 20, 3600)
    if not version["approved_at"]:
        raise HTTPException(409, "Approve this model before synthesis")
    result = synthesize(Model.model_validate(version["model"]), body.safe, body.goal)
    with db.connection() as conn:
        row = conn.execute(
            "INSERT INTO proposals(id,project_id,kind,base_version_id,data) VALUES(%s,%s,'synthesis',%s,%s) RETURNING *",
            (str(uuid.uuid4()), pid, body.version_id, Jsonb(result)),
        ).fetchone()
        db.activity(conn, pid, "synthesis.finished", {"proposal_id": str(row["id"]), "status": result["status"]})
    return row


@app.post("/api/projects/{pid}/artifacts", status_code=201)
def create_artifact(pid: str, body: RunInput, current=Depends(user)):
    version = version_access(pid, body.version_id, current)
    run = db.one(
        "SELECT * FROM runs WHERE version_id=%s AND status='passed' ORDER BY finished_at DESC LIMIT 1",
        (body.version_id,),
    )
    if not run or not version["approved_at"]:
        raise HTTPException(409, "A reviewed version and passing verification run are required")
    files, manifest, content_hash = generate(Model.model_validate(version["model"]), str(run["id"]), run["result"])
    manifest["version_id"] = body.version_id
    files["manifest.json"] = json.dumps(manifest, indent=2)
    content_hash = digest(files)
    with db.connection() as conn:
        row = conn.execute(
            "INSERT INTO artifacts(id,project_id,version_id,run_id,model_hash,content_hash,files,manifest) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,version_id,model_hash,content_hash,manifest,created_at",
            (
                str(uuid.uuid4()),
                pid,
                body.version_id,
                run["id"],
                version["model_hash"],
                content_hash,
                Jsonb(files),
                Jsonb(manifest),
            ),
        ).fetchone()
        db.activity(conn, pid, "artifact.created", {"artifact_id": str(row["id"]), "model_hash": version["model_hash"]})
    return row


@app.get("/api/projects/{pid}/artifacts/{aid}/download")
def download_artifact(pid: str, aid: str, current=Depends(user)):
    project_access(pid, current)
    artifact = db.one("SELECT * FROM artifacts WHERE id=%s AND project_id=%s", (aid, pid))
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if digest(artifact["files"]) != artifact["content_hash"]:
        raise HTTPException(409, "Artifact checksum mismatch")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in artifact["files"].items():
            archive.writestr(name, content)
    return Response(
        buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="stateforge-{aid[:8]}.zip"'},
    )


@app.post("/api/projects/{pid}/runtimes", status_code=201)
def create_runtime(pid: str, body: RuntimeInput, current=Depends(user)):
    version = version_access(pid, body.version_id, current)
    artifact = db.one(
        "SELECT * FROM artifacts WHERE id=%s AND project_id=%s AND version_id=%s",
        (body.artifact_id, pid, body.version_id),
    )
    if not artifact or artifact["model_hash"] != version["model_hash"]:
        raise HTTPException(409, "Generate an artifact for this exact model version before starting a runtime")
    model = Model.model_validate(version["model"])
    ingest_key = secrets.token_urlsafe(48)
    with db.connection() as conn:
        row = conn.execute(
            "INSERT INTO runtimes(id,project_id,version_id,artifact_id,name,model_hash,state,values,ingest_key_hash) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,name,model_hash,state,values,sequence,status,version_id,artifact_id",
            (
                str(uuid.uuid4()),
                pid,
                body.version_id,
                body.artifact_id,
                body.name,
                version["model_hash"],
                model.initial,
                Jsonb({v.name: v.initial for v in model.variables}),
                hash_token(ingest_key),
            ),
        ).fetchone()
        db.activity(conn, pid, "runtime.created", {"runtime_id": str(row["id"])})
    return {**row, "ingest_key": ingest_key}


def runtime_event(runtime_id: str, body: EventInput, current=None, ingest_key=None):
    with db.connection() as conn:
        runtime = conn.execute(
            "SELECT r.*,v.model FROM runtimes r JOIN versions v ON v.id=r.version_id WHERE r.id=%s FOR UPDATE OF r",
            (runtime_id,),
        ).fetchone()
        if not runtime:
            raise HTTPException(404, "Runtime not found")
        if current:
            project_access(runtime["project_id"], current)
        elif not ingest_key or not secrets.compare_digest(runtime["ingest_key_hash"], hash_token(ingest_key)):
            raise HTTPException(401, "Invalid runtime ingest key")
        existing = conn.execute(
            "SELECT * FROM traces WHERE runtime_id=%s AND event_id=%s", (runtime_id, body.event_id)
        ).fetchone()
        if existing:
            return {**existing, "duplicate": True}
        if runtime["status"] != "active":
            raise HTTPException(409, "This runtime is stopped")
        if runtime["sequence"] != body.expected_sequence:
            raise HTTPException(409, f"Event sequence conflict; current sequence is {runtime['sequence']}")
        model = Model.model_validate(runtime["model"])
        violations = []
        next_state, values, tid = runtime["state"], runtime["values"], None
        if body.model_hash != runtime["model_hash"]:
            violations.append("model_version_mismatch")
        if body.observed_state and body.observed_state != runtime["state"]:
            violations.append("state_desynchronization")
        if not violations:
            try:
                next_state, values, tid = transition(model, runtime["state"], runtime["values"], body.event)
            except ModelError as exc:
                violations.append(str(exc))
        if tid and runtime["strategy_id"]:
            strategy = conn.execute("SELECT data FROM proposals WHERE id=%s", (runtime["strategy_id"],)).fetchone()[
                "data"
            ]
            candidate = Model.model_validate(strategy["candidate"])
            try:
                restricted_state, restricted_values, _ = transition(
                    candidate, runtime["state"], runtime["values"], body.event
                )
                if (restricted_state, restricted_values) != (next_state, values):
                    raise ModelError("Policy disagrees with model")
            except ModelError:
                violations.append("event_rejected_by_approved_policy")
                next_state, values, tid = runtime["state"], runtime["values"], None
        context = {"state": next_state, **values}
        for prop in model.properties:
            if prop.operator == "AG" and not Predicate(prop.predicate, set(context))(context):
                violations.append(f"invariant:{prop.id}")
        if (
            body.latency_ms is not None
            and body.latency_budget_ms is not None
            and body.latency_ms > body.latency_budget_ms
        ):
            violations.append("reported_latency_budget_exceeded")
        seq = runtime["sequence"] + 1
        data = {
            "from": runtime["state"],
            "state": next_state,
            "values": values,
            "transition": tid,
            "model_hash": runtime["model_hash"],
            "reported_model_hash": body.model_hash,
            "violations": violations,
            "latency_ms": body.latency_ms,
            "event": body.event,
            "status": "violation" if violations else "accepted",
            "monitoring": "State sync, event order, version identity and AG predicates; liveness remains an offline proof.",
        }
        conn.execute(
            "UPDATE runtimes SET state=%s,values=%s,sequence=%s WHERE id=%s",
            (next_state, Jsonb(values), seq, runtime_id),
        )
        row = conn.execute(
            "INSERT INTO traces(runtime_id,event_id,sequence,event,data) VALUES(%s,%s,%s,%s,%s) RETURNING *",
            (runtime_id, body.event_id, seq, body.event, Jsonb(data)),
        ).fetchone()
        db.activity(conn, runtime["project_id"], "runtime.event", {"runtime_id": runtime_id, "sequence": seq, **data})
    return row


@app.post("/api/projects/{pid}/runtimes/{rid}/events")
def send_event(pid: str, rid: str, body: EventInput, request: Request, current=Depends(user)):
    project_access(pid, current)
    runtime = db.one("SELECT id FROM runtimes WHERE id=%s AND project_id=%s", (rid, pid))
    if not runtime:
        raise HTTPException(404, "Runtime not found")
    rate_limit(request, "events", 300, 60)
    return runtime_event(rid, body, current=current)


@app.post("/api/ingest/{rid}")
def ingest(rid: str, body: EventInput, request: Request):
    rate_limit(request, "ingest", 600, 60)
    return runtime_event(rid, body, ingest_key=request.headers.get("x-runtime-key"))


@app.get("/api/projects/{pid}/runtimes/{rid}/traces")
def traces(pid: str, rid: str, after: int = 0, latest: bool = False, current=Depends(user)):
    project_access(pid, current)
    if not db.one("SELECT id FROM runtimes WHERE id=%s AND project_id=%s", (rid, pid)):
        raise HTTPException(404, "Runtime not found")
    if latest:
        return list(
            reversed(db.many("SELECT * FROM traces WHERE runtime_id=%s ORDER BY sequence DESC LIMIT 500", (rid,)))
        )
    return db.many("SELECT * FROM traces WHERE runtime_id=%s AND sequence>%s ORDER BY sequence LIMIT 500", (rid, after))


@app.post("/api/projects/{pid}/runtimes/{rid}/stop")
def stop_runtime(pid: str, rid: str, current=Depends(user)):
    project_access(pid, current)
    with db.connection() as conn:
        row = conn.execute(
            "UPDATE runtimes SET status='stopped',ingest_key_hash='' WHERE id=%s AND project_id=%s RETURNING id",
            (rid, pid),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Runtime not found")
        db.activity(conn, pid, "runtime.stopped", {"runtime_id": rid})
    return {"status": "stopped"}


@app.post("/api/projects/{pid}/runtimes/{rid}/adapt")
def adapt_runtime(pid: str, rid: str, body: AdaptInput, current=Depends(user)):
    project_access(pid, current)
    with db.connection() as conn:
        runtime = conn.execute(
            "SELECT r.*,v.model FROM runtimes r JOIN versions v ON v.id=r.version_id "
            "WHERE r.id=%s AND r.project_id=%s FOR UPDATE OF r",
            (rid, pid),
        ).fetchone()
        strategy = conn.execute(
            "SELECT * FROM proposals WHERE id=%s AND project_id=%s AND kind='synthesis'", (body.strategy_id, pid)
        ).fetchone()
        if not runtime or not strategy:
            raise HTTPException(404, "Runtime or strategy not found")
        result = strategy["data"]
        if runtime["status"] != "active" or body.expected_sequence != runtime["sequence"]:
            raise HTTPException(409, "Runtime is stopped or changed. Refresh and review again.")
        if strategy["base_version_id"] != runtime["version_id"] or result.get("status") != "candidate":
            raise HTTPException(409, "A verified strategy for the active model version is required")
        candidate = Model.model_validate(result["candidate"])
        from .engine import build_graph

        cg = build_graph(candidate)
        if not any(
            sid == runtime["state"] and dict(zip([v.name for v in candidate.variables], vals)) == runtime["values"]
            for sid, vals in cg.nodes
        ):
            raise HTTPException(409, "Current runtime configuration is outside the verified strategy")
        conn.execute("UPDATE runtimes SET strategy_id=%s WHERE id=%s", (body.strategy_id, rid))
        seq = runtime["sequence"] + 1
        conn.execute("UPDATE runtimes SET sequence=%s WHERE id=%s", (seq, rid))
        data = {
            "status": "adapted",
            "state": runtime["state"],
            "model_hash": runtime["model_hash"],
            "strategy_id": body.strategy_id,
            "reviewer_id": str(current["id"]),
            "violations": [],
        }
        conn.execute(
            "INSERT INTO traces(runtime_id,event_id,sequence,event,data) VALUES(%s,%s,%s,%s,%s)",
            (rid, str(uuid.uuid4()), seq, "__adaptation__", Jsonb(data)),
        )
        db.activity(conn, pid, "runtime.adapted", {"runtime_id": rid, "sequence": seq, **data})
    return data


@app.get("/api/projects/{pid}/activity")
def project_activity(pid: str, after: int = 0, latest: bool = False, current=Depends(user)):
    project_access(pid, current)
    if latest:
        return list(reversed(db.many("SELECT * FROM activity WHERE project_id=%s ORDER BY id DESC LIMIT 250", (pid,))))
    return db.many("SELECT * FROM activity WHERE project_id=%s AND id>%s ORDER BY id LIMIT 250", (pid, after))


@app.get("/api/projects/{pid}/stream")
async def project_stream(pid: str, request: Request, after: int = 0, current=Depends(user)):
    await asyncio.to_thread(project_access, pid, current)
    token_hash = hash_token(request.headers["authorization"].split(" ", 1)[1])

    async def events():
        cursor, last_auth, start = max(after, 0), 0, time.monotonic()
        while time.monotonic() - start < 300:
            if await request.is_disconnected():
                return
            if time.monotonic() - last_auth > 20:
                valid = await asyncio.to_thread(
                    db.one, "SELECT 1 FROM sessions WHERE token_hash=%s AND expires_at>now()", (token_hash,)
                )
                if not valid:
                    yield "event: expired\ndata: {}\n\n"
                    return
                last_auth = time.monotonic()
            rows = await asyncio.to_thread(
                db.many, "SELECT * FROM activity WHERE project_id=%s AND id>%s ORDER BY id LIMIT 250", (pid, cursor)
            )
            for row in rows:
                cursor = row["id"]
                yield f"id: {cursor}\nevent: activity\ndata: {json.dumps(jsonable_encoder(row))}\n\n"
            if not rows:
                yield ": heartbeat\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})
