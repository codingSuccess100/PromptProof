// Shared contracts between the engine (server) and the experience (client).
// Keep these stable so the team can work in parallel.

export type CheckKind =
  | "maxWords"
  | "matches" // output must match the pattern
  | "notMatches" // output must not match the pattern
  | "firstSentenceMatches"
  | "startsWith"
  | "noListFormatting"
  | "numberedItemsExactly"
  | "onlyNumberedLines"
  | "minMatches";

export interface CheckSpec {
  id: string;
  /** Shown to the user after a run, for example "Under 60 words". */
  label: string;
  kind: CheckKind;
  /** Regex source (case-insensitive unless flags given) or number, depending on kind. */
  pattern?: string;
  flags?: string;
  value?: number;
  /** Text offered as a ghost suggestion when this check fails. Comes from the task, not from a model. */
  ghostClause: string;
  /** Regex source that detects whether a prompt already communicates this requirement. */
  promptCue: string;
}

export interface Task {
  id: string;
  title: string;
  /** One line shown on the task picker. */
  blurb: string;
  /** Facts only the user sees. The model never receives this. */
  situationCard: string[];
  /** Material the model receives with every prompt. Empty string if none. */
  sourceMaterial: string;
  checks: CheckSpec[];
}

/** What the browser is allowed to see before a run: no hidden checklist. */
export interface PublicTask {
  id: string;
  title: string;
  blurb: string;
  situationCard: string[];
  sourceMaterial: string;
  checkCount: number;
}

export interface CheckResult {
  id: string;
  label: string;
  pass: boolean;
  /** Short factual detail, for example "84 words". */
  detail: string;
}

export interface PromptChunk {
  index: number;
  text: string;
}

export type FrictionCategory =
  | "persona"
  | "leading_assumption"
  | "vague_reference"
  | "conflicting_instructions"
  | "emotionally_loaded";

export interface FrictionFinding {
  category: FrictionCategory;
  categoryLabel: string;
  /** The exact phrase from the user's prompt. */
  phrase: string;
  explanation: string;
  suggestion: string;
  /** Index of the chunk that contains the phrase, so the UI can pair it with a measured effect. */
  chunkIndex: number | null;
}

export interface GhostSuggestion {
  checkId: string;
  clause: string;
  /** True when the prompt already seems to ask for this, yet the output still failed the check. */
  alreadyInPrompt: boolean;
}

export interface RunRequest {
  taskId: string;
  prompt: string;
}

export interface RunResult {
  taskId: string;
  prompt: string;
  output: string;
  checks: CheckResult[];
  score: number;
  total: number;
  chunks: PromptChunk[];
  friction: FrictionFinding[];
  ghosts: GhostSuggestion[];
  model: string;
  /** True when the offline mock model produced the output. The UI must say so. */
  mock: boolean;
  ms: number;
}

export type AblationLabel = "helpful" | "no_measured_effect" | "possibly_harmful" | "uncertain";

export interface AblationResult {
  chunkIndex: number;
  text: string;
  /** Checklist scores for each run with this chunk removed. */
  scores: number[];
  /** Baseline score minus average ablated score. Positive means the chunk helped. */
  delta: number;
  label: AblationLabel;
  /** Check ids whose result changed when the chunk was removed (first run). */
  flippedChecks: string[];
}

export interface XrayRequest {
  taskId: string;
  prompt: string;
}

export interface XrayResult {
  taskId: string;
  baselineScores: number[];
  baselineScore: number;
  total: number;
  runsPerChunk: number;
  ablations: AblationResult[];
  modelCalls: number;
  ms: number;
  model: string;
  mock: boolean;
}

export interface ApiError {
  error: string;
}
