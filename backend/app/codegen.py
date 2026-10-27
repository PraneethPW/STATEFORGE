"""Generate a portable, data-driven engine and transition/property regression tests.

The emitted evaluator is the same reviewed predicate interpreter as verification.
No user code is executed by the web server or worker.
"""

import inspect
import json
from .engine import Predicate, ModelError, digest, ENGINE_VERSION, build_graph
from .schemas import Model

GENERATOR_VERSION = "stateforge-python/1.0.0"


def generate(model: Model, run_id: str, evidence: dict):
    if evidence["status"] != "passed" or evidence["model_hash"] != digest(model.model_dump()):
        raise ModelError("Generation requires a passing run for the exact model hash")
    evaluator = inspect.getsource(Predicate)
    engine = (
        '''"""Generated StateForge runtime. Side effects belong in external adapters."""
import ast
import hashlib
import json
from pathlib import Path

class ModelError(ValueError):
    pass

'''
        + evaluator
        + """
class Engine:
    def __init__(self):
        root = Path(__file__).parent
        raw = (root / 'model.json').read_text()
        self.model = json.loads(raw)
        self.manifest = json.loads((root / 'manifest.json').read_text())
        canonical = json.dumps(self.model, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        if hashlib.sha256(canonical.encode()).hexdigest() != self.manifest['model_hash']:
            raise ModelError('Model hash does not match manifest')
        self.state = self.model['initial']
        self.values = {v['name']: v['initial'] for v in self.model['variables']}
        self.sequence = 0

    def send(self, event):
        context = {'state': self.state, **self.values}
        matches = [t for t in self.model['transitions'] if t['source'] == self.state and t['event'] == event
                   and Predicate(t['guard'], set(context))(context)]
        if len(matches) != 1:
            raise ModelError('Invalid or nondeterministic event')
        t = matches[0]
        previous = self.state
        self.state = t['target']
        self.values.update(t['updates'])
        violations = [p['id'] for p in self.model['properties'] if p['operator'] == 'AG'
                      and not Predicate(p['predicate'], {'state', *self.values})({'state': self.state, **self.values})]
        self.sequence += 1
        return {'from': previous, 'state': self.state, 'values': dict(self.values),
                'transition': t['id'], 'violations': violations, 'sequence': self.sequence,
                'model_hash': self.manifest['model_hash']}
"""
    )
    # Fixtures cover every reachable configuration and every enabled/disabled event.
    graph = build_graph(model)
    events = sorted({t.event for t in model.transitions})
    if len(graph.nodes) * (len(events) + 1) > 100000:
        raise ModelError("Generation exceeds 100,000 conformance cases. Decompose the model before generation.")
    fixtures = []
    for i, (state, vals) in enumerate(graph.nodes):
        enabled = {
            t.id
            for t in model.transitions
            if t.source == state and Predicate(t.guard, {"state", *(v.name for v in model.variables)})(graph.context(i))
        }
        for event in [*events, "__invalid_event__"]:
            matches = [t for t in model.transitions if t.id in enabled and t.event == event]
            t = matches[0] if matches else None
            values = dict(zip([v.name for v in model.variables], vals))
            fixtures.append(
                {
                    "state": state,
                    "values": values,
                    "event": event,
                    "expected": {"state": t.target, "values": {**values, **t.updates}, "transition": t.id}
                    if t
                    else None,
                }
            )
    tests = """import json
import unittest
from pathlib import Path
from engine import Engine, ModelError

class GeneratedConformance(unittest.TestCase):
    def test_all_reachable_transitions_and_rejections(self):
        cases = json.loads((Path(__file__).parent / 'conformance.json').read_text())
        for case in cases:
            with self.subTest(state=case['state'], event=case['event'], values=case['values']):
                engine = Engine()
                engine.state, engine.values = case['state'], dict(case['values'])
                if case['expected'] is None:
                    with self.assertRaises(ModelError):
                        engine.send(case['event'])
                else:
                    actual = engine.send(case['event'])
                    for key, value in case['expected'].items():
                        self.assertEqual(actual[key], value)

if __name__ == '__main__':
    unittest.main()
"""
    manifest = {
        "generator": GENERATOR_VERSION,
        "engine": ENGINE_VERSION,
        "model_hash": digest(model.model_dump()),
        "run_id": run_id,
        "property_ids": [p.id for p in model.properties],
        "semantics": evidence["semantics"],
        "target": "python3.12",
        "conformance_cases": len(fixtures),
        "reachable_configurations": len(graph.nodes),
    }
    files = {
        "engine.py": engine,
        "model.json": json.dumps(model.model_dump(), indent=2),
        "manifest.json": json.dumps(manifest, indent=2),
        "test_engine.py": tests,
        "conformance.json": json.dumps(fixtures, indent=2),
        "verification.json": json.dumps(evidence, indent=2),
        "README.md": "# Generated StateForge engine\n\nRun `python -m unittest -v test_engine.py`.\n"
        "Import `Engine` from `engine.py` and call `send(event)`; connect side effects in your adapter.\n"
        "The conformance suite covers every reachable configuration and enabled/disabled event.\n"
        "This package does not implement external service side effects, timers, or an HTTP deployment.\n",
    }
    # Hash all payload files. Manifest includes these checksums; package hash is stored separately.
    manifest["files"] = {name: digest(content) for name, content in files.items() if name != "manifest.json"}
    files["manifest.json"] = json.dumps(manifest, indent=2)
    if sum(len(content.encode()) for content in files.values()) > 16 * 1024 * 1024:
        raise ModelError("Generated package exceeds 16 MB. Decompose the model before generation.")
    return files, manifest, digest(files)
