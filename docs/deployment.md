# Deployment

The repository deploys the frontend on Vercel and two independent backend services on Railway, both backed by the same Neon database. Build and verify a reviewed commit before linking deployments. Railway's legacy `railway.json`/`railway.toml` config is deprecated for new services; configure the service fields through Railway or import them into its current Infrastructure as Code workflow.

## Railway API

- Source repository: `PraneethPW/STATEFORGE`, branch `main`.
- Root directory: `/backend`; Dockerfile: detected at that root.
- Start: the Dockerfile's Uvicorn command, listening on `PORT=8000`.
- Health check: `/api/health`, timeout 120 seconds.
- Automatic sleeping: disabled for live SSE connections.
- Variables: `DATABASE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL=openrouter/free`, `ENVIRONMENT=production`, `FRONTEND_URL`, `CORS_ORIGINS`, `PORT=8000`.
- Public service domain. TLS is provided at Railway's edge.

## Railway worker

- Same repository, branch, Docker image build and root directory.
- Start override: `python -m app.worker`.
- No HTTP health check or public domain.
- Automatic sleeping: disabled.
- Variables: `DATABASE_URL` and `ENVIRONMENT=production`. The worker does not need the OpenRouter key.
- Multiple workers may be added; claims use PostgreSQL row locks. Each worker executes one analysis at a time.

Both processes apply SQL migrations at startup under an advisory transaction lock. The schema is `stateforge`; existing unrelated schemas are not modified. Configure a migration-role/runtime-role split if your organization requires separately managed database permissions.

## Vercel

- Project: `stateforge-studio`.
- Root: `frontend`, framework: Vite, Node: 24.
- Install: `npm ci`, build: `npm run build`, output: `dist`.
- Set `VITE_API_URL=https://YOUR-API.up.railway.app/api` before building. It is a public URL, not a secret.
- Allow the exact production frontend origin in Railway `CORS_ORIGINS`; update `FRONTEND_URL` as well.
- `frontend/vercel.json` provides SPA fallback and security headers. Its connect policy permits Railway service domains; add your custom API domain if you use one.
- Production is accessible through the application login. Vercel account protection remains enabled for preview deployments.

## After deployment

Check `/api/health`, register a real account, create a project, save and approve a model, queue a run, wait for its worker result, download and run the generated package tests, start a runtime, dispatch an event, and inspect the stored trace. Verify a second session sees the event, reconnect resumes the stream, and unrelated users cannot read the project. Check Railway worker/API logs and Vercel build logs. Do not seed the production workspace with examples to make it look populated.

The frontend and backend require independent deployment rollbacks. Database migrations are forward-only; take a Neon branch or backup before destructive schema changes. Current migrations are additive and application-owned evidence remains immutable.
