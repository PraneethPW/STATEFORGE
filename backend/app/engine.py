"""Exact explicit-state verification for a bounded finite transition system.

No eval, subprocesses, LLM verdicts, fairness assumptions, or sampled paths.
Terminal configurations are totalized with a stutter edge for CTL semantics.
"""

import ast
import hashlib
import itertools
import json
import time
from collections import deque
from dataclasses import dataclass
from typing import Any
from .schemas import Model

ENGINE_VERSION = "stateforge-explicit/1.0.0"
MAX_SECONDS = 20


class ModelError(ValueError):
    pass


class BudgetExceeded(Exception):
    pass


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class Predicate:
    def __init__(self, text: str, names: set[str]):
        try:
            self.tree = ast.parse(text, mode="eval").body
        except (SyntaxError, RecursionError) as exc:
            raise ModelError(f"Invalid predicate: {text}") from exc
        allowed = (
            ast.Expression,
            ast.BoolOp,
            ast.And,
            ast.Or,
            ast.UnaryOp,
            ast.Not,
            ast.Compare,
            ast.Eq,
            ast.NotEq,
            ast.Lt,
            ast.LtE,
            ast.Gt,
            ast.GtE,
            ast.Name,
            ast.Load,
            ast.Constant,
            ast.USub,
        )
        nodes = list(ast.walk(self.tree))
        if len(nodes) > 100:
            raise ModelError("Predicate is too complex")
        for n in nodes:
            if not isinstance(n, allowed):
                raise ModelError("Use constants, variable names, comparisons, and/or/not only")
            if isinstance(n, ast.Name) and n.id not in names:
                raise ModelError(f"Unknown predicate variable: {n.id}")
            if isinstance(n, ast.Constant) and type(n.value) not in (str, int, bool):
                raise ModelError("Unsupported predicate constant")

    def __call__(self, context: dict) -> bool:
        def visit(n):
            if isinstance(n, ast.Constant):
                return n.value
            if isinstance(n, ast.Name):
                return context[n.id]
            if isinstance(n, ast.UnaryOp):
                value = visit(n.operand)
                if isinstance(n.op, ast.Not):
                    return not value
                if type(value) is not int:
                    raise ModelError("Unary minus requires an integer")
                return -value
            if isinstance(n, ast.BoolOp):
                vals = [bool(visit(x)) for x in n.values]
                return all(vals) if isinstance(n.op, ast.And) else any(vals)
            if isinstance(n, ast.Compare):
                left = visit(n.left)
                for op, right_node in zip(n.ops, n.comparators):
                    right = visit(right_node)
                    same = type(left) is type(right)
                    if isinstance(op, ast.Eq):
                        ok = same and left == right
                    elif isinstance(op, ast.NotEq):
                        ok = not same or left != right
                    else:
                        if not same or type(left) not in (int, str):
                            raise ModelError("Ordered comparisons require matching integers or strings")
                        if isinstance(op, ast.Lt):
                            ok = left < right
                        elif isinstance(op, ast.LtE):
                            ok = left <= right
                        elif isinstance(op, ast.Gt):
                            ok = left > right
                        else:
                            ok = left >= right
                    if not ok:
                        return False
                    left = right
                return True
            raise ModelError("Unsupported predicate")

        result = visit(self.tree)
        if type(result) is not bool:
            raise ModelError("Predicates must evaluate to a boolean")
        return result


@dataclass
class Graph:
    model: Model
    nodes: list[tuple[str, tuple]]
    edges: dict[int, list[tuple[int, str | None]]]
    parents: dict[int, tuple[int, str]]
    diagnostics: list[dict]

    def context(self, index):
        state, values = self.nodes[index]
        return {"state": state, **dict(zip([v.name for v in self.model.variables], values))}

    def step(self, index, via=None):
        return {"configuration": index, **self.context(index), "transition": via}

    def path(self, index):
        result = []
        while index != 0:
            parent, via = self.parents[index]
            result.append(self.step(index, via))
            index = parent
        return [self.step(0), *reversed(result)]


