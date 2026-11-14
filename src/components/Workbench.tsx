"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeCheck } from "@/lib/custom";
import { CUSTOM_TASK_ID } from "@/lib/types";
import type {
  AblationLabel,
  AblationResult,
  ApiError,
  CustomCheck,
  CustomCheckKind,
  PublicTask,
  RunResult,
  SuggestResult,
  XrayResult,
} from "@/lib/types";
import { useCountUp } from "./hooks";

type Mode = "practice" | "own";
type Busy = "idle" | "run" | "xray";

interface Attempt {
  id: number;
  run: RunResult;
  xray: XrayResult | null;
  xrayError: string | null;
  /** True while the three-run confirmation is still in flight. */
  confirming: boolean;
  /** Set when this is a saved earlier run shown because the live model failed. */
  recordedAt: string | null;
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

const LABEL: Record<AblationLabel, { text: string; icon: string }> = {
  helpful: { text: "Helped", icon: "✓" },
  no_measured_effect: { text: "No measured effect", icon: "–" },
  possibly_harmful: { text: "Possibly harmful", icon: "!" },
  uncertain: { text: "Uncertain", icon: "?" },
};

const KIND_OPTIONS: { kind: CustomCheckKind; label: string; input: "number" | "text" | "none"; placeholder?: string }[] = [
  { kind: "maxWords", label: "Word limit", input: "number", placeholder: "60" },
  { kind: "includes", label: "Must include", input: "text", placeholder: "a phrase or number" },
  { kind: "excludes", label: "Must not mention", input: "text", placeholder: "a phrase" },
  { kind: "startsWith", label: "Must start with", input: "text", placeholder: "Subject:" },
  { kind: "singleParagraph", label: "One paragraph, no bullets", input: "none" },
  { kind: "numberedItems", label: "Numbered list, exact count", input: "number", placeholder: "3" },
  { kind: "listOnly", label: "A list and nothing else", input: "none" },
];

const EXAMPLE = {
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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({ error: "Unexpected server response." }))) as T | ApiError;
  if (!res.ok || (data as ApiError).error) throw new Error((data as ApiError).error ?? "Request failed.");
  return data as T;
}

