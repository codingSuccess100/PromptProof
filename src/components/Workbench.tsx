"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareChecks, conclusion, diffWords, sameContext } from "@/lib/compare";
import { alternativesFor, describeCheck, findContradiction } from "@/lib/custom";
import { CUSTOM_TASK_ID } from "@/lib/types";
import type {
  AblationLabel,
  AblationResult,
  ApiError,
  CheckCategory,
  CheckResult,
  CustomCheck,
  CustomCheckKind,
  Diagnosis,
  DiagnosisKind,
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
  xray: XrayResult | null;
  xrayStatus: "idle" | "running" | "error";
  xrayError: string | null;
  /** Set when this is a replay of a saved result, shown because the live model failed. */
  recordedAt: string | null;
  source: "you" | "helper";
}

interface TaskData {
  tasks: PublicTask[];
  model: string;
  mock: boolean;
}

interface DraftCheck extends CustomCheck {
  key: number;
  suggested?: boolean;
}

interface HelperAttempt {
  n: number;
  change: string;
  reason: string;
  outcome: "kept" | "rejected" | "blocked";
  why: string;
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

const CATEGORY: Record<CheckCategory, string> = {
  exact_text: "exact text",
  text_pattern: "text pattern",
  length: "length",
  format: "format",
};

const KIND_TITLE: Record<DiagnosisKind, string> = {
  missing_instruction: "Missing instruction",
  present_not_followed: "Instruction present but not followed",
  conflict: "Conflicting instructions",
  possible_checker_mismatch: "Possible checker mismatch",
  insufficient_evidence: "Not enough evidence",
};

const XLABEL: Record<AblationLabel, { text: string; icon: string }> = {
  helpful: { text: "Pass rate fell without it", icon: "↓" },
  possibly_harmful: { text: "Pass rate rose without it", icon: "↑" },
  tradeoff: { text: "Tradeoff between requirements", icon: "⇄" },
  no_measured_effect: { text: "No change detected in the selected checks", icon: "=" },
  uncertain: { text: "Mixed results", icon: "?" },
  not_tested: { text: "Not tested", icon: "–" },
};

const OWN_EXAMPLE = {
  prompt: "You are a world-class communicator. Write an update for the team about the launch.",
  material:
    "Notes from today's call:\n- Launch moves from Feb 24 to March 3 because QA found a checkout bug.\n- Marketing emails are already scheduled and need to move.\n- Budget is unchanged at $40k. Do not share the budget outside leadership.\n- Priya owns the fix. Sam owns the email reschedule.",
  checks: [
    { kind: "maxWords", value: 70 },
    { kind: "includes", text: "March 3" },
    { kind: "includes", text: "checkout bug" },
    { kind: "excludes", text: "$40k" },
    { kind: "singleParagraph" },
  ] as CustomCheck[],
};

let nextKey = 1;
const withKey = (check: CustomCheck, suggested = false): DraftCheck => ({ ...check, key: nextKey++, suggested });

function isComplete(check: DraftCheck): boolean {
  const option = KIND_OPTIONS.find((o) => o.kind === check.kind);
  if (!option) return false;
  if (option.input === "text") return !!check.text && check.text.trim().length > 0;
  if (option.input === "number") return Number.isFinite(check.value) && (check.value ?? 0) >= 1;
  return true;
}

const strip = ({ kind, text, value, alternatives }: DraftCheck): CustomCheck => ({ kind, text, value, alternatives });

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json().catch(() => ({ error: "Unexpected server response." }))) as T | ApiError;
  if (!res.ok || (data as ApiError).error) throw new Error((data as ApiError).error ?? "Request failed.");
  return data as T;
}

const STORE = "promptproof:last";

function xrayLine(a: AblationResult, baselineRuns: number): string {
  const counts = (list: typeof a.changes) =>
    list.map((c) => `${c.label} (${c.baselinePasses} of ${baselineRuns} runs with it, ${c.ablatedPasses} of ${a.validRuns} without)`).join("; ");
  const down = a.changes.filter((c) => c.ablatedPasses / a.validRuns < c.baselinePasses / baselineRuns);
  const up = a.changes.filter((c) => c.ablatedPasses / a.validRuns > c.baselinePasses / baselineRuns);
  switch (a.label) {
    case "helpful":
      return `Removing this instruction reduced the pass rate in these runs for: ${counts(down)}.`;
    case "possibly_harmful":
      return `Removing this instruction raised the pass rate in these runs for: ${counts(up)}. That is a tradeoff to weigh, not a reason to delete it. It may matter for things these checks do not measure.`;
    case "tradeoff":
      return `Removing it helped ${counts(up)} and hurt ${counts(down)}. Decide which requirement matters more before changing it.`;
    case "uncertain":
      return `Mixed results. More evidence is needed. ${counts(a.changes)}.`;
    case "not_tested":
      return "Every run for this instruction failed, so there is no result. This is not a score of zero.";
    default:
      return "None of the selected checks moved. It may still matter for things they do not measure.";
  }
}

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
              {check.pass ? "Met" : "Not met"}. Evidence: {check.detail}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Answer({ text }: { text: string }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="answer">
      <div className="answer-head">
        <span className="label">AI answer</span>
        <button className="link" onClick={() => setRaw((r) => !r)} aria-pressed={raw}>
          {raw ? "Show formatted" : "Show raw text"}
        </button>
      </div>
      <div className="answer-body" tabIndex={0}>
        {raw ? <pre>{text}</pre> : <Markdown text={text} />}
      </div>
      <p className="fine">Checks always run on the raw text. Formatting only changes how it is displayed.</p>
    </div>
  );
}