def build_graph(model: Model, deadline=None) -> Graph:
    deadline = deadline or time.monotonic() + MAX_SECONDS
    states = {s.id: s for s in model.states}
    names = {"state", *(v.name for v in model.variables)}
    guards = {t.id: Predicate(t.guard, names) for t in model.transitions}
    for prop in model.properties:
        if prop.operator == "LTL":
            from .spin import formula

            formula(prop.predicate, model.states)
        else:
            Predicate(prop.predicate, names)
    outgoing = {s: [t for t in model.transitions if t.source == s] for s in states}
    diagnostics = []
    # Check every finite valuation, including guards at currently unreachable states.
    domains = [v.domain for v in model.variables]
    for sid, state in states.items():
        if state.terminal and outgoing[sid]:
            diagnostics.append(
                {
                    "severity": "error",
                    "code": "terminal_outgoing",
                    "state": sid,
                    "message": f"Terminal state {sid} has outgoing transitions",
                }
            )
        overlap = set()
        for values in itertools.product(*domains):
            if time.monotonic() > deadline:
                raise BudgetExceeded()
            context = {"state": sid, **dict(zip([v.name for v in model.variables], values))}
            enabled = [t for t in outgoing[sid] if guards[t.id](context)]
            grouped = {}
            for t in enabled:
                if t.event in grouped:
                    pair = tuple(sorted([grouped[t.event], t.id]))
                    if pair not in overlap:
                        diagnostics.append(
                            {
                                "severity": "error",
                                "code": "nondeterminism",
                                "state": sid,
                                "transitions": list(pair),
                                "valuation": context,
                                "message": f"Overlapping guards for event {t.event} in {sid}",
                            }
                        )
                        overlap.add(pair)
                grouped[t.event] = t.id
    nodes = [(model.initial, tuple(v.initial for v in model.variables))]
    index = {nodes[0]: 0}
    edges, parents = {}, {}
    queue = deque([0])
    dead_states = set()
    while queue:
        if time.monotonic() > deadline:
            raise BudgetExceeded()
        i = queue.popleft()
        sid, values = nodes[i]
        context = {"state": sid, **dict(zip([v.name for v in model.variables], values))}
        successors = []
        for t in outgoing[sid]:
            if not guards[t.id](context):
                continue
            updated = tuple(t.updates.get(v.name, val) for v, val in zip(model.variables, values))
            key = (t.target, updated)
            if key not in index:
                if len(nodes) >= 10000:
                    raise BudgetExceeded()
                index[key] = len(nodes)
                nodes.append(key)
                parents[index[key]] = (i, t.id)
                queue.append(index[key])
            successors.append((index[key], t.id))
        if not successors and not states[sid].terminal and sid not in dead_states:
            diagnostics.append(
                {
                    "severity": "error",
                    "code": "deadlock",
                    "state": sid,
                    "valuation": context,
                    "message": f"No enabled event in nonterminal state {sid}",
                }
            )
            dead_states.add(sid)
        edges[i] = successors or [(i, None)]
    reachable = {sid for sid, _ in nodes}
    for sid in states.keys() - reachable:
        diagnostics.append(
            {
                "severity": "warning",
                "code": "unreachable",
                "state": sid,
                "message": f"{sid} is unreachable from the initial configuration",
            }
        )
    return Graph(model, nodes, edges, parents, diagnostics)


