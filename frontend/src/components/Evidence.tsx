import { useState } from "react";
import {
  ShieldCheck,
  Play,
  AlertTriangle,
  ChevronRight,
  Check,
  Sparkles,
  Workflow,
  ArrowRight,
} from "lucide-react";
import type { Proposal, Run, Snapshot, Version } from "../types";
import { Empty, Modal, Spinner, Status, time, short, SectionTitle } from "./UI";
export default function Evidence({
  snapshot,
  version,
  busy,
  action,
  onProposal,
  onTrace,
}: {
  snapshot: Snapshot;
  version?: Version;
  busy: string;
  action: (name: string, path: string, body: unknown) => Promise<unknown>;
  onProposal: (p: Proposal) => void;
  onTrace: (state: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  const [synth, setSynth] = useState(false);
  const [safe, setSafe] = useState("True");
  const [goal, setGoal] = useState("");
  const runs = snapshot.runs.filter((r) => r.version_id === version?.id);
  const run = runs.find((r) => r.id === selected) || runs[0];
  const result = run?.result;
  const root = `/projects/${snapshot.project.id}`;
  return (
    <div className="page-section">
      <SectionTitle
        index="02 / VERIFICATION LAB"
        title="Confidence comes from evidence."
        description="Exhaustive finite-state analysis. Every result belongs to an immutable model version."
        action={
          <div className="flex gap-2">
            <button
              className="button"
              disabled={!version?.approved_at || !!busy}
              onClick={() => setSynth(true)}
            >
              <Workflow size={15} />
              Synthesize
            </button>
            <button
              className="button primary"
              disabled={!version?.approved_at || !!busy}
              onClick={() =>
                action("verify", `${root}/runs`, { version_id: version!.id })
              }
            >
              {busy === "verify" ? <Spinner /> : <Play size={14} />}Verify
              version
            </button>
          </div>
        }
      />
      {!version?.approved_at && (
        <div className="notice">
          <AlertTriangle size={18} />
          <span>
            Save and explicitly approve your model in the authoring workspace
            before running verification.
          </span>
        </div>
      )}
      <div className="evidence-layout">
        <aside className="run-list">
          <div className="tree-heading">
            VERIFICATION RUNS <span>{runs.length}</span>
          </div>
          {runs.map((r) => (
            <button
              key={r.id}
              className={run?.id === r.id ? "selected" : ""}
              onClick={() => setSelected(r.id)}
            >
              <span>
                <ShieldCheck size={15} />
                <code>{r.id.slice(0, 8)}</code>
              </span>
              <Status value={r.status} />
              <small>{time(r.created_at)}</small>
            </button>
          ))}
          {!runs.length && (
            <p className="muted p-5">No runs for this version.</p>
          )}
        </aside>
        <div className="evidence-main">
          {run ? (
            <>
              <div className="evidence-banner">
                <div>
                  <span className="eyebrow">RUN / {run.id.slice(0, 8)}</span>
                  <h3>
                    {run.status === "passed"
                      ? "Behavior checks out."
                      : run.status === "failed"
                        ? "A path needs your attention."
                        : ["queued", "running"].includes(run.status)
                          ? "Exploring the behavior space…"
                          : "Analysis did not complete."}
                  </h3>
                </div>
                <Status value={run.status} />
              </div>
              {["queued", "running"].includes(run.status) ? (
                <div className="working-state">
                  <Spinner />
                  <p>
                    {run.status === "queued"
                      ? "Queued for the verification worker. Updates arrive automatically."
                      : "Evaluating structural checks and temporal properties."}
                  </p>
                </div>
              ) : (
                result && (
                  <>
                    <div className="metrics-row">
                      <div>
                        <span>CONFIGURATIONS</span>
                        <strong>{result.configurations ?? "—"}</strong>
                      </div>
                      <div>
                        <span>EDGES EXPLORED</span>
                        <strong>{result.edges ?? "—"}</strong>
                      </div>
                      <div>
                        <span>ANALYSIS TIME</span>
                        <strong>
                          {result.duration_ms ?? "—"}
                          <small> ms</small>
                        </strong>
                      </div>
                      <div>
                        <span>PROPERTIES</span>
                        <strong>
                          {result.properties?.filter(
                            (x) => x.status === "passed",
                          ).length ?? 0}
                          <small> / {result.properties?.length ?? 0}</small>
                        </strong>
                      </div>
                    </div>
                    {result.message && (
                      <div className="notice">{result.message}</div>
                    )}
                    <div className="evidence-record">
                      <span>
                        ENGINE <code>{result.engine}</code>
                      </span>
                      <span>
                        MODEL{" "}
                        <code title={result.model_hash}>
                          {result.model_hash ? short(result.model_hash) : "—"}
                        </code>
                      </span>
                    </div>
                    {result.diagnostics?.map((d, i) => (
                      <div className={`diagnostic ${d.severity}`} key={i}>
                        <AlertTriangle size={16} />
                        <div>
                          <strong>{d.code.replaceAll("_", " ")}</strong>
                          <p>{d.message}</p>
                          {d.state && (
                            <button onClick={() => onTrace(d.state!)}>
                              Locate {d.state} <ArrowRight size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="property-results">
                      {result.properties?.length ? (
                        result.properties.map((p) => (
                          <details
                            key={p.property_id}
                            className="property-result"
                            open={p.status === "failed"}
                          >
                            <summary>
                              <span className={`result-icon ${p.status}`}>
                                {p.status === "passed" ? (
                                  <Check size={14} />
                                ) : (
                                  <AlertTriangle size={14} />
                                )}
                              </span>
                              <div>
                                <strong>{p.name}</strong>
                                <code>{p.formula}</code>
                              </div>
                              <Status value={p.status} />
                              <ChevronRight size={15} />
                            </summary>
                            <div className="property-detail">
                              <p>
                                {p.backend === "SPIN"
                                  ? `${p.tool_version || "SPIN"} · ${p.message || "Exact LTL model checking"}`
                                  : `${p.satisfying_configurations} configurations satisfy this temporal formula.`}
                              </p>
                              {p.trace.length ? (
                                <>
                                  <span className="eyebrow">
                                    {p.status === "failed"
                                      ? "COUNTEREXAMPLE"
                                      : "WITNESS"}{" "}
                                    {p.loop_index !== null
                                      ? ` / LOOP RETURNS TO STEP ${p.loop_index}`
                                      : ""}
                                  </span>
                                  <div className="trace-path">
                                    {p.trace.map((step, i) => (
                                      <button
                                        key={i}
                                        onClick={() => onTrace(step.state)}
                                      >
                                        <small>
                                          {String(i).padStart(2, "0")}
                                          {step.transition
                                            ? ` / ${step.transition}`
                                            : ""}
                                        </small>
                                        <span>
                                          <CircleState />
                                          {step.state}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </>
                              ) : (
                                <p className="muted">
                                  No linear witness applies to this result. The
                                  verdict comes from the complete fixed-point
                                  calculation.
                                </p>
                              )}
                            </div>
                          </details>
                        ))
                      ) : (
                        <p className="muted p-5">
                          No temporal properties were declared. This run checks
                          structure only.
                        </p>
                      )}
                    </div>
                    <div className="semantics-note">
                      {result.semantics ||
                        "No verification evidence was produced."}
                    </div>
                    {run.status === "failed" && (
                      <button
                        className="button"
                        disabled={!!busy}
                        onClick={async () => {
                          const p = await action("repair", `${root}/ai`, {
                            mode: "repair",
                            version_id: version!.id,
                            run_id: run.id,
                            requirements:
                              version!.requirements ||
                              `Preserve the supplied behavioral model and all declared properties. Correct the reported violation with a minimal edit.`,
                          });
                          if (p) onProposal(p as Proposal);
                        }}
                      >
                        {busy === "repair" ? (
                          <Spinner />
                        ) : (
                          <Sparkles size={15} />
                        )}
                        Propose a bounded repair
                      </button>
                    )}
                  </>
                )
              )}
            </>
          ) : (
            <Empty
              icon={<ShieldCheck size={36} />}
              title="Explore the paths you haven't taken."
            >
              Run verification to check deadlocks, conflicting guards, and
              temporal properties. Counterexamples appear here when a property
              fails.
            </Empty>
          )}
        </div>
      </div>
      <div className="synthesis-results">
        <h3>Controller synthesis</h3>
        <p className="muted">
          Solve a finite safety and reachability game. Environment decisions
          remain adversarial; controller choices can be restricted.
        </p>
        {snapshot.proposals
          .filter(
            (p) => p.kind === "synthesis" && p.base_version_id === version?.id,
          )
          .map((p) => (
            <button
              className="property-card"
              key={p.id}
              onClick={() => onProposal(p)}
            >
              <Workflow size={22} />
              <div>
                <strong>
                  {p.data.status === "candidate"
                    ? "Verified strategy candidate"
                    : "Synthesis result"}
                </strong>
                <small>
                  {p.data.winning_configurations} winning configurations ·{" "}
                  {time(p.created_at)}
                </small>
              </div>
              <Status value={p.data.status || "unknown"} />
              <ChevronRight size={15} />
            </button>
          ))}
      </div>
      {synth && (
        <Modal
          title="Synthesize a controller"
          subtitle="Construct a strategy that maintains safety and inevitably reaches a goal."
          close={() => setSynth(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const p = await action("synthesis", `${root}/synthesize`, {
                version_id: version!.id,
                safe,
                goal,
              });
              if (p) {
                setSynth(false);
                onProposal(p as Proposal);
              }
            }}
          >
            <label>
              Safety predicate
              <input
                required
                className="mono"
                value={safe}
                onChange={(e) => setSafe(e.target.value)}
              />
            </label>
            <label>
              Reachability goal
              <input
                required
                className="mono"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="state == 'YourGoalState'"
              />
            </label>
            <p className="muted">
              Set state ownership in the model editor. Each controller state
              chooses an enabled transition. Environment states must tolerate
              every enabled transition. The candidate is independently rechecked
              and requires your review.
            </p>
            <footer className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setSynth(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!!busy}>
                {busy ? <Spinner /> : <Workflow size={15} />}Solve game
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
function CircleState() {
  return <i className="tiny-state" />;
}
export function RunSummary({ run }: { run?: Run }) {
  return run ? (
    <Status value={run.status} />
  ) : (
    <span className="muted">Not verified</span>
  );
}
