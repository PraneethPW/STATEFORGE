import importlib.util
import random
import subprocess
import sys
import pytest
from app.engine import Predicate, ModelError, verify, transition, synthesize
from app.schemas import Model
from app.codegen import generate


def machine(**overrides):
    value = {
        "name": "Conformance test",
        "initial": "Idle",
        "states": [{"id": "Idle", "label": "Idle"}, {"id": "Done", "label": "Done", "terminal": True}],
        "transitions": [{"id": "Complete", "source": "Idle", "target": "Done", "event": "finish"}],
        "properties": [{"id": "Progress", "name": "Completion", "operator": "AF", "predicate": "state == 'Done'"}],
    }
    return Model.model_validate({**value, **overrides})


def test_finite_guard_updates_and_generated_runtime_equivalence(tmp_path):
    model = machine(
        variables=[{"name": "ready", "domain": [False, True], "initial": False}],
        transitions=[
            {
                "id": "Prepare",
                "source": "Idle",
                "target": "Idle",
                "event": "prepare",
                "guard": "not ready",
                "updates": {"ready": True},
            },
            {"id": "Complete", "source": "Idle", "target": "Done", "event": "finish", "guard": "ready"},
        ],
    )
    result = verify(model)
    assert result["status"] == "passed" and result["configurations"] == 3
    files, manifest, _ = generate(model, "test-run", result)
    for name, text in files.items():
        (tmp_path / name).write_text(text)
    test = subprocess.run([sys.executable, "-I", str(tmp_path / "test_engine.py")], capture_output=True, text=True)
    # -I intentionally excludes script imports; normal documented package command is used below.
    test = subprocess.run(
        [sys.executable, "-m", "unittest", "-v", "test_engine.py"], cwd=tmp_path, capture_output=True, text=True
    )
    assert test.returncode == 0, test.stderr
    spec = importlib.util.spec_from_file_location("emitted_engine", tmp_path / "engine.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = module.Engine()
    state, values = "Idle", {"ready": False}
    for event in ["prepare", "finish"]:
        state, values, tid = transition(model, state, values, event)
        observed = engine.send(event)
        assert (observed["state"], observed["values"], observed["transition"]) == (state, values, tid)
    assert manifest["conformance_cases"] == 9
    (tmp_path / "model.json").write_text("{}")
    with pytest.raises(module.ModelError, match="hash"):
        module.Engine()


def test_liveness_cycle_is_not_reachability():
    model = machine(
        transitions=[
            {"id": "Wait", "source": "Idle", "target": "Idle", "event": "wait"},
            {"id": "Finish", "source": "Idle", "target": "Done", "event": "finish"},
        ],
        properties=[
            {"id": "AFDone", "name": "Inevitable completion", "operator": "AF", "predicate": "state == 'Done'"},
            {"id": "EFDone", "name": "Possible completion", "operator": "EF", "predicate": "state == 'Done'"},
        ],
    )
    result = verify(model)
    assert result["properties"][0]["status"] == "failed"
    assert result["properties"][0]["loop_index"] == 0
    assert result["properties"][0]["trace"][-1]["state"] == "Idle"
    assert result["properties"][1]["status"] == "passed"


def test_structural_failures_are_blocking_and_unreachable_is_reported():
    model = machine(
        states=[
            {"id": "Idle", "label": "Idle"},
            {"id": "Done", "label": "Done", "terminal": True},
            {"id": "Unused", "label": "Unused"},
        ],
        transitions=[],
    )
    result = verify(model)
    assert result["status"] == "failed"
    assert {"deadlock", "unreachable"} <= {d["code"] for d in result["diagnostics"]}
    terminal = machine(
        transitions=[
            {"id": "Finish", "source": "Idle", "target": "Done", "event": "finish"},
            {"id": "Restart", "source": "Done", "target": "Idle", "event": "restart"},
        ]
    )
    assert any(d["code"] == "terminal_outgoing" for d in verify(terminal)["diagnostics"])


def test_overlap_checks_all_valuations_not_only_initial():
    model = machine(
        variables=[{"name": "flag", "domain": [False, True], "initial": False}],
        transitions=[
            {"id": "A", "source": "Idle", "target": "Done", "event": "go", "guard": "flag"},
            {"id": "B", "source": "Idle", "target": "Idle", "event": "go", "guard": "flag"},
            {"id": "C", "source": "Idle", "target": "Done", "event": "complete", "guard": "not flag"},
        ],
    )
    assert any(d["code"] == "nondeterminism" for d in verify(model)["diagnostics"])


@pytest.mark.parametrize(
    "expression",
    [
        "__import__('os').system('id')",
        "state.upper()",
        "state[0]",
        "[x for x in state]",
        "(lambda: True)()",
        "1 + 2 == 3",
        "unknown == 1",
    ],
)
def test_expression_injection_is_rejected(expression):
    with pytest.raises(ModelError):
        Predicate(expression, {"state"})


def test_terminal_stuttering_and_bool_int_distinction():
    model = machine(initial="Done", states=[{"id": "Done", "label": "Done", "terminal": True}], transitions=[])
    assert verify(model)["status"] == "passed"
    assert not Predicate("flag == 1", {"flag"})({"flag": True})
    with pytest.raises(ModelError):
        Predicate("flag", {"flag"})({"flag": 2})


def test_adversarial_synthesis_restricts_controller_but_not_environment():
    model = machine(
        states=[
            {"id": "Idle", "label": "Idle", "owner": "controller"},
            {"id": "Done", "label": "Done", "terminal": True},
            {"id": "Bad", "label": "Bad", "terminal": True},
        ],
        transitions=[
            {"id": "Good", "source": "Idle", "target": "Done", "event": "finish"},
            {"id": "Wrong", "source": "Idle", "target": "Bad", "event": "break"},
        ],
        properties=[],
    )
    result = synthesize(model, "state != 'Bad'", "state == 'Done'")
    assert result["status"] == "candidate"
    assert [t["event"] for t in result["candidate"]["transitions"]] == ["finish"]
    model.states[0].owner = "environment"
    assert synthesize(model, "state != 'Bad'", "state == 'Done'")["status"] == "unrealizable"


def test_synthesis_cannot_violate_existing_properties():
    model = machine(
        states=[
            {"id": "Idle", "label": "Idle", "owner": "controller"},
            {"id": "Done", "label": "Done", "terminal": True},
        ],
        properties=[{"id": "Stay", "name": "Stay idle", "operator": "AG", "predicate": "state == 'Idle'"}],
    )
    assert synthesize(model, "True", "state == 'Done'")["status"] == "rejected"


def test_af_fixed_point_matches_independent_cycle_oracle():
    rng = random.Random(193)
    for _ in range(40):
        n = rng.randint(2, 9)
        states = [{"id": f"S{i}", "label": f"State {i}"} for i in range(n)]
        transitions = []
        adjacency = {}
        for i in range(n):
            targets = rng.sample(range(n), rng.randint(1, min(3, n)))
            adjacency[i] = targets
            for k, j in enumerate(targets):
                transitions.append({"id": f"T{i}_{k}", "source": f"S{i}", "target": f"S{j}", "event": f"e{k}"})
        model = Model.model_validate(
            {
                "name": "Oracle check",
                "initial": "S0",
                "states": states,
                "transitions": transitions,
                "properties": [{"id": "P", "name": "Goal", "operator": "AF", "predicate": f"state == 'S{n - 1}'"}],
            }
        )

        # AF goal fails exactly when a reachable path can avoid goal forever (a non-goal cycle).
        def cycle(i, visiting, done):
            if i == n - 1:
                return False
            if i in visiting:
                return True
            if i in done:
                return False
            if any(cycle(j, visiting | {i}, done) for j in adjacency[i]):
                return True
            done.add(i)
            return False

        expected = not cycle(0, set(), set())
        actual = verify(model)["properties"][0]["status"] == "passed"
        assert actual == expected


def test_mixed_boolean_integer_domains_cannot_alias_configuration_identity():
    from pydantic import ValidationError

    # Python considers False == 0 and True == 1 in tuple/dict keys. A typed,
    # homogeneous variable domain prevents those identities from collapsing.
    with pytest.raises(ValidationError, match="one type"):
        machine(variables=[{"name": "ambiguous", "domain": [False, 0, True, 1], "initial": False}])


def test_ai_repair_cannot_drop_or_weaken_original_properties():
    from app.ai import check_repair_contract

    original = machine()
    candidate = original.model_copy(deep=True)
    check_repair_contract(original.model_dump(), candidate)
    candidate.properties[0].predicate = "True"
    with pytest.raises(ModelError, match="preserve every original property"):
        check_repair_contract(original.model_dump(), candidate)
    candidate.properties = []
    with pytest.raises(ModelError, match="preserve every original property"):
        check_repair_contract(original.model_dump(), candidate)
