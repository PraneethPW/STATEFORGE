import type { Model, Runtime } from "../types";
export function PredicatePreview({
  model,
  runtime,
}: {
  model: Model;
  runtime: Runtime;
}) {
  return (
    <div className="monitor-scope">
      <span className="live-dot" />
      <p>
        Monitoring {model.properties.filter((p) => p.operator === "AG").length}{" "}
        invariant predicates, event validity, version identity, and state
        synchronization at sequence <code>{runtime.sequence}</code>. Liveness is
        checked offline.
      </p>
    </div>
  );
}
