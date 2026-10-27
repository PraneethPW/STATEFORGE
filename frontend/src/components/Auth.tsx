import PrintText from "./PrintText";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  ShieldCheck,
  Radio,
  Braces,
} from "lucide-react";
import { api, setToken } from "../api";
import type { User } from "../types";
import { Logo, Spinner } from "./UI";
const Atmosphere = lazy(() => import("./Atmosphere"));
export default function Auth({ onAuth }: { onAuth: (u: User) => void }) {
  const [register, setRegister] = useState(false),
    [showForm, setShowForm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [health, setHealth] = useState("checking");
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 130]);
  useEffect(() => {
    const c = new AbortController();
    api<{ status: string }>("/health", undefined, c.signal)
      .then(() => setHealth("connected"))
      .catch(() => {
        if (!c.signal.aborted) setHealth("unavailable");
      });
    return () => c.abort();
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ token: string; user: User }>(
        `/auth/${register ? "register" : "login"}`,
        {
          email: data.get("email"),
          password: data.get("password"),
          name: data.get("name") || "",
        },
      );
      setToken(result.token);
      onAuth(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Logo />
        <div>
          <a href="#lifecycle">
            The lifecycle <ArrowUpRight size={12} />
          </a>
          <button
            className="button small"
            onClick={() => {
              setRegister(false);
              setShowForm(true);
            }}
          >
            Open studio <ArrowUpRight size={14} />
          </button>
        </div>
      </nav>
      <main>
        <section className="hero">
          <motion.div className="hero-visual" style={{ y }}>
            <Suspense fallback={<div className="orb-fallback" />}>
              <Atmosphere />
            </Suspense>
            <div className="orb-caption">
              <span>BEHAVIORAL SPACE</span>
              <code>MODEL → PROOF → EXECUTION</code>
            </div>
            <div className="orbit-tag one">
              <span className="live-dot" />
              EXPLICIT STATES
            </div>
            <div className="orbit-tag two">
              <ShieldCheck size={13} />
              TRACEABLE EVIDENCE
            </div>
          </motion.div>
          <motion.div
            className="hero-content"
            initial={reduced ? false : { opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="hero-kicker">
              <span className="live-dot" />
              AUTOMATA-DRIVEN ENGINEERING <span>V.01</span>
            </div>
            <h1>
              <PrintText>
                Behavior,
                <br />
                by <em>design.</em>
              </PrintText>
            </h1>
            <p className="hero-description">
              From the first requirement to the last runtime event. One model to
              build, verify, and operate your software with confidence.
            </p>
            <div className="hero-cta">
              <button
                className="button primary large"
                onClick={() => {
                  setRegister(true);
                  setShowForm(true);
                }}
              >
                Enter the workspace <ArrowRight size={17} />
              </button>
              <a className="text-link" href="#lifecycle">
                Explore the lifecycle <ArrowUpRight size={14} />
              </a>
            </div>
            <div className="hero-foot">
              <Braces size={15} />
              <span>
                Explicit models. Reproducible proofs. Observable execution.
              </span>
            </div>
          </motion.div>
          <div className="hero-bottom">
            <span>01 — THE BEHAVIORAL ENGINEERING STUDIO</span>
            <span className={`service-health ${health}`}>
              <i />
              API {health}
            </span>
            <span>SCROLL TO DISCOVER ↓</span>
          </div>
        </section>
        <section className="lifecycle" id="lifecycle">
          <div className="section-title">
            <div>
              <span className="eyebrow">ONE CONTINUOUS LIFECYCLE</span>
              <h2>
                <PrintText>
                  Close the gap between
                  <br />
                  what you design and what runs.
                </PrintText>
              </h2>
            </div>
            <p>
              Your model stays the source of truth.
              <br />
              Every result points back to its exact version.
            </p>
          </div>
          <div className="lifecycle-grid">
            {[
              {
                number: "01",
                icon: GitBranch,
                title: "Shape the behavior",
                text: "Translate requirements into explicit states, events, guards, and properties. Review AI proposals before they become your model.",
              },
              {
                number: "02",
                icon: ShieldCheck,
                title: "Explore every path",
                text: "Analyze reachable configurations. Inspect safety and progress properties, with counterexamples that explain a failure.",
              },
              {
                number: "03",
                icon: Radio,
                title: "Keep execution in view",
                text: "Generate a traceable Python engine. Stream real events, detect drift, and approve verified fallback strategies.",
              },
            ].map(({ number, icon: Icon, title, text }) => (
              <motion.article
                key={number}
                initial={reduced ? false : { y: 30, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <div>
                  <Icon size={25} strokeWidth={1.25} />
                  <code>{number}</code>
                </div>
                <h3>
                  <PrintText>{title}</PrintText>
                </h3>
                <p>{text}</p>
              </motion.article>
            ))}
          </div>
          <div className="landing-scope">
            <span className="eyebrow">ENGINE BOUNDARY</span>
            <p>
              Finite-state models · finite guard variables · CTL & SPIN LTL ·
              turn-based synthesis.
              <br />
              Formal results cover the encoded model and its assumptions.
              External side effects need their own integration checks.
            </p>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <Logo />
        <span>ENGINEER BEHAVIOR. PRESERVE THE EVIDENCE.</span>
        <button
          onClick={() => {
            setRegister(true);
            setShowForm(true);
          }}
        >
          Start building <ArrowUpRight size={15} />
        </button>
      </footer>
      {showForm && (
        <div className="modal-backdrop">
          <motion.div
            className="auth-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <button
              className="auth-close icon-btn"
              aria-label="Close sign-in"
              onClick={() => setShowForm(false)}
            >
              ×
            </button>
            <Logo />
            <span className="eyebrow">YOUR ENGINEERING WORKSPACE</span>
            <h2>
              <PrintText>
                {register ? "Create your account." : "Welcome back."}
              </PrintText>
            </h2>
            <p>
              {register
                ? "Start with an empty workspace. Build your own behavior."
                : "Continue from your latest model and evidence."}
            </p>
            <form onSubmit={submit}>
              {register && (
                <label>
                  Your name
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={100}
                    placeholder="Name"
                  />
                </label>
              )}
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="you@company.com"
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete={register ? "new-password" : "current-password"}
                  required
                  placeholder="At least 12 characters"
                />
              </label>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <button className="button primary full" disabled={busy}>
                {busy ? <Spinner /> : <ArrowRight size={16} />}
                {register ? "Create account" : "Sign in"}
              </button>
            </form>
            <div className="auth-switch">
              {register ? "Already have an account?" : "New to StateForge?"}{" "}
              <button
                onClick={() => {
                  setRegister(!register);
                  setError("");
                }}
              >
                {register ? "Sign in" : "Create account"}
              </button>
            </div>
            <small>
              Sessions expire after 12 hours. Your models stay in your private
              workspace.
            </small>
          </motion.div>
        </div>
      )}
    </div>
  );
}
