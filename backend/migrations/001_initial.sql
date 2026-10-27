CREATE TABLE users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions(user_id);
CREATE TABLE projects (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON projects(owner_id);
CREATE TABLE versions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), number int NOT NULL,
 model jsonb NOT NULL, model_hash text NOT NULL, requirements text NOT NULL DEFAULT '',
 note text NOT NULL DEFAULT '', approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id, number)
);
CREATE TABLE runs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
 version_id uuid NOT NULL REFERENCES versions(id), status text NOT NULL DEFAULT 'queued',
 result jsonb, worker_id text, started_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON runs(status, created_at);
CREATE TABLE proposals (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), kind text NOT NULL,
 base_version_id uuid REFERENCES versions(id), data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE artifacts (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
 version_id uuid NOT NULL REFERENCES versions(id), run_id uuid NOT NULL REFERENCES runs(id),
 model_hash text NOT NULL, content_hash text NOT NULL, files jsonb NOT NULL,
 manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE runtimes (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
 version_id uuid NOT NULL REFERENCES versions(id), artifact_id uuid NOT NULL REFERENCES artifacts(id),
 name text NOT NULL, model_hash text NOT NULL, state text NOT NULL, values jsonb NOT NULL,
 sequence bigint NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active',
 ingest_key_hash text NOT NULL, strategy_id uuid REFERENCES proposals(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE traces (
 id bigserial PRIMARY KEY, runtime_id uuid NOT NULL REFERENCES runtimes(id),
 event_id text NOT NULL, sequence bigint NOT NULL, event text NOT NULL,
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(runtime_id, event_id), UNIQUE(runtime_id, sequence)
);
CREATE TABLE activity (
 id bigserial PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), kind text NOT NULL,
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON activity(project_id, id);
CREATE TABLE rate_limits (
 key text PRIMARY KEY, count int NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL
);
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only evidence cannot be mutated'; END; $$;
CREATE TRIGGER traces_append_only BEFORE UPDATE OR DELETE ON traces FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER activity_append_only BEFORE UPDATE OR DELETE ON activity FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE FUNCTION protect_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.model IS DISTINCT FROM OLD.model OR NEW.model_hash IS DISTINCT FROM OLD.model_hash
    OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.requirements IS DISTINCT FROM OLD.requirements THEN
    RAISE EXCEPTION 'Model versions are immutable';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER versions_immutable BEFORE UPDATE ON versions FOR EACH ROW EXECUTE FUNCTION protect_version();