def check_property(graph: Graph, prop, deadline) -> dict:
    all_nodes = set(range(len(graph.nodes)))
    pred = Predicate(prop.predicate, {"state", *(v.name for v in graph.model.variables)})
    target = {i for i in all_nodes if pred(graph.context(i))}
    op = prop.operator
    successors = {i: {j for j, _ in graph.edges[i]} for i in all_nodes}
    if op in ("AF", "EF"):
        accepted = set(target)
        while True:
            if time.monotonic() > deadline:
                raise BudgetExceeded()
            more = {
                i
                for i in all_nodes - accepted
                if (successors[i] <= accepted if op == "AF" else bool(successors[i] & accepted))
            }
            if not more:
                break
            accepted |= more
    elif op in ("AG", "EG"):
        accepted = set(target)
        while True:
            if time.monotonic() > deadline:
                raise BudgetExceeded()
            keep = {
                i for i in accepted if (successors[i] <= accepted if op == "AG" else bool(successors[i] & accepted))
            }
            if keep == accepted:
                break
            accepted = keep
    else:
        accepted = {i for i in all_nodes if (successors[i] <= target if op == "AX" else bool(successors[i] & target))}
    passed = 0 in accepted
    trace, loop_index = [], None
    if op == "AG" and not passed:
        trace = graph.path(next(i for i in all_nodes if i not in target))
    elif op == "EF" and passed:
        trace = graph.path(next(i for i in all_nodes if i in target))
    elif (op == "AF" and not passed) or (op == "EG" and passed):
        allowed = (all_nodes - accepted) if op == "AF" else accepted
        current, seen, incoming = 0, {}, None
        while current not in seen:
            seen[current] = len(trace)
            next_node, tid = next((j, tid) for j, tid in graph.edges[current] if j in allowed)
            trace.append(graph.step(current, None if not trace else incoming))
            incoming = tid
            current = next_node
        loop_index = seen[current]
        trace.append(graph.step(current, incoming))
    elif op in ("AX", "EX"):
        candidates = [(j, t) for j, t in graph.edges[0] if (j not in target if not passed else j in target)]
        if candidates:
            j, t = candidates[0]
            trace = [graph.step(0), graph.step(j, t)]
    return {
        "property_id": prop.id,
        "name": prop.name,
        "formula": f"{op} ({prop.predicate})",
        "status": "passed" if passed else "failed",
        "trace": trace,
        "loop_index": loop_index,
        "satisfying_configurations": len(accepted),
    }


def verify(model: Model) -> dict:
    start = time.monotonic()
    deadline = start + MAX_SECONDS
    base = {
        "engine": ENGINE_VERSION,
        "model_hash": digest(model.model_dump()),
        "semantics": "Finite CTL / SPIN LTL, all enabled events; no fairness; terminal stuttering",
        "limits": {"configurations": 10000, "seconds": MAX_SECONDS},
    }
    try:
        graph = build_graph(model, deadline)
        from .spin import check as spin_check

        results = [
            spin_check(graph, p, deadline) if p.operator == "LTL" else check_property(graph, p, deadline)
            for p in model.properties
        ]
        structural = any(d["severity"] == "error" for d in graph.diagnostics)
        statuses = {p["status"] for p in results}
        status = (
            "failed"
            if structural or "failed" in statuses
            else next((s for s in ("timeout", "error", "unavailable") if s in statuses), "passed")
        )
        return {
            **base,
            "status": status,
            "diagnostics": graph.diagnostics,
            "properties": results,
            "configurations": len(graph.nodes),
            "edges": sum(len(es) for es in graph.edges.values()),
            "duration_ms": round((time.monotonic() - start) * 1000, 3),
        }
    except BudgetExceeded:
        return {
            **base,
            "status": "timeout",
            "diagnostics": [],
            "properties": [],
            "duration_ms": round((time.monotonic() - start) * 1000, 3),
        }
    except ModelError as exc:
        return {
            **base,
            "status": "failed",
            "diagnostics": [{"severity": "error", "code": "predicate", "message": str(exc)}],
            "properties": [],
            "duration_ms": round((time.monotonic() - start) * 1000, 3),
        }


