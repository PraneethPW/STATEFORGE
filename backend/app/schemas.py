from typing import Literal
import keyword
from pydantic import BaseModel, ConfigDict, Field, model_validator

Atom = bool | int | str


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class State(Strict):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
    label: str = Field(min_length=1, max_length=120)
    terminal: bool = False
    owner: Literal["controller", "environment"] = "environment"
    x: float = Field(default=0, ge=-100000, le=100000)
    y: float = Field(default=0, ge=-100000, le=100000)
    requirement: str = Field(default="", max_length=1000)


class Variable(Strict):
    name: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,31}$")
    domain: list[Atom] = Field(min_length=1, max_length=16)
    initial: Atom

    @model_validator(mode="after")
    def valid(self):
        if self.name in {"state", "True", "False", "None"} or keyword.iskeyword(self.name):
            raise ValueError("Reserved variable name")
        if any(type(v) not in (bool, int, str) for v in self.domain):
            raise ValueError("Finite domains use boolean, integer or string constants")
        if len({(type(v).__name__, str(v)) for v in self.domain}) != len(self.domain):
            raise ValueError("Duplicate domain values")
        if not any(type(v) is type(self.initial) and v == self.initial for v in self.domain):
            raise ValueError("Initial value must be in the domain")
        return self


class Transition(Strict):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
    source: str = Field(max_length=64)
    target: str = Field(max_length=64)
    event: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$")
    guard: str = Field(default="True", min_length=1, max_length=500)
    updates: dict[str, Atom] = Field(default_factory=dict, max_length=8)
    requirement: str = Field(default="", max_length=1000)


class Property(Strict):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=160)
    operator: Literal["AG", "AF", "EF", "EG", "AX", "EX", "LTL"]
    predicate: str = Field(min_length=1, max_length=500)
    requirement: str = Field(default="", max_length=1000)


class Model(Strict):
    name: str = Field(min_length=1, max_length=160)
    initial: str = Field(max_length=64)
    states: list[State] = Field(min_length=1, max_length=150)
    transitions: list[Transition] = Field(default_factory=list, max_length=600)
    variables: list[Variable] = Field(default_factory=list, max_length=8)
    properties: list[Property] = Field(default_factory=list, max_length=60)
    assumptions: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def identifiers(self):
        for field, key in [("states", "id"), ("transitions", "id"), ("variables", "name"), ("properties", "id")]:
            values = [getattr(x, key) for x in getattr(self, field)]
            if len(values) != len(set(values)):
                raise ValueError(f"Duplicate identifiers in {field}")
        ids = {s.id for s in self.states}
        if self.initial not in ids:
            raise ValueError("Initial state does not exist")
        domains = {v.name: v.domain for v in self.variables}
        for t in self.transitions:
            if t.source not in ids or t.target not in ids:
                raise ValueError(f"{t.id}: unknown source or target")
            for k, value in t.updates.items():
                if k not in domains or not any(type(v) is type(value) and v == value for v in domains[k]):
                    raise ValueError(f"{t.id}: update {k} is outside its finite domain")
        product = 1
        for v in self.variables:
            product *= len(v.domain)
        if product * len(self.states) > 10000:
            raise ValueError("Model exceeds the 10,000 configuration limit")
        return self


class Credentials(Strict):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    name: str = Field(default="", max_length=100)


class ProjectInput(Strict):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)


class VersionInput(Strict):
    model: Model
    requirements: str = Field(default="", max_length=30000)
    expected_version: int = Field(ge=0)
    note: str = Field(default="", max_length=500)


class AIInput(Strict):
    requirements: str = Field(min_length=20, max_length=30000)
    version_id: str | None = None
    run_id: str | None = None
    mode: Literal["parse", "repair"] = "parse"


class RunInput(Strict):
    version_id: str


class SynthesisInput(Strict):
    version_id: str
    safe: str = Field(default="True", min_length=1, max_length=500)
    goal: str = Field(min_length=1, max_length=500)


class RuntimeInput(Strict):
    version_id: str
    artifact_id: str
    name: str = Field(min_length=1, max_length=100)


class EventInput(Strict):
    event_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,100}$")
    event: str = Field(min_length=1, max_length=64)
    expected_sequence: int = Field(ge=0)
    model_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    observed_state: str | None = Field(default=None, max_length=64)
    latency_ms: float | None = Field(default=None, ge=0, le=86400000)
    latency_budget_ms: float | None = Field(default=None, gt=0, le=86400000)


class AdaptInput(Strict):
    strategy_id: str
    expected_sequence: int = Field(ge=0)
