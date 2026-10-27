# StateForge

StateForge connects requirements, versioned finite-state models, formal verification, generated Python engines, and live runtime monitoring. All application data is persisted in PostgreSQL. The application starts empty: there are no seeded projects, fabricated metrics, simulated verification verdicts, or mock API fallbacks.

Live application: [stateforge-studio.vercel.app](https://stateforge-studio.vercel.app)  
API health: [Railway](https://stateforge-api-production.up.railway.app/api/health)  
Source: [PraneethPW/STATEFORGE](https://github.com/PraneethPW/STATEFORGE)

## Repository

```text
StateForge/
├── frontend/                 React + TypeScript + Vite
│   ├── src/components/       Graph editor, evidence viewer, runtime console
│   ├── src/api.ts            Authenticated HTTP and resumable SSE
│   ├── src/styles.css        Responsive design and reduced-motion support
│   └── vercel.json           Frontend deployment and security headers
├── backend/                  FastAPI + Python 3.12
│   ├── app/engine.py         Exact finite-state CTL verification and game synthesis
│   ├── app/spin.py           SPIN LTL adapter and normalized counterexamples
│   ├── app/codegen.py        Portable engine and exhaustive conformance fixtures
│   ├── app/worker.py         Durable PostgreSQL-backed verification queue
│   ├── app/main.py           Authentication, projects, models, runs, ingestion, SSE
│   ├── migrations/           Versioned, locked SQL migrations
│   ├── tests/                Engine, SPIN, generated-code and real PostgreSQL tests
│   ├── Dockerfile            Non-root API/worker image with SPIN and compiler
│   └── requirements.lock     Resolved Python dependency constraints
├── docs/                     Architecture, semantics, deployment and operations
└── .github/workflows/ci.yml   Build, analysis and database integration checks
```

## Run locally

Requires Node.js 24, Python 3.12+, a real PostgreSQL database (Neon is supported), and SPIN plus a C compiler for LTL properties. CTL and finite game synthesis do not need an external solver.

1. Copy `backend/.env.example` to `backend/.env` and supply `DATABASE_URL` and `OPENROUTER_API_KEY`. Use Neon’s pooled connection URL with TLS. Environment values override the file. **Do not commit secrets.**
2. From `backend`, run:

   ```sh
   python3.12 -m venv .venv
   source .venv/bin/activate
   pip install -c requirements.lock -e '.[dev]'
   python -m app.db
   uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

3. In another terminal, from `backend` with the same environment:

   ```sh
   source .venv/bin/activate
   python -m app.worker
   ```

4. From `frontend`:

   ```sh
   npm ci
   npm run dev
   ```

Open `http://127.0.0.1:5173`. The Vite development proxy connects `/api` to FastAPI. Interactive API documentation is at `http://127.0.0.1:8000/docs`. Production requires `VITE_API_URL` at frontend build time.

## Use the complete workflow

1. Register your account and create a project. Accounts own isolated projects.
2. Open Model studio. Add states and transitions, or enter requirements and request an OpenRouter draft. AI outputs are validated proposals requiring explicit review.
3. Add finite variables and temporal properties. Set an initial state. Link elements to source requirements. Inspect assumptions and resolve proposal ambiguities.
4. Save an immutable version, review it, and approve it. The worker processes queued verification runs and streams updates to the browser.
5. Inspect failed properties and counterexample paths. Optionally request one of at most five repair proposals per base version, review it, save a revision, and reverify.
6. Generate and download an engine package after a passing run. Run its included tests with `python -m unittest -v test_engine.py`.
7. Start a monitored runtime using that artifact. Dispatch real events from the console or integrate the authenticated ingestion API. Save the one-time runtime key securely.
8. Synthesize a controller strategy using a safety predicate and reachability goal. State ownership determines adversarial environment decisions. Candidate strategies are independently checked. Activate a reviewed candidate only for its exact source version and reachable current configuration.

## Formal support and limits

- Flat deterministic event-driven machines with boolean, integer, and string variables over explicit, homogeneous finite domains. Transition updates assign literal domain values.
- Up to 150 states, 600 transitions, 60 properties, 8 variables, and 10,000 configurations. The shared analysis time budget is 20 seconds.
- CTL: `AG`, `AF`, `EF`, `EG`, `AX`, and `EX` with non-nested boolean predicates. Guards use constants, names, comparisons, `and`, `or`, and `not`. No arbitrary `eval`, Python calls, indexing, or arithmetic.
- SPIN LTL: nested `G`, `F`, `U`, `R`, `!`, `&&`, `||`, `->`, `<->`, parentheses, and state propositions `at_StateId`. No `X` or variable propositions. Translations, configuration maps, solver options, versions, logs, and counterexample traces are preserved in evidence.
- Terminal configurations stutter. All enabled environment events are possible, without fairness. `AF` therefore fails when an event can be postponed indefinitely by a cycle.
- Synthesis solves a finite turn-based safety/reachability game, not unrestricted LTL reactive synthesis or SyGuS.
- Runtime monitoring checks event validity/order, model identity, optional reported state synchronization, and current `AG` invariant predicates. Supplied latency measurements and budgets are marked as reported data. Offline temporal proofs are not represented as online liveness detection.
- Hierarchical/parallel statecharts, timed/probabilistic automata, UPPAAL, nuXmv, SemML/Strix, SyGuS, and automatic external side effects are not implemented. These need additional semantics and solver adapters; the application does not claim to provide them.

A successful run proves the encoded properties of the encoded finite model. It is not certification of stakeholder requirements, arbitrary application effects, or the entire paper’s research vision. ML training is not added without a dataset and measured evaluation; OpenRouter assists interpretation and repair while formal engines control verdicts.

## Verification

```sh
cd frontend && npm ci && npm run build
cd ../backend
source .venv/bin/activate
ruff check app tests
pytest -q
# For database integration tests, explicitly select a disposable PostgreSQL database:
STATEFORGE_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/stateforge_test pytest -q
```

Integration tests create test-owned accounts and evidence in the specified database. They never select Neon implicitly and do not insert data into application workspaces. The suite exercises safety/liveness differences, guard overlap, code injection rejection, generated-code equivalence, adversarial synthesis, real SPIN results, authentication and tenant boundaries, immutable versions, generation gates, idempotency, stale hashes, runtime adaptation, key revocation, and evidence mutation rejection. A fixed-seed graph oracle independently checks `AF` over 40 transition systems.

## Deploy

See [deployment](docs/deployment.md) for the two Railway services and Vercel frontend, [semantics](docs/semantics.md) for precise analysis behavior, and [operations](docs/operations.md) for maintenance and remaining launch considerations.

OpenRouter free routing uses real provider capacity and quotas. A missing key, provider rejection, timeout, unavailable solver, or incomplete search is surfaced as an operational result; none becomes a successful proof or fabricated model.