def synthesize(model: Model, safe: str, goal: str) -> dict:
    """Solve a finite, turn-based safety + reachability game via attractor ranks.

    The environment chooses every outgoing edge of environment-owned states.
    The controller chooses one edge in controller-owned configurations.
    The result is a candidate model, never an automatically approved runtime policy.
    """
    deadline = time.monotonic() + MAX_SECONDS
    graph = build_graph(model, deadline)
    if any(x["severity"] == "error" for x in graph.diagnostics):
        raise ModelError("Fix structural errors before synthesis")
    names = {"state", *(v.name for v in model.variables)}
    safety, objective = Predicate(safe, names), Predicate(goal, names)
    safe_set = {i for i in range(len(graph.nodes)) if safety(graph.context(i))}
    # Once a goal is reached, safety must still hold indefinitely.
    kernel = set(safe_set)
    owners = {s.id: s.owner for s in model.states}
    while True:
        if time.monotonic() > deadline:
            raise BudgetExceeded()
        nxt = {
            i
            for i in kernel
            if (
                any(j in kernel for j, _ in graph.edges[i])
                if owners[graph.nodes[i][0]] == "controller"
                else all(j in kernel for j, _ in graph.edges[i])
            )
        }
        if nxt == kernel:
            break
        kernel = nxt
    winning = {i for i in kernel if objective(graph.context(i))}
    rank = {i: 0 for i in winning}
    level = 0
    while True:
        if time.monotonic() > deadline:
            raise BudgetExceeded()
        add = {
            i
            for i in kernel - winning
            if (
                any(j in winning for j, _ in graph.edges[i])
                if owners[graph.nodes[i][0]] == "controller"
                else all(j in winning for j, _ in graph.edges[i])
            )
        }
        if not add:
            break
        level += 1
        rank.update({i: level for i in add})
        winning |= add
    if 0 not in winning:
        return {
            "status": "unrealizable",
            "engine": ENGINE_VERSION,
            "winning_configurations": len(winning),
            "reason": "The environment can prevent the reachability goal or violate safety.",
        }
    candidate = model.model_copy(deep=True)
    chosen = {}
    transitions = {t.id: t for t in model.transitions}
    for i in sorted(winning):
        sid = graph.nodes[i][0]
        if owners[sid] != "controller":
            continue
        valid = [
            (j, tid)
            for j, tid in graph.edges[i]
            if tid and j in kernel and (rank[i] == 0 or (j in rank and rank[j] < rank[i]))
        ]
        if valid:
            chosen[i] = valid[0][1]
    # Generate guards over exact finite valuations. Environment transitions stay unchanged.
    candidate.transitions = [t for t in candidate.transitions if owners[t.source] == "environment"]
    for count, (i, tid) in enumerate(chosen.items()):
        original = transitions[tid]
        conditions = [original.guard]
        for v, val in zip(model.variables, graph.nodes[i][1]):
            conditions.append(f"{v.name} == {val!r}")
        candidate.transitions.append(
            original.model_copy(update={"id": f"Syn{count}", "guard": " and ".join(f"({c})" for c in conditions)})
        )
    # Re-validate bounds and identifiers before exposing generated candidates.
    candidate = Model.model_validate(candidate.model_dump())
    evidence = verify(candidate)
    goal_prop = type(
        "P", (), {"id": "synth_goal", "name": "Synthesis reachability objective", "operator": "AF", "predicate": goal}
    )()
    safe_prop = type(
        "P", (), {"id": "synth_safe", "name": "Synthesis safety objective", "operator": "AG", "predicate": safe}
    )()
    cg = build_graph(candidate, deadline)
    obligations = [check_property(cg, p, deadline) for p in (safe_prop, goal_prop)]
    return {
        "status": "candidate"
        if evidence["status"] == "passed" and all(p["status"] == "passed" for p in obligations)
        else "rejected",
        "engine": ENGINE_VERSION,
        "winning_configurations": len(winning),
        "candidate": candidate.model_dump(),
        "verification": evidence,
        "objectives": obligations,
        "safe": safe,
        "goal": goal,
    }


def transition(model: Model, state: str, values: dict, event: str):
    context = {"state": state, **values}
    options = [
        t
        for t in model.transitions
        if t.source == state and t.event == event and Predicate(t.guard, set(context))(context)
    ]
    if len(options) != 1:
        raise ModelError("Event has no enabled transition" if not options else "Event is nondeterministic")
    t = options[0]
    return t.target, {**values, **t.updates}, t.id
