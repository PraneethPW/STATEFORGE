import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X, LoaderCircle, ArrowUpRight, Hexagon } from "lucide-react";
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className="brand">
      <div className="brand-symbol">
        <Hexagon size={small ? 21 : 25} strokeWidth={1.5} />
        <span />
      </div>
      {!small && (
        <>
          <strong>stateforge</strong>
          <span className="brand-tag">STUDIO</span>
        </>
      )}
    </div>
  );
}
export function Spinner() {
  return <LoaderCircle size={16} className="spin" aria-label="Loading" />;
}
export function Status({ value }: { value: string }) {
  const good = [
    "passed",
    "active",
    "connected",
    "accepted",
    "candidate",
    "approved",
    "adapted",
  ].includes(value);
  const bad = [
    "failed",
    "error",
    "violation",
    "unrealizable",
    "rejected",
    "timeout",
  ].includes(value);
  return (
    <span className={`status ${good ? "good" : bad ? "bad" : ""}`}>
      <i />
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, [tabindex="0"]',
        ) || [],
      ).filter((x) => !x.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const elements = focusable();
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`modal ${wide ? "wide" : ""}`}
        initial={reduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <header>
          <div>
            <span className="eyebrow">STATEFORGE / WORKSPACE</span>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </motion.div>
    </div>
  );
}
export function Toast({
  message,
  clear,
}: {
  message: string;
  clear: () => void;
}) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="toast"
          role="alert"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <span>{message}</span>
          <button aria-label="Dismiss notification" onClick={clear}>
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export function SectionTitle({
  index,
  title,
  description,
  action,
}: {
  index: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <span className="eyebrow">{index}</span>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function LinkMark() {
  return <ArrowUpRight size={16} />;
}
export const time = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const short = (value: string) =>
  `${value.slice(0, 8)}…${value.slice(-4)}`;
