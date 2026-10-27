# Architecture

The browser sends authenticated requests to FastAPI on Railway. The API stores all application state in a dedicated `stateforge` schema in Neon PostgreSQL. No frontend database credentials or OpenRouter credentials are emitted into the browser bundle.

## Data and trust boundaries

Projects belong to one authenticated user. Every project operation checks ownership. Opaque 384-bit account sessions are stored as SHA-256 hashes with a 12-hour expiry; the browser keeps the bearer in session storage, not URLs. Passwords use per-user salted scrypt. Account logout and password changes revoke stored sessions. Runtime keys are separately scoped to one instance and displayed once; stopping the instance revokes ingestion.

Model versions preserve requirements, element identifiers, coordinates, source references, explicit assumptions, canonical SHA-256 checksums, review approval, and revision notes. A project row lock and expected version protect concurrent saves. New models do not overwrite prior versions or change existing runtime instances.

Verification jobs are committed before the API returns. Independent Railway workers claim jobs with `FOR UPDATE SKIP LOCKED`, then commit the lease before computation. Jobs store their exact model version, engine version, resource limits, evidence, and terminal status. Expired leases become errors. They are never promoted to passing results.

The explicit-state engine enumerates reachable configurations and applies CTL fixed points. SPIN receives a generated Promela transition graph and an LTL formula parsed through a closed grammar. No arbitrary Promela or C is accepted from clients. Compiler and verifier subprocesses receive a minimal environment without application secrets, run in temporary directories, and use OS CPU, memory (Linux), output and descriptor budgets. The worker Docker image runs as a non-root user. Model-generated application code is downloaded, not executed by the service.

AI requests go only from FastAPI to OpenRouter. The validated draft, actual provider model, usage information, ambiguity list, and prompt version become a proposal. User review precedes model acceptance. Repair attempts are bounded per base version. A repair cannot delete or weaken original property formulas; candidate models are independently verified and failed candidates cannot be adopted directly. AI never writes verification verdicts.

## Live updates and ingestion

Each mutation appends an activity record in the same transaction as the domain data. The API streams those durable IDs through authenticated fetch/SSE. A reconnect uses the last received ID, and all replicas read the same source. The server checks session validity while a stream is open. Streams close after five minutes and the client reconnects. PostgreSQL polling is once per second; this is near-real-time rather than a hard realtime latency guarantee.

Runtime events lock the instance row, enforce sequence order, check idempotency, verify model identity, evaluate guards, apply literal updates, and evaluate current invariants. Accepted transitions and rejected events are recorded in append-only traces. Database triggers reject trace/activity mutation and protect model content. Out-of-sequence submissions receive a conflict response and must refresh before retrying.

An approved adaptation narrows available behavior through a verified strategy for the exact original version. It cannot change the current state or model hash. Candidate reachability is checked before activation, and activation is itself an append-only trace entry.

## Dependency chain

Requirements → model version → review → verification run → artifact manifest → runtime instance → trace.

Changing a requirement produces a new model version. Earlier evidence stays tied to its original checksum; it does not authorize generation or runtime creation for the new version. Existing runtimes continue using the old immutable version. This conservative invalidation recomputes the whole new model; selective incremental property invalidation is not implemented.
