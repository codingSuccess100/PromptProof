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
  /** For exact-text checks from a user: the literal strings being searched for. */
  literals?: string[];
}

/** What kind of evidence a check gives. Shown beside every result so nobody mistakes one for another. */
export type CheckCategory = "exact_text" | "text_pattern" | "length" | "format";

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
  /** The user goal in plain language: audience, deliverable, important facts. Used for goal review, never for scoring. */
  goal: string;
  /** For practice tasks: a neutral opening that restores the intended recipient and deliverable. Offered, never applied silently. */
  goalRestore?: string;
  /** Offline-mock only: wording that suggests the prompt asks for the intended deliverable, or for something else. */
  mockIntent?: { expects: string; conflicts: string };
}

/** What the browser shows before a run. The generation model never receives the scenario card or the criteria. */
export interface PublicTask {
  id: string;
  title: string;
  blurb: string;
  situationCard: string[];
  sourceMaterial: string;
  checkCount: number;
  /** The requirements, in plain words. Shown to the learner up front. There are no hidden gotchas. */
  criteria: string[];
  /** One-sentence statement of what the exercise asks for. */
  goal: string;
}

export interface CheckResult {
  id: string;
  label: string;
  pass: boolean;
  /** Short factual detail, for example "84 words". This is the evidence behind the result. */
  detail: string;
  category: CheckCategory;
}

