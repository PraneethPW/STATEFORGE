"""SPIN LTL adapter with closed grammar, isolated temp files and process budgets.

Supported LTL: G F U R, ! && || -> <->; atoms at_<state-id>, true, false.
X is deliberately rejected: default SPIN distributions do not enable next-time.
"""

import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from .engine import ModelError, digest


def formula(text, states):
    tokens = re.findall(r"<->|->|&&|\|\||[!()]|[A-Za-z][A-Za-z0-9_]*", text)
    if "".join(tokens) != re.sub(r"\s+", "", text) or len(tokens) > 120:
        raise ModelError("Invalid LTL syntax. Use G F U R ! && || -> <-> and at_<state-id> atoms.")
    valid_atoms = {f"at_{s.id}" for s in states} | {"true", "false"}
    at = 0
    precedence = {"<->": 1, "->": 2, "||": 3, "&&": 4, "U": 5, "R": 5}

    def parse(minimum=0):
        nonlocal at
        if at >= len(tokens):
            raise ModelError("Incomplete LTL formula")
        token = tokens[at]
        at += 1
        if token in ("G", "F", "!"):
            symbol = {"G": "[]", "F": "<>", "!": "!"}[token]
            left = f"({symbol} {parse(6)})"
        elif token == "(":
            left = parse()
            if at >= len(tokens) or tokens[at] != ")":
                raise ModelError("Unbalanced LTL parentheses")
            at += 1
        elif token in valid_atoms:
            left = token
        else:
            raise ModelError(f"Unknown LTL atom or operator: {token}")
        while at < len(tokens) and tokens[at] in precedence and precedence[tokens[at]] >= minimum:
            op = tokens[at]
            at += 1
            right = parse(precedence[op] + (0 if op == "->" else 1))
            left = f"({left} {'V' if op == 'R' else op} {right})"
        return left

    result = parse()
    if at != len(tokens):
        raise ModelError("Unexpected LTL token")
    return result


def available():
    return bool(shutil.which("spin") and (shutil.which("gcc") or shutil.which("cc")))


def run_tool(args, folder, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired(args, 0)
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "TMPDIR": str(folder), "LANG": "C", "LC_ALL": "C"}
    # Log to a file under RLIMIT_FSIZE, not an unbounded memory pipe.
    with tempfile.TemporaryFile() as output:
        proc = subprocess.Popen(
            [sys.executable, "-I", str(Path(__file__).with_name("solver_runner.py")), *args],
            cwd=folder,
            env=env,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            raise
        output.seek(0)
        return proc.returncode, output.read(16000).decode(errors="replace")


def check(graph, prop, deadline):
    started = time.monotonic()
    ltl = formula(prop.predicate, graph.model.states)
    base = {
        "property_id": prop.id,
        "name": prop.name,
        "formula": prop.predicate,
        "backend": "SPIN",
        "trace": [],
        "loop_index": None,
        "satisfying_configurations": None,
    }
    if not available():
        return {
            **base,
            "status": "unavailable",
            "message": "SPIN and a C compiler are required in the verification worker.",
        }
    definitions = []
    for state in graph.model.states:
        indices = [str(i) for i, (sid, _) in enumerate(graph.nodes) if sid == state.id]
        atom = " || ".join(f"config == {i}" for i in indices) or "false"
        definitions.append(f"#define at_{state.id} ({atom})")
    tids = [None, *[t.id for t in graph.model.transitions]]
    branches = []
    for i, es in graph.edges.items():
        for j, tid in es:
            branches.append(
                f':: atomic {{ config == {i} -> config = {j}; printf("SFTRACE:%d:{tids.index(tid)}\\n", config) }}'
            )
    source = "\n".join(
        [
            *definitions,
            "int config = 0;",
            "active proctype Engine() { do",
            *branches,
            "od }",
            f"ltl requirement {{ {ltl} }}",
        ]
    )
    try:
        with tempfile.TemporaryDirectory(prefix="stateforge-spin-") as directory:
            folder = Path(directory)
            (folder / "model.pml").write_text(source)
            _, version = run_tool(["spin", "-V"], folder, deadline)
            code, output = run_tool(["spin", "-a", "model.pml"], folder, deadline)
            if code:
                return {**base, "status": "error", "message": "SPIN translation failed", "log": output}
            code, output = run_tool(["gcc", "-O1", "-DMEMLIM=512", "-o", "pan", "pan.c"], folder, deadline)
            if code:
                return {**base, "status": "error", "message": "SPIN verifier compilation failed", "log": output}
            code, output = run_tool([str(folder / "pan"), "-a", "-m100000", "-w20"], folder, deadline)
            match = re.search(r"errors:\s*(\d+)", output)
            incomplete = any(
                s in output.lower()
                for s in ["max search depth too small", "out of memory", "search not completed", "reached -dmemory"]
            )
            # A found counterexample is valid even if exhaustive exploration stopped at the first error.
            failed = bool(match and int(match.group(1)) > 0)
            if not match or (incomplete and not failed) or code not in (0, 1):
                return {**base, "status": "error", "message": "SPIN search did not complete", "log": output}
            trace, loop = [], None
            if failed:
                _, replay = run_tool(["spin", "-t", "-p", "model.pml"], folder, deadline)
                trace = [graph.step(0)]
                for line in replay.splitlines():
                    if "START OF CYCLE" in line:
                        loop = len(trace) - 1
                    m = re.search(r"^\s*SFTRACE:(\d+):(\d+)\s*$", line)
                    if m:
                        trace.append(graph.step(int(m.group(1)), tids[int(m.group(2))]))
            return {
                **base,
                "status": "failed" if failed else "passed",
                "trace": trace,
                "loop_index": loop,
                "tool_version": version.strip(),
                "translation_hash": digest(source),
                "translation": source,
                "configuration_map": [graph.context(i) for i in range(len(graph.nodes))],
                "options": ["-a", "-m100000", "-w20", "MEMLIM=512"],
                "log": output,
                "duration_ms": round((time.monotonic() - started) * 1000, 3),
            }
    except subprocess.TimeoutExpired:
        return {**base, "status": "timeout", "message": "SPIN exceeded the analysis time budget."}
