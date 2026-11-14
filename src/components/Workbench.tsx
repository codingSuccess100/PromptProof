"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareChecks, conclusion, diffWords, sameContext } from "@/lib/compare";
import { alternativesFor, describeCheck, findContradiction, findTensions } from "@/lib/custom";
import { CUSTOM_TASK_ID } from "@/lib/types";
import type {
  AblationLabel,
  AblationResult,
  ApiError,
  CheckCategory,
  CheckResult,
  CustomCheck,
  CustomCheckKind,
  GoalFindingKind,
  GoalReview,
  ImproveStep,
  PublicTask,
  RunResult,
  SuggestResult,
  XrayResult,
} from "@/lib/types";
import Markdown from "./Markdown";

type Mode = "example" | "own";

/** One immutable result. It carries its own prompt, answer, checks, and evaluation context. */
interface RunEntry {
  id: number;
  result: RunResult;
  /** Where this run came from. A recorded replay is never mixed with live results. */
  role: "original" | "revision" | "helper" | "recorded";
  review: { status: "running" | "done" | "error"; data: GoalReview | null; error: string | null };
  /** Checks passed in fresh confirmation runs of this same prompt. */
  confirmations: number[];
  xray: XrayResult | null;
  xrayStatus: "idle" | "running" | "error";
  xrayError: string | null;
  recordedAt: string | null;
}

interface TaskData {
  tasks: PublicTask[];
  model: string;
  mock: boolean;
}

interface DraftCheck extends CustomCheck {
  key: number;
}

interface HelperAttempt {
  n: number;
  change: string;
  reason: string;
  outcome: "kept" | "rejected" | "blocked" | "tradeoff" | "choice";
  why: string;
  prompt?: string;
}

/** One thing worth the user's attention, from either layer, in a single shape. */
interface Finding {
  id: string;
  source: "review" | "rule" | "setup";
  title: string;
  what: string;
  evidence: string[];
  why: string;
  edit: string | null;
  editMode: "add" | "replace";
  alternatives?: string[];
  checkLabel?: string;
}

const KIND_OPTIONS: { kind: CustomCheckKind; label: string; input: "number" | "text" | "none"; placeholder?: string }[] = [
  { kind: "includes", label: "Contains exact text", input: "text", placeholder: "a phrase, name, or number" },
  { kind: "excludes", label: "Does not mention", input: "text", placeholder: "a phrase" },
  { kind: "maxWords", label: "Word limit", input: "number", placeholder: "60" },
  { kind: "startsWith", label: "Starts with", input: "text", placeholder: "Subject:" },
  { kind: "singleParagraph", label: "One paragraph, no bullets", input: "none" },
  { kind: "numberedItems", label: "Numbered list of exactly", input: "number", placeholder: "3" },
  { kind: "listOnly", label: "A numbered list, nothing else", input: "none" },
];

const CATEGORY: Record<CheckCategory, string> = { exact_text: "exact text", text_pattern: "text pattern", length: "length", format: "format" };

const REVIEW_TITLE: Record<GoalFindingKind, string> = {
  task_mismatch: "Possible task mismatch",
  recipient_changed: "The recipient may have changed",
  missing_fact: "An important fact may be missing",
  criteria_gap: "The checks may not cover your main goal",
  contradiction: "Possible contradiction",
  off_topic: "Possibly off topic",
  other: "Worth a look",
};

const RULE_TITLE = {
  missing_instruction: "Missing instruction",
  present_not_followed: "Instruction present but not followed",
  conflict: "Conflicting instructions",
  possible_checker_mismatch: "The check may be too literal",
  insufficient_evidence: "Not enough evidence",
} as const;

const XLABEL: Record<AblationLabel, { text: string; icon: string }> = {
  helpful: { text: "A check passed less often without it", icon: "↓" },
  possibly_harmful: { text: "A check passed more often without it", icon: "↑" },
  tradeoff: { text: "Helped one check, hurt another", icon: "⇄" },
  no_measured_effect: { text: "No change detected in the selected checks", icon: "=" },
  uncertain: { text: "Mixed across runs", icon: "?" },
  not_tested: { text: "Not tested", icon: "–" },
};

const OWN_SAMPLE = {
  prompt: "You are a world-class communicator. Write an update for the team about the launch.",
  goal: 'A short update the whole team can read in one go: under 70 words, one paragraph. It includes "March 3" and "checkout bug", and never mentions $40k.',
  material:
    "Notes from today's call:\n- Launch moves from Feb 24 to March 3 because QA found a checkout bug.\n- Marketing emails are already scheduled and need to move.\n- Budget is unchanged at $40k. Do not share the budget outside leadership.\n- Priya owns the fix. Sam owns the email reschedule.",
};

let nextKey = 1;
const withKey = (check: CustomCheck): DraftCheck => ({ ...check, key: nextKey++ });
const strip = ({ kind, text, value, alternatives }: DraftCheck | CustomCheck): CustomCheck => ({ kind, text, value, alternatives });

function isComplete(check: CustomCheck): boolean {
  const option = KIND_OPTIONS.find((o) => o.kind === check.kind);
  if (!option) return false;
  if (option.input === "text") return !!check.text && check.text.trim().length > 0;
  if (option.input === "number") return Number.isFinite(check.value) && (check.value ?? 0) >= 1;
  return true;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = (await res.json().catch(() => ({ error: "Unexpected server response." }))) as T | ApiError;
  if (!res.ok || (data as ApiError).error) throw new Error((data as ApiError).error ?? "Request failed.");
  return data as T;
}

const STORE = "promptproof:last";
const passed = (r: RunResult) => (r.total === 0 ? "Unscored" : `${r.score} of ${r.total} checks passed`);

