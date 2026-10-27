# Validation evidence

Validation was performed on 27 October 2026. Test records are explicitly owned by isolated QA accounts; application users start with empty workspaces. No benchmark measurements from the research paper are presented as StateForge results.

## Automated checks

The release suite includes 26 tests, with real SPIN/compiler execution and three API integration tests against a disposable PostgreSQL database. The cases include finite guard updates, generated engine equivalence, a 40-graph independent AF oracle, safety-versus-reachability semantics, liveness counterexample cycles, terminal stuttering, nondeterministic guards, typed configuration identity, expression injection, LTL grammar rejection, adversarial synthesis, property-preservation gates, tenant isolation, optimistic versions, immutable/append-only evidence, idempotency, stale model identities, adaptation and key revocation.

The TypeScript production build passes. The runtime dependency audit reported zero vulnerabilities at validation time. GitHub Actions checks the frontend build/audit and repeats backend analysis and PostgreSQL integration with SPIN installed.

## Browser checks

The application was exercised through the browser: account registration, project creation, validated JSON import, graph rendering, immutable version save, explicit review approval, verification completion, artifact generation, runtime creation, event dispatch, terminal state display, trace persistence, and runtime key revocation. The deployed frontend loads its Three.js visual and connects to the Railway API. Responsive breakpoints and reduced-motion paths are implemented; a separate mobile device compatibility campaign has not been performed.

## Live deployment checks

Fifteen checks passed against the deployed Railway API/worker and Neon database:

1. Public health route confirms a real database connection.
2. A separate worker completes CTL and SPIN LTL verification.
3. The generated ZIP downloads successfully.
4. The downloaded package passes its executable conformance suite.
5. An authenticated SSE subscriber connects.
6. External key-authenticated ingestion changes the real runtime state.
7. The committed event reaches the SSE subscriber.
8. Retrying an event is idempotent.
9. The runtime reaches the verified terminal state.
10. A stale model hash creates a recorded violation.
11. Finite-game synthesis returns an independently verified candidate.
12. A compatible strategy can be explicitly activated.
13. Stopping the runtime revokes ingestion.
14. A live OpenRouter free provider returns a validated proposal.
15. Logout revokes the account session.

The live solver identified itself as SPIN 6.5.2. Provider routing selected a real free model and its identifier was preserved with the proposal. Free routing is variable and subject to quota and availability; validation is evidence of the observed request, not an availability guarantee.

These are functional checks, not a sustained performance benchmark, independent security audit, timed-system proof, or formal certification of production operations. Remaining capability and operational boundaries are documented in [operations](operations.md) and [semantics](semantics.md).
