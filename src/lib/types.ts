// Shared contracts between the engine (server) and the experience (client).
// Keep these stable so the team can work in parallel.

export type CheckKind =
  | "maxWords"
  | "matches" // output must match the pattern
  | "notMatches" // output must not match the pattern
  | "firstSentenceMatches"
  | "mentionsFirst" // pattern is named in the first sentence, before any `rival`, and not negated
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
  /** For mentionsFirst: the competing subject that must not come earlier. */
  rival?: string;
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
  /** Output budget for the generation model, in tokens. Part of the evaluation context. */
  outputTokens?: number;
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
  /** What the user wants from the answer, in their own words. Used for goal review and for proposing revisions. Never sent to the generation model. */
  goal?: string;
  /** Answers to clarifying questions. A null value means the user skipped it. */
  brief?: BriefAnswer[];
  /** Topics the answer should cover. Reviewed by the goal review, never scored by a rule. */
  coverage?: string[];
}

export type QuestionType = "date" | "text" | "number" | "choice";

/** One clarifying question. The id is stable, so an answered or skipped question is never asked again. */
export interface ClarifyQuestion {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[];
  /** Why the answer would change the result. */
  why: string;
}

export interface BriefAnswer {
  id: string;
  question: string;
  type: QuestionType;
  /** The answer, stored in its own type (a date as YYYY-MM-DD). Null means skipped. */
  value: string | null;
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
  /** True when the goal says something the prompt and reference material never told the model. */
  observation: string;
  evidence: string;
  interpretation: string;
  /** Text to add to the prompt, or null when a prompt edit is not the right next step. */
  suggestedEdit: string | null;
  /** For a possible checker mismatch: spellings the user may approve. */
  alternatives?: string[];
}

export interface RunResult {
  /** False when the provider stopped the answer at the output limit. Checks on a cut-off answer are not reliable. */
  complete: boolean;
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
  /** True for the instruction that states the task. Removing it tests "no task", which is not an edit to consider. */
  core: boolean;
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
  /** The prompt being tested, so nothing it already says is asked again. */
  prompt?: string;
  material?: string;
  /** Questions already answered or skipped. */
  answers?: BriefAnswer[];
}

/**
 * suggestions: every stated requirement became a rule-based check.
 * partial: some became checks, the rest is left for goal review.
 * needs_clarification: a detail is missing that would change the result. Questions are offered and can be skipped.
 * ready: nothing to propose and nothing to ask. The answer will be reviewed against the goal.
 */
export type SuggestStatus = "suggestions" | "partial" | "needs_clarification" | "ready";

export interface SuggestResult {
  status: SuggestStatus;
  checks: CustomCheck[];
  /** Parts of the goal that a rule cannot verify. Covered by goal review, not scored. */
  qualitative: string[];
  /** What is already known from the prompt, goal, and earlier answers. */
  known: string[];
  /** At most two questions, never one that was already answered or skipped. */
  questions: ClarifyQuestion[];
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
  /** True when the reviewer saw only part of the answer (it was cut off, or too long). It then cannot say something is absent. */
  partial: boolean;
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
  /** Every individual run, so each can be inspected. chunkIndex null is the unchanged prompt. */
  trials: { chunkIndex: number | null; ok: boolean; passed: string[] }[];
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
  /** Goal-review concerns about the current answer, in plain words. */
  concerns?: string[];
}

/** One complete candidate prompt. A proposal until it has been tested. */
export interface Proposal {
  prompt: string;
  /** What changed and why, in plain words. */
  changes: string[];
  /** Details from the original prompt that the rewrite dropped and were put back. */
  restored: string[];
  /** Specifics the rewrite added without support, replaced by a visible placeholder. */
  placeholders: string[];
  /** Confirmed details from the goal that the original prompt never told the model. */
  gap: string[];
  source: "model" | "rules";
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
