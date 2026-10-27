export type Atom = boolean | number | string;
export interface State {
  id: string;
  label: string;
  terminal: boolean;
  owner: "controller" | "environment";
  x: number;
  y: number;
  requirement: string;
}
export interface Transition {
  id: string;
  source: string;
  target: string;
  event: string;
  guard: string;
  updates: Record<string, Atom>;
  requirement: string;
}
export interface Variable {
  name: string;
  domain: Atom[];
  initial: Atom;
}
export interface Property {
  id: string;
  name: string;
  operator: "AG" | "AF" | "EF" | "EG" | "AX" | "EX" | "LTL";
  predicate: string;
  requirement: string;
}
export interface Model {
  name: string;
  initial: string;
  states: State[];
  transitions: Transition[];
  variables: Variable[];
  properties: Property[];
  assumptions: string[];
}
export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  version_count?: number;
  runtime_count?: number;
}
export interface Version {
  id: string;
  project_id: string;
  number: number;
  model: Model;
  model_hash: string;
  requirements: string;
  note: string;
  approved_at: string | null;
  created_at: string;
}
export interface TraceStep {
  state: string;
  configuration?: number;
  transition?: string | null;
  [key: string]: unknown;
}
export interface PropertyResult {
  property_id: string;
  name: string;
  formula: string;
  status: string;
  trace: TraceStep[];
  loop_index: number | null;
  satisfying_configurations: number | null;
  backend?: string;
  tool_version?: string;
  message?: string;
}
export interface Evidence {
  status: string;
  engine: string;
  model_hash: string;
  duration_ms: number;
  configurations: number;
  edges: number;
  diagnostics: {
    severity: string;
    code: string;
    message: string;
    state?: string;
    transitions?: string[];
  }[];
  properties: PropertyResult[];
  message?: string;
  semantics: string;
}
export interface Run {
  id: string;
  version_id: string;
  status: string;
  result: Evidence | null;
  created_at: string;
  finished_at: string | null;
}
export interface Proposal {
  id: string;
  kind: "parse" | "repair" | "synthesis";
  base_version_id: string | null;
  data: {
    model?: Model;
    candidate?: Model;
    ambiguities?: string[];
    notes?: string[];
    provider_model?: string;
    status?: string;
    reason?: string;
    verification?: Evidence;
    winning_configurations?: number;
    safe?: string;
    goal?: string;
  };
  created_at: string;
}
export interface Artifact {
  id: string;
  version_id: string;
  model_hash: string;
  content_hash: string;
  manifest: {
    generator: string;
    engine: string;
    conformance_cases: number;
    reachable_configurations: number;
    [key: string]: unknown;
  };
  created_at: string;
}
export interface Runtime {
  id: string;
  version_id: string;
  artifact_id: string;
  name: string;
  model_hash: string;
  state: string;
  values: Record<string, Atom>;
  sequence: number;
  status: string;
  strategy_id: string | null;
  ingest_key?: string;
}
export interface Trace {
  id: number;
  event_id: string;
  sequence: number;
  event: string;
  data: {
    from?: string;
    state: string;
    values?: Record<string, Atom>;
    violations: string[];
    status: string;
    latency_ms?: number;
    model_hash: string;
    strategy_id?: string;
  };
  created_at: string;
}
export interface Activity {
  id: number;
  kind: string;
  data: Record<string, unknown>;
  created_at: string;
}
export interface Snapshot {
  project: Project;
  versions: Version[];
  runs: Run[];
  proposals: Proposal[];
  artifacts: Artifact[];
  runtimes: Runtime[];
}
export interface Capabilities {
  database: string;
  ai_configured: boolean;
  ai_model: string;
  engine: string;
  operators: string[];
  max_configurations: number;
  synthesis: string;
  unsupported: string[];
}
