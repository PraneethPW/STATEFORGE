import PrintText from "./PrintText";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Code2,
  FileCode2,
  GitBranch,
  History,
  Layers,
  LockKeyhole,
  Play,
  Radio,
  Save,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { api, download, stream } from "../api";
import type {
  Activity,
  Artifact,
  Capabilities,
  Model,
  Project,
  Proposal,
  Snapshot,
  Version,
} from "../types";
import { Empty, Modal, SectionTitle, short, Spinner, Status, time } from "./UI";
const GraphEditor = lazy(() => import("./GraphEditor"));
const Evidence = lazy(() => import("./Evidence"));
const RuntimeConsole = lazy(() => import("./RuntimeConsole"));
const tabs = [
  { id: "overview", name: "Overview", icon: Layers },
  { id: "model", name: "Model studio", icon: GitBranch },
  { id: "verification", name: "Verification", icon: ShieldCheck },
  { id: "artifacts", name: "Artifacts", icon: Box },
  { id: "runtime", name: "Runtime", icon: Radio },
  { id: "activity", name: "Activity", icon: ActivityIcon },
];
function blank(project: Project): Model {
  return {
    name: project.name,
    initial: "",
    states: [],
    transitions: [],
    properties: [],
    variables: [],
    assumptions: [],
  };
}
export default function Studio({
  project,
  capabilities,
  notify,
  refreshProjects,
}: {
  project: Project;
  capabilities?: Capabilities;
  notify: (s: string) => void;
  refreshProjects: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("overview");
  const [versionId, setVersionId] = useState("");
  const [model, setModel] = useState<Model>(() => blank(project));
  const [requirements, setRequirements] = useState("");
  const [busy, setBusy] = useState("");
  const [connection, setConnection] = useState<"connected" | "reconnecting">(
    "reconnecting",
  );
  const [activity, setActivity] = useState<Activity[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [activeState, setActiveState] = useState<string>();
  const [saveOpen, setSaveOpen] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const loadedId = useRef("");
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const reduced = useReducedMotion();
  const root = `/projects/${project.id}`;
  const refresh = useCallback(async () => {
    try {
      const data = await api<Snapshot>(root);
      if (!mounted.current) return;
      setSnapshot(data);
      setLoadError("");
      refreshProjects();
    } catch (e) {
      if (mounted.current) setLoadError((e as Error).message);
    }
  }, [root, refreshProjects]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const controller = new AbortController();
    void (async () => {
      let cursor = 0;
      try {
        const recent = await api<Activity[]>(
          `${root}/activity?latest=true`,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setActivity(recent);
        cursor = recent.at(-1)?.id || 0;
      } catch {
        if (controller.signal.aborted) return;
      }
      await stream(
        project.id,
        cursor,
        controller.signal,
        (e) => {
          setActivity((prev) =>
            prev.some((x) => x.id === e.id) ? prev : [...prev, e].slice(-250),
          );
          clearTimeout(debounce.current);
          debounce.current = setTimeout(() => {
            void refresh();
          }, 180);
        },
        setConnection,
      );
    })();
    return () => {
      mounted.current = false;
      controller.abort();
      clearTimeout(debounce.current);
    };
  }, [project.id, root, refresh]);
  const version =
    snapshot?.versions.find((v) => v.id === versionId) || snapshot?.versions[0];
  useEffect(() => {
    if (version && loadedId.current !== version.id) {
      loadedId.current = version.id;
      setVersionId(version.id);
      setModel(structuredClone(version.model));
      setRequirements(version.requirements);
    }
  }, [version]);
  const dirty = version
    ? JSON.stringify(model) !== JSON.stringify(version.model) ||
      requirements !== version.requirements
    : model.states.length > 0 || !!requirements;
  const action = useCallback(
    async (name: string, path: string, body: unknown) => {
      setBusy(name);
      try {
        const result = await api<unknown>(path, body);
        await refresh();
        return result;
      } catch (e) {
        notify((e as Error).message);
        return undefined;
      } finally {
        setBusy("");
      }
    },
    [refresh, notify],
  );
  const latestRun = snapshot?.runs.find((r) => r.version_id === version?.id);
  const currentArtifact = snapshot?.artifacts.find(
    (a) => a.version_id === version?.id,
  );
  const recent = activity.slice(-8).reverse();
  const draftRef = useRef(dirty);
  draftRef.current = dirty;
  useEffect(() => {
    function before(e: BeforeUnloadEvent) {
      if (draftRef.current) e.preventDefault();
    }
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  async function save() {
    const result = (await action("save", `${root}/versions`, {
      model,
      requirements,
      expected_version: snapshot?.versions[0]?.number || 0,
      note: versionNote,
    })) as Version | undefined;
    if (result) {
      setVersionId(result.id);
      setSaveOpen(false);
      setVersionNote("");
      notify(`Version ${result.number} saved. Review it before verification.`);
    }
  }
  function selectVersion(id: string) {
    if (
      dirty &&
      !window.confirm("Discard the unsaved draft and open this model version?")
    )
      return;
    loadedId.current = "";
    setVersionId(id);
  }
  function showTrace(state: string) {
    setActiveState(state);
    setTab("model");
  }
  if (!snapshot)
    return (
      <div className="workspace-loading">
        {loadError ? (
          <>
            <p>{loadError}</p>
            <button className="button" onClick={refresh}>
              Retry connection
            </button>
          </>
        ) : (
          <>
            <Spinner />
            <p>Opening your engineering workspace…</p>
          </>
        )}
      </div>
    );
  return (
    <div className="studio">
      <header className="studio-heading">
        <div>
          <div className="breadcrumbs">
            <span>WORKSPACE</span>
            <ChevronRight size={11} />
            <span>{project.name}</span>
          </div>
          <h1>
            <PrintText>
              {project.name}
              <span className="project-kind">FINITE-STATE SYSTEM</span>
            </PrintText>
          </h1>
          <p>
            {project.description ||
              "One model. A continuous chain of evidence."}
          </p>
        </div>
        <div className="heading-actions">
          <Status value={connection} />
          <button
            className="button primary"
            disabled={!model.states.length || !!busy}
            onClick={() => setSaveOpen(true)}
          >
            {busy === "save" ? <Spinner /> : <Save size={15} />}Save version
          </button>
        </div>
      </header>
      <nav className="workspace-tabs" aria-label="Project views">
        {tabs.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {name}
            {id === "verification" && latestRun?.status === "failed" && (
              <i className="tab-alert" />
            )}
          </button>
        ))}
        <div className="version-picker">
          <span>
            {dirty ? (
              <>
                <i className="unsaved-dot" />
                Unsaved draft
              </>
            ) : (
              "MODEL VERSION"
            )}
          </span>
          <select
            aria-label="Model version"
            value={version?.id || ""}
            onChange={(e) => selectVersion(e.target.value)}
          >
            {!snapshot.versions.length && (
              <option value="">No saved versions</option>
            )}
            {snapshot.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.number} · {v.model_hash.slice(0, 7)}
              </option>
            ))}
          </select>
        </div>
      </nav>
      {loadError && (
        <div className="notice error">
          {loadError}
          <button onClick={refresh}>Retry</button>
        </div>
      )}
      <motion.div
        key={tab}
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
      >
        {tab === "overview" && (
          <div className="overview">
            <div className="overview-intro">
              <div>
                <span className="eyebrow">
                  <span className="live-dot" />
                  ENGINEERING CONTROL ROOM
                </span>
                <h2>
                  <PrintText>
                    Make every transition
                    <br />
                    <em>intentional.</em>
                  </PrintText>
                </h2>
                <p>
                  Shape the behavior. Explore every path.
                  <br />
                  Keep the proof connected to production.
                </p>
                <button className="button" onClick={() => setTab("model")}>
                  Open model studio <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="overview-signal" aria-hidden="true">
                <div className="signal-ring r1" />
                <div className="signal-ring r2" />
                <div className="signal-ring r3" />
                <div className="signal-center">
                  <Workflow size={36} strokeWidth={1} />
                </div>
                <span className="signal-label a">MODEL</span>
                <span className="signal-label b">EVIDENCE</span>
                <span className="signal-label c">RUNTIME</span>
              </div>
              <div className="overview-caption">
                AUTHOR · VERIFY · GENERATE · OBSERVE
              </div>
            </div>
            <div className="stat-grid">
              {[
                {
                  label: "MODEL STATES",
                  value: version?.model.states.length || 0,
                  icon: GitBranch,
                  detail: `${version?.model.transitions.length || 0} explicit transitions`,
                },
                {
                  label: "DECLARED PROPERTIES",
                  value: version?.model.properties.length || 0,
                  icon: ShieldCheck,
                  detail: "Safety, progress & reachability",
                },
                {
                  label: "VERIFICATION RUNS",
                  value: snapshot.runs.length,
                  icon: Play,
                  detail: `${snapshot.runs.filter((r) => r.status === "passed").length} passing results`,
                },
                {
                  label: "ACTIVE RUNTIMES",
                  value: snapshot.runtimes.filter((r) => r.status === "active")
                    .length,
                  icon: Radio,
                  detail: `${snapshot.runtimes.length} total instances`,
                },
              ].map(({ label, value, icon: Icon, detail }) => (
                <article className="stat-card" key={label}>
                  <div>
                    <span>{label}</span>
                    <Icon size={16} />
                  </div>
                  <strong>{String(value).padStart(2, "0")}</strong>
                  <small>{detail}</small>
                </article>
              ))}
            </div>
            <div className="overview-lower">
              <div className="pipeline-panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">BEHAVIORAL PIPELINE</span>
                    <h3>
                      <PrintText>From intention to execution</PrintText>
                    </h3>
                  </div>
                  <ArrowUpRight size={17} />
                </div>
                {[
                  {
                    label: "Authoritative model",
                    subtitle: version
                      ? `Version ${version.number} · ${short(version.model_hash)}`
                      : "Create your first model version",
                    icon: GitBranch,
                    status: version
                      ? version.approved_at
                        ? "approved"
                        : "review needed"
                      : "empty",
                    go: "model",
                  },
                  {
                    label: "Formal verification",
                    subtitle: latestRun
                      ? `${latestRun.result?.configurations ?? "—"} configurations explored`
                      : "No verification evidence yet",
                    icon: ShieldCheck,
                    status: latestRun?.status || "waiting",
                    go: "verification",
                  },
                  {
                    label: "Generated implementation",
                    subtitle: currentArtifact
                      ? currentArtifact.manifest.generator
                      : "Waiting for a verified model",
                    icon: FileCode2,
                    status: currentArtifact ? "passed" : "waiting",
                    go: "artifacts",
                  },
                  {
                    label: "Runtime assurance",
                    subtitle: "Version-bound event monitoring",
                    icon: Radio,
                    status: snapshot.runtimes.some((r) => r.status === "active")
                      ? "active"
                      : "waiting",
                    go: "runtime",
                  },
                ].map((p, i) => (
                  <button
                    className="pipeline-row"
                    key={p.go}
                    onClick={() => setTab(p.go)}
                  >
                    <span className="pipeline-number">0{i + 1}</span>
                    <p.icon size={19} />
                    <div>
                      <strong>{p.label}</strong>
                      <small>{p.subtitle}</small>
                    </div>
                    <Status value={p.status} />
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
              <div className="recent-panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">LIVE WORKSPACE FEED</span>
                    <h3>
                      <PrintText>Latest signals</PrintText>
                    </h3>
                  </div>
                  <span className="live-dot" />
                </div>
                {recent.length ? (
                  recent.map((e) => (
                    <div className="recent-event" key={e.id}>
                      <span className="event-dot" />
                      <div>
                        <strong>{e.kind.replaceAll(".", " ")}</strong>
                        <small>{time(e.created_at)}</small>
                      </div>
                      <code>#{e.id}</code>
                    </div>
                  ))
                ) : (
                  <p className="muted p-5">
                    Actions in this workspace appear here in real time.
                  </p>
                )}
                <button
                  className="text-link"
                  onClick={() => setTab("activity")}
                >
                  View activity <ArrowRight size={14} />
                </button>
              </div>
            </div>
            <div className="engine-strip">
              <LockKeyhole size={18} />
              <div>
                <strong>
                  {capabilities?.engine || "Explicit finite-state engine"}
                </strong>
                <span>
                  Neon PostgreSQL · immutable model versions · append-only
                  runtime evidence
                </span>
              </div>
              <code>NO SAMPLED VERDICTS</code>
            </div>
          </div>
        )}
        {tab === "model" && (
          <div className="authoring">
            <div className="authoring-top">
              <div>
                <span className="eyebrow">01 / MODEL STUDIO</span>
                <h2>
                  <PrintText>Design the behavior.</PrintText>
                </h2>
              </div>
              <div className="flex gap-2">
                {activeState && (
                  <button
                    className="button small"
                    onClick={() => setActiveState(undefined)}
                  >
                    <X size={13} />
                    Clear trace highlight
                  </button>
                )}
                <button
                  className="button small"
                  disabled={
                    !version || dirty || !!busy || !!version.approved_at
                  }
                  onClick={() => setReviewOpen(true)}
                >
                  <Check size={14} />
                  {version?.approved_at
                    ? "Version reviewed"
                    : "Review & approve"}
                </button>
                <button
                  className="button primary small"
                  disabled={!version?.approved_at || dirty || !!busy}
                  onClick={async () => {
                    await action("verify", `${root}/runs`, {
                      version_id: version!.id,
                    });
                    setTab("verification");
                  }}
                >
                  <Play size={13} />
                  Verify
                </button>
              </div>
            </div>
            <div className="model-meta">
              <label>
                Model name
                <input
                  value={model.name}
                  maxLength={160}
                  onChange={(e) => setModel({ ...model, name: e.target.value })}
                />
              </label>
              <label>
                Initial state
                <select
                  value={model.initial}
                  onChange={(e) =>
                    setModel({ ...model, initial: e.target.value })
                  }
                >
                  <option value="" disabled>
                    Select initial state
                  </option>
                  {model.states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({s.id})
                    </option>
                  ))}
                </select>
              </label>
              <div className="model-version-status">
                {version ? (
                  <>
                    <code>v{version.number}</code>
                    <Status
                      value={
                        dirty
                          ? "draft"
                          : version.approved_at
                            ? "approved"
                            : "review needed"
                      }
                    />
                  </>
                ) : (
                  <Status value="draft" />
                )}
              </div>
            </div>
            <div className="editor-shell">
              <Suspense
                fallback={
                  <div className="workspace-loading">
                    <Spinner />
                  </div>
                }
              >
                <GraphEditor
                  model={model}
                  setModel={setModel}
                  activeState={activeState}
                  onError={notify}
                />
              </Suspense>
            </div>
            <div className="requirements-panel">
              <div>
                <span className="eyebrow">SOURCE REQUIREMENTS</span>
                <h3>
                  <PrintText>Start with the intent.</PrintText>
                </h3>
                <p>
                  Describe behavior, constraints, and assumptions. AI proposes
                  an explicit model for your review; it supplies no proof.
                </p>
                <div className="ai-provider">
                  <Sparkles size={13} />
                  {capabilities?.ai_configured
                    ? capabilities.ai_model
                    : "OpenRouter not configured"}
                </div>
              </div>
              <div>
                <label className="sr-only" htmlFor="requirements">
                  Behavioral requirements
                </label>
                <textarea
                  id="requirements"
                  rows={6}
                  value={requirements}
                  maxLength={30000}
                  onChange={(e) => setRequirements(e.target.value)}
                  placeholder="Describe your system's actual states, events, expected outcomes, and recovery rules…"
                />
                <button
                  className="button"
                  disabled={
                    requirements.length < 20 ||
                    !!busy ||
                    !capabilities?.ai_configured
                  }
                  onClick={async () => {
                    const result = await action("ai", `${root}/ai`, {
                      requirements,
                      mode: "parse",
                    });
                    if (result) setProposal(result as Proposal);
                  }}
                >
                  {busy === "ai" ? <Spinner /> : <Sparkles size={15} />}Draft
                  model from requirements <ArrowRight size={15} />
                </button>
              </div>
            </div>
            {snapshot.proposals.filter((p) => p.kind !== "synthesis").length >
              0 && (
              <div className="proposal-history">
                <h3>
                  <PrintText>Requirement & repair proposals</PrintText>
                </h3>
                {snapshot.proposals
                  .filter((p) => p.kind !== "synthesis")
                  .map((p) => (
                    <button key={p.id} onClick={() => setProposal(p)}>
                      <Sparkles size={14} />
                      <span>
                        {p.kind === "repair"
                          ? "Repair proposal"
                          : "Requirement interpretation"}
                      </span>
                      <small>{time(p.created_at)}</small>
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
              </div>
            )}
            <div className="semantics-note">
              Editing creates a draft. Saving creates an immutable version and
              makes earlier evidence stale for the new model. Existing runtimes
              retain their original verified version.
            </div>
          </div>
        )}
        {tab === "verification" && (
          <Suspense
            fallback={
              <div className="workspace-loading">
                <Spinner />
              </div>
            }
          >
            <Evidence
              snapshot={snapshot}
              version={version}
              busy={busy}
              action={action}
              onProposal={setProposal}
              onTrace={showTrace}
            />
          </Suspense>
        )}
        {tab === "artifacts" && (
          <div className="page-section">
            <SectionTitle
              index="03 / ARTIFACT FOUNDRY"
              title="Ship the behavior you verified."
              description="Generate a Python engine, model manifest, exhaustive transition fixtures, and runnable conformance tests."
              action={
                <button
                  className="button primary"
                  disabled={latestRun?.status !== "passed" || dirty || !!busy}
                  onClick={() =>
                    action("generate", `${root}/artifacts`, {
                      version_id: version!.id,
                    })
                  }
                >
                  {busy === "generate" ? <Spinner /> : <Code2 size={16} />}
                  Generate package
                </button>
              }
            />
            {latestRun?.status !== "passed" && (
              <div className="notice">
                <ShieldCheck size={17} />A passing verification run for the
                selected version is required.
              </div>
            )}
            {snapshot.artifacts.filter((a) => a.version_id === version?.id)
              .length ? (
              <div className="artifact-grid">
                {snapshot.artifacts
                  .filter((a) => a.version_id === version?.id)
                  .map((a) => (
                    <ArtifactCard
                      key={a.id}
                      artifact={a}
                      download={() => {
                        void download(
                          `${root}/artifacts/${a.id}/download`,
                        ).catch((e) => notify(e.message));
                      }}
                    />
                  ))}
              </div>
            ) : (
              <Empty
                icon={<FileCode2 size={40} />}
                title="The model becomes the implementation."
              >
                Generated artifacts carry the model checksum and verification
                record. Your package includes a standalone engine and real
                transition conformance tests.
              </Empty>
            )}
            <div className="semantics-note">
              Generated tests cover control-flow semantics. External actions,
              device I/O, deployment packaging, and third-party service effects
              require application-specific adapters and tests.
            </div>
          </div>
        )}
        {tab === "runtime" && (
          <Suspense
            fallback={
              <div className="workspace-loading">
                <Spinner />
              </div>
            }
          >
            <RuntimeConsole
              snapshot={snapshot}
              version={version}
              busy={busy}
              action={action}
              onError={notify}
              activitySeq={activity.at(-1)?.id || 0}
            />
          </Suspense>
        )}
        {tab === "activity" && (
          <div className="page-section">
            <SectionTitle
              index="05 / AUDIT TRAIL"
              title="A history that stays intact."
              description="Durable activity and runtime records stream from PostgreSQL. Reconnecting resumes from the last received event."
              action={<Status value={connection} />}
            />
            <div className="activity-feed">
              {[...activity].reverse().map((e) => (
                <div className="audit-event" key={e.id}>
                  <div className="audit-icon">
                    <History size={16} />
                  </div>
                  <div>
                    <span className="eyebrow">
                      EVENT {e.id} · {time(e.created_at)}
                    </span>
                    <h3>
                      <PrintText>{e.kind.replaceAll(".", " ")}</PrintText>
                    </h3>
                    <details>
                      <summary>Inspect evidence</summary>
                      <pre>{JSON.stringify(e.data, null, 2)}</pre>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
      <footer className="studio-footer">
        <span>
          <i className="live-dot" />
          {connection === "connected"
            ? "LIVE EVENT STREAM"
            : "RECONNECTING EVENT STREAM"}
        </span>
        <span>POSTGRESQL / NEON</span>
        <span>
          {version
            ? `MODEL ${version.model_hash.slice(0, 12)}`
            : "NO SAVED MODEL"}
        </span>
      </footer>
      {saveOpen && (
        <Modal
          title="Save a model version"
          subtitle="This snapshot is immutable. Later edits create a new version with a new checksum."
          close={() => setSaveOpen(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="save-summary">
              <span>{model.states.length} states</span>
              <span>{model.transitions.length} transitions</span>
              <span>{model.properties.length} properties</span>
            </div>
            {!model.properties.length && (
              <div className="notice">
                No temporal properties are declared. Verification will cover
                structural checks only.
              </div>
            )}
            <label>
              Revision note
              <textarea
                rows={3}
                maxLength={500}
                value={versionNote}
                onChange={(e) => setVersionNote(e.target.value)}
                placeholder="Describe what changed and why"
              />
            </label>
            <footer className="modal-footer">
              <button
                className="button"
                type="button"
                onClick={() => setSaveOpen(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={!!busy}>
                {busy ? <Spinner /> : <Save size={15} />}Save v
                {(snapshot.versions[0]?.number || 0) + 1}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {reviewOpen && (
        <Modal
          title="Approve this behavioral model"
          subtitle={`Version ${version?.number} · ${version?.model_hash.slice(0, 16)}`}
          close={() => setReviewOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const result = await action(
                "approve",
                `${root}/versions/${version!.id}/approve`,
                {},
              );
              if (result) {
                setReviewOpen(false);
                notify(
                  "Review recorded. The version is eligible for verification.",
                );
              }
            }}
          >
            <p>
              Review the states, guards, terminal behavior, property
              definitions, source requirements, and assumptions. Approval
              records your review; it does not replace verification.
            </p>
            <label className="check-label review-check">
              <input type="checkbox" required />I reviewed this model and
              resolved requirement ambiguities.
            </label>
            <footer className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setReviewOpen(false)}
              >
                Back to model
              </button>
              <button className="button primary" disabled={!!busy}>
                {busy ? <Spinner /> : <Check size={16} />}Approve version
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {proposal && (
        <ProposalReview
          proposal={proposal}
          close={() => setProposal(null)}
          accept={(candidate, resolution) => {
            setModel(structuredClone(candidate));
            if (resolution)
              setRequirements(
                (prev) => `${prev}\n\nReview resolution: ${resolution}`,
              );
            setVersionNote(`Reviewed ${proposal.kind} proposal ${proposal.id}`);
            setProposal(null);
            setTab("model");
            notify(
              "Proposal loaded into your draft. Inspect it and save a new version.",
            );
          }}
        />
      )}
    </div>
  );
}
function ArtifactCard({
  artifact,
  download,
}: {
  artifact: Artifact;
  download: () => void;
}) {
  return (
    <article className="artifact-card">
      <div className="artifact-top">
        <FileCode2 size={29} strokeWidth={1.2} />
        <Status value="passed" />
      </div>
      <span className="eyebrow">VERIFIED PYTHON PACKAGE</span>
      <h3>
        <PrintText>{artifact.manifest.generator}</PrintText>
      </h3>
      <p>
        Portable engine · JSON model · monitor predicates · conformance tests ·
        evidence manifest
      </p>
      <div className="artifact-metrics">
        <div>
          <strong>{artifact.manifest.conformance_cases}</strong>
          <span>CONFORMANCE CASES</span>
        </div>
        <div>
          <strong>{artifact.manifest.reachable_configurations}</strong>
          <span>CONFIGURATIONS</span>
        </div>
      </div>
      <div className="artifact-hash">
        <span>MODEL</span>
        <code title={artifact.model_hash}>{short(artifact.model_hash)}</code>
        <span>PACKAGE</span>
        <code title={artifact.content_hash}>
          {short(artifact.content_hash)}
        </code>
      </div>
      <button className="button full" onClick={download}>
        <ArrowDownToLine size={16} />
        Download engine package
      </button>
      <small>{time(artifact.created_at)}</small>
    </article>
  );
}
function ProposalReview({
  proposal,
  close,
  accept,
}: {
  proposal: Proposal;
  close: () => void;
  accept: (m: Model, resolution: string) => void;
}) {
  const candidate = proposal.data.model || proposal.data.candidate;
  const [resolution, setResolution] = useState("");
  const [raw, setRaw] = useState(false);
  const ambiguous = proposal.data.ambiguities?.length || 0;
  return (
    <Modal
      title={
        proposal.kind === "synthesis"
          ? "Controller strategy evidence"
          : proposal.kind === "repair"
            ? "Review the proposed repair"
            : "Review the behavioral draft"
      }
      subtitle="A proposal changes nothing until you load it, inspect it, and save a version."
      wide
      close={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (candidate) accept(candidate, resolution);
        }}
      >
        <div className="proposal-summary">
          <div>
            <Sparkles size={21} />
            <span>{proposal.data.provider_model || "Finite game solver"}</span>
          </div>
          <Status value={proposal.data.status || "review needed"} />
        </div>
        {proposal.data.reason && (
          <div className="notice">{proposal.data.reason}</div>
        )}
        {candidate && (
          <>
            <div className="save-summary">
              <span>{candidate.states.length} states</span>
              <span>{candidate.transitions.length} transitions</span>
              <span>{candidate.properties.length} properties</span>
            </div>
            <div className="proposal-states">
              {candidate.states.map((s) => (
                <div key={s.id}>
                  <span className="tiny-state" />
                  <strong>{s.label}</strong>
                  <code>{s.id}</code>
                  <small>
                    {s.id === candidate.initial
                      ? "Initial"
                      : s.terminal
                        ? "Terminal"
                        : s.owner}
                  </small>
                </div>
              ))}
            </div>
            <h3>
              <PrintText>Proposed transitions</PrintText>
            </h3>
            <div className="proposal-transitions">
              {candidate.transitions.map((t) => (
                <div key={t.id}>
                  <code>{t.source}</code>
                  <span>— {t.event} →</span>
                  <code>{t.target}</code>
                  <small>{t.guard}</small>
                </div>
              ))}
            </div>
            {candidate.assumptions.length > 0 && (
              <>
                <h3>
                  <PrintText>Model assumptions</PrintText>
                </h3>
                <ul>
                  {candidate.assumptions.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            <button
              className="button ghost small"
              type="button"
              onClick={() => setRaw(!raw)}
            >
              {raw ? "Hide" : "Inspect"} model JSON
            </button>
            {raw && (
              <pre className="proposal-json">
                {JSON.stringify(candidate, null, 2)}
              </pre>
            )}
          </>
        )}
        {ambiguous > 0 && (
          <div className="notice column">
            <strong>Ambiguities requiring your decision</strong>
            <ul>
              {proposal.data.ambiguities!.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        {proposal.data.notes?.map((n, i) => (
          <p key={i} className="muted">
            {n}
          </p>
        ))}
        {ambiguous > 0 && (
          <label>
            How you resolved the ambiguities
            <textarea
              required
              minLength={10}
              maxLength={1500}
              rows={3}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </label>
        )}
        <footer className="modal-footer">
          <button type="button" className="button" onClick={close}>
            Keep current model
          </button>
          {candidate && proposal.data.status !== "rejected" && (
            <button className="button primary">
              <GitBranch size={15} />
              Load candidate into draft
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