function Xray({ entry, onRun }: { entry: RunEntry; onRun: () => void }) {
  const { result, xray } = entry;
  const parts = result.chunks.length;
  const find = (index: number) => xray?.ablations.find((a) => a.chunkIndex === index) ?? null;
  const changed = xray ? xray.ablations.filter((a) => a.label !== "no_measured_effect" && a.label !== "not_tested").length : 0;
  // Readable prose: the original prompt, with each instruction marked in place.
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

  return (
    <section className="panel solid xray" aria-label="X-ray">
      <div className="panel-head">
        <h3>X-ray: which instructions changed a check</h3>
        <span className="fine">Optional. Removes one instruction at a time and reruns.</span>
      </div>

      {parts <= 1 && <p className="note">This prompt is a single instruction, so there is nothing to remove and compare.</p>}

      {parts > 1 && !xray && entry.xrayStatus === "idle" && (
        <div className="xray-start">
          <p>
            Tests {parts} instructions, 3 runs each, plus 3 runs of the unchanged prompt: {3 * (parts + 1)} model calls.
          </p>
          <button className="btn" onClick={onRun}>
            Run the X-ray
          </button>
        </div>
      )}
      {entry.xrayStatus === "running" && (
        <p className="status" role="status">
          <span className="pulse" aria-hidden="true" />
          Running {3 * (parts + 1)} model calls. Your result above stays usable while this finishes.
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

      {xray && (
        <>
          <p className="headline">
            {changed === 0
              ? "No instruction changed a check when removed."
              : `${changed} of ${xray.ablations.length} instructions changed at least one check when removed.`}
          </p>
          {xray.caution && <p className="notice caution">{xray.caution}</p>}
          {xray.failedCalls > 0 && (
            <p className="notice caution">
              {xray.failedCalls} of {xray.modelCalls} model calls failed. Those runs are left out, not counted as zero.
            </p>
          )}

          <p className="prose" aria-hidden="true">
            {prose.map((piece, i) => {
              const a = piece.index === null ? null : find(piece.index);
              return (
                <span key={i} className={a ? `mark-${a.label}` : undefined}>
                  {piece.text}
                </span>
              );
            })}
          </p>

          <ol className="readout">
            {result.chunks.map((chunk) => {
              const a = find(chunk.index);
              if (!a) return null;
              const persona = result.friction.find(
                (f) => f.chunkIndex === chunk.index && f.category === "persona" && (a.label === "no_measured_effect" || a.label === "possibly_harmful"),
              );
              return (
                <li key={chunk.index} className={`row ${a.label}`}>
                  <span className="row-icon" aria-hidden="true">
                    {XLABEL[a.label].icon}
                  </span>
                  <div>
                    <p className="row-text">&quot;{chunk.text}&quot;</p>
                    <p className="row-effect">
                      <b>{XLABEL[a.label].text}.</b> {xrayLine(a, xray.baselineValidRuns)}
                      {a.failedRuns > 0 && a.validRuns > 0 ? ` ${a.failedRuns} run${a.failedRuns === 1 ? "" : "s"} failed and ${a.failedRuns === 1 ? "is" : "are"} left out.` : ""}
                    </p>
                    {persona && (
                      <p className="row-note">
                        Wording note: this is a role or persona. {persona.explanation} {persona.suggestion}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <details className="howto">
            <summary>How to read this, and what it cannot tell you</summary>
            <ul>
              <li>
                This is phrase-level testing against your {result.total} selected check{result.total === 1 ? "" : "s"}. It
                does not attribute effects to individual words.
              </li>
              <li>
                &quot;No change detected&quot; means none of those checks moved. The instruction may still matter for
                things they do not measure, such as audience, tone, or accuracy.
              </li>
              <li>
                Instructions were removed one at a time. Do not delete every unchanged instruction at once. Remove one,
                then test the combined rewrite.
              </li>
              <li>
                {xray.runsPerChunk} runs per instruction are {xray.runsPerChunk} observations, not a guarantee.
              </li>
              <li>
                Measured on {xray.mock ? "the offline mock model" : xray.model}: {xray.modelCalls} model calls in{" "}
                {(xray.ms / 1000).toFixed(1)}s. Another model may respond differently.
              </li>
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function Compare({ before, after, onRestore, onEdit }: { before: RunEntry; after: RunEntry; onRestore: () => void; onEdit: () => void }) {
  const [copied, setCopied] = useState(false);
  const a = before.result;
  const b = after.result;
  const verdict = conclusion(a, b);
  if (!verdict) return null;
  const diff = compareChecks(a.checks, b.checks);
  const tokens = diffWords(a.prompt, b.prompt);
  const status = (check: CheckResult) =>
    diff.improved.includes(check) ? "Improved" : diff.regressed.includes(check) ? "Regressed" : "Unchanged";
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
        <span className="fine">Same task, same requirements, same model settings.</span>
      </div>
      <p className="headline">{verdict}</p>

      <div className="compare-grid">
        <div className="side">
          <p className="label">Original prompt</p>
          <p className="side-score">
            {a.score} <span>of {a.total} requirements met</span>
          </p>
          <p className="side-prompt">
            {tokens
              .filter((t) => t.type !== "added")
              .map((t, i) => (
                <span key={i} className={t.type === "removed" ? "removed" : undefined}>
                  {t.text}{" "}
                </span>
              ))}
          </p>
          <Answer text={a.output} />
        </div>
        <div className="side">
          <p className="label">Revised prompt</p>
          <p className="side-score">
            {b.score} <span>of {b.total} requirements met</span>
          </p>
          <p className="side-prompt">
            {tokens
              .filter((t) => t.type !== "removed")
              .map((t, i) => (
                <span key={i} className={t.type === "added" ? "added" : undefined}>
                  {t.text}{" "}
                </span>
              ))}
          </p>
          <Answer text={b.output} />
        </div>
      </div>
      <p className="fine">
        <span className="added">Highlighted</span> text was added in the revision. <span className="removed">Struck</span> text
        was removed.
      </p>

      <table className="check-table">
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            <th scope="col">Original</th>
            <th scope="col">Revised</th>
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
                <td className={was?.pass ? "pass" : "fail"}>{was?.pass ? "✓ met" : "× missed"}</td>
                <td className={check.pass ? "pass" : "fail"}>{check.pass ? "✓ met" : "× missed"}</td>
                <td className={s.toLowerCase()}>{s}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
  const [material, setMaterial] = useState("");
  const [checks, setChecks] = useState<DraftCheck[]>([]);
  const [goal, setGoal] = useState("");
  const [showRules, setShowRules] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  // Results, grouped by evaluation context. A key change starts a new experiment.
  const [experiments, setExperiments] = useState<Record<string, RunEntry[]>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [helper, setHelper] = useState<{ active: boolean; attempts: HelperAttempt[]; summary: string | null; calls: number }>({
    active: false,
    attempts: [],
    summary: null,
    calls: 0,
  });
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
  const ready = checks.filter(isComplete);
  const contradiction = useMemo(() => (ready.length === checks.length ? findContradiction(ready.map(strip)) : null), [ready, checks]);
  const ownReady = ready.length > 0 && ready.length === checks.length && !contradiction;

  /** Identifies the evaluation inputs in the form right now. The server issues the authoritative context id. */
  const formKey = useMemo(
    () => (mode === "own" ? `own:${JSON.stringify([material.trim(), ready.map(strip)])}` : `example:${taskId}`),
    [mode, material, ready, taskId],
  );
  const runs = experiments[formKey] ?? [];
  const latest = runs[runs.length - 1];
  // Compare with the most recent earlier live run in the same context that used a different prompt.
  const previous = latest
    ? [...runs]
        .slice(0, -1)
        .reverse()
        .find((r) => !r.recordedAt && sameContext(r.result, latest.result) && r.result.prompt.trim() !== latest.result.prompt.trim())
    : undefined;
  const earlier = Object.entries(experiments).filter(([key, list]) => key !== formKey && list.length > 0);
  const dirty = !!latest && latest.result.prompt.trim() !== prompt.trim();
  const canRun = !running && !helper.active && prompt.trim().length > 0 && (mode === "example" ? !!task : ownReady);

  const setPrompt = useCallback((value: string) => setPrompts((p) => ({ ...p, [promptKey]: value })), [promptKey]);

  const payloadFor = useCallback(
    (text: string) =>
      mode === "own"
        ? { taskId: CUSTOM_TASK_ID, prompt: text, custom: { material, checks: ready.map(strip) } }
        : { taskId, prompt: text },
    [mode, material, ready, taskId],
  );

  const addEntry = useCallback((key: string, entry: RunEntry) => {
    setExperiments((all) => ({ ...all, [key]: [...(all[key] ?? []), entry] }));
  }, []);

  const patchEntry = useCallback((key: string, id: number, patch: Partial<RunEntry>) => {
    setExperiments((all) => ({ ...all, [key]: (all[key] ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  }, []);

  /** Runs a prompt. The result is always filed under the context it was sent with, never the one on screen later. */
  const run = async (text = prompt) => {
    if (!canRun && text === prompt) return;
    const sentKey = formKey;
    const body = payloadFor(text);
    const seq = ++requestSeq.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setError(null);
    setRunning(true);
    try {
      const result = await postJson<RunResult>("/api/run", body, controller.current.signal);
      const entry: RunEntry = { id: entryId.current++, result, xray: null, xrayStatus: "idle", xrayError: null, recordedAt: null, source: "you" };
      addEntry(sentKey, entry);
      try {
        localStorage.setItem(STORE, JSON.stringify({ key: sentKey, result, savedAt: new Date().toISOString() }));
      } catch {
        // Replay is a convenience. Ignore storage failures.
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError" && seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      }
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
      // Attach only if it was measured in the same context as the run it belongs to.
      if (xray.contextId !== entry.result.contextId) throw new Error("the requirements changed while it was running");
      patchEntry(key, entry.id, { xray, xrayStatus: "idle" });
    } catch (err) {
      patchEntry(key, entry.id, { xrayStatus: "error", xrayError: err instanceof Error ? err.message : "unknown error" });
    }
  };

  const showRecorded = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { key: string; result: RunResult; savedAt: string } | null;
      if (!saved) return;
      addEntry(saved.key === formKey ? formKey : `recorded:${saved.result.contextId}`, {
        id: entryId.current++,
        result: saved.result,
        xray: null,
        xrayStatus: "idle",
        xrayError: null,
        recordedAt: saved.savedAt,
        source: "you",
      });
      setError(saved.key === formKey ? null : "The saved result belongs to a different task, so it is listed under earlier experiments.");
    } catch {
      // Nothing saved.
    }
  };

  const clearSession = () => {
    cancel();
    setExperiments({});
    setPrompts({});
    setMaterial("");
    setChecks([]);
    setGoal("");
    setUndo([]);
    setEdits({});
    setError(null);
    setSuggestNote(null);
    setHelper({ active: false, attempts: [], summary: null, calls: 0 });
    try {
      localStorage.removeItem(STORE);
    } catch {
      // Nothing to remove.
    }
  };

  const addToDraft = (text: string) => {
    const clean = text.trim();
    if (!clean || prompt.includes(clean)) return;
    setUndo((stack) => [...stack, prompt]);
    setPrompt(`${prompt.trim()} ${clean}`.trim());
  };

  const undoLast = () => {
    setUndo((stack) => {
      if (stack.length === 0) return stack;
      setPrompt(stack[stack.length - 1]);
      return stack.slice(0, -1);
    });
  };

  /** Bounded helper: up to three single edits, each tested fresh, each kept only on a clean improvement. */
  const improve = async () => {
    if (!latest || helper.active) return;
    cancelled.current = false;
    const key = formKey;
    const MAX_EDITS = 3;
    let base = latest.result;
    const rejected: string[] = [];
    const attempts: HelperAttempt[] = [];
    let calls = 0;
    setHelper({ active: true, attempts: [], summary: null, calls: 0 });
    try {
      for (let n = 1; n <= MAX_EDITS && !cancelled.current; n++) {
        const failed = base.checks.filter((c) => !c.pass).map((c) => c.id);
        if (failed.length === 0) break;
        const step = await postJson<ImproveStep>("/api/improve", { ...payloadFor(base.prompt), output: base.output, failedCheckIds: failed, rejected });
        calls += step.modelCalls;
        if (cancelled.current) break;
        const change = step.candidate?.change ?? "No edit proposed";
        if (!step.run) {
          attempts.push({ n, change, reason: step.candidate?.reason ?? "", outcome: "blocked", why: step.blocked ?? "Not tested." });
          if (step.candidate) rejected.push(step.candidate.change);
          setHelper({ active: true, attempts: [...attempts], summary: null, calls });
          if (!step.candidate) break;
          continue;
        }
        if (!sameContext(step.run, base)) {
          attempts.push({ n, change, reason: "", outcome: "blocked", why: "The requirements changed during the run, so this result was discarded." });
          setHelper({ active: true, attempts: [...attempts], summary: null, calls });
          break;
        }
        const d = compareChecks(base.checks, step.run.checks);
        const keep = d.improved.length > 0 && d.regressed.length === 0;
        attempts.push({
          n,
          change,
          reason: step.candidate?.reason ?? "",
          outcome: keep ? "kept" : "rejected",
          why: keep
            ? `Gained: ${d.improved.map((c) => c.label).join("; ")}. Nothing regressed.`
            : d.regressed.length > 0
              ? `Lost: ${d.regressed.map((c) => c.label).join("; ")}.`
              : "No requirement improved.",
        });
        if (keep) {
          base = step.run;
          addEntry(key, { id: entryId.current++, result: step.run, xray: null, xrayStatus: "idle", xrayError: null, recordedAt: null, source: "helper" });
        } else if (step.candidate) {
          rejected.push(step.candidate.change);
        }
        setHelper({ active: true, attempts: [...attempts], summary: null, calls });
      }

      let summary: string;
      if (cancelled.current) {
        summary = "Stopped. No further model calls were made.";
      } else if (base === latest.result) {
        summary = "No improvement found. None of the tested edits met more requirements without losing one.";
      } else {
        // Confirm on fresh runs, so the result is not just the run that got the edit selected.
        const fresh: number[] = [];
        for (let i = 0; i < 2 && !cancelled.current; i++) {
          try {
            const again = await postJson<RunResult>("/api/run", payloadFor(base.prompt));
            calls++;
            fresh.push(again.score);
          } catch {
            // A failed confirmation run is reported as missing, not as a score.
          }
        }
        const held = fresh.length > 0 && fresh.every((s) => s >= base.score);
        summary =
          fresh.length === 0
            ? `The revised prompt met ${base.score} of ${base.total} in its test run. The confirmation runs failed, so this is one observation.`
            : `The revised prompt met ${base.score} of ${base.total} in its test run. On ${fresh.length} fresh run${fresh.length === 1 ? "" : "s"} it met ${fresh.join(" and ")}. ${held ? "The result held." : "It did not hold every time, so treat it with care."}`;
        setUndo((stack) => [...stack, prompt]);
        setPrompt(base.prompt);
      }
      setHelper({ active: false, attempts, summary, calls });
    } catch (err) {
      setHelper({ active: false, attempts, summary: `Stopped early: ${err instanceof Error ? err.message : "unknown error"}`, calls });
    }
  };

  const suggest = async () => {
    setSuggestNote(null);
    setSuggesting(true);
    try {
      const result = await postJson<SuggestResult>("/api/suggest", { goal });
      setChecks((list) => [...list, ...result.checks.map((c) => withKey(c, true))].slice(0, 8));
      setShowRules(true);
      setSuggestNote(`${result.checks.length} suggested by ${result.mock ? "simple offline rules" : result.model}. Review each one. Remove any that do not match what you meant.`);
    } catch (err) {
      setSuggestNote(err instanceof Error ? err.message : "Could not suggest requirements.");
    } finally {
      setSuggesting(false);
    }
  };

  const loadOwnExample = () => {
    setPrompts((p) => ({ ...p, [CUSTOM_TASK_ID]: OWN_EXAMPLE.prompt }));
    setMaterial(OWN_EXAMPLE.material);
    setChecks(OWN_EXAMPLE.checks.map((c) => withKey(c)));
    setShowRules(true);
    setSuggestNote(null);
  };

  const updateCheck = (k: number, patch: Partial<DraftCheck>) =>
    setChecks((list) => list.map((c) => (c.key === k ? { ...c, ...patch, suggested: false } : c)));

  const approveAlternative = (diagnosis: Diagnosis, alt: string) => {
    setChecks((list) =>
      list.map((c) =>
        c.kind === "includes" && describeCheck(strip(c)) === diagnosis.checkLabel ? { ...c, alternatives: [...(c.alternatives ?? []), alt] } : c,
      ),
    );
  };

  const switchMode = (next: Mode) => {
    cancel();
    setMode(next);
    setError(null);
    setUndo([]);
    setHelper({ active: false, attempts: [], summary: null, calls: 0 });
  };

  if (loadError) {
    return (
      <section className="bench">
        <div className="notice error">{loadError}</div>
      </section>
    );
  }

  const failures = latest?.result.diagnoses ?? [];
  const notes = (latest?.result.friction ?? []).filter((f) => f.category !== "persona");

  return (
    <section className="bench">
      <header className="bench-head">
        <div>
          <h1>Workspace</h1>
          <p>Run a prompt, see which requirements the answer missed, try a targeted edit, and compare under the same checks.</p>
        </div>
        <div className="bench-meta">
          {data && (
            <span className={`badge${data.mock ? " warn" : ""}`}>
              {data.mock ? "Offline mock model. For testing the app, not real AI behavior." : `Live model: ${data.model}`}
            </span>
          )}
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

      <div className="bench-grid">
        {/* ---------------- setup ---------------- */}
        <div className="setup">
          {mode === "example" && data && (
            <div className="panel solid">
              <label className="field">
                <span className="label">Example task</span>
                <select value={taskId} onChange={(e) => { cancel(); setTaskId(e.target.value); setError(null); setUndo([]); }}>
                  {data.tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </label>
              {task && (
                <>
                  <p className="label">The situation</p>
                  <ul className="facts">
                    {task.situationCard.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="fine">
                    The AI does not see this situation or the requirements below. It receives only your prompt
                    {task.sourceMaterial ? " and the reference material" : ""}. Use any of these details in your prompt.
                  </p>
                  <p className="label">A successful answer will</p>
                  <ul className="criteria">
                    {task.criteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  {task.sourceMaterial && (
                    <details className="material">
                      <summary>Reference material sent with your prompt</summary>
                      <pre>{task.sourceMaterial}</pre>
                    </details>
                  )}
                </>
              )}
            </div>
          )}

          <div className="panel solid editor">
            <div className="panel-head">
              <label htmlFor="prompt" className="label big">
                Your prompt
              </label>
              {mode === "own" && (
                <button className="link" onClick={loadOwnExample}>
                  Fill in a sample
                </button>
              )}
            </div>
            <p className="fine">The instructions you would give an AI assistant.</p>
            <textarea
              id="prompt"
              ref={editor}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === "example" ? "Write what you would type to get this done." : "Paste a prompt you actually use."}
              maxLength={2000}
              spellCheck={false}
            />
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
                    {latest ? (dirty ? "Test this revision" : "Run again") : "Run"}
                  </button>
                )}
              </span>
            </div>
            {mode === "own" && !ownReady && prompt.trim().length > 0 && (
              <p className="note">{contradiction ?? "Add at least one complete requirement below, so there is something to check the answer against."}</p>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}{" "}
                <button className="link" onClick={showRecorded}>
                  Show the last saved result from this device
                </button>
              </div>
            )}
          </div>

          {mode === "own" && (
            <>
              <div className="panel solid">
                <label htmlFor="material" className="label big">
                  Reference material
                </label>
                <p className="fine">
                  Optional. Notes, a document, or data the AI needs to do the task. It is sent along with your prompt.
                  Example: the prompt says &quot;summarize these notes&quot;, and the notes go here.
                </p>
                <textarea
                  id="material"
                  className="material-input"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  placeholder="Leave empty if your prompt stands on its own."
                  maxLength={6000}
                />
              </div>

              <div className="panel solid">
                <p className="label big">What should a successful answer do?</p>
                <p className="fine">These are the criteria the answer is checked against. You decide what success means.</p>
                <div className="suggest-row">
                  <input
                    type="text"
                    value={goal}
                    maxLength={600}
                    aria-label="Describe a successful answer"
                    placeholder="In your own words: under 80 words, names the new date, never mentions the budget"
                    onChange={(e) => setGoal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && goal.trim().length >= 8 && !suggesting) suggest(); }}
                  />
                  <button className="btn small" disabled={suggesting || goal.trim().length < 8 || checks.length >= 8} onClick={suggest}>
                    {suggesting ? "Working" : "Suggest checks"}
                  </button>
                </div>
                {suggestNote && <p className="note">{suggestNote}</p>}

                {(showRules || checks.length > 0) && (
                  <ul className="req-list">
                    {checks.map((check) => {
                      const option = KIND_OPTIONS.find((o) => o.kind === check.kind)!;
                      const offers = check.kind === "includes" && check.text ? alternativesFor(check.text).filter((a) => !(check.alternatives ?? []).includes(a)) : [];
                      return (
                        <li key={check.key} className={check.suggested ? "suggested" : ""}>
                          <div className="req-row">
                            <select
                              value={check.kind}
                              aria-label="Requirement type"
                              onChange={(e) => updateCheck(check.key, { kind: e.target.value as CustomCheckKind, text: undefined, value: undefined, alternatives: undefined })}
                            >
                              {KIND_OPTIONS.map((o) => (
                                <option key={o.kind} value={o.kind}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            {option.input === "text" && (
                              <input type="text" value={check.text ?? ""} maxLength={120} placeholder={option.placeholder} aria-label={option.label} onChange={(e) => updateCheck(check.key, { text: e.target.value, alternatives: undefined })} />
                            )}
                            {option.input === "number" && (
                              <input type="number" min={1} value={check.value ?? ""} placeholder={option.placeholder} aria-label={option.label} onChange={(e) => updateCheck(check.key, { value: e.target.value === "" ? undefined : Number(e.target.value) })} />
                            )}
                            {option.input === "none" && <span />}
                            <button className="icon" aria-label={`Remove: ${isComplete(check) ? describeCheck(strip(check)) : option.label}`} onClick={() => setChecks((list) => list.filter((c) => c.key !== check.key))}>
                              {"×"}
                            </button>
                          </div>
                          {check.suggested && <p className="fine">Suggested by the model. Edit or remove it if it is not what you meant.</p>}
                          {check.kind === "includes" && check.text && (
                            <p className="fine">
                              Checks that this exact text appears. It cannot tell whether the idea is explained correctly.
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
                )}
                <button className="btn small" disabled={checks.length >= 8} onClick={() => { setShowRules(true); setChecks((list) => [...list, withKey({ kind: "includes", text: "" })]); }}>
                  Add a check by hand
                </button>
                {contradiction && <p className="notice error">{contradiction}</p>}
              </div>
            </>
          )}
          <p className="fine">
            Your prompt and reference material are sent to the AI provider to generate an answer. This app has no
            database. <Link href="/method">What happens to your text</Link>
          </p>
        </div>

        {/* ---------------- results ---------------- */}
        <div className="results" aria-live="polite">
          {running && (
            <p className="status panel solid" role="status">
              <span className="pulse" aria-hidden="true" />
              Running your prompt. One model call.
            </p>
          )}

          {!latest && !running && (
            <div className="panel solid empty">
              <h3>No result yet</h3>
              <p>
                {earlier.length > 0
                  ? "The task or requirements changed, so this is a new experiment. Earlier results are kept below with their own requirements and are not compared with this one."
                  : "Run a prompt to see the answer and which requirements it met."}
              </p>
            </div>
          )}

          {latest && (
            <>
              {latest.recordedAt && (
                <div className="notice recorded" role="status">
                  <b>Recorded result</b> from {new Date(latest.recordedAt).toLocaleString()}. This is a replay saved on this
                  device, not a live measurement.
                </div>
              )}
              {dirty && !running && (
                <div className="notice caution">
                  You have edited the prompt since this result. The result below is for the earlier version.{" "}
                  <button className="link" onClick={() => run()} disabled={!canRun}>
                    Test this revision
                  </button>
                </div>
              )}

              <section className="panel solid result" aria-label="Result">
                <div className="panel-head">
                  <h3>Result</h3>
                  <span className="fine">
                    {latest.source === "helper" ? "Tested by Improve and test. " : ""}
                    {latest.result.mock ? "Offline mock model" : latest.result.model}, {(latest.result.ms / 1000).toFixed(1)}s
                  </span>
                </div>
                <p className="met">
                  <span className="met-n">
                    {latest.result.score} <span>of {latest.result.total}</span>
                  </span>{" "}
                  requirements met
                </p>
                <div className="result-grid">
                  <Answer text={latest.result.output} />
                  <div>
                    <p className="label">Requirements</p>
                    <Checks checks={latest.result.checks} />
                    <p className="fine">
                      This counts requirements met. It is not a measure of how good the answer is.
                    </p>
                  </div>
                </div>
              </section>

              <section className="panel solid fixes" aria-label="What to fix">
                <div className="panel-head">
                  <h3>What to fix</h3>
                </div>
                {failures.length === 0 ? (
                  <p className="headline">
                    Every requirement was met in this run. Run it again to see if that holds, or use the X-ray to see
                    which instructions the result depends on.
                  </p>
                ) : (
                  <>
                    <p className="headline">
                      {failures.length} requirement{failures.length === 1 ? " was" : "s were"} not met. Start with:{" "}
                      {failures[0].checkLabel}.
                    </p>
                    <ul className="fix-list">
                      {failures.map((d) => {
                        const value = edits[d.checkId] ?? d.suggestedEdit ?? "";
                        const added = !!value && prompt.includes(value.trim());
                        return (
                          <li key={d.checkId}>
                            <p className="fix-kind">
                              <span className={`chip kind-${d.kind}`}>{KIND_TITLE[d.kind]}</span> {d.checkLabel}
                            </p>
                            <p>{d.interpretation}</p>
                            <details>
                              <summary>Evidence</summary>
                              <p>{d.observation}</p>
                              <p>{d.evidence}</p>
                            </details>
                            {d.suggestedEdit !== null && (
                              <div className="fix-edit">
                                <label className="label" htmlFor={`edit-${d.checkId}`}>
                                  Suggested edit (you can change it)
                                </label>
                                <div className="suggest-row">
                                  <input id={`edit-${d.checkId}`} type="text" value={value} maxLength={300} onChange={(e) => setEdits((all) => ({ ...all, [d.checkId]: e.target.value }))} />
                                  <button className="btn small" onClick={() => addToDraft(value)} disabled={added || !value.trim()}>
                                    {added ? "In your draft" : "Add to draft"}
                                  </button>
                                </div>
                                <p className="fine">{added ? "Added to your draft. Not tested yet." : "A suggestion. It has not been tested."}</p>
                              </div>
                            )}
                            {d.kind === "possible_checker_mismatch" && mode === "own" && (d.alternatives ?? []).length > 0 && (
                              <p className="fix-alt">
                                If the variant is acceptable to you:{" "}
                                {(d.alternatives ?? []).map((alt) => (
                                  <button key={alt} className="btn small" onClick={() => approveAlternative(d, alt)}>
                                    Also accept &quot;{alt}&quot;
                                  </button>
                                ))}
                                <span className="fine"> Changing a requirement starts a new experiment.</span>
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    <div className="next">
                      <button className="btn primary" onClick={() => run()} disabled={!dirty || !canRun}>
                        Test this revision
                      </button>
                      <span className="fine">{dirty ? "Runs your edited prompt under the same requirements." : "Add an edit to your draft first, or edit the prompt yourself."}</span>
                    </div>

                    <div className="helper">
                      <p className="label">Or let PromptProof try</p>
                      <p className="fine">
                        Proposes one small edit at a time, tests each on a fresh run, and keeps an edit only if a
                        requirement improves and none regresses. Stops after 3 edits, at most 8 model calls. It cannot
                        change your requirements.
                      </p>
                      {helper.active ? (
                        <button className="btn small" onClick={cancel}>
                          Stop
                        </button>
                      ) : (
                        <button className="btn small" onClick={improve} disabled={running || dirty || !!latest.recordedAt}>
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
                  </>
                )}
                {(helper.attempts.length > 0 || helper.summary) && (
                  <div className="helper-log">
                    <p className="label">Improve and test: what was tried</p>
                    <ol>
                      {helper.attempts.map((a) => (
                        <li key={a.n} className={a.outcome}>
                          <b>{a.outcome === "kept" ? "Kept" : a.outcome === "rejected" ? "Rejected" : "Blocked"}.</b> {a.change}
                          <small>
                            {a.reason} {a.why}
                          </small>
                        </li>
                      ))}
                    </ol>
                    {helper.summary && <p className="headline">{helper.summary}</p>}
                    {!helper.active && <p className="fine">{helper.calls} model calls used. A higher count of requirements met is evidence, not proof, of a better answer. Read both answers.</p>}
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

              {previous && !latest.recordedAt && (
                <Compare
                  before={previous}
                  after={latest}
                  onEdit={() => editor.current?.focus()}
                  onRestore={() => { setUndo((stack) => [...stack, prompt]); setPrompt(previous.result.prompt); editor.current?.focus(); }}
                />
              )}

              {!latest.recordedAt && <Xray entry={latest} onRun={() => runXray(latest)} />}

              {runs.length > 1 && (
                <details className="history">
                  <summary>All runs in this experiment ({runs.length})</summary>
                  <ol>
                    {runs.map((r, i) => (
                      <li key={r.id}>
                        Run {i + 1}: {r.result.score} of {r.result.total} met{r.source === "helper" ? ", by Improve and test" : ""}
                        {r.recordedAt ? ", recorded replay" : ""}. <span className="fine">{r.result.prompt.slice(0, 90)}{r.result.prompt.length > 90 ? "..." : ""}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          )}

          {earlier.length > 0 && (
            <details className="history">
              <summary>Earlier experiments ({earlier.length}), each with its own requirements</summary>
              <p className="fine">These used a different task, reference material, or requirements, so they are not compared with the current one.</p>
              <ol>
                {earlier.map(([key, list]) => {
                  const last = list[list.length - 1].result;
                  return (
                    <li key={key}>
                      {last.context.title}, {last.context.criteria.length} requirement{last.context.criteria.length === 1 ? "" : "s"}: {list.map((r) => `${r.result.score} of ${r.result.total}`).join(", ")}
                      {list.some((r) => r.recordedAt) ? " (recorded replay)" : ""}
                    </li>
                  );
                })}
              </ol>
            </details>
          )}
        </div>
      </div>
    </section>
  );
}
