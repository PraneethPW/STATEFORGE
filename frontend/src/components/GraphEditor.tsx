import PrintText from "./PrintText";
import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import type { Connection, Node, Edge } from "@xyflow/react";
import {
  Plus,
  Trash2,
  CircleDot,
  ArrowRight,
  GitBranch,
  Code2,
  ShieldCheck,
  Variable as VariableIcon,
  Maximize2,
} from "lucide-react";
import type { Model, Property, State, Transition, Variable } from "../types";
import { Modal, Empty, Spinner } from "./UI";
import { api } from "../api";

type Editing =
  | { kind: "state"; value: State; fresh: boolean }
  | { kind: "transition"; value: Transition; fresh: boolean }
  | { kind: "property"; value: Property; fresh: boolean }
  | { kind: "variable"; value: Variable; fresh: boolean }
  | { kind: "json" }
  | null;
function nextId(prefix: string, used: string[]) {
  let i = 1;
  while (used.includes(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}
export default function GraphEditor({
  model,
  setModel,
  activeState,
  onError,
}: {
  model: Model;
  setModel: (m: Model) => void;
  activeState?: string;
  onError: (s: string) => void;
}) {
  const [section, setSection] = useState("graph");
  const [editing, setEditing] = useState<Editing>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const transitionIndex = useMemo(
    () => new Map(model.transitions.map((t) => [t.id, t])),
    [model.transitions],
  );
  useEffect(() => {
    setNodes(
      model.states.map((s, i) => ({
        id: s.id,
        position: {
          x: s.x || (i % 3) * 260,
          y: s.y || Math.floor(i / 3) * 180,
        },
        type: "default",
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: `state-node ${s.terminal ? "terminal" : ""} ${s.id === activeState ? "executing" : ""}`,
        data: {
          label: (
            <div className="state-label">
              <span className="node-meta">
                {s.id === model.initial
                  ? "INITIAL"
                  : s.terminal
                    ? "TERMINAL"
                    : s.owner.toUpperCase()}
              </span>
              <span>
                <i className="node-dot" />
                {s.label}
              </span>
              <code>{s.id}</code>
            </div>
          ),
        },
      })),
    );
  }, [model.states, model.initial, activeState, setNodes]);
  useEffect(() => {
    setEdges(
      model.transitions.map((t) => ({
        id: t.id,
        source: t.source,
        target: t.target,
        label: t.event,
        animated: !!activeState && t.target === activeState,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#bc3852" },
        style: { stroke: "#a43b51", strokeWidth: 1.5 },
        labelStyle: { fill: "#efd4dc", fontSize: 11 },
        labelBgStyle: { fill: "#19090f" },
        labelBgPadding: [8, 5],
      })),
    );
  }, [model.transitions, activeState, setEdges]);
  function newState() {
    const id = nextId(
      "State",
      model.states.map((x) => x.id),
    );
    setEditing({
      kind: "state",
      fresh: true,
      value: {
        id,
        label: "",
        terminal: false,
        owner: "environment",
        x: (model.states.length % 3) * 270,
        y: Math.floor(model.states.length / 3) * 180,
        requirement: "",
      },
    });
  }
  function newTransition(connection?: Connection) {
    if (!model.states.length) {
      onError("Add states before connecting them.");
      return;
    }
    setEditing({
      kind: "transition",
      fresh: true,
      value: {
        id: nextId(
          "T",
          model.transitions.map((x) => x.id),
        ),
        source: connection?.source || model.states[0].id,
        target: connection?.target || model.states.at(-1)!.id,
        event: "",
        guard: "True",
        updates: {},
        requirement: "",
      },
    });
  }
  function newProperty() {
    setEditing({
      kind: "property",
      fresh: true,
      value: {
        id: nextId(
          "P",
          model.properties.map((p) => p.id),
        ),
        name: "",
        operator: "AG",
        predicate: "",
        requirement: "",
      },
    });
  }
  function newVariable() {
    setEditing({
      kind: "variable",
      fresh: true,
      value: { name: "", domain: [false, true], initial: false },
    });
  }
  function save(value: State | Transition | Property | Variable) {
    if (!editing || editing.kind === "json") return;
    if (editing.kind === "state") {
      const s = value as State;
      if (editing.fresh && model.states.some((x) => x.id === s.id))
        throw new Error("State ID already exists");
      setModel({
        ...model,
        initial: model.initial || s.id,
        states: editing.fresh
          ? [...model.states, s]
          : model.states.map((x) => (x.id === s.id ? s : x)),
      });
    }
    if (editing.kind === "transition") {
      const t = value as Transition;
      if (editing.fresh && model.transitions.some((x) => x.id === t.id))
        throw new Error("Transition ID already exists");
      setModel({
        ...model,
        transitions: editing.fresh
          ? [...model.transitions, t]
          : model.transitions.map((x) => (x.id === t.id ? t : x)),
      });
    }
    if (editing.kind === "property") {
      const p = value as Property;
      if (editing.fresh && model.properties.some((x) => x.id === p.id))
        throw new Error("Property ID already exists");
      setModel({
        ...model,
        properties: editing.fresh
          ? [...model.properties, p]
          : model.properties.map((x) => (x.id === p.id ? p : x)),
      });
    }
    if (editing.kind === "variable") {
      const v = value as Variable;
      if (editing.fresh && model.variables.some((x) => x.name === v.name))
        throw new Error("Variable name already exists");
      setModel({
        ...model,
        variables: editing.fresh
          ? [...model.variables, v]
          : model.variables.map((x) => (x.name === v.name ? v : x)),
      });
    }
    setEditing(null);
  }
  function remove() {
    if (!editing || editing.kind === "json" || editing.fresh) return;
    if (editing.kind === "state") {
      const id = editing.value.id;
      setModel({
        ...model,
        initial:
          model.initial === id
            ? model.states.find((x) => x.id !== id)?.id || ""
            : model.initial,
        states: model.states.filter((x) => x.id !== id),
        transitions: model.transitions.filter(
          (x) => x.source !== id && x.target !== id,
        ),
      });
    } else if (editing.kind === "transition")
      setModel({
        ...model,
        transitions: model.transitions.filter((x) => x.id !== editing.value.id),
      });
    else if (editing.kind === "property")
      setModel({
        ...model,
        properties: model.properties.filter((x) => x.id !== editing.value.id),
      });
    else
      setModel({
        ...model,
        variables: model.variables.filter((x) => x.name !== editing.value.name),
      });
    setEditing(null);
  }
  return (
    <>
      <div className="editor-toolbar">
        <div className="segmented">
          {[
            ["graph", "State graph"],
            ["properties", "Properties"],
            ["variables", "Variables"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={section === id ? "selected" : ""}
              onClick={() => setSection(id)}
            >
              {label}
              <span>
                {id === "graph"
                  ? model.states.length
                  : id === "properties"
                    ? model.properties.length
                    : model.variables.length}
              </span>
            </button>
          ))}
        </div>
        <button
          className="button ghost small"
          onClick={() => setEditing({ kind: "json" })}
        >
          <Code2 size={14} />
          Model JSON
        </button>
      </div>
      {section === "graph" ? (
        <div className="graph-layout">
          <aside className="model-tree">
            <div className="tree-heading">
              MODEL EXPLORER{" "}
              <button
                className="icon-btn"
                aria-label="Add state"
                onClick={newState}
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="tree-group">
              <span>
                <CircleDot size={12} />
                STATES <b>{model.states.length}</b>
              </span>
              {model.states.map((s) => (
                <button
                  key={s.id}
                  onClick={() =>
                    setEditing({ kind: "state", value: s, fresh: false })
                  }
                >
                  <i className={s.terminal ? "terminal-dot" : ""} />
                  {s.label}
                  <code>{s.id === model.initial ? "↗" : ""}</code>
                </button>
              ))}
            </div>
            <div className="tree-group">
              <span>
                <GitBranch size={12} />
                TRANSITIONS <b>{model.transitions.length}</b>
              </span>
              {model.transitions.map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    setEditing({ kind: "transition", value: t, fresh: false })
                  }
                >
                  <ArrowRight size={12} />
                  {t.event}
                </button>
              ))}
            </div>
            <div className="tree-footer">
              <span className="live-dot" />
              Finite-state model
              <br />
              <small>
                Drag handles to connect states.
                <br />
                Select any element to edit.
              </small>
            </div>
          </aside>
          <div className="graph-canvas">
            {model.states.length ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={newTransition}
                onNodeClick={(_, n) => {
                  const state = model.states.find((s) => s.id === n.id);
                  if (state)
                    setEditing({ kind: "state", value: state, fresh: false });
                }}
                onEdgeClick={(_, e) => {
                  const t = transitionIndex.get(e.id);
                  if (t)
                    setEditing({ kind: "transition", value: t, fresh: false });
                }}
                onNodeDragStop={(_, n) =>
                  setModel({
                    ...model,
                    states: model.states.map((s) =>
                      s.id === n.id
                        ? { ...s, x: n.position.x, y: n.position.y }
                        : s,
                    ),
                  })
                }
                fitView
                fitViewOptions={{ padding: 0.4 }}
                minZoom={0.15}
                maxZoom={2}
                deleteKeyCode={null}
                colorMode="dark"
                proOptions={{ hideAttribution: false }}
              >
                <Background color="#36121d" gap={24} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                  nodeColor="#9f1d3b"
                  maskColor="#0b0407bb"
                  pannable
                  zoomable
                />
              </ReactFlow>
            ) : (
              <Empty
                icon={<GitBranch size={38} />}
                title="Every system starts with a state."
                action={
                  <button className="button primary" onClick={newState}>
                    <Plus size={16} />
                    Create first state
                  </button>
                }
              >
                Build the behavior you intend to ship. Add states and connect
                the events that move between them.
              </Empty>
            )}
            <div className="canvas-label">
              <span className="live-dot" />
              {model.name}
              <span>AUTHORING CANVAS</span>
            </div>
            <div className="canvas-actions">
              <button className="button small" onClick={newState}>
                <Plus size={14} />
                State
              </button>
              <button
                className="button small"
                onClick={() => newTransition()}
                disabled={!model.states.length}
              >
                <GitBranch size={14} />
                Transition
              </button>
            </div>
            <span className="canvas-hint">
              <Maximize2 size={11} />
              SCROLL TO ZOOM · DRAG TO EXPLORE
            </span>
          </div>
        </div>
      ) : section === "properties" ? (
        <div className="list-section">
          <div className="list-intro">
            <div>
              <h3>
                <PrintText>Behavioral contracts</PrintText>
              </h3>
              <p>
                Declare what must hold across all possible executions.
                Predicates use state IDs and finite variables.
              </p>
            </div>
            <button className="button primary small" onClick={newProperty}>
              <Plus size={14} />
              Add property
            </button>
          </div>
          {model.properties.length ? (
            model.properties.map((p) => (
              <button
                className="property-card"
                key={p.id}
                onClick={() =>
                  setEditing({ kind: "property", value: p, fresh: false })
                }
              >
                <span className="operator">{p.operator}</span>
                <div>
                  <strong>{p.name}</strong>
                  <code>{p.predicate}</code>
                  <small>{p.requirement || "No requirement linked"}</small>
                </div>
                <code>{p.id}</code>
                <ArrowRight size={16} />
              </button>
            ))
          ) : (
            <Empty
              icon={<ShieldCheck size={30} />}
              title="Give correctness a definition."
              action={
                <button className="button" onClick={newProperty}>
                  Add a property
                </button>
              }
            >
              AG checks invariants. AF checks inevitable progress. EF checks
              reachability. Every property is evaluated against the saved model.
            </Empty>
          )}
          <div className="semantics-note">
            LTL uses G F U R ! &amp;&amp; || → and at_StateId atoms (SPIN). AG
            always · AF inevitably · EF reachable · EG one always-valid path ·
            AX all next states · EX some next state. Terminal states stutter. No
            fairness assumptions.
          </div>
        </div>
      ) : (
        <div className="list-section">
          <div className="list-intro">
            <div>
              <h3>
                <PrintText>Finite variables</PrintText>
              </h3>
              <p>
                Guard variables have explicit finite domains. Updates assign
                literal values within those domains.
              </p>
            </div>
            <button className="button primary small" onClick={newVariable}>
              <Plus size={14} />
              Add variable
            </button>
          </div>
          {model.variables.length ? (
            model.variables.map((v) => (
              <button
                className="property-card"
                key={v.name}
                onClick={() =>
                  setEditing({ kind: "variable", value: v, fresh: false })
                }
              >
                <VariableIcon size={22} />
                <div>
                  <strong>{v.name}</strong>
                  <code>{JSON.stringify(v.domain)}</code>
                </div>
                <small>Initial: {JSON.stringify(v.initial)}</small>
              </button>
            ))
          ) : (
            <Empty
              icon={<VariableIcon size={30} />}
              title="Make conditions explicit."
            >
              Add finite boolean, integer, or string variables to model guards
              and state updates. Pure state models work without variables.
            </Empty>
          )}
        </div>
      )}
      {editing &&
        (editing.kind === "json" ? (
          <JSONModal
            model={model}
            close={() => setEditing(null)}
            save={(m) => {
              setModel(m);
              setEditing(null);
            }}
          />
        ) : (
          <ElementModal
            editing={editing}
            model={model}
            close={() => setEditing(null)}
            save={save}
            remove={remove}
          />
        ))}
    </>
  );
}
function ElementModal({
  editing,
  model,
  close,
  save,
  remove,
}: {
  editing: Exclude<Editing, null | { kind: "json" }>;
  model: Model;
  close: () => void;
  save: (v: State | Transition | Property | Variable) => void;
  remove: () => void;
}) {
  const [form, setForm] = useState(editing.value);
  const [error, setError] = useState("");
  const [json, setJson] = useState(
    editing.kind === "transition"
      ? JSON.stringify(editing.value.updates, null, 2)
      : editing.kind === "variable"
        ? JSON.stringify(editing.value.domain)
        : "",
  );
  const [initial, setInitial] = useState(
    editing.kind === "variable" ? JSON.stringify(editing.value.initial) : "",
  );
  function change(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  return (
    <Modal
      title={`${editing.fresh ? "Add" : "Edit"} ${editing.kind}`}
      subtitle="Changes remain in your draft until you save a new model version."
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const value = { ...form };
            if (editing.kind === "transition")
              (value as Transition).updates = JSON.parse(json);
            if (editing.kind === "variable") {
              (value as Variable).domain = JSON.parse(json);
              (value as Variable).initial = JSON.parse(initial);
              if (!Array.isArray((value as Variable).domain))
                throw new Error("Domain must be a JSON array");
            }
            save(value);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {editing.kind !== "variable" && (
          <label>
            Identifier
            <input
              required
              pattern="[A-Za-z][A-Za-z0-9_]{0,63}"
              readOnly={!editing.fresh}
              value={(form as State).id}
              onChange={(e) => change("id", e.target.value)}
            />
          </label>
        )}
        {editing.kind === "state" && (
          <>
            <label>
              Display name
              <input
                required
                maxLength={120}
                value={(form as State).label}
                onChange={(e) => change("label", e.target.value)}
                placeholder="Name this state"
              />
            </label>
            <div className="form-row">
              <label>
                Decision owner
                <select
                  value={(form as State).owner}
                  onChange={(e) => change("owner", e.target.value)}
                >
                  <option value="environment">Environment</option>
                  <option value="controller">Controller</option>
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={(form as State).terminal}
                  onChange={(e) => change("terminal", e.target.checked)}
                />
                Terminal state
              </label>
            </div>
            {!editing.fresh && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={model.initial === (form as State).id}
                  onChange={() => {
                    /* initial is set through model JSON to keep this dialog atomic */
                  }}
                  disabled
                />
                Initial state: {model.initial}
              </label>
            )}
          </>
        )}
        {editing.kind === "transition" && (
          <>
            <div className="form-row">
              <label>
                From
                <select
                  value={(form as Transition).source}
                  onChange={(e) => change("source", e.target.value)}
                >
                  {model.states.map((s) => (
                    <option key={s.id}>{s.id}</option>
                  ))}
                </select>
              </label>
              <label>
                To
                <select
                  value={(form as Transition).target}
                  onChange={(e) => change("target", e.target.value)}
                >
                  {model.states.map((s) => (
                    <option key={s.id}>{s.id}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Event
              <input
                required
                pattern="[A-Za-z][A-Za-z0-9_.:-]{0,63}"
                value={(form as Transition).event}
                onChange={(e) => change("event", e.target.value)}
                placeholder="Event name"
              />
            </label>
            <label>
              Guard predicate
              <input
                required
                className="mono"
                value={(form as Transition).guard}
                onChange={(e) => change("guard", e.target.value)}
              />
            </label>
            <label>
              Variable updates · JSON object
              <textarea
                className="mono"
                rows={3}
                value={json}
                onChange={(e) => setJson(e.target.value)}
              />
            </label>
          </>
        )}
        {editing.kind === "property" && (
          <>
            <label>
              Property name
              <input
                required
                value={(form as Property).name}
                onChange={(e) => change("name", e.target.value)}
              />
            </label>
            <div className="form-row">
              <label>
                Temporal operator
                <select
                  value={(form as Property).operator}
                  onChange={(e) => change("operator", e.target.value)}
                >
                  {["AG", "AF", "EF", "EG", "AX", "EX", "LTL"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              <label>
                Predicate
                <input
                  required
                  className="mono"
                  value={(form as Property).predicate}
                  onChange={(e) => change("predicate", e.target.value)}
                  placeholder="state == 'YourStateId'"
                />
              </label>
            </div>
          </>
        )}
        {editing.kind === "variable" && (
          <>
            <label>
              Variable name
              <input
                required
                pattern="[A-Za-z][A-Za-z0-9_]{0,31}"
                readOnly={!editing.fresh}
                value={(form as Variable).name}
                onChange={(e) => change("name", e.target.value)}
              />
            </label>
            <label>
              Finite domain · JSON array
              <input
                required
                className="mono"
                value={json}
                onChange={(e) => setJson(e.target.value)}
              />
            </label>
            <label>
              Initial value · JSON literal
              <input
                required
                className="mono"
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
              />
            </label>
          </>
        )}
        {editing.kind !== "variable" && (
          <label>
            Requirement reference
            <textarea
              rows={2}
              value={(form as State).requirement}
              onChange={(e) => change("requirement", e.target.value)}
              placeholder="Source requirement ID or explanation"
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          {!editing.fresh && (
            <button type="button" className="button danger" onClick={remove}>
              <Trash2 size={14} />
              Delete
            </button>
          )}
          <button type="button" className="button ghost" onClick={close}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            Apply to draft
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function JSONModal({
  model,
  close,
  save,
}: {
  model: Model;
  close: () => void;
  save: (m: Model) => void;
}) {
  const [raw, setRaw] = useState(JSON.stringify(model, null, 2));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Authoritative model JSON"
      subtitle="Edit the initial state, assumptions, coordinates, and full model schema. The server validates every saved version."
      wide
      close={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const m = JSON.parse(raw);
            if (
              !m.name ||
              !Array.isArray(m.states) ||
              !Array.isArray(m.transitions) ||
              !Array.isArray(m.variables) ||
              !Array.isArray(m.properties) ||
              !Array.isArray(m.assumptions) ||
              typeof m.initial !== "string"
            )
              throw new Error(
                "Model must include name, initial, states, transitions, variables, properties, and assumptions",
              );
            for (const s of m.states)
              if (typeof s.id !== "string" || typeof s.label !== "string")
                throw new Error("Every state needs an ID and label");
            const validated = await api<Model>("/models/validate", m);
            save(validated);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea
          aria-label="Model JSON"
          className="code-editor"
          rows={23}
          spellCheck={false}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-footer">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy && <Spinner />}Load into draft
          </button>
        </footer>
      </form>
    </Modal>
  );
}
