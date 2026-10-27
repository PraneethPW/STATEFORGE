from contextlib import contextmanager
from pathlib import Path
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from .config import settings

_pool = None


def pool():
    global _pool
    if _pool is None:
        cfg = settings()
        if not cfg.database_url:
            raise RuntimeError("DATABASE_URL is required; no local or mock fallback is configured")
        _pool = ConnectionPool(
            cfg.database_url,
            min_size=1,
            max_size=cfg.database_pool_size,
            timeout=10,
            kwargs={"row_factory": dict_row, "connect_timeout": 10},
            open=True,
        )
        _pool.wait(timeout=15)
    return _pool


@contextmanager
def connection():
    with pool().connection() as conn:
        conn.execute("SET LOCAL search_path TO stateforge, public")
        conn.execute("SET LOCAL statement_timeout TO '15s'")
        yield conn


def one(sql, params=()):
    with connection() as conn:
        return conn.execute(sql, params).fetchone()


def many(sql, params=()):
    with connection() as conn:
        return conn.execute(sql, params).fetchall()


def activity(conn, project_id, kind, data):
    conn.execute("INSERT INTO activity(project_id, kind, data) VALUES (%s,%s,%s)", (project_id, kind, Jsonb(data)))


def migrate():
    with connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(93846210)")
        conn.execute("CREATE SCHEMA IF NOT EXISTS stateforge")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"
        )
        for file in sorted((Path(__file__).parent.parent / "migrations").glob("*.sql")):
            if not conn.execute("SELECT 1 FROM schema_migrations WHERE name=%s", (file.name,)).fetchone():
                conn.execute(file.read_text())
                conn.execute("INSERT INTO schema_migrations(name) VALUES (%s)", (file.name,))


if __name__ == "__main__":
    migrate()
    print("Database migrations applied")
