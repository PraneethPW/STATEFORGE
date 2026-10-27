# Executable semantics

A configuration consists of a state identifier and the ordered tuple of finite variable values. Each variable uses a homogeneous domain so boolean and integer identities cannot alias. The initial configuration uses the declared initial state and variable initial values. Guards are side-effect-free boolean expressions over that configuration. Updates are simultaneous literal assignments to declared finite domains. There is no hidden environment input, arbitrary expression evaluator, external action execution, or implicit timer.

Two transitions with the same source and event must not have overlapping guards for any declared valuation, including currently unreachable valuations. Different event names represent distinct possible choices. All enabled environment events are explored. Terminal states must have no outgoing transitions. For temporal semantics, a configuration without successors gets a self-loop; nonterminal deadlocks also produce a blocking structural diagnostic. Unreachable named states are warnings with their identifiers, rather than proofs of invalid behavior.

## CTL

Predicates may use `state`, variable names, boolean/integer/string constants, typed equality/inequality, ordered integer/string comparisons, and `and`, `or`, `not`. Boolean `True` is distinct from integer `1`. Unknown names, calls, attributes, indexing, arithmetic, comprehensions, and executable code are rejected unless explicitly allowed by the closed predicate grammar.

Each operator applies to a predicate, not a nested CTL formula:

| Operator | Meaning from the initial configuration |
| --- | --- |
| AG | Every reachable configuration satisfies the predicate |
| AF | Every infinite path eventually reaches a satisfying configuration |
| EF | Some path reaches a satisfying configuration |
| EG | Some infinite path always stays in satisfying configurations |
| AX | Every immediate successor satisfies the predicate |
| EX | Some immediate successor satisfies the predicate |

AF/EF use least fixed points; AG/EG use greatest fixed points. Terminal stuttering gives standard infinite-path semantics. No fairness is inferred. A reachable non-goal cycle refutes AF even when a separate path reaches the goal. AF counterexamples and EG witnesses retain a cycle marker; AG violations and EF witnesses use reachable paths. Failed EF/EG can require branching evidence, so no artificial linear counterexample is invented.

## SPIN LTL

LTL properties use `G`, `F`, `U`, `R`, `!`, `&&`, `||`, `->`, and `<->`, with parentheses and state propositions `at_StateId`. Example: `G (at_Pending -> F at_Approved)`. `true` and `false` are constants. Next-time `X` and variable propositions are rejected. The adapter generates the exact reachable graph, invokes SPIN, compiles its generated verifier with GCC, runs acceptance-cycle checking, and replays error trails. Every result retains the tool version, options, translation, translation hash, configuration mapping, bounded log, and trace. No bit-state approximation is used.

The analysis shares a 20-second budget. A missing tool, timeout, compiler failure, incomplete search, memory exhaustion, or worker failure is not a proof. Code generation requires an exact passing result for the approved model checksum.

## Finite synthesis and adaptation

Synthesis solves a safety-plus-reachability game using explicit controller/environment ownership. A greatest fixed point first finds the safety kernel. A ranked attractor then finds configurations from which the controller can force the goal while the environment may choose any outgoing edge. Controller guards are restricted to winning choices with decreasing ranks until the goal. The candidate is independently checked against all original properties and the synthesis obligations. A strategy can still be rejected if it violates an existing property even when it solves the requested game.

Candidates are proposals, not model approvals. A user can adopt one as a new model version or explicitly activate it as a restrictive policy on a runtime using its exact base version. Current configuration membership is checked before activation. No unseen runtime behavior is invented or automatically deployed.

## Generated and observed behavior

The generated engine uses the same predicate interpreter and model data as the verifier. Conformance fixtures enumerate every reachable configuration and every declared event plus an invalid event. Generation is refused above 100,000 cases or a 16 MB package. The tests assert transition identity, destination, values, and invalid-event rejection. Manifests include model and payload checksums. Hashes establish traceability and tamper detection, not cryptographic signatures from an independent authority.

Runtime monitoring evaluates current AG invariants, transitions, event sequence, pinned model hash, and optional reported source state. AF/EF/EG/LTL remain offline properties; the monitor does not claim to detect all temporal violations online. External adapters are responsible for real side effects, reliable event delivery, and trustworthy latency measurements.
