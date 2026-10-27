import { useCallback, useEffect, useState } from "react";
import {
  Radio,
  Plus,
  Send,
  Square,
  ChevronDown,
  ShieldCheck,
  Copy,
  KeyRound,
} from "lucide-react";
import { api, API } from "../api";
import type { Runtime, Snapshot, Trace, Version } from "../types";
import { PredicatePreview } from "./RuntimePredicate";
import { Empty, Modal, Spinner, Status, SectionTitle, time, short } from "./UI";
export default function RuntimeConsole({
  snapshot,
  version,
  busy,
  action,
  onError,
  activitySeq,
}: {
  snapshot: Snapshot;
  version?: Version;
  busy: string;
  action: (name: string, path: string, body: unknown) => Promise<unknown>;
  onError: (s: string) => void;
  activitySeq: number;
}) {
  const [selected, setSelected] = useState("");
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const [event, setEvent] = useState("");
  const [traces, setTraces] = useState<Trace[]>([]);
  const [ingestKey, setIngestKey] = useState<{
    id: string;
    key: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const root = `/projects/${snapshot.project.id}`;
  const runtime =
    snapshot.runtimes.find((r) => r.id === selected) || snapshot.runtimes[0];
  const runtimeModel = snapshot.versions.find(
    (v) => v.id === runtime?.version_id,
  )?.model;
  const artifacts = snapshot.artifacts.filter(
    (a) => a.version_id === version?.id,
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!runtime) return;
      setLoading(true);
      try {
        const result = await api<Trace[]>(
          `${root}/runtimes/${runtime.id}/traces?latest=true`,
          undefined,
          signal,
        );
        setTraces(result);
      } catch (e) {
        if (!signal?.aborted) onError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [runtime?.id, root, onError],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, activitySeq]);
  return (
    <div className="page-section">
      <SectionTitle
        index="04 / RUNTIME OBSERVATORY"
        title="Watch your model meet the world."
        description="Real events, append-only traces, and state synchronization against a pinned model version."
        action={
          <button
            className="button primary"
            disabled={!artifacts.length || !!busy}
            onClick={() => {
              setArtifactId(artifacts[0]?.id || "");
              setCreate(true);
            }}
          >
            <Plus size={15} />
            Start runtime
          </button>
        }
      />
      {!artifacts.length && (
        <div className="notice">
          <ShieldCheck size={17} />
          Generate an artifact for the selected version to start a runtime.
        </div>
      )}
      {runtime ? (
        <>
          <div className="runtime-select">
            <label>
              RUNTIME INSTANCE
              <select
                value={runtime.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setTraces([]);
                }}
              >
                {snapshot.runtimes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <Status value={runtime.status} />
            <button
              className="button small danger"
              disabled={runtime.status !== "active" || !!busy}
              onClick={() =>
                action("stop", `${root}/runtimes/${runtime.id}/stop`, {})
              }
            >
              <Square size={12} />
              Stop & revoke key
            </button>
          </div>
          <div className="runtime-grid">
            <div className="runtime-state">
              <span className="eyebrow">CURRENT STATE</span>
              <div className="state-radar">
                <i />
                <i />
                <i />
                <span>
                  <Radio size={27} />
                  <strong>
                    {runtimeModel?.states.find((s) => s.id === runtime.state)
                      ?.label || runtime.state}
                  </strong>
                  <code>{runtime.state}</code>
                </span>
              </div>
              <div className="runtime-meta">
                <span>
                  EVENT SEQUENCE <code>{runtime.sequence}</code>
                </span>
                <span>
                  MODEL{" "}
                  <code title={runtime.model_hash}>
                    {short(runtime.model_hash)}
                  </code>
                </span>
                <span>
                  ADAPTATION{" "}
                  <code>
                    {runtime.strategy_id
                      ? runtime.strategy_id.slice(0, 8)
                      : "Base behavior"}
                  </code>
                </span>
              </div>
              {Object.keys(runtime.values).length > 0 && (
                <pre className="runtime-values">
                  {JSON.stringify(runtime.values, null, 2)}
                </pre>
              )}
            </div>
            <div className="event-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">EVENT DISPATCH</span>
                  <h3>Drive the actual engine.</h3>
                </div>
                <Send size={18} />
              </div>
              <p className="muted">
                Send a domain event to this persisted instance. Invalid events
                are recorded as violations; idempotent retries preserve the
                original trace.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const result = await action(
                    "event",
                    `${root}/runtimes/${runtime.id}/events`,
                    {
                      event_id: crypto.randomUUID(),
                      event,
                      expected_sequence: runtime.sequence,
                      model_hash: runtime.model_hash,
                    },
                  );
                  if (result) {
                    setEvent("");
                    void load();
                  }
                }}
              >
                <label>
                  Event name
                  <div className="event-input">
                    <input
                      required
                      value={event}
                      onChange={(e) => setEvent(e.target.value)}
                      placeholder="Enter a domain event"
                      list="runtime-events"
                    />
                    <datalist id="runtime-events">
                      {[
                        ...new Set(
                          runtimeModel?.transitions
                            .filter((t) => t.source === runtime.state)
                            .map((t) => t.event) || [],
                        ),
                      ].map((e) => (
                        <option key={e} value={e} />
                      ))}
                    </datalist>
                    <button
                      className="button primary"
                      disabled={!!busy || runtime.status !== "active"}
                    >
                      {busy === "event" ? <Spinner /> : <Send size={15} />}
                      Dispatch
                    </button>
                  </div>
                </label>
              </form>
              <div className="available-events">
                <span className="eyebrow">OUTGOING EVENTS</span>
                <div>
                  {runtimeModel?.transitions
                    .filter((t) => t.source === runtime.state)
                    .map((t) => (
                      <button
                        className="event-chip"
                        key={t.id}
                        onClick={() => setEvent(t.event)}
                      >
                        {t.event}
                        <code>{t.guard}</code>
                      </button>
                    ))}
                  {!runtimeModel?.transitions.some(
                    (t) => t.source === runtime.state,
                  ) && (
                    <p className="muted">
                      No outgoing transitions from this state.
                    </p>
                  )}
                </div>
              </div>
              {runtimeModel && (
                <PredicatePreview model={runtimeModel} runtime={runtime} />
              )}
              <details className="ingest-help">
                <summary>
                  Connect an external application <ChevronDown size={14} />
                </summary>
                <p>
                  POST to{" "}
                  <code>
                    {API}/ingest/{runtime.id}
                  </code>{" "}
                  with <code>X-Runtime-Key</code> and the event payload below.
                  The key appears once when the runtime is created.
                </p>
                <pre>
                  {JSON.stringify(
                    {
                      event_id: "unique-event-identifier",
                      event: "<your-event>",
                      expected_sequence: runtime.sequence,
                      model_hash: runtime.model_hash,
                      observed_state: runtime.state,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          </div>
          <div className="trace-table">
            <div className="panel-header">
              <div>
                <span className="eyebrow">APPEND-ONLY EVIDENCE</span>
                <h3>Execution trace</h3>
              </div>
              <span className="muted">
                {loading ? "Syncing…" : `${traces.length} most recent events`}
              </span>
            </div>
            {traces.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>SEQ</th>
                      <th>EVENT</th>
                      <th>STATE</th>
                      <th>RESULT</th>
                      <th>OBSERVED AT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traces.map((t) => (
                      <tr key={t.id}>
                        <td className="mono">
                          {String(t.sequence).padStart(3, "0")}
                        </td>
                        <td>
                          <strong>{t.event}</strong>
                          {t.data.violations?.length > 0 && (
                            <small className="violation-text">
                              {t.data.violations.join(" · ")}
                            </small>
                          )}
                        </td>
                        <td>
                          <code>
                            {t.data.from ? `${t.data.from} → ` : ""}
                            {t.data.state}
                          </code>
                        </td>
                        <td>
                          <Status value={t.data.status} />
                        </td>
                        <td className="muted">{time(t.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted p-5">
                The instance is ready. Dispatch its first event to record a
                trace.
              </p>
            )}
          </div>
          <div className="adapt-panel">
            <div>
              <h3>Verified adaptation</h3>
              <p>
                Activate a strategy for this exact version only when the current
                configuration is inside its independently verified reachable
                space.
              </p>
            </div>
            {snapshot.proposals
              .filter(
                (p) =>
                  p.kind === "synthesis" &&
                  p.base_version_id === runtime.version_id &&
                  p.data.status === "candidate",
              )
              .map((p) => (
                <button
                  key={p.id}
                  className="button"
                  disabled={
                    !!busy ||
                    runtime.status !== "active" ||
                    runtime.strategy_id === p.id
                  }
                  onClick={() =>
                    action("adapt", `${root}/runtimes/${runtime.id}/adapt`, {
                      strategy_id: p.id,
                      expected_sequence: runtime.sequence,
                    })
                  }
                >
                  <ShieldCheck size={15} />
                  {runtime.strategy_id === p.id
                    ? "Active strategy"
                    : "Approve & activate"}{" "}
                  {p.id.slice(0, 8)}
                </button>
              ))}
          </div>
        </>
      ) : (
        <Empty
          icon={<Radio size={40} />}
          title="An observatory for real behavior."
        >
          Start a runtime from a verified artifact. Its events, state, model
          hash, and violations will appear here as they happen.
        </Empty>
      )}
      {create && (
        <Modal
          title="Start a monitored runtime"
          subtitle="This instance stays pinned to its generated artifact and immutable model."
          close={() => setCreate(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = (await action("runtime", `${root}/runtimes`, {
                name,
                version_id: version!.id,
                artifact_id: artifactId,
              })) as Runtime | undefined;
              if (result) {
                setCreate(false);
                setSelected(result.id);
                setName("");
                if (result.ingest_key)
                  setIngestKey({ id: result.id, key: result.ingest_key });
              }
            }}
          >
            <label>
              Instance name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name your runtime instance"
              />
            </label>
            <label>
              Verified artifact
              <select
                required
                value={artifactId}
                onChange={(e) => setArtifactId(e.target.value)}
              >
                {artifacts.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.id.slice(0, 8)} · {a.manifest.generator}
                  </option>
                ))}
              </select>
            </label>
            <footer className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setCreate(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!!busy}>
                {busy ? <Spinner /> : <Radio size={16} />}Start instance
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {ingestKey && (
        <Modal
          title="Runtime ingestion key"
          subtitle="Copy this key now. It is stored as a hash and cannot be retrieved again."
          close={() => setIngestKey(null)}
        >
          <div className="key-display">
            <KeyRound size={20} />
            <code>{ingestKey.key}</code>
          </div>
          <p className="muted">
            Use it only in your external application's backend. Stopping the
            runtime revokes this key. Your workspace can dispatch events without
            it.
          </p>
          <footer className="modal-footer">
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(ingestKey.key);
                  onError("Runtime key copied.");
                } catch {
                  onError(
                    "Clipboard unavailable. Select and copy the key manually.",
                  );
                }
              }}
            >
              <Copy size={15} />
              Copy key
            </button>
            <button
              className="button primary"
              onClick={() => setIngestKey(null)}
            >
              I have saved the key
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
