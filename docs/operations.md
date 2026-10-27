# Operations and release boundaries

The repository includes functioning security and reliability controls: password hashing, expiring revocable sessions, tenant ownership checks, database-backed rate limits, bounded request payloads and model size, parameterized SQL, non-root solver workers, durable jobs, idempotent runtime ingestion, optimistic model versions, append-only evidence triggers, exact hash gates, restricted CORS, frontend CSP, and reduced-motion support.

Production readiness still depends on the intended audience, traffic, risk profile, and hosting configuration. This implementation has not undergone an independent security audit, sustained load test, disaster recovery exercise, or formal certification. Do not represent unit/integration results as measured production scalability or reproduction of the paper's benchmark claims.

## Day-to-day checks

- Monitor API health, error counts, Neon storage/connection usage, Railway CPU/memory, worker queue age, error/timeout rates, and OpenRouter quotas.
- Retain database backups and test restoration to a separate environment. Confirm your Neon plan's restore window.
- Expired sessions and rate-limit rows can be pruned with explicit SQL retention jobs. Project evidence is append-only; an evidence-retention policy must be designed before long-term high-volume use.
- Rotate database passwords and the OpenRouter key through their provider consoles, then update the local ignored environment and Railway variables. Never copy actual credentials into README files, CI logs, source control, browser bundles, or screenshots.
- The Uvicorn image trusts proxy forwarding headers because Railway is the public ingress. If you expose it directly or introduce another ingress, configure trusted proxies and verify the effective client IP used for rate limiting.
- Limits are currently request-source based. Use an edge WAF and account-scoped quotas for open multi-tenant scale. Add stream-connection quotas and measured ingestion budgets before high-volume public service.
- Generated payloads are limited to 100,000 conformance cases and 16 MB. Source models are bounded to 10,000 configurations and 20 seconds of shared analysis. Decompose models when they exceed those limits.

## Features that need further product work

- Email ownership verification, self-service password recovery, MFA/SSO, team collaboration, roles, invitations, and account lifecycle management are not included. Password changes revoke sessions; recovery without the old password needs a verified identity channel.
- Selective incremental impact analysis is not implemented; each revision invalidates prior evidence for that revision and recomputes all properties.
- Flat finite-state semantics, supported CTL, SPIN LTL and safety/reachability games are implemented. Timed/probabilistic and hierarchical models, broader synthesis engines, and semantic translations to those engines need separate implementation and validation.
- Runtime events preserve attempted invalid behavior and pin the original model. The service does not execute external effects, arbitrary uploaded code, physical device controls, or unrestricted adaptive mutations.
- Evidence shown in the UI is paginated/bounded: newest 100 project versions/runs/artifacts/runtimes, 40 proposals, 250 activity events, and 500 runtime traces. Earlier version lookup and sequence-based trace/activity APIs remain available. An archival/export product is needed for large historical workspaces.

## Source references

Implementation choices were checked against the current primary documentation:

- [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request) and [model catalog](https://openrouter.ai/docs/api/api-reference/models/get-models).
- [Neon pooled connection behavior](https://neon.com/docs/connect/connection-errors).
- [FastAPI streaming responses](https://fastapi.tiangolo.com/advanced/custom-response/).
- [SPIN analyzer options](https://spinroot.com/spin/Man/Pan.html) and [SPIN manual](https://www.spinroot.com/spin/Man/Manual.html).
- [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) and [monorepo deployment](https://docs.railway.com/deployments/monorepo).