function Checks({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="checks">
      {checks.map((check) => (
        <li key={check.id} className={check.pass ? "pass" : "fail"}>
          <span className="mark" aria-hidden="true">
            {check.pass ? "✓" : "×"}
          </span>
          <span>
            <span className="check-label">
              {check.label} <span className="chip">{CATEGORY[check.category]}</span>
            </span>
            <small>
              {check.pass ? "Passed" : "Did not pass"}. {check.detail}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Answer({ text, label = "AI answer" }: { text: string; label?: string }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="answer">
      <div className="answer-head">
        <span className="label">{label}</span>
        <button className="link" onClick={() => setRaw((r) => !r)} aria-pressed={raw}>
          {raw ? "Show formatted" : "Show raw text"}
        </button>
      </div>
      <div className="answer-body">{raw ? <pre>{text}</pre> : <Markdown text={text} />}</div>
    </div>
  );
}

function ReviewBox({ entry }: { entry: RunEntry }) {
  const { review } = entry;
  const data = review.data;
  return (
    <div className="review">
      <p className="label">
        Goal review <span className="chip model">model-assisted, can be wrong</span>
      </p>
      {review.status === "running" && (
        <p className="status" role="status">
          <span className="pulse" aria-hidden="true" />
          Reading the answer against the goal.
        </p>
      )}
      {review.status === "error" && <p className="note">The goal review did not finish: {review.error} The rule-based checks are unaffected.</p>}
      {data && (
        <p className={`review-status ${data.status}`}>
          <b>
            {data.status === "aligned"
              ? "No concerns found."
              : data.status === "concerns"
                ? `${data.findings.length} possible concern${data.findings.length === 1 ? "" : "s"}.`
                : data.status === "unclear"
                  ? "Could not tell."
                  : "Not reviewed."}
          </b>{" "}
          {data.summary}
        </p>
      )}
      {data && data.status === "concerns" && <p className="fine">Details are under &quot;What to fix&quot;. This is separate from the rule-based checks and does not change them.</p>}
    </div>
  );
}

function Xray({ entry, onRun }: { entry: RunEntry; onRun: () => void }) {
  const { result, xray } = entry;
  const parts = result.chunks.length;
  const find = (index: number) => xray?.ablations.find((a) => a.chunkIndex === index) ?? null;
  const prose = useMemo(() => {
    const pieces: { text: string; index: number | null }[] = [];
    let at = 0;
    for (const chunk of result.chunks) {
      if (chunk.start > at) pieces.push({ text: result.prompt.slice(at, chunk.start), index: null });
      pieces.push({ text: result.prompt.slice(chunk.start, chunk.end), index: chunk.index });
      at = chunk.end;
    }
    if (at < result.prompt.length) pieces.push({ text: result.prompt.slice(at), index: null });
    return pieces;
  }, [result]);
  const [picked, setPicked] = useState<number | null>(null);

  /** One line per requirement: what was observed for that check across the experiment. */
  const perCheck = useMemo(() => {
    if (!xray) return [];
    const R = xray.baselineValidRuns;
    return xray.baselineChecks.map((check) => {
      const moved = (a: AblationResult) => a.changes.find((c) => c.checkId === check.id);
      const fell = xray.ablations.filter((a) => { const c = moved(a); return c && a.validRuns > 0 && c.ablatedPasses / a.validRuns < check.passes / R; });
      const rose = xray.ablations.filter((a) => { const c = moved(a); return c && a.validRuns > 0 && c.ablatedPasses / a.validRuns > check.passes / R; });
      const count = (a: AblationResult) => `"${a.text}" (${moved(a)!.ablatedPasses} of ${a.validRuns} without it)`;
      let line: string;
      if (check.passes > 0 && check.passes < R) {
        line = `Passed in ${check.passes} of ${R} runs of the unchanged prompt, so differences for this check may be ordinary variation.`;
      } else if (fell.length > 0) {
        line = `Passed in ${check.passes} of ${R} runs with the full prompt. It passed less often when this was removed: ${fell.map(count).join("; ")}.`;
      } else if (rose.length > 0) {
        line = `Did not pass with the full prompt. It passed more often when this was removed: ${rose.map(count).join("; ")}.`;
      } else {
        line = check.passes === R ? `Passed in all ${R} runs, and removing any single instruction did not change that.` : `Did not pass in any of ${R} runs, and removing any single instruction did not change that.`;
      }
      return { id: check.id, label: check.label, line };
    });
  }, [xray]);

  return (
    <section className="panel solid xray" aria-label="X-ray">
      <div className="panel-head">
        <h3>X-ray: which instructions these results depend on</h3>
        <span className="fine">Optional</span>
      </div>

      {result.total === 0 && <p className="note">There are no rule-based checks in this experiment, so the X-ray has nothing to measure.</p>}
      {result.total > 0 && parts <= 1 && <p className="note">This prompt is a single instruction, so there is nothing to remove and compare.</p>}

      {result.total > 0 && parts > 1 && !xray && entry.xrayStatus === "idle" && (
        <div className="xray-start">
          <p>Removes one instruction at a time and reruns, to see which of the {result.total} checks change.</p>
          <button className="btn" onClick={onRun}>
            Run the X-ray
          </button>
        </div>
      )}
      {entry.xrayStatus === "running" && (
        <p className="status" role="status">
          <span className="pulse" aria-hidden="true" />
          Testing which instructions affect these results. Your answer above stays usable.
        </p>
      )}
      {entry.xrayStatus === "error" && (
        <div className="notice error" role="alert">
          The X-ray did not finish: {entry.xrayError}{" "}
          <button className="link" onClick={onRun}>
            Try again
          </button>
        </div>
      )}
      {result.total > 0 && parts > 1 && (
        <details className="howto">
          <summary>How the test works</summary>
          <p>
            Three runs of your unchanged prompt, plus three runs for each of the {parts} instructions with that
            instruction removed. Every run is scored with the same rule-based checks.
          </p>
        </details>
      )}

      {xray && (
        <>
          {xray.caution && <p className="notice caution">{xray.caution}</p>}
          {xray.failedCalls > 0 && (
            <p className="notice caution">
              {xray.failedCalls} of {xray.modelCalls} requests failed. Those runs are left out. A failed request is not a failed check.
            </p>
          )}

          <p className="label">By check</p>
          <ul className="by-check">
            {perCheck.map((c) => (
              <li key={c.id}>
                <b>{c.label}.</b> {c.line}
              </li>
            ))}
          </ul>

          <p className="label">By instruction. Select one to see what was observed.</p>
          <p className="prose">
            {prose.map((piece, i) => {
              const a = piece.index === null ? null : find(piece.index);
              if (!a) return <span key={i}>{piece.text}</span>;
              return (
                <button key={i} className={`span mark-${a.label}${picked === piece.index ? " picked" : ""}`} onClick={() => setPicked(picked === piece.index ? null : piece.index)} aria-pressed={picked === piece.index}>
                  {piece.text}
                </button>
              );
            })}
          </p>

          <ol className="readout">
            {result.chunks.map((chunk) => {
              const a = find(chunk.index);
              if (!a || (picked !== null && picked !== chunk.index)) return null;
              const R = xray.baselineValidRuns;
              const detail = a.changes.map((c) => `${c.label}: ${c.baselinePasses} of ${R} with it, ${c.ablatedPasses} of ${a.validRuns} without`).join("; ");
              const persona = result.friction.find((f) => f.chunkIndex === chunk.index && f.category === "persona" && a.label === "no_measured_effect");
              return (
                <li key={chunk.index} className={`row ${a.label}`}>
                  <span className="row-icon" aria-hidden="true">
                    {XLABEL[a.label].icon}
                  </span>
                  <div>
                    <p className="row-text">&quot;{chunk.text}&quot;</p>
                    <p className="row-effect">
                      <b>{XLABEL[a.label].text}.</b>{" "}
                      {a.label === "not_tested"
                        ? "Every run for this instruction failed, so there is no result."
                        : a.label === "no_measured_effect"
                          ? "It may still matter for things these checks do not measure, such as audience, tone, or accuracy."
                          : `${detail}.`}
                      {a.label === "possibly_harmful" || a.label === "tradeoff" ? " This is an observation, not a recommendation to delete it." : ""}
                      {a.failedRuns > 0 && a.validRuns > 0 ? ` ${a.failedRuns} request${a.failedRuns === 1 ? "" : "s"} failed and ${a.failedRuns === 1 ? "is" : "are"} left out.` : ""}
                    </p>
                    {a.bundled.length > 1 && (
                      <p className="row-note">
                        This instruction carries several requirements together ({a.bundled.join("; ")}), so the test cannot say which words did what.
                      </p>
                    )}
                    {persona && <p className="row-note">This is a role. In these runs it did not change the selected checks. That is not the same as having no effect.</p>}
                  </div>
                </li>
              );
            })}
          </ol>

          <details className="howto">
            <summary>What this can and cannot tell you</summary>
            <ul>
              <li>This is a diagnostic, not a list of edits. Removing the instruction that states your task or audience is never a recommendation.</li>
              <li>It tests whole instructions against your {result.total} selected check{result.total === 1 ? "" : "s"}. It does not attribute effects to single words.</li>
              <li>Three runs are three observations. They are not a guarantee or a confidence level.</li>
              <li>Instructions were removed one at a time. If you remove several, test the combined prompt.</li>
              <li>
                Technical details: {xray.mock ? "offline mock model" : xray.model}, {xray.modelCalls} requests for this X-ray, {xray.failedCalls} failed, {(xray.ms / 1000).toFixed(1)}s.
              </li>
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function Compare({ before, after, onRestore, onEdit }: { before: RunEntry; after: RunEntry; onRestore: () => void; onEdit: () => void }) {
  const [view, setView] = useState<"prompt" | "answer">("prompt");
  const [copied, setCopied] = useState(false);
  const a = before.result;
  const b = after.result;
  const verdict = conclusion(a, b);
  if (!verdict) return null;
  const diff = compareChecks(a.checks, b.checks);
  const tokens = diffWords(a.prompt, b.prompt);
  const status = (check: CheckResult) => (diff.improved.includes(check) ? "Improved" : diff.regressed.includes(check) ? "Regressed" : "Unchanged");
  const reviewLine = (e: RunEntry) =>
    e.review.data ? (e.review.data.status === "concerns" ? `${e.review.data.findings.length} possible concern${e.review.data.findings.length === 1 ? "" : "s"}` : e.review.data.status === "aligned" ? "no concerns found" : "could not tell") : "not available";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="panel solid compare" aria-label="Before and after comparison">
      <div className="panel-head">
        <h3>Comparison</h3>
        <span className="fine">Same goal, same checks, same model settings.</span>
      </div>
      <p className="headline">
        {verdict}
        {before.review.data?.status === "concerns" && after.review.data?.status === "aligned" ? " Separately, the goal review no longer raises the concern it raised for the original (model-assisted)." : ""}
        {before.review.data?.status === "aligned" && after.review.data?.status === "concerns" ? " Separately, the goal review raises a new concern for the revision (model-assisted). See What to fix." : ""}
      </p>
      <p className="fine evidence">
        Evidence: original, 1 run. Revision, 1 test run
        {after.confirmations.length > 0 ? `, plus ${after.confirmations.length} confirmation run${after.confirmations.length === 1 ? "" : "s"} that passed ${after.confirmations.join(" and ")} of ${b.total}` : ". Run it again to see if the result holds"}.
        {" "}Goal review (model-assisted): original, {reviewLine(before)}. Revision, {reviewLine(after)}.
      </p>

      <div className="tabs" role="tablist" aria-label="What to compare">
        <button role="tab" aria-selected={view === "prompt"} onClick={() => setView("prompt")}>
          Prompt changes
        </button>
        <button role="tab" aria-selected={view === "answer"} onClick={() => setView("answer")}>
          Answer changes
        </button>
      </div>

      <div className="compare-grid">
        <div className="side">
          <p className="label">Original, {passed(a).toLowerCase()}</p>
          {view === "prompt" ? (
            <p className="side-prompt">
              {tokens.filter((t) => t.type !== "added").map((t, i) => (
                <span key={i} className={t.type === "removed" ? "removed" : undefined}>
                  {t.text}{" "}
                </span>
              ))}
            </p>
          ) : (
            <Answer text={a.output} label="Original answer" />
          )}
        </div>
        <div className="side">
          <p className="label">Revision, {passed(b).toLowerCase()}</p>
          {view === "prompt" ? (
            <p className="side-prompt">
              {tokens.filter((t) => t.type !== "removed").map((t, i) => (
                <span key={i} className={t.type === "added" ? "added" : undefined}>
                  {t.text}{" "}
                </span>
              ))}
            </p>
          ) : (
            <Answer text={b.output} label="Revised answer" />
          )}
        </div>
      </div>
      {view === "prompt" && (
        <p className="fine">
          <span className="added">Highlighted</span> text was added. <span className="removed">Struck</span> text was removed.
        </p>
      )}

      {b.checks.length > 0 && (
        <table className="check-table">
          <thead>
            <tr>
              <th scope="col">Rule-based check</th>
              <th scope="col">Original</th>
              <th scope="col">Revision</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {b.checks.map((check) => {
              const was = a.checks.find((c) => c.id === check.id);
              const s = status(check);
              return (
                <tr key={check.id}>
                  <th scope="row">{check.label}</th>
                  <td className={was?.pass ? "pass" : "fail"}>{was?.pass ? "✓ passed" : "× missed"}</td>
                  <td className={check.pass ? "pass" : "fail"}>{check.pass ? "✓ passed" : "× missed"}</td>
                  <td className={s.toLowerCase()}>{s}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="actions">
        <button className="btn small" onClick={copy}>
          {copied ? "Copied" : "Copy revised prompt"}
        </button>
        <button className="btn small" onClick={onEdit}>
          Edit further
        </button>
        <button className="btn small" onClick={onRestore}>
          Go back to the original prompt
        </button>
      </div>
    </section>
  );
}

export default function Workbench() {
  const [data, setData] = useState<TaskData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("example");
  const [taskId, setTaskId] = useState("");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  // Own-prompt setup: the goal in the user's words, optional notes, and confirmed checks.
  const [goal, setGoal] = useState("");
  const [material, setMaterial] = useState("");
  const [checks, setChecks] = useState<DraftCheck[]>([]);
  const [proposal, setProposal] = useState<SuggestResult | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [keptExact, setKeptExact] = useState<string[]>([]);
  const [ackTension, setAckTension] = useState(false);
  // Results, grouped by evaluation context. A key change starts a new experiment.
  const [experiments, setExperiments] = useState<Record<string, RunEntry[]>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [helper, setHelper] = useState<{ active: boolean; attempts: HelperAttempt[]; summary: string | null; calls: number }>({ active: false, attempts: [], summary: null, calls: 0 });
  const entryId = useRef(1);
  const requestSeq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const cancelled = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/tasks")
      .then((res) => res.json())
      .then((loaded: TaskData) => {
        setData(loaded);
        setTaskId(loaded.tasks[0]?.id ?? "");
      })
      .catch(() => setLoadError("Could not load the examples. Refresh the page."));
  }, []);

  const task = useMemo(() => data?.tasks.find((t) => t.id === taskId), [data, taskId]);
  const promptKey = mode === "own" ? CUSTOM_TASK_ID : taskId;
  const prompt = prompts[promptKey] ?? "";
  const complete = checks.filter(isComplete);
  const contradiction = useMemo(() => (complete.length === checks.length ? findContradiction(complete.map(strip)) : null), [complete, checks]);
  const tensions = useMemo(() => (mode === "own" && !ackTension ? findTensions(goal, prompt, complete.map(strip)) : []), [mode, ackTension, goal, prompt, complete]);
  const ownReady = complete.length === checks.length && !contradiction && (goal.trim().length > 0 || complete.length > 0);

  /** Identifies the evaluation inputs in the form right now. The server issues the authoritative context id. */
  const formKey = useMemo(
    () => (mode === "own" ? `own:${JSON.stringify([goal.trim(), material.trim(), complete.map(strip)])}` : `example:${taskId}`),
    [mode, goal, material, complete, taskId],
  );
  const runs = experiments[formKey] ?? [];
  const latest = runs[runs.length - 1];
  const previous = latest
    ? [...runs].slice(0, -1).reverse().find((r) => r.role !== "recorded" && sameContext(r.result, latest.result) && r.result.prompt.trim() !== latest.result.prompt.trim())
    : undefined;
  const earlier = Object.entries(experiments).filter(([key, list]) => key !== formKey && list.length > 0);
  const dirty = !!latest && latest.result.prompt.trim() !== prompt.trim();
  const canRun = !running && !helper.active && prompt.trim().length > 0 && (mode === "example" ? !!task : ownReady);

  const setPrompt = useCallback((value: string) => setPrompts((p) => ({ ...p, [promptKey]: value })), [promptKey]);

  const payloadFor = useCallback(
    (text: string) => (mode === "own" ? { taskId: CUSTOM_TASK_ID, prompt: text, custom: { goal: goal.trim(), material, checks: complete.map(strip) } } : { taskId, prompt: text }),
    [mode, goal, material, complete, taskId],
  );

  const addEntry = useCallback((key: string, entry: RunEntry) => setExperiments((all) => ({ ...all, [key]: [...(all[key] ?? []), entry] })), []);
  const patchEntry = useCallback(
    (key: string, id: number, patch: Partial<RunEntry>) => setExperiments((all) => ({ ...all, [key]: (all[key] ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
    [],
  );

  const makeEntry = (result: RunResult, role: RunEntry["role"], review: GoalReview | null = null): RunEntry => ({
    id: entryId.current++,
    result,
    role,
    review: { status: review ? "done" : "running", data: review, error: null },
    confirmations: [],
    xray: null,
    xrayStatus: "idle",
    xrayError: null,
    recordedAt: null,
  });

  /** Goal review runs after the answer is already on screen. It never changes a check result. */
  const startReview = async (key: string, entry: RunEntry, body: ReturnType<typeof payloadFor>) => {
    try {
      const review = await postJson<GoalReview>("/api/review", { ...body, output: entry.result.output });
      patchEntry(key, entry.id, { review: { status: "done", data: review, error: null } });
    } catch (err) {
      patchEntry(key, entry.id, { review: { status: "error", data: null, error: err instanceof Error ? err.message : "unknown error" } });
    }
  };

  /** Runs a prompt. The result is always filed under the context it was sent with, never the one on screen later. */
  const run = async (text = prompt) => {
    if (!canRun && text === prompt) return;
    const sentKey = formKey;
    const body = payloadFor(text);
    const seq = ++requestSeq.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setError(null);
    setShowAll(false);
    setRunning(true);
    try {
      const result = await postJson<RunResult>("/api/run", body, controller.current.signal);
      const entry = makeEntry(result, (experiments[sentKey] ?? []).some((e) => e.role !== "recorded") ? "revision" : "original");
      addEntry(sentKey, entry);
      void startReview(sentKey, entry, body);
      try {
        localStorage.setItem(STORE, JSON.stringify({ key: sentKey, result, savedAt: new Date().toISOString() }));
      } catch {
        // Replay is a convenience. Ignore storage failures.
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError" && seq === requestSeq.current) setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      if (seq === requestSeq.current) setRunning(false);
    }
  };

  const cancel = () => {
    cancelled.current = true;
    requestSeq.current++;
    controller.current?.abort();
    setRunning(false);
  };

  const runXray = async (entry: RunEntry) => {
    const key = formKey;
    patchEntry(key, entry.id, { xrayStatus: "running", xrayError: null });
    try {
      const xray = await postJson<XrayResult>("/api/xray", { ...payloadFor(entry.result.prompt), runs: 3 });
      if (xray.contextId !== entry.result.contextId) throw new Error("the goal or checks changed while it was running");
      patchEntry(key, entry.id, { xray, xrayStatus: "idle" });
    } catch (err) {
      patchEntry(key, entry.id, { xrayStatus: "error", xrayError: err instanceof Error ? err.message : "unknown error" });
    }
  };

  const showRecorded = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { key: string; result: RunResult; savedAt: string } | null;
      if (!saved) return;
      const entry = { ...makeEntry(saved.result, "recorded"), recordedAt: saved.savedAt, review: { status: "done" as const, data: null, error: null } };
      addEntry(saved.key === formKey ? formKey : `recorded:${saved.result.contextId}`, entry);
      setError(saved.key === formKey ? null : "The saved result belongs to a different task, so it is listed under earlier experiments.");
    } catch {
      // Nothing saved.
    }
  };

  const resetHelper = () => setHelper({ active: false, attempts: [], summary: null, calls: 0 });

  const clearSession = () => {
    cancel();
    setExperiments({});
    setPrompts({});
    setGoal("");
    setMaterial("");
    setChecks([]);
    setProposal(null);
    setSuggestError(null);
    setKeptExact([]);
    setAckTension(false);
    setUndo([]);
    setEdits({});
    setError(null);
    resetHelper();
    try {
      localStorage.removeItem(STORE);
    } catch {
      // Nothing to remove.
    }
  };

  const applyEdit = (text: string, how: "add" | "replace") => {
    const clean = text.trim();
    if (!clean || prompt.includes(clean)) return;
    setUndo((stack) => [...stack, prompt]);
    // "Replace" swaps only the opening sentence, which is where the task and recipient are stated.
    // The rest of the prompt is kept, and Undo restores the original.
    const rest = prompt.trim().split(/(?<=[.!?])\s+/).slice(1).join(" ");
    setPrompt(how === "replace" ? `${clean} ${rest}`.trim() : `${prompt.trim()} ${clean}`.trim());
    editor.current?.focus();
  };

  const undoLast = () =>
    setUndo((stack) => {
      if (stack.length === 0) return stack;
      setPrompt(stack[stack.length - 1]);
      return stack.slice(0, -1);
    });

  /** Bounded helper: up to three single edits. It aims at the goal, and it asks instead of deciding when the choice is the user's. */
  const improve = async () => {
    if (!latest || helper.active) return;
    cancelled.current = false;
    const key = formKey;
    const MAX_EDITS = 3;
    const start = latest;
    let base = latest.result;
    let baseEntryId = latest.id;
    const rejected: string[] = [];
    const attempts: HelperAttempt[] = [];
    let calls = 0;
    let stopNote: string | null = null;
    const drift = (r: GoalReview | null) => !!r && r.status === "concerns" && r.findings.some((f) => f.kind === "task_mismatch" || f.kind === "recipient_changed" || f.kind === "off_topic");

    if (tensions.length > 0) {
      setHelper({ active: false, attempts: [], calls: 0, summary: `A choice is yours first. ${tensions[0]} Decide that in the setup above. Then the helper can work toward what you actually want.` });
      return;
    }
    if (drift(start.review.data)) {
      setHelper({ active: false, attempts: [], calls: 0, summary: "A choice is yours first. The goal review suggests the prompt asks for something different from the goal. Decide that under \"What to fix\" before fine-tuning the wording." });
      return;
    }
    setHelper({ active: true, attempts: [], summary: null, calls: 0 });
    try {
      for (let n = 1; n <= MAX_EDITS && !cancelled.current; n++) {
        const failed = base.checks.filter((c) => !c.pass).map((c) => c.id);
        if (failed.length === 0) break;
        const step = await postJson<ImproveStep>("/api/improve", { ...payloadFor(base.prompt), output: base.output, failedCheckIds: failed, rejected });
        calls += step.modelCalls;
        if (cancelled.current) break;
        if (step.needsChoice) {
          attempts.push({ n, change: "Stopped to ask you", reason: "", outcome: "choice", why: step.needsChoice });
          stopNote = "A tradeoff requires your choice.";
          setHelper({ active: true, attempts: [...attempts], summary: null, calls });
          break;
        }
        const change = step.candidate?.change ?? "No edit proposed";
        if (!step.run) {
          attempts.push({ n, change, reason: step.candidate?.reason ?? "", outcome: "blocked", why: step.blocked ?? "Not tested." });
          if (step.candidate) rejected.push(step.candidate.change);
          setHelper({ active: true, attempts: [...attempts], summary: null, calls });
          if (!step.candidate) break;
          continue;
        }
        if (!sameContext(step.run, base)) {
          attempts.push({ n, change, reason: "", outcome: "blocked", why: "The goal or checks changed during the run, so this result was discarded." });
          break;
        }
        const d = compareChecks(base.checks, step.run.checks);
        const drifted = drift(step.review);
        const gained = d.improved.map((c) => c.label).join("; ");
        const lost = d.regressed.map((c) => c.label).join("; ");
        if (d.improved.length > 0 && d.regressed.length === 0 && !drifted) {
          attempts.push({ n, change, reason: step.candidate?.reason ?? "", outcome: "kept", why: `Gained: ${gained}. No check regressed${step.review && !step.review.mock ? ", and the goal review raised no drift concern" : ""}.` });
          base = step.run;
          const entry = makeEntry(step.run, "helper", step.review);
          baseEntryId = entry.id;
          addEntry(key, entry);
        } else if (d.improved.length > 0) {
          attempts.push({
            n,
            change,
            reason: step.candidate?.reason ?? "",
            outcome: "tradeoff",
            why: drifted ? `Gained: ${gained}. But the goal review flagged possible drift: ${step.review!.findings[0].what} Not applied. Your choice.` : `Gained: ${gained}. Lost: ${lost}. Not applied. Your choice.`,
            prompt: step.run.prompt,
          });
          if (step.candidate) rejected.push(step.candidate.change);
        } else {
          attempts.push({ n, change, reason: step.candidate?.reason ?? "", outcome: "rejected", why: lost ? `Lost: ${lost}.` : "No check improved." });
          if (step.candidate) rejected.push(step.candidate.change);
        }
        setHelper({ active: true, attempts: [...attempts], summary: null, calls });
      }

      let summary: string;
      if (cancelled.current) {
        summary = "Stopped. No further requests were made.";
      } else if (base === start.result) {
        summary = stopNote ?? (attempts.some((a) => a.outcome === "tradeoff") ? "A tradeoff requires your choice. Nothing was applied." : "No improvement found. No tested edit passed more checks without losing one.");
      } else {
        const fresh: number[] = [];
        for (let i = 0; i < 2 && !cancelled.current; i++) {
          try {
            const again = await postJson<RunResult>("/api/run", payloadFor(base.prompt));
            calls++;
            fresh.push(again.score);
          } catch {
            // A failed confirmation request is reported as missing, not as a score.
          }
        }
        patchEntry(key, baseEntryId, { confirmations: fresh });
        const held = fresh.length > 0 && fresh.every((s) => s >= base.score);
        summary =
          `Requirements improved: ${start.result.score} to ${base.score} of ${base.total} checks in the test run. ` +
          (fresh.length === 0 ? "The confirmation runs failed, so this is one observation." : `On ${fresh.length} fresh run${fresh.length === 1 ? "" : "s"} it passed ${fresh.join(" and ")}. ${held ? "The result held in those runs." : "It did not hold every time."}`) +
          " Passing more checks does not by itself make the answer better. Compare the two answers below." +
          (stopNote ? ` ${stopNote}` : "");
        setUndo((stack) => [...stack, prompt]);
        setPrompt(base.prompt);
      }
      setHelper({ active: false, attempts, summary, calls });
    } catch (err) {
      setHelper({ active: false, attempts, summary: `Stopped early: ${err instanceof Error ? err.message : "unknown error"}`, calls });
    }
  };

  const suggest = async () => {
    setSuggestError(null);
    setSuggesting(true);
    try {
      setProposal(await postJson<SuggestResult>("/api/suggest", { goal }));
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : "The suggestion request failed.");
    } finally {
      setSuggesting(false);
    }
  };

  const accept = (list: CustomCheck[]) => {
    setChecks((current) => {
      const have = new Set(current.map((c) => describeCheck(strip(c))));
      return [...current, ...list.filter((c) => !have.has(describeCheck(c))).map(withKey)].slice(0, 8);
    });
    setProposal((p) => (p ? { ...p, checks: p.checks.filter((c) => !list.includes(c)) } : p));
  };

  const loadSample = () => {
    setPrompts((p) => ({ ...p, [CUSTOM_TASK_ID]: OWN_SAMPLE.prompt }));
    setGoal(OWN_SAMPLE.goal);
    setMaterial(OWN_SAMPLE.material);
    setChecks([]);
    setProposal(null);
    setSuggestError(null);
  };

  const updateCheck = (k: number, patch: Partial<DraftCheck>) => setChecks((list) => list.map((c) => (c.key === k ? { ...c, ...patch } : c)));

  const switchMode = (next: Mode) => {
    cancel();
    setMode(next);
    setError(null);
    setUndo([]);
    resetHelper();
  };

  if (loadError) {
    return (
      <section className="bench">
        <div className="notice error">{loadError}</div>
      </section>
    );
  }

  // ---- findings: both layers in one prioritized list, goal concerns first ----
  const findings: Finding[] = [];
  if (latest) {
    for (const [i, f] of (latest.review.data?.findings ?? []).entries()) {
      findings.push({
        id: `review-${latest.id}-${i}`,
        source: "review",
        title: REVIEW_TITLE[f.kind],
        what: f.what,
        evidence: [f.promptEvidence ? `Your prompt says: "${f.promptEvidence}"` : "", f.answerEvidence ? `The answer says: "${f.answerEvidence}"` : ""].filter(Boolean),
        why: f.why,
        edit: f.suggestedEdit,
        editMode: f.editMode,
      });
    }
    for (const [i, note] of tensions.entries()) {
      findings.push({ id: `tension-${i}`, source: "setup", title: "A check may work against your goal", what: note, evidence: [], why: "A result can pass this check and still not be what you asked for.", edit: null, editMode: "add" });
    }
    for (const d of latest.result.diagnoses) {
      // An exact-text question stays a question until the user says the wording is deliberate.
      const question = d.kind === "possible_checker_mismatch" && !keptExact.includes(d.checkLabel);
      const confirmed = d.kind === "possible_checker_mismatch" && !question;
      findings.push({
        id: `rule-${latest.id}-${d.checkId}`,
        source: "rule",
        title: confirmed ? "Exact text confirmed by you, not in the answer" : RULE_TITLE[d.kind],
        what: d.observation,
        evidence: [d.evidence],
        why: confirmed ? "You confirmed this exact wording is required. Telling the AI to include it is the direct thing to try." : d.interpretation,
        edit: question ? null : d.suggestedEdit,
        editMode: "add",
        alternatives: question ? (d.alternatives ?? []) : undefined,
        checkLabel: d.checkLabel,
      });
    }
  }
  const visible = showAll ? findings : findings.slice(0, 3);
  const reviewDone = latest && latest.review.status !== "running";
  const diagnosis = !latest
    ? ""
    : findings.length > 0
      ? findings[0].source === "review"
        ? `${latest.result.total > 0 ? `${passed(latest.result)}. Separately, the goal review raised a concern: ` : "The goal review raised a concern: "}${findings[0].what}`
        : findings[0].source === "setup"
          ? "Before reading the result: one of your checks may work against your own goal."
          : findings[0].alternatives
            ? "One check may be too literal. Decide what you meant before changing the prompt."
            : findings[0].what
      : !reviewDone
        ? "Rule-based checks are done. The goal review is still reading the answer."
        : latest.result.total === 0
          ? "This answer is unscored, and the goal review found nothing to flag. Read it and decide."
          : "Every rule-based check passed, and the goal review found nothing to flag. There is nothing to fix from what was checked.";

  const notes = (latest?.result.friction ?? []).filter((f) => f.category !== "persona");

  const editorPanel = (
    <div className="panel solid editor">
      <div className="panel-head">
        <label htmlFor="prompt" className="label big">
          Your prompt
        </label>
        {mode === "own" && (
          <button className="link" onClick={loadSample}>
            Fill in a sample
          </button>
        )}
      </div>
      <p className="fine">The instructions you would give an AI assistant.</p>
      <textarea id="prompt" ref={editor} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={mode === "example" ? "Write what you would type to get this done." : "Paste or write a rough prompt."} maxLength={2000} spellCheck={false} />
      <div className="editor-foot">
        <span className="fine">{prompt.length} of 2000 characters</span>
        <span className="actions">
          {undo.length > 0 && (
            <button className="btn small" onClick={undoLast}>
              Undo last edit
            </button>
          )}
          {running ? (
            <button className="btn" onClick={cancel}>
              Cancel
            </button>
          ) : (
            <button className="btn primary" onClick={() => run()} disabled={!canRun}>
              {latest ? (dirty ? "Test revision" : "Run again") : "Run"}
            </button>
          )}
        </span>
      </div>
      {mode === "own" && !ownReady && prompt.trim().length > 0 && <p className="note">{contradiction ?? (complete.length !== checks.length ? "One of your checks is incomplete. Fill it in or remove it." : "Next: say what you want from the answer, so there is something to evaluate against.")}</p>}
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <button className="link" onClick={showRecorded}>
            Show the last saved result from this device
          </button>
        </div>
      )}
    </div>
  );

  return (
    <section className="bench">
      <header className="bench-head">
        <div>
          <h1>Workspace</h1>
          <p>Give it a rough prompt and what you want. It shows what missed, proposes a specific change, and tests it.</p>
        </div>
        <div className="bench-meta">
          {data && <span className={`badge${data.mock ? " warn" : ""}`}>{data.mock ? "Offline mock model. For testing the app, not real AI behavior." : `Live model: ${data.model}`}</span>}
          <button className="link" onClick={clearSession}>
            Clear session
          </button>
        </div>
      </header>

      <div className="mode" role="tablist" aria-label="Choose what to work on">
        <button role="tab" aria-selected={mode === "example"} onClick={() => switchMode("example")}>
          Try an example
        </button>
        <button role="tab" aria-selected={mode === "own"} onClick={() => switchMode("own")}>
          Use my own prompt
        </button>
      </div>

      {/* ---------------- setup ---------------- */}
      <div className="setup-grid">
        {mode === "own" && editorPanel}

        {mode === "example" && data && (
          <div className="panel solid">
            <label className="field">
              <span className="label">Practice task</span>
              <select value={taskId} onChange={(e) => { cancel(); setTaskId(e.target.value); setError(null); setUndo([]); resetHelper(); }}>
                {data.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            {task && (
              <>
                <p className="label">The goal</p>
                <p className="goal">{task.goal}</p>
                <details className="brief">
                  <summary>Full brief, the {task.checkCount} checks, and the reference material</summary>
                  <p className="label">Details you can use</p>
                  <ul className="facts">
                    {task.situationCard.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="label">Rule-based checks</p>
                  <ul className="criteria">
                    {task.criteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  {task.sourceMaterial && (
                    <>
                      <p className="label">Reference material sent with your prompt</p>
                      <pre>{task.sourceMaterial}</pre>
                    </>
                  )}
                </details>
                <p className="fine">
                  The AI receives only your prompt{task.sourceMaterial ? " and the reference material" : ""}. Want a different task? Switch to &quot;Use my own prompt&quot;.
                </p>
              </>
            )}
          </div>
        )}

        {mode === "example" && editorPanel}

        {mode === "own" && (
          <div className="panel solid">
            <label htmlFor="goal" className="label big">
              What do you want from the answer?
            </label>
            <p className="fine">In your own words: who it is for, what it should be, anything it must include or avoid.</p>
            <textarea id="goal" className="goal-input" value={goal} maxLength={600} onChange={(e) => setGoal(e.target.value)} placeholder="A study plan for my calculus midterm that I can follow over five days, with practice problems." />
            <div className="actions">
              <button className="btn small" onClick={suggest} disabled={suggesting || goal.trim().length === 0}>
                {suggesting ? "Reading your goal" : proposal ? "Review again" : "Review proposed evaluation"}
              </button>
              <span className="fine">Optional. You can also just run.</span>
            </div>

            {suggestError && (
              <div className="notice error" role="alert">
                {suggestError}{" "}
                <button className="link" onClick={suggest}>
                  Retry
                </button>{" "}
                <button className="link" onClick={() => setAdvanced(true)}>
                  Add checks by hand
                </button>
              </div>
            )}

            {proposal && (
              <div className="proposal" role="status">
                <p className="label">
                  Proposed evaluation <span className="chip model">{proposal.mock ? "offline rules" : "model-assisted"}</span>
                </p>
                {proposal.checks.length > 0 && (
                  <>
                    <p className="fine">These can be checked by a rule. Nothing is used until you accept it.</p>
                    <ul className="proposed">
                      {proposal.checks.map((c, i) => (
                        <li key={i}>
                          <span>{describeCheck(c)}</span>
                          <span className="actions">
                            <button className="btn small" onClick={() => accept([c])}>
                              Accept
                            </button>
                            <button className="link" onClick={() => setProposal((p) => (p ? { ...p, checks: p.checks.filter((x) => x !== c) } : p))}>
                              Dismiss
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {proposal.checks.length > 1 && (
                      <button className="btn small" onClick={() => accept(proposal.checks)}>
                        Accept all
                      </button>
                    )}
                  </>
                )}
                {proposal.warning && <p className="notice caution">{proposal.warning}</p>}
                {proposal.qualitative.length > 0 && (
                  <p className="note">
                    Not checkable by a rule, so left to the goal review: {proposal.qualitative.join(", ")}.
                  </p>
                )}
                {proposal.clarify && (
                  <div className="clarify">
                    <p>{proposal.clarify.question}</p>
                    <div className="actions">
                      {proposal.clarify.options.map((o) => (
                        <button key={o} className="btn small" onClick={() => { setGoal((g) => `${g.trim().replace(/[.;]$/, "")}; ${o.charAt(0).toLowerCase()}${o.slice(1)}`); setProposal(null); }}>
                          {o}
                        </button>
                      ))}
                    </div>
                    <p className="fine">These are possible meanings, not facts about your situation. Picking one adds it to your goal, where you can edit it. You can also run as is: the answer will be reviewed against your goal and left unscored.</p>
                  </div>
                )}
                {proposal.checks.length === 0 && !proposal.clarify && proposal.qualitative.length === 0 && <p className="note">Nothing left to review. Your accepted checks are listed below.</p>}
              </div>
            )}

            <div className="evaluation">
              <p className="label">How this answer will be evaluated</p>
              <ul className="eval-list">
                <li>
                  <b>Rule-based checks:</b>{" "}
                  {complete.length === 0 ? "none yet. The answer will be unscored." : `${complete.length}. ${complete.map((c) => describeCheck(strip(c))).join("; ")}.`}
                </li>
                <li>
                  <b>Goal review:</b> {goal.trim() ? "the answer is read against your goal above. Model-assisted, shown separately." : "needs a goal above."}
                </li>
              </ul>
              {tensions.map((t) => (
                <p key={t} className="notice caution">
                  {t}{" "}
                  <button className="link" onClick={() => setAckTension(true)}>
                    Keep the limit, a compact answer is what I want
                  </button>
                </p>
              ))}
              {contradiction && <p className="notice error">{contradiction}</p>}
            </div>

            <details className="brief">
              <summary>Add notes or a document the AI needs{material.trim() ? " (added)" : ""}</summary>
              <p className="fine">
                Instructions go in your prompt. Source text goes here and is sent along with it. Example: the prompt says &quot;summarize these notes&quot;, and the notes go here.
              </p>
              <textarea className="material-input" aria-label="Reference material" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Paste notes, an email thread, or data." maxLength={6000} />
            </details>

            <details className="brief" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
              <summary>Advanced: edit checks by hand{checks.length > 0 ? ` (${checks.length})` : ""}</summary>
              <ul className="req-list">
                {checks.map((check) => {
                  const option = KIND_OPTIONS.find((o) => o.kind === check.kind)!;
                  const offers = check.kind === "includes" && check.text ? alternativesFor(check.text).filter((a) => !(check.alternatives ?? []).includes(a)) : [];
                  return (
                    <li key={check.key}>
                      <div className="req-row">
                        <select value={check.kind} aria-label="Check type" onChange={(e) => updateCheck(check.key, { kind: e.target.value as CustomCheckKind, text: undefined, value: undefined, alternatives: undefined })}>
                          {KIND_OPTIONS.map((o) => (
                            <option key={o.kind} value={o.kind}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {option.input === "text" && <input type="text" value={check.text ?? ""} maxLength={120} placeholder={option.placeholder} aria-label={option.label} onChange={(e) => updateCheck(check.key, { text: e.target.value, alternatives: undefined })} />}
                        {option.input === "number" && <input type="number" min={1} value={check.value ?? ""} placeholder={option.placeholder} aria-label={option.label} onChange={(e) => updateCheck(check.key, { value: e.target.value === "" ? undefined : Number(e.target.value) })} />}
                        {option.input === "none" && <span />}
                        <button className="icon" aria-label={`Remove: ${isComplete(check) ? describeCheck(strip(check)) : option.label}`} onClick={() => setChecks((list) => list.filter((c) => c.key !== check.key))}>
                          {"×"}
                        </button>
                      </div>
                      {check.kind === "includes" && check.text && (
                        <p className="fine">
                          Checks that this exact text appears. It cannot tell whether the topic is covered or explained correctly.
                          {(check.alternatives ?? []).length > 0 && ` Also accepted: ${(check.alternatives ?? []).map((a) => `"${a}"`).join(", ")}.`}
                          {offers.map((alt) => (
                            <button key={alt} className="link" onClick={() => updateCheck(check.key, { alternatives: [...(check.alternatives ?? []), alt] })}>
                              {" "}
                              Also accept &quot;{alt}&quot;
                            </button>
                          ))}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
              <button className="btn small" disabled={checks.length >= 8} onClick={() => setChecks((list) => [...list, withKey({ kind: "includes", text: "" })])}>
                Add a check
              </button>
            </details>
          </div>
        )}
      </div>
      <p className="fine privacy">
        Your prompt, goal, and notes are sent to the AI provider. This app has no database. <Link href="/method">What happens to your text</Link>
      </p>

      {/* ---------------- results ---------------- */}
      <div className="results" aria-live="polite">
        {running && (
          <p className="status panel solid" role="status">
            <span className="pulse" aria-hidden="true" />
            Running your prompt.
          </p>
        )}

        {!latest && !running && earlier.length > 0 && (
          <div className="panel solid empty">
            <h3>New experiment</h3>
            <p>
              The task, goal, notes, or checks changed, including accepting another spelling. Results from before are kept below with their own criteria and are not compared with this one, because a score that moves when the checks change is not a prompt improvement.
            </p>
          </div>
        )}

        {latest && (
          <>
            {latest.recordedAt && (
              <div className="notice recorded" role="status">
                <b>Recorded result</b> from {new Date(latest.recordedAt).toLocaleString()}. This is a replay saved on this device, not a live measurement.
              </div>
            )}
            {dirty && !running && (
              <div className="notice caution">
                You have edited the prompt since this result. What you see below is for the earlier version.{" "}
                <button className="link" onClick={() => run()} disabled={!canRun}>
                  Test revision
                </button>
              </div>
            )}

            <section className="panel solid result" aria-label="Result">
              <div className="panel-head">
                <h3>Result</h3>
                <span className="fine">
                  {latest.role === "helper" ? "Tested by Improve and test. " : ""}
                  {latest.result.mock ? "Offline mock model" : latest.result.model}, {(latest.result.ms / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="result-grid">
                <Answer text={latest.result.output} />
                <div className="judgement">
                  <p className="label">Rule-based checks</p>
                  {latest.result.total === 0 ? (
                    <p className="note unscored">None were set, so this answer is unscored. No number is shown because nothing mechanical was measured.</p>
                  ) : (
                    <>
                      <p className="met">
                        <span className="met-n">
                          {latest.result.score} <span>of {latest.result.total}</span>
                        </span>{" "}
                        passed
                      </p>
                      <Checks checks={latest.result.checks} />
                      <p className="fine">This counts fixed rules passed. It does not say whether the answer is good or serves your goal.</p>
                    </>
                  )}
                  {latest.role !== "recorded" && <ReviewBox entry={latest} />}
                </div>
              </div>
            </section>

            <section className="panel solid fixes" aria-label="What to fix">
              <div className="panel-head">
                <h3>What to fix</h3>
              </div>
              <p className="headline">{diagnosis}</p>

              {visible.length > 0 && (
                <ul className="fix-list">
                  {visible.map((f) => {
                    const value = edits[f.id] ?? f.edit ?? "";
                    const applied = !!value && prompt.includes(value.trim());
                    return (
                      <li key={f.id}>
                        <p className="fix-kind">
                          <span className={`chip src-${f.source}`}>{f.source === "review" ? "Goal review, model-assisted" : f.source === "rule" ? "Rule-based check" : "Your setup"}</span> {f.title}
                        </p>
                        <dl>
                          <dt>What happened</dt>
                          <dd>{f.what}</dd>
                          {f.evidence.length > 0 && (
                            <>
                              <dt>Evidence</dt>
                              <dd>
                                {f.evidence.map((e) => (
                                  <span key={e} className="quote">
                                    {e}
                                  </span>
                                ))}
                              </dd>
                            </>
                          )}
                          <dt>{f.source === "review" ? "Why it may matter (suggested interpretation)" : "Why it matters"}</dt>
                          <dd>{f.why}</dd>
                        </dl>
                        {f.edit !== null && (
                          <div className="fix-edit">
                            <label className="label" htmlFor={`edit-${f.id}`}>
                              Edit to try (you can change it)
                            </label>
                            <div className="suggest-row">
                              <input id={`edit-${f.id}`} type="text" value={value} maxLength={300} onChange={(e) => setEdits((all) => ({ ...all, [f.id]: e.target.value }))} />
                              <button className="btn small" onClick={() => applyEdit(value, f.editMode)} disabled={applied || !value.trim()}>
                                {applied ? "In your draft" : f.editMode === "replace" ? "Replace my opening sentence" : "Add to draft"}
                              </button>
                            </div>
                            <p className="fine">
                              {applied ? "In your draft. Not tested yet." : "Not tested. It only changes your draft, and you can undo it."}
                              {f.editMode === "replace" && !applied ? " It replaces only your first sentence and keeps the rest." : ""}
                            </p>
                          </div>
                        )}
                        {f.alternatives && f.checkLabel && (
                          <div className="fix-alt">
                            <p>Is that exact spelling what you need?</p>
                            <div className="actions">
                              <button className="btn small" onClick={() => setKeptExact((list) => [...list, f.checkLabel!])}>
                                Yes, keep it exact
                              </button>
                              {mode === "own" && (
                                <button className="btn small" onClick={() => setChecks((list) => list.filter((c) => describeCheck(strip(c)) !== f.checkLabel))}>
                                  Remove this check
                                </button>
                              )}
                              {mode === "own" &&
                                f.alternatives.map((alt) => (
                                  <button
                                    key={alt}
                                    className="btn small"
                                    onClick={() => setChecks((list) => list.map((c) => (c.kind === "includes" && describeCheck(strip(c)) === f.checkLabel ? { ...c, alternatives: [...(c.alternatives ?? []), alt] } : c)))}
                                  >
                                    Also accept &quot;{alt}&quot;
                                  </button>
                                ))}
                            </div>
                            <p className="fine">Changing or removing a check changes the evaluation, so it starts a new experiment. A score that rises for that reason is not a prompt improvement.</p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {findings.length > 3 && (
                <button className="link" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? "Show the top 3 only" : `Show all ${findings.length} findings`}
                </button>
              )}

              {findings.length > 0 && (
                <div className="next">
                  <button className="btn primary" onClick={() => run()} disabled={!dirty || !canRun}>
                    Test revision
                  </button>
                  <span className="fine">{dirty ? "Runs your edited prompt under the same goal and checks." : "Apply an edit above, or change the prompt yourself. Then test it."}</span>
                </div>
              )}

              {latest.result.checks.some((c) => !c.pass) && latest.role !== "recorded" && (
                <div className="helper">
                  <p className="label">Or let PromptProof try</p>
                  <p className="fine">
                    Tries one small edit at a time. Keeps it only if a check improves, none regresses, and the goal review raises no drift concern. Stops after 3 edits. It cannot change your goal or checks, and it asks you before forcing an exact phrase.
                  </p>
                  {helper.active ? (
                    <button className="btn small" onClick={cancel}>
                      Stop
                    </button>
                  ) : (
                    <button className="btn small" onClick={improve} disabled={running || dirty}>
                      Improve and test
                    </button>
                  )}
                  {helper.active && (
                    <p className="status" role="status">
                      <span className="pulse" aria-hidden="true" />
                      Testing edit {helper.attempts.length + 1} of up to 3.
                    </p>
                  )}
                </div>
              )}
              {(helper.attempts.length > 0 || helper.summary) && (
                <div className="helper-log">
                  <p className="label">Improve and test: what was tried</p>
                  <ol>
                    {helper.attempts.map((a) => (
                      <li key={a.n} className={a.outcome}>
                        <b>{a.outcome === "kept" ? "Kept" : a.outcome === "rejected" ? "Rejected" : a.outcome === "blocked" ? "Blocked before testing" : a.outcome === "tradeoff" ? "Tradeoff, your choice" : "Your choice"}.</b> {a.change}
                        <small>
                          {a.reason} {a.why}
                        </small>
                        {a.outcome === "tradeoff" && a.prompt && (
                          <button className="link" onClick={() => { setUndo((stack) => [...stack, prompt]); setPrompt(a.prompt!); }}>
                            Use this prompt as my draft anyway
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                  {helper.summary && <p className="headline">{helper.summary}</p>}
                  {!helper.active && helper.calls > 0 && <p className="fine">Technical detail: {helper.calls} requests used by the helper.</p>}
                </div>
              )}
              {notes.length > 0 && (
                <details className="wording">
                  <summary>Wording notes ({notes.length})</summary>
                  <p className="fine">Found by wording rules, not by measurement. Use your own judgment.</p>
                  {notes.map((f, i) => (
                    <p key={i}>
                      <b>{f.categoryLabel}:</b> &quot;{f.phrase}&quot;. {f.explanation} {f.suggestion}
                    </p>
                  ))}
                </details>
              )}
            </section>

            {previous && latest.role !== "recorded" && (
              <Compare
                before={previous}
                after={latest}
                onEdit={() => editor.current?.focus()}
                onRestore={() => { setUndo((stack) => [...stack, prompt]); setPrompt(previous.result.prompt); editor.current?.focus(); }}
              />
            )}

            {latest.role !== "recorded" && <Xray key={latest.id} entry={latest} onRun={() => runXray(latest)} />}

            {runs.length > 1 && (
              <details className="history">
                <summary>All runs in this experiment ({runs.length})</summary>
                <ol>
                  {runs.map((r) => (
                    <li key={r.id}>
                      <b>{r.role === "original" ? "Original" : r.role === "revision" ? "Your revision" : r.role === "helper" ? "Helper candidate, kept" : "Recorded replay"}:</b> {passed(r.result).toLowerCase()}
                      {r.confirmations.length > 0 ? `, confirmation runs passed ${r.confirmations.join(" and ")}` : ""}. <span className="fine">{r.result.prompt.slice(0, 90)}{r.result.prompt.length > 90 ? "..." : ""}</span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </>
        )}

        {earlier.length > 0 && (
          <details className="history">
            <summary>Earlier experiments ({earlier.length}), each with its own criteria</summary>
            <p className="fine">These used a different task, goal, notes, or checks, so they are not compared with the current one.</p>
            <ol>
              {earlier.map(([key, list]) => {
                const last = list[list.length - 1].result;
                return (
                  <li key={key}>
                    {last.context.title}, {last.context.criteria.length} check{last.context.criteria.length === 1 ? "" : "s"}: {list.map((r) => passed(r.result).toLowerCase()).join(", ")}
                    {list.some((r) => r.role === "recorded") ? " (recorded replay)" : ""}
                  </li>
                );
              })}
            </ol>
          </details>
        )}
      </div>
    </section>
  );
}
