import PrintText from "./components/PrintText";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  FolderOpen,
  LayoutGrid,
  LogOut,
  Plus,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { api, getToken, setToken } from "./api";
import type { Capabilities, Project, User } from "./types";
import Auth from "./components/Auth";
import Studio from "./components/Studio";
import { Empty, Logo, Modal, Spinner, Toast } from "./components/UI";
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(
    () => new URLSearchParams(location.search).get("project") || "",
  );
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [message, setMessage] = useState("");
  const [create, setCreate] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const notify = useCallback((s: string) => setMessage(s), []);
  const refreshProjects = useCallback(() => {
    void api<Project[]>("/projects")
      .then(setProjects)
      .catch((e) => notify(e.message));
  }, [notify]);
  useEffect(() => {
    if (!getToken()) return;
    const controller = new AbortController();
    api<User>("/auth/me", undefined, controller.signal)
      .then(setUser)
      .catch((e) => {
        if (!controller.signal.aborted) {
          setToken(null);
          notify(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [notify]);
  useEffect(() => {
    function expired() {
      setToken(null);
      setUser(null);
      setProjects([]);
      notify("Your session expired. Sign in to continue.");
    }
    window.addEventListener("stateforge.expired", expired);
    return () => window.removeEventListener("stateforge.expired", expired);
  }, [notify]);
  useEffect(() => {
    if (user) {
      refreshProjects();
      api<Capabilities>("/capabilities")
        .then(setCapabilities)
        .catch((e) => notify(e.message));
    }
  }, [user, refreshProjects, notify]);
  useEffect(() => {
    const url = new URL(location.href);
    if (projectId) url.searchParams.set("project", projectId);
    else url.searchParams.delete("project");
    history.replaceState(null, "", url);
  }, [projectId]);
  async function logout(skipRequest = false) {
    try {
      if (!skipRequest) await api("/auth/logout", {});
    } finally {
      setToken(null);
      setUser(null);
      setProjects([]);
    }
  }
  const project = projects.find((p) => p.id === projectId);
  if (loading)
    return (
      <div className="boot">
        <Logo />
        <Spinner />
        <span>Connecting to StateForge…</span>
      </div>
    );
  if (!user)
    return (
      <>
        <Auth onAuth={setUser} />
        <Toast message={message} clear={() => setMessage("")} />
      </>
    );
  return (
    <div className="app-shell">
      <aside className="rail">
        <button
          className="rail-logo"
          aria-label="All projects"
          onClick={() => setProjectId("")}
        >
          <Logo small />
        </button>
        <div className="rail-nav">
          <button
            className={!project ? "active" : ""}
            title="Projects"
            aria-label="All projects"
            onClick={() => setProjectId("")}
          >
            <LayoutGrid size={20} />
          </button>
          {project && (
            <button
              className="active"
              title={project.name}
              aria-label="Current project"
            >
              <FolderOpen size={20} />
            </button>
          )}
          <button
            title="New project"
            aria-label="New project"
            onClick={() => setCreate(true)}
          >
            <Plus size={20} />
          </button>
        </div>
        <div className="rail-bottom">
          <button
            title="Engine capabilities and account"
            aria-label="Engine capabilities and account"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={20} />
          </button>
          <button
            title="Sign out"
            aria-label="Sign out"
            onClick={() => {
              void logout().catch((e) => notify(e.message));
            }}
          >
            <LogOut size={18} />
          </button>
          <div className="avatar" title={user.name}>
            {user.name.slice(0, 2).toUpperCase()}
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar">
          <button className="brand-button" onClick={() => setProjectId("")}>
            <Logo />
          </button>
          <div className="topbar-right">
            <span className="workspace-private">
              <ShieldCheck size={13} />
              PRIVATE WORKSPACE
            </span>
            <button className="user-menu" onClick={() => setSettings(true)}>
              {user.name}
              <ChevronDown size={13} />
            </button>
          </div>
        </header>
        {project ? (
          <Studio
            key={project.id}
            project={project}
            capabilities={capabilities}
            notify={notify}
            refreshProjects={refreshProjects}
          />
        ) : (
          <main className="projects-page">
            <div className="projects-title">
              <div>
                <span className="eyebrow">YOUR ENGINEERING WORKSPACE</span>
                <h1>
                  <PrintText>Systems start here.</PrintText>
                </h1>
                <p>Give your software an explicit behavioral foundation.</p>
              </div>
              <button
                className="button primary"
                onClick={() => setCreate(true)}
              >
                <Plus size={16} />
                New project
              </button>
            </div>
            {projects.length ? (
              <div className="project-grid">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    className="project-card"
                    onClick={() => setProjectId(p.id)}
                  >
                    <div>
                      <FolderOpen size={27} strokeWidth={1.2} />
                      <ArrowUpRight size={17} />
                    </div>
                    <span className="eyebrow">FINITE-STATE SYSTEM</span>
                    <h2>
                      <PrintText>{p.name}</PrintText>
                    </h2>
                    <p>{p.description || "Behavioral engineering workspace"}</p>
                    <footer>
                      <span>{p.version_count || 0} model versions</span>
                      <span>
                        <i className="live-dot" />
                        {p.runtime_count || 0} active runtimes
                      </span>
                    </footer>
                  </button>
                ))}
                <button
                  className="new-project-card"
                  onClick={() => setCreate(true)}
                >
                  <Plus size={30} strokeWidth={1} />
                  <span>Create a new system</span>
                </button>
              </div>
            ) : (
              <div className="new-workspace">
                <div className="new-workspace-orbit" aria-hidden="true">
                  <div />
                  <ShieldCheck size={60} strokeWidth={0.8} />
                </div>
                <Empty
                  icon={<FolderOpen size={32} />}
                  title="Your workspace is a clean slate."
                  action={
                    <button
                      className="button primary"
                      onClick={() => setCreate(true)}
                    >
                      <Plus size={16} />
                      Create your first project
                    </button>
                  }
                >
                  Create a project, describe its behavior, and build your first
                  state model. Everything you see here comes from your own work.
                </Empty>
              </div>
            )}
            <div className="project-guide">
              <BookOpen size={22} strokeWidth={1.3} />
              <div>
                <h3>
                  <PrintText>One model through the lifecycle.</PrintText>
                </h3>
                <p>
                  Author states and properties, verify every reachable path,
                  generate the implementation, and monitor real runtime events.
                </p>
              </div>
              <button className="text-link" onClick={() => setSettings(true)}>
                Engine capabilities <ArrowUpRight size={14} />
              </button>
            </div>
          </main>
        )}
      </div>
      {create && (
        <Modal
          title="Create a behavioral system"
          subtitle="A private workspace for your model, evidence, and runtime events."
          close={() => setCreate(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const p = await api<Project>("/projects", {
                  name,
                  description,
                });
                setProjects((prev) => [p, ...prev]);
                setProjectId(p.id);
                setCreate(false);
                setName("");
                setDescription("");
              } catch (e) {
                notify((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Project name
              <input
                required
                autoComplete="off"
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name your system"
              />
            </label>
            <label>
              Description
              <textarea
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What behavior will this system model?"
              />
            </label>
            <footer className="modal-footer">
              <button
                className="button"
                type="button"
                onClick={() => setCreate(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Plus size={15} />}Create project
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {settings && (
        <AccountModal
          user={user}
          capabilities={capabilities}
          close={() => setSettings(false)}
          notify={notify}
          logout={logout}
        />
      )}
      <Toast message={message} clear={() => setMessage("")} />
    </div>
  );
}
function AccountModal({
  user,
  capabilities,
  close,
  notify,
  logout,
}: {
  user: User;
  capabilities?: Capabilities;
  close: () => void;
  notify: (s: string) => void;
  logout: (skipRequest?: boolean) => Promise<void>;
}) {
  const [password, setPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={password ? "Change your password" : "Workspace & engine"}
      subtitle={user.email}
      close={close}
    >
      {password ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            try {
              await api("/auth/password", {
                current_password: form.get("current"),
                new_password: form.get("next"),
              });
              notify("Password changed. Sign in again with your new password.");
              close();
              await logout(true);
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Current password
            <input
              name="current"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <label>
            New password
            <input
              name="next"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
          </label>
          <footer className="modal-footer">
            <button
              className="button"
              type="button"
              onClick={() => setPassword(false)}
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? <Spinner /> : "Change password"}
            </button>
          </footer>
        </form>
      ) : (
        <>
          <div className="capability-list">
            <div>
              <span>Database</span>
              <strong>Neon PostgreSQL</strong>
            </div>
            <div>
              <span>Verifier</span>
              <code>{capabilities?.engine || "Loading…"}</code>
            </div>
            <div>
              <span>Configuration budget</span>
              <code>
                {capabilities?.max_configurations.toLocaleString() || "—"}
              </code>
            </div>
            <div>
              <span>AI provider</span>
              <strong>
                {capabilities?.ai_configured
                  ? capabilities.ai_model
                  : "Not configured"}
              </strong>
            </div>
            <div>
              <span>Temporal operators</span>
              <code>{capabilities?.operators.join(" · ")}</code>
            </div>
          </div>
          <h3>
            <PrintText>Implementation boundaries</PrintText>
          </h3>
          <p className="muted">
            {capabilities?.synthesis}. Flat finite-state models with finite
            literal updates. No arbitrary code execution or third-party side
            effects.
          </p>
          <ul className="muted">
            {capabilities?.unsupported.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className="muted">
            Formal proof concerns the encoded model and declared assumptions.
            Free AI services have provider quotas and availability limits.
          </p>
          <footer className="modal-footer">
            <button className="button" onClick={() => setPassword(true)}>
              Change password
            </button>
            <button className="button primary" onClick={close}>
              Back to workspace
            </button>
          </footer>
        </>
      )}
    </Modal>
  );
}