function effectSentence(ablation: AblationResult, xray: XrayResult, run: RunResult): string {
  const after = Number((xray.baselineScore - ablation.delta).toFixed(2));
  const changed = ablation.flippedChecks
    .map((id) => run.checks.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join("; ");
  switch (ablation.label) {
    case "helpful":
      return `Without it the score fell from ${xray.baselineScore} to ${after}.${changed ? ` Lost: ${changed}.` : ""}`;
    case "possibly_harmful":
      return `Without it the score rose from ${xray.baselineScore} to ${after}.${changed ? ` Changed: ${changed}.` : ""}`;
    case "uncertain":
      return "Repeat runs disagreed, so there is no conclusion for this phrase.";
    default:
      return "Removing this phrase caused no measurable decline on this task.";
  }
}

function runsNote(ablation: AblationResult, xray: XrayResult): string {
  if (xray.runsPerChunk < 2) return "1 run";
  const moved = ablation.scores.filter((s) => s !== xray.baselineScore).length;
  if (ablation.label === "no_measured_effect") return `${xray.runsPerChunk} of ${xray.runsPerChunk} runs unchanged`;
  return `${moved} of ${xray.runsPerChunk} runs`;
}

const storeKey = (key: string) => `promptproof:last:${key}`;

function saveLast(key: string, attempt: Attempt) {
  try {
    localStorage.setItem(storeKey(key), JSON.stringify({ run: attempt.run, xray: attempt.xray, savedAt: new Date().toISOString() }));
  } catch {
    // Storage can be unavailable. The fallback is a convenience, not a requirement.
  }
}

function loadLast(key: string): { run: RunResult; xray: XrayResult | null; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(storeKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function Score({ attempt, previous }: { attempt: Attempt; previous?: Attempt }) {
  const { run } = attempt;
  const shown = useCountUp(run.score, attempt.id);
  const improved = previous ? run.score > previous.run.score : false;
  return (
    <div className={`panel glass score-panel${improved ? " improved" : ""}`}>
      <div className="panel-head">
        <h3>Objective checks</h3>
        <span className="tag">fixed rules, no AI judge</span>
      </div>
      <div className="score-line">
        <span className="score-big" aria-label={`${run.score} of ${run.total}`}>
          {shown}
          <span className="score-of"> / {run.total}</span>
        </span>
        {previous && (
          <span className="score-was">
            previous attempt {previous.run.score} / {previous.run.total}
            {improved && <b> up {run.score - previous.run.score}</b>}
          </span>
        )}
      </div>
      <ul className="checks">
        {run.checks.map((check, i) => (
          <li key={`${attempt.id}-${check.id}`} className={check.pass ? "pass" : "fail"} style={{ animationDelay: `${300 + i * 110}ms` }}>
            <span className="mark" aria-hidden="true">
              {check.pass ? "✓" : "×"}
            </span>
            <span>
              {check.label}
              <small>
                {check.pass ? "Passed" : "Missed"}: {check.detail}
              </small>
            </span>
          </li>
        ))}
      </ul>
      <p className="fine">
        The score says whether the answer met each stated requirement. It does not say whether the answer is good.
      </p>
    </div>
  );
}

function Xray({ attempt, busy, onRetry, stale, showGhosts }: { attempt: Attempt; busy: Busy; onRetry: () => void; stale: boolean; showGhosts: boolean }) {
  const { run, xray } = attempt;
  const frictionByChunk = useMemo(() => {
    const map = new Map<number, typeof run.friction>();
    for (const finding of run.friction) {
      if (finding.chunkIndex === null) continue;
      map.set(finding.chunkIndex, [...(map.get(finding.chunkIndex) ?? []), finding]);
    }
    return map;
  }, [run]);
  const loose = run.friction.filter((f) => f.chunkIndex === null);
  const missing = run.ghosts.filter((g) => !g.alreadyInPrompt);
  const scanning = busy === "xray" && !xray;
  const single = run.chunks.length <= 1;
  const find = (index: number) => xray?.ablations.find((a) => a.chunkIndex === index) ?? null;

  return (
    <div className={`panel glass xray-panel${scanning ? " scanning" : ""}`}>
      <div className="panel-head">
        <h3>Prompt X-ray</h3>
        <span className="tag">
          {scanning
            ? "removing one part at a time"
            : attempt.confirming
              ? "confirming with 3 runs"
              : xray
                ? `measured, ${xray.runsPerChunk} run${xray.runsPerChunk === 1 ? "" : "s"} per part`
                : "measured effect"}
        </span>
      </div>
      {stale && <p className="fine">This X-ray is for the prompt you last ran, not your edits.</p>}

      <p className="xray-strip" aria-hidden={!!xray}>
        {run.chunks.map((chunk, i) => {
          const ablation = find(chunk.index);
          const classes = ["chunk", ablation ? `${ablation.label} lit` : "pending"];
          if (frictionByChunk.has(chunk.index)) classes.push("friction");
          return (
            <span key={chunk.index} className={classes.join(" ")} style={{ transitionDelay: `${i * 180}ms` }}>
              {chunk.text}
            </span>
          );
        })}
        {showGhosts &&
          missing.map((ghost) => (
            <span key={ghost.checkId} className="ghost shown">
              {" "}
              {ghost.clause}
            </span>
          ))}
        {!showGhosts && missing.length > 0 && (
          <span className="ghost shown">
            {" "}
            + {missing.length} missing detail{missing.length === 1 ? "" : "s"}
          </span>
        )}
      </p>

      {single && <p className="fine">This prompt is a single instruction, so there is nothing to remove and compare. Add detail and run it again.</p>}
      {attempt.xrayError && (
        <div className="notice error" role="alert">
          {attempt.xrayError}{" "}
          <button className="link" onClick={onRetry}>
            Retry the X-ray
          </button>
        </div>
      )}

      {(xray || loose.length > 0 || frictionByChunk.size > 0) && (
        <ol className="readout">
          {run.chunks.map((chunk, i) => {
            const ablation = find(chunk.index);
            const warnings = frictionByChunk.get(chunk.index) ?? [];
            if (!ablation && warnings.length === 0) return null;
            return (
              <li key={chunk.index} className={`readout-row ${ablation?.label ?? "pending"}`} style={{ animationDelay: `${i * 180}ms` }}>
                <span className="readout-icon" aria-hidden="true">
                  {ablation ? LABEL[ablation.label].icon : "…"}
                </span>
                <div>
                  <p className="readout-text">{chunk.text}</p>
                  {ablation && xray && (
                    <p className="readout-effect">
                      <b>{LABEL[ablation.label].text}</b>
                      <span className="runs">{runsNote(ablation, xray)}</span>
                      {effectSentence(ablation, xray, run)}
                    </p>
                  )}
                  {warnings.map((warning, w) => (
                    <details className="warning" key={w}>
                      <summary>
                        <span className="warning-mark" aria-hidden="true" />
                        Pattern warning: {warning.categoryLabel}
                        {ablation?.label === "no_measured_effect" ? ", with no measured benefit here" : ""}
                      </summary>
                      <p>{warning.explanation}</p>
                      <p>
                        <b>Try:</b> {warning.suggestion}
                      </p>
                      <p className="fine">Detected by a wording rule. A possible risk, not a measurement.</p>
                    </details>
                  ))}
                </div>
              </li>
            );
          })}
          {loose.map((warning, w) => (
            <li key={`loose-${w}`} className="readout-row pending">
              <span className="readout-icon" aria-hidden="true">
                !
              </span>
              <div>
                <p className="readout-text">{warning.phrase}</p>
                <details className="warning" open>
                  <summary>
                    <span className="warning-mark" aria-hidden="true" />
                    Pattern warning: {warning.categoryLabel}
                  </summary>
                  <p>{warning.explanation}</p>
                  <p>
                    <b>Try:</b> {warning.suggestion}
                  </p>
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}

      {xray && (
        <ul className="limits">
          <li>
            &quot;No measured effect&quot; means none of the {run.total} checks changed. The phrase may still matter for
            things the checks do not measure.
          </li>
          <li>Parts are removed one at a time, so two phrases that overlap can each look unnecessary.</li>
          <li>
            Measured on {xray.mock ? "the offline mock model" : xray.model} with {xray.modelCalls} model calls in{" "}
            {(xray.ms / 1000).toFixed(1)}s. Other models may respond differently.
          </li>
        </ul>
      )}
    </div>
  );
}

function Compare({ before, after }: { before: Attempt; after: Attempt }) {
  const side = (attempt: Attempt, title: string) => {
    const counts = { helpful: 0, no_measured_effect: 0, possibly_harmful: 0, uncertain: 0 };
    for (const a of attempt.xray?.ablations ?? []) counts[a.label]++;
    return (
      <div className="compare-side">
        <p className="tag">{title}</p>
        <p className="compare-score">
          {attempt.run.score} <span>/ {attempt.run.total}</span>
        </p>
        <p className="pips" aria-label={`${attempt.run.score} of ${attempt.run.total} requirements passed`}>
          {attempt.run.checks.map((c) => (
            <i key={c.id} className={c.pass ? "pass" : "fail"} />
          ))}
        </p>
        <p className="compare-prompt">{attempt.run.prompt}</p>
        {attempt.xray && attempt.xray.ablations.length > 0 && (
          <p className="fine">
            {counts.helpful} helped, {counts.no_measured_effect} no measured effect
            {counts.possibly_harmful ? `, ${counts.possibly_harmful} possibly harmful` : ""}
            {counts.uncertain ? `, ${counts.uncertain} uncertain` : ""}
          </p>
        )}
      </div>
    );
  };
  const improved = after.run.score > before.run.score;
  return (
    <div className={`panel glass compare${improved ? " improved" : ""}`}>
      <div className="panel-head">
        <h3>Before and after</h3>
        <span className="tag">
          {improved ? `up ${after.run.score - before.run.score}` : after.run.score === before.run.score ? "no change" : "down"}
        </span>
      </div>
      <div className="compare-grid">
        {side(before, "Before")}
        {side(after, "After")}
      </div>
    </div>
  );
}

export default function Workbench() {
  const [data, setData] = useState<TaskData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("practice");
  const [taskId, setTaskId] = useState("");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState<Record<string, Attempt[]>>({});
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hintsOpen, setHintsOpen] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [pulse, setPulse] = useState(0);
  // Own-prompt setup
  const [material, setMaterial] = useState("");
  const [checks, setChecks] = useState<DraftCheck[]>([]);
  const [goal, setGoal] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const attemptId = useRef(1);

  useEffect(() => {
    fetch("/api/tasks")
      .then((res) => res.json())
      .then((loaded: TaskData) => {
        setData(loaded);
        setTaskId(loaded.tasks[0]?.id ?? "");
      })
      .catch(() => setLoadError("Could not load the scenarios. Refresh the page."));
  }, []);

  const key = mode === "own" ? CUSTOM_TASK_ID : taskId;
  const task = useMemo(() => data?.tasks.find((t) => t.id === taskId), [data, taskId]);
  const prompt = prompts[key] ?? "";
  const history = attempts[key] ?? [];
  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  const readyChecks = checks.filter(isComplete);
  const ownReady = readyChecks.length > 0 && readyChecks.length === checks.length;
  const canRun = busy !== "run" && prompt.trim().length > 0 && (mode === "practice" ? !!task : ownReady);

  const setPrompt = (value: string) => setPrompts((p) => ({ ...p, [key]: value }));

  const patchAttempt = useCallback((k: string, id: number, patch: Partial<Attempt>) => {
    setAttempts((all) => ({
      ...all,
      [k]: (all[k] ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }, []);

  const payload = useCallback(
    (k: string, text: string) =>
      k === CUSTOM_TASK_ID
        ? { taskId: k, prompt: text, custom: { material, checks: readyChecks.map(({ kind, text: t, value }) => ({ kind, text: t, value })) } }
        : { taskId: k, prompt: text },
    [material, readyChecks],
  );

  /** One quick pass for a fast first picture, then three runs per part to confirm it. */
  const runXray = useCallback(
    async (k: string, attempt: Attempt) => {
      const body = payload(k, attempt.run.prompt);
      setBusy("xray");
      let first: XrayResult | null = null;
      try {
        first = await postJson<XrayResult>("/api/xray", { ...body, runs: 1 });
        patchAttempt(k, attempt.id, { xray: first, xrayError: null, confirming: true });
        saveLast(k, { ...attempt, xray: first });
      } catch (err) {
        patchAttempt(k, attempt.id, { xrayError: err instanceof Error ? err.message : "The X-ray failed." });
      } finally {
        setBusy("idle");
      }
      if (!first) return;
      try {
        const confirmed = await postJson<XrayResult>("/api/xray", { ...body, runs: 3 });
        patchAttempt(k, attempt.id, { xray: confirmed, confirming: false });
        saveLast(k, { ...attempt, xray: confirmed });
      } catch {
        // Keep the single-run result. Its label already says it is one run.
        patchAttempt(k, attempt.id, { confirming: false });
      }
    },
    [payload, patchAttempt],
  );

  const run = async () => {
    if (!canRun) return;
    const k = key;
    setError(null);
    setAdded([]);
    setBusy("run");
    try {
      const result = await postJson<RunResult>("/api/run", payload(k, prompt));
      const attempt: Attempt = { id: attemptId.current++, run: result, xray: null, xrayError: null, confirming: false, recordedAt: null };
      setAttempts((all) => ({ ...all, [k]: [...(all[k] ?? []), attempt] }));
      saveLast(k, attempt);
      if (result.chunks.length > 1) {
        await runXray(k, attempt);
      } else {
        setBusy("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy("idle");
    }
  };

  const showRecorded = () => {
    const saved = loadLast(key);
    if (!saved) return;
    const attempt: Attempt = {
      id: attemptId.current++,
      run: saved.run,
      xray: saved.xray,
      xrayError: null,
      confirming: false,
      recordedAt: saved.savedAt,
    };
    setAttempts((all) => ({ ...all, [key]: [...(all[key] ?? []), attempt] }));
    setError(null);
  };

  const addGhost = (clause: string) => {
    // Functional update, so two quick clicks cannot overwrite each other.
    setPrompts((all) => {
      const text = all[key] ?? "";
      return text.includes(clause) ? all : { ...all, [key]: `${text.trim()} ${clause}`.trim() };
    });
    setAdded((list) => (list.includes(clause) ? list : [...list, clause]));
    setPulse((n) => n + 1);
  };

  const suggest = async () => {
    setSuggestNote(null);
    setSuggesting(true);
    try {
      const result = await postJson<SuggestResult>("/api/suggest", { goal });
      setChecks((list) => [...list, ...result.checks.map((c) => withKey(c, true))].slice(0, 8));
      setSuggestNote(
        `${result.checks.length} suggested by ${result.mock ? "simple offline rules" : result.model}. Review each one before you run.`,
      );
    } catch (err) {
      setSuggestNote(err instanceof Error ? err.message : "Could not suggest requirements.");
    } finally {
      setSuggesting(false);
    }
  };

  const loadExample = () => {
    setPrompts((p) => ({ ...p, [CUSTOM_TASK_ID]: EXAMPLE.prompt }));
    setMaterial(EXAMPLE.material);
    setChecks(EXAMPLE.checks.map((c) => withKey(c)));
    setSuggestNote(null);
  };

  const updateCheck = (k: number, patch: Partial<DraftCheck>) =>
    setChecks((list) => list.map((c) => (c.key === k ? { ...c, ...patch, suggested: false } : c)));

  if (loadError) {
    return (
      <section className="bench" id="try">
        <div className="notice error">{loadError}</div>
      </section>
    );
  }

  const missing = (current?.run.ghosts ?? []).filter((g) => !g.alreadyInPrompt);
  const ignored = (current?.run.ghosts ?? []).filter((g) => g.alreadyInPrompt);
  const hintsVisible = mode === "own" || hintsOpen[key];
  const stale = current ? current.run.prompt !== prompt : false;
  const hasRecorded = typeof window !== "undefined" && !!error && !!loadLast(key);

  return (
    <section className="bench" id="try">
      <div className="section-head">
        <h2>Run the experiment</h2>
        <p>Start with a practice scenario to see how it works, then bring a prompt you actually use.</p>
        {data && (
          <span className={`tag model${data.mock ? " warn" : ""}`}>
            {data.mock ? "Offline mock model. Results are for testing the app, not real AI behavior." : `Live model: ${data.model}`}
          </span>
        )}
      </div>

      <div className="mode" role="tablist" aria-label="What to debug">
        <button role="tab" aria-selected={mode === "practice"} onClick={() => { setMode("practice"); setError(null); }}>
          Practice scenarios
        </button>
        <button role="tab" aria-selected={mode === "own"} onClick={() => { setMode("own"); setError(null); }}>
          Your own prompt
        </button>
      </div>

      {mode === "practice" && data && (
        <div className="scenarios" role="tablist" aria-label="Scenarios">
          {data.tasks.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === taskId} onClick={() => { setTaskId(t.id); setError(null); }}>
              <strong>{t.title}</strong>
              <span>{t.blurb}</span>
            </button>
          ))}
        </div>
      )}

      <div className="bench-grid">
        <div className="col">
          {mode === "practice" && task && (
            <div className="panel glass">
              <div className="panel-head">
                <h3>Practice scenario</h3>
                <span className="tag">only you can see this</span>
              </div>
              <p className="lede">
                Imagine this is your situation. The AI cannot see this card, so anything you leave out of your prompt, it
                does not know.
              </p>
              <ul className="facts">
                {task.situationCard.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {task.sourceMaterial && (
                <details className="material">
                  <summary>Text the AI receives with your prompt</summary>
                  <pre>{task.sourceMaterial}</pre>
                </details>
              )}
            </div>
          )}

          {mode === "own" && (
            <div className="panel glass">
              <div className="panel-head">
                <h3>Your task</h3>
                <button className="link" onClick={loadExample}>
                  Load an example
                </button>
              </div>
              <label className="field">
                <span>Text the AI should work on (optional)</span>
                <textarea
                  className="material-input"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  placeholder="Paste notes, an email thread, data. Leave empty if your prompt stands alone."
                  maxLength={6000}
                />
              </label>

              <div className="field">
                <span>What must a good answer do?</span>
                <p className="fine">
                  Each requirement is a fixed rule, so the score stays a fact. Add the ones you would check by eye.
                </p>
                <ul className="req-list">
                  {checks.map((check) => {
                    const option = KIND_OPTIONS.find((o) => o.kind === check.kind)!;
                    return (
                      <li key={check.key} className={check.suggested ? "suggested" : ""}>
                        <select
                          value={check.kind}
                          aria-label="Requirement type"
                          onChange={(e) => updateCheck(check.key, { kind: e.target.value as CustomCheckKind, text: undefined, value: undefined })}
                        >
                          {KIND_OPTIONS.map((o) => (
                            <option key={o.kind} value={o.kind}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {option.input === "text" && (
                          <input
                            type="text"
                            value={check.text ?? ""}
                            maxLength={120}
                            placeholder={option.placeholder}
                            aria-label={option.label}
                            onChange={(e) => updateCheck(check.key, { text: e.target.value })}
                          />
                        )}
                        {option.input === "number" && (
                          <input
                            type="number"
                            min={1}
                            value={check.value ?? ""}
                            placeholder={option.placeholder}
                            aria-label={option.label}
                            onChange={(e) => updateCheck(check.key, { value: e.target.value === "" ? undefined : Number(e.target.value) })}
                          />
                        )}
                        {option.input === "none" && <span className="req-fill" />}
                        {check.suggested && <span className="tag">suggested</span>}
                        <button className="icon" aria-label={`Remove requirement: ${isComplete(check) ? describeCheck(check) : option.label}`} onClick={() => setChecks((list) => list.filter((c) => c.key !== check.key))}>
                          {"×"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button className="btn small" disabled={checks.length >= 8} onClick={() => setChecks((list) => [...list, withKey({ kind: "includes", text: "" })])}>
                  Add a requirement
                </button>
              </div>

              <div className="field suggest">
                <span>Or describe a good answer and get suggestions</span>
                <div className="suggest-row">
                  <input
                    type="text"
                    value={goal}
                    maxLength={600}
                    placeholder='Under 80 words, names the new date, never mentions the budget'
                    onChange={(e) => setGoal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && goal.trim().length >= 8 && !suggesting) suggest(); }}
                  />
                  <button className="btn small" disabled={suggesting || goal.trim().length < 8 || checks.length >= 8} onClick={suggest}>
                    {suggesting ? "Thinking" : "Suggest"}
                  </button>
                </div>
                {suggestNote && <p className="fine">{suggestNote}</p>}
                <p className="fine">
                  Suggestions come from the AI model, so check them. Scoring still uses only the fixed rules you keep.
                </p>
              </div>
            </div>
          )}

          <div className={`panel editor${busy === "run" ? " running" : ""}`} key={`editor-${pulse}`} data-pulse={pulse > 0 ? "on" : undefined}>
            <div className="panel-head">
              <h3>Your prompt</h3>
              <span className="tag">{prompt.length} / 2000</span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === "practice" ? "Write what you would type into an AI assistant to get this done." : "Paste a prompt you actually use."}
              maxLength={2000}
              spellCheck={false}
              aria-label="Your prompt"
            />
            {added.length > 0 && (
              <p className="added" aria-live="polite">
                Added: {added.map((clause) => <span key={clause}>{clause}</span>)}
              </p>
            )}
            <div className="editor-foot">
              <span className="fine">
                {mode === "practice" && task
                  ? `Scored against ${task.checkCount} requirements from the scenario.`
                  : ownReady
                    ? `Scored against your ${readyChecks.length} requirement${readyChecks.length === 1 ? "" : "s"}.`
                    : "Add at least one complete requirement to run."}
              </span>
              <button className="btn primary run" onClick={run} disabled={!canRun}>
                <span>{busy === "run" ? "Analyzing" : current ? "Run again" : "Run"}</span>
              </button>
            </div>
            {error && (
              <div className="notice error" role="alert">
                {error}
                {hasRecorded && (
                  <>
                    {" "}
                    <button className="link" onClick={showRecorded}>
                      Show the last recorded run from this device
                    </button>
                  </>
                )}
              </div>
            )}
            <p className="fine">Prompts are sent to the AI model to produce an answer. Nothing is stored on our server.</p>
          </div>

          {current && (missing.length > 0 || ignored.length > 0) && (
            <div className="panel glass">
              <div className="panel-head">
                <h3>What the prompt left out</h3>
                <span className="tag">from the failed checks, no AI</span>
              </div>
              {missing.length > 0 && !hintsVisible && (
                <>
                  <p className="lede">
                    {missing.length} requirement{missing.length === 1 ? " was" : "s were"} never mentioned in your prompt.
                    Look at the scenario card again before you reveal {missing.length === 1 ? "it" : "them"}.
                  </p>
                  <button className="btn small" onClick={() => setHintsOpen((h) => ({ ...h, [key]: true }))}>
                    Show what I missed
                  </button>
                </>
              )}
              {missing.length > 0 && hintsVisible && (
                <>
                  <p className="lede">Click a missing detail to add it to your prompt, then run again.</p>
                  <div className="ghost-chips">
                    {missing.map((ghost) => {
                      const used = prompt.includes(ghost.clause);
                      return (
                        <button key={ghost.checkId} className={`ghost-chip${used ? " used" : ""}`} onClick={() => addGhost(ghost.clause)} disabled={used}>
                          <span aria-hidden="true">{used ? "✓" : "+"}</span> {ghost.clause}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {ignored.length > 0 && (
                <p className="fine">
                  Your prompt already seems to ask for this, yet the answer missed it: {ignored.map((g) => g.clause).join(" ")}{" "}
                  Try stating it more directly.
                </p>
              )}
            </div>
          )}
          {current && busy !== "run" && (
            <div className="panel glass">
              <div className="panel-head">
                <h3>AI answer</h3>
                <span className="tag">
                  {current.run.mock ? "offline mock model" : current.run.model}, {(current.run.ms / 1000).toFixed(1)}s
                </span>
              </div>
              <pre className="answer">{current.run.output}</pre>
            </div>
          )}
        </div>

        <div className="col results" aria-live="polite">
          {busy === "run" && (
            <div className="panel glass analyzing">
              <div className="scanline" aria-hidden="true" />
              <p>PromptProof is analyzing your instructions.</p>
            </div>
          )}

          {!current && busy !== "run" && (
            <div className="panel glass empty">
              <h3>Nothing measured yet</h3>
              <p>
                Run a prompt. You get the AI answer, a score from fixed rules, and an X-ray showing which parts of your
                prompt changed that score.
              </p>
            </div>
          )}

          {current && busy !== "run" && (
            <>
              {current.recordedAt && (
                <div className="notice recorded" role="status">
                  Recorded run from {new Date(current.recordedAt).toLocaleString()}. The live model did not respond, so
                  this is an earlier result saved on this device.
                </div>
              )}
              <Score attempt={current} previous={previous} />
              <Xray attempt={current} busy={busy} stale={stale} showGhosts={!!hintsVisible} onRetry={() => runXray(key, current)} />
              {previous && <Compare before={previous} after={current} />}
              {history.length > 2 && (
                <p className="attempts">
                  {history.map((a, i) => (
                    <span key={a.id}>
                      Attempt {i + 1}: {a.run.score}/{a.run.total}
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
