import pytest
from app.spin import formula, available
from app.engine import ModelError, verify
from app.schemas import Model


def model(cycle=False):
    return Model.model_validate(
        {
            "name": "SPIN conformance",
            "initial": "Idle",
            "states": [{"id": "Idle", "label": "Idle"}, {"id": "Done", "label": "Done", "terminal": True}],
            "transitions": [{"id": "Finish", "source": "Idle", "target": "Done", "event": "finish"}]
            + ([{"id": "Wait", "source": "Idle", "target": "Idle", "event": "wait"}] if cycle else []),
            "properties": [
                {"id": "Completion", "name": "Response", "operator": "LTL", "predicate": "G (at_Idle -> F at_Done)"}
            ],
        }
    )


@pytest.mark.parametrize(
    "text", ["G at_Unknown", "X at_Idle", "G at_Idle; printf(1)", "F (at_Idle", "#include <x>", "at_Idle at_Done"]
)
def test_ltl_closed_grammar(text):
    with pytest.raises(ModelError):
        formula(text, model().states)


@pytest.mark.skipif(not available(), reason="SPIN/compiler not installed")
def test_real_spin_pass_and_counterexample():
    success = verify(model())
    assert success["status"] == "passed", success
    failure = verify(model(cycle=True))
    assert failure["status"] == "failed", failure
    prop = failure["properties"][0]
    assert prop["backend"] == "SPIN"
    assert len(prop["trace"]) >= 2
    assert prop["loop_index"] is not None
    assert prop["translation_hash"]