export interface PromptChunk {
  index: number;
  text: string;
  /** Character offsets of this instruction in the original prompt. */
  start: number;
  end: number;
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

/** Rule-based requirement a user can attach to their own prompt. Text is matched literally, never as a regex. */
export type CustomCheckKind =
  | "maxWords" // value = word limit
  | "includes" // text must appear
  | "excludes" // text must not appear
  | "startsWith" // answer must begin with text
  | "singleParagraph" // one paragraph, no list formatting
  | "numberedItems" // value = exact number of numbered items
  | "listOnly"; // numbered list and nothing else

export interface CustomCheck {
  kind: CustomCheckKind;
  text?: string;
  value?: number;
  /** Other spellings the user has approved for an "includes" check. Never added silently. */
  alternatives?: string[];
}

/** A task the user defines for their own prompt. Sent with taskId "custom". */
export interface CustomTaskInput {
  /** Optional text the model should work on. Sent to the model with the prompt. */
  material: string;
  /** Rule-based checks the user has confirmed. May be empty when a goal is given: the answer is then unscored. */
  checks: CustomCheck[];
  /** What the user wants from the answer, in their own words. Used for goal review only. */
  goal?: string;
}

export const CUSTOM_TASK_ID = "custom";

export interface RunRequest {
  taskId: string;
  prompt: string;
  /** Required when taskId is "custom". */
  custom?: CustomTaskInput;
}

/** Everything that defines an evaluation. Two runs are comparable only when their context ids match. */
export interface ContextSnapshot {
  /** Fingerprint of the task, reference material, criteria, scorer version, and model settings. */
  id: string;
  taskId: string;
  title: string;
  material: string;
  goal: string;
  criteria: { id: string; label: string; category: CheckCategory }[];
  scorerVersion: string;
  model: string;
  settings: string;
}

export type DiagnosisKind =
  | "missing_instruction"
  | "present_not_followed"
  | "conflict"
  | "possible_checker_mismatch"
  | "insufficient_evidence";

/** Why a check may have failed, with the evidence, and one edit to try. A suggestion is never a tested fix. */
export interface Diagnosis {
  checkId: string;
  checkLabel: string;
  kind: DiagnosisKind;
  observation: string;
  evidence: string;
  interpretation: string;
  /** Text to add to the prompt, or null when a prompt edit is not the right next step. */
  suggestedEdit: string | null;
  /** For a possible checker mismatch: spellings the user may approve. */
  alternatives?: string[];
}

export interface RunResult {
  contextId: string;
  context: ContextSnapshot;
  diagnoses: Diagnosis[];
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

export type AblationLabel =
  | "helpful" // removing it lowered the pass rate of at least one check, consistently
  | "no_measured_effect" // no change detected in the selected checks
  | "possibly_harmful" // removing it raised the pass rate, consistently
  | "tradeoff" // removing it helped one check and hurt another
  | "uncertain" // mixed results across runs
  | "not_tested"; // every run for this part failed, so there is nothing to report

export interface CheckChange {
  checkId: string;
  label: string;
  /** Runs (out of `runs`) in which the check passed with the full prompt. */
  baselinePasses: number;
  /** Runs (out of `validRuns` for the part) in which it passed with the instruction removed. */
  ablatedPasses: number;
}

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
  /** Per-check pass counts, only for checks whose count changed. */
  changes: CheckChange[];
  /** Requirements this one instruction appears to carry together. With more than one, the test cannot separate them. */
  bundled: string[];
  /** Runs that returned an answer. A failed request is not a zero score. */
  validRuns: number;
  failedRuns: number;
}

export interface XrayRequest {
  taskId: string;
  prompt: string;
  custom?: CustomTaskInput;
  /** Runs per removed part, 1 to 3. Defaults to the server setting. */
  runs?: number;
}

export interface SuggestRequest {
  /** What the user wants from the answer, in ordinary language. */
  goal: string;
}

/**
 * suggestions: every part of the goal became a rule-based check.
 * partial: some parts became checks, the rest is left for goal review.
 * needs_clarification: nothing mechanical yet. A question and editable interpretations are offered.
 */
export type SuggestStatus = "suggestions" | "partial" | "needs_clarification";

export interface SuggestResult {
  status: SuggestStatus;
  /** Proposed checks. They are proposals until the user accepts them. */
  checks: CustomCheck[];
  /** Parts of the goal that a rule cannot verify. Covered by goal review, not scored. */
  qualitative: string[];
  clarify: { question: string; options: string[] } | null;
  /** A contradiction among the proposed checks, if there is one. */
  warning: string | null;
  model: string;
  mock: boolean;
}

export type GoalFindingKind =
  | "task_mismatch"
  | "recipient_changed"
  | "missing_fact"
  | "criteria_gap"
  | "contradiction"
  | "off_topic"
  | "other";

/** One model-assisted observation. It is a suggested interpretation, never a measurement. */
export interface GoalFinding {
  kind: GoalFindingKind;
  what: string;
  /** Exact quotes, kept only when they really appear in the prompt or the answer. */
  promptEvidence: string | null;
  answerEvidence: string | null;
  why: string;
  suggestedEdit: string | null;
  /** "replace" when the edit is a new opening for the prompt, "add" when it can be appended. */
  editMode: "add" | "replace";
}

export interface GoalReview {
  /** aligned: no concerns found. concerns: see findings. unclear: the reviewer could not tell. unavailable: no goal to review against. */
  status: "aligned" | "concerns" | "unclear" | "unavailable";
  summary: string;
  findings: GoalFinding[];
  model: string;
  mock: boolean;
  ms: number;
}

export interface ReviewRequest {
  taskId: string;
  prompt: string;
  output: string;
  custom?: CustomTaskInput;
}

export interface XrayResult {
  taskId: string;
  baselineScores: number[];
  baselineScore: number;
  total: number;
  runsPerChunk: number;
  ablations: AblationResult[];
  contextId: string;
  /** Baseline runs that returned an answer. */
  baselineValidRuns: number;
  failedCalls: number;
  /** Pass counts per check with the full prompt, across the baseline runs. */
  baselineChecks: { id: string; label: string; passes: number }[];
  /** Plain-language caution when the evidence is thin, for example a zero-score baseline. */
  caution: string | null;
  modelCalls: number;
  ms: number;
  model: string;
  mock: boolean;
}

export interface ApiError {
  error: string;
}

export interface ImproveRequest {
  taskId: string;
  prompt: string;
  custom?: CustomTaskInput;
  /** The answer and failed checks from the run being improved. */
  output: string;
  failedCheckIds: string[];
  /** Edits already tried and rejected in this session, so they are not proposed again. */
  rejected: string[];
}

export interface ImproveStep {
  /** The proposed revision. Null when no usable edit could be proposed. */
  candidate: { prompt: string; change: string; reason: string } | null;
  /** A fresh run of the candidate under the same criteria. Null when the candidate was blocked or the run failed. */
  run: RunResult | null;
  /** Why the candidate was blocked before testing, if it was. */
  blocked: string | null;
  /** Set when the helper will not decide alone and the user has to choose. */
  needsChoice: string | null;
  /** Goal review of the candidate's answer, when a goal exists. */
  review: GoalReview | null;
  modelCalls: number;
}
