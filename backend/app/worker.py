"""Durable DB-backed worker. Run separately from the API: python -m app.worker."""

import logging
import signal
import time
import uuid
from psycopg.types.json import Jsonb
from . import db
from .config import settings
from .engine import verify
from .schemas import Model

log = logging.getLogger("stateforge.worker")
running = True


def stop(*_):
    global running
    running = False


def work_once(worker_id):
    with db.connection() as conn:
        # A crashed worker cannot leave evidence permanently marked running.
        expired = conn.execute(
            "UPDATE runs SET status='error', finished_at=now(), result=%s "
            "WHERE status='running' AND started_at < now() - %s * interval '1 second' "
            "RETURNING id, project_id",
            (
                Jsonb({"status": "error", "message": "Worker lease expired. Queue a new verification run."}),
                settings().job_timeout_seconds,
            ),
        ).fetchall()
        for row in expired:
            db.activity(conn, row["project_id"], "run.finished", {"run_id": str(row["id"]), "status": "error"})
        job = conn.execute(
            "SELECT r.*,v.model FROM runs r JOIN versions v ON v.id=r.version_id "
            "WHERE r.status='queued' ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1"
        ).fetchone()
        if not job:
            return False
        conn.execute(
            "UPDATE runs SET status='running', worker_id=%s, started_at=now() WHERE id=%s", (worker_id, job["id"])
        )
        db.activity(conn, job["project_id"], "run.started", {"run_id": str(job["id"])})
    try:
        result = verify(Model.model_validate(job["model"]))
    except Exception:
        log.exception("Verification failed for run %s", job["id"])
        result = {"status": "error", "message": "Verification worker failed. Inspect server logs."}
    with db.connection() as conn:
        updated = conn.execute(
            "UPDATE runs SET status=%s,result=%s,finished_at=now() "
            "WHERE id=%s AND status='running' AND worker_id=%s RETURNING id",
            (result["status"], Jsonb(result), job["id"], worker_id),
        ).fetchone()
        if updated:
            db.activity(conn, job["project_id"], "run.finished", {"run_id": str(job["id"]), "status": result["status"]})
    return True


def main():
    logging.basicConfig(level=logging.INFO)
    db.migrate()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    worker_id = str(uuid.uuid4())
    log.info("Verification worker ready: %s", worker_id)
    while running:
        try:
            if not work_once(worker_id):
                time.sleep(settings().worker_poll_seconds)
        except Exception:
            log.exception("Worker polling failed")
            time.sleep(3)


if __name__ == "__main__":
    main()
