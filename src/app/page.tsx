"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_NAME, TAGLINE } from "@/lib/brand";
import type { AblationLabel, AblationResult, ApiError, PublicTask, RunResult, XrayResult } from "@/lib/types";

interface Attempt {
  run: RunResult;
  xray: XrayResult | null;
  xrayError: string | null;
}

interface TaskData {
  tasks: PublicTask[];
  model: string;
  mock: boolean;
}

const LABEL_TEXT: Record<AblationLabel, string> = {
  helpful: "Helped",
  no_measured_effect: "No measured effect",
  possibly_harmful: "Possibly harmful",
  uncertain: "Uncertain",
};

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

function describeEffect(ablation: AblationResult, xray: XrayResult, run: RunResult): string {
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

export default function Home() {
  const [data, setData] = useState<TaskData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string>("");
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [attempts, setAttempts] = useState<Record<string, Attempt[]>>({});
  const [busy, setBusy] = useState<"idle" | "run" | "xray">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tasks")
      .then((res) => res.json())
      .then((loaded: TaskData) => {
        setData(loaded);
        setTaskId(loaded.tasks[0]?.id ?? "");
      })
      .catch(() => setLoadError("Could not load the tasks. Refresh the page."));
  }, []);

  const task = useMemo(() => data?.tasks.find((t) => t.id === taskId), [data, taskId]);
  const prompt = prompts[taskId] ?? "";
  const history = attempts[taskId] ?? [];
  const current = history[history.length - 1];
  const previous = history[history.length - 2];

  const setPrompt = (value: string) => setPrompts((p) => ({ ...p, [taskId]: value }));

  const updateLastAttempt = useCallback((id: string, patch: Partial<Attempt>) => {
    setAttempts((all) => {
      const list = all[id] ?? [];
      if (list.length === 0) return all;
      return { ...all, [id]: [...list.slice(0, -1), { ...list[list.length - 1], ...patch }] };
    });
  }, []);

  const runXray = useCallback(
    async (id: string, text: string) => {
      setBusy("xray");
      try {
        const xray = await postJson<XrayResult>("/api/xray", { taskId: id, prompt: text });
        updateLastAttempt(id, { xray, xrayError: null });
      } catch (err) {
        updateLastAttempt(id, { xrayError: err instanceof Error ? err.message : "The X-ray failed." });
      } finally {
        setBusy("idle");
      }
    },
    [updateLastAttempt],
  );

  const run = async () => {
    if (!task || busy !== "idle") return;
    setError(null);
    setBusy("run");
    try {
      const result = await postJson<RunResult>("/api/run", { taskId, prompt });
      setAttempts((all) => ({
        ...all,
        [taskId]: [...(all[taskId] ?? []), { run: result, xray: null, xrayError: null }],
      }));
      if (result.chunks.length > 1) {
        await runXray(taskId, prompt);
      } else {
        setBusy("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setBusy("idle");
    }
  };

  const addGhost = (clause: string) => {
    if (prompt.includes(clause)) return;
    setPrompt(`${prompt.trim()} ${clause}`.trim());
  };

  if (loadError) {
    return (
      <main>
        <div className="error">{loadError}</div>
      </main>
    );
  }
  if (!data || !task) {
    return (
      <main>
        <p>
          <span className="spinner" />
          Loading tasks
        </p>
      </main>
    );
  }

  const labelFor = (index: number): AblationLabel | null =>
    current?.xray?.ablations.find((a) => a.chunkIndex === index)?.label ?? null;
  const frictionChunks = new Set((current?.run.friction ?? []).map((f) => f.chunkIndex));
  const missingGhosts = (current?.run.ghosts ?? []).filter((g) => !g.alreadyInPrompt);
  const ignoredGhosts = (current?.run.ghosts ?? []).filter((g) => g.alreadyInPrompt);
  const promptChanged = current ? current.run.prompt !== prompt : false;

  return (
    <main>
      <header className="top">
        <div>
          <h1>{APP_NAME}</h1>
          <p className="tagline">{TAGLINE}</p>
        </div>
        <span className={`badge${data.mock ? " warn" : ""}`}>
          {data.mock ? "Offline mock model. Add an API key for real AI answers." : `Model: ${data.model}`}
        </span>
      </header>

      <div className="tabs" role="tablist" aria-label="Tasks">
        {data.tasks.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={t.id === taskId}
            onClick={() => {
              setTaskId(t.id);
              setError(null);
            }}
          >
            <strong>{t.title}</strong>
            <span>{t.blurb}</span>
          </button>
        ))}
      </div>

      <div className="grid">
        <section>
          <div className="panel card">
            <h2>Your situation</h2>
            <ul>
              {task.situationCard.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="hint">Only you can see this card. The AI gets your prompt and nothing else from it.</p>
            {task.sourceMaterial && (
              <details>
                <summary>Material the AI receives with your prompt</summary>
                <pre>{task.sourceMaterial}</pre>
              </details>
            )}
          </div>

          <div className="panel">
            <h2>Your prompt</h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Write what you would type into an AI assistant to get this done."
              maxLength={2000}
              aria-label="Your prompt"
            />
            <div className="row">
              <span className="hint">
                Scored against {task.checkCount} hidden requirements. {prompt.length}/2000
              </span>
              <button className="primary" onClick={run} disabled={busy !== "idle" || prompt.trim().length === 0}>
                {busy === "run" ? "Running" : current ? "Run again" : "Run"}
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <p className="hint">Prompts are sent to the AI model to produce an answer. Nothing is stored.</p>
          </div>

          {current && (missingGhosts.length > 0 || ignoredGhosts.length > 0) && (
            <div className="panel">
              <h2>What you left out</h2>
              {missingGhosts.length > 0 && (
                <>
                  <p className="hint">
                    These come from the task requirements your output missed. Click to add one to your prompt.
                  </p>
                  <div className="chips">
                    {missingGhosts.map((g) => (
                      <button
                        key={g.checkId}
                        className="chip"
                        onClick={() => addGhost(g.clause)}
                        disabled={prompt.includes(g.clause)}
                      >
                        + {g.clause}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {ignoredGhosts.length > 0 && (
                <p className="hint">
                  Your prompt seems to ask for this already, but the answer still missed it:{" "}
                  {ignoredGhosts.map((g) => g.clause).join(" ")} Try stating it more directly.
                </p>
              )}
            </div>
          )}
        </section>

        <section aria-live="polite">
          {!current && (
            <div className="panel">
              <h2>Result</h2>
              <p className="hint">
                Run a prompt to see the AI answer, an objective score, and an X-ray of which parts of your prompt
                changed the result.
              </p>
            </div>
          )}

          {current && (
            <>
              <div className="panel">
                <h2>Objective checks</h2>
                <div className="score">
                  <span className="big">
                    {current.run.score} / {current.run.total}
                  </span>
                  {previous && (
                    <span className="was">
                      previous attempt {previous.run.score} / {previous.run.total}
                      {current.run.score > previous.run.score && (
                        <span className="up"> (up {current.run.score - previous.run.score})</span>
                      )}
                    </span>
                  )}
                </div>
                <ul className="checks">
                  {current.run.checks.map((c) => (
                    <li key={c.id} className={c.pass ? "pass" : "fail"}>
                      <span className="mark" aria-hidden="true">
                        {c.pass ? "✓" : "✗"}
                      </span>
                      <span>
                        {c.label}
                        <small>
                          {c.pass ? "Passed" : "Missed"}: {c.detail}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="hint">Each check is a fixed rule applied to the answer. No AI judges the score.</p>
                {history.length > 1 && (
                  <div className="attempts">
                    {history.map((a, i) => (
                      <span className="attempt" key={i}>
                        Attempt {i + 1}: {a.run.score}/{a.run.total}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel">
                <h2>Prompt X-ray</h2>
                {promptChanged && <p className="hint">This X-ray is for the prompt you last ran, not your edits.</p>}
                <div className="xray">
                  {current.run.chunks.map((chunk) => {
                    const label = labelFor(chunk.index);
                    const cls = `chunk ${label ?? "pending"}${frictionChunks.has(chunk.index) ? " friction" : ""}`;
                    return (
                      <span key={chunk.index} className={cls} title={label ? LABEL_TEXT[label] : "Not measured"}>
                        {chunk.text}
                      </span>
                    );
                  })}
                  {missingGhosts.map((g) => (
                    <span key={g.checkId} className="ghost">
                      {" "}
                      {g.clause}
                    </span>
                  ))}
                </div>

                {busy === "xray" && (
                  <p className="hint">
                    <span className="spinner" />
                    Removing one part at a time and rerunning the task
                  </p>
                )}
                {current.xrayError && (
                  <div className="error" role="alert">
                    {current.xrayError}{" "}
                    <button className="link" onClick={() => runXray(taskId, current.run.prompt)}>
                      Retry X-ray
                    </button>
                  </div>
                )}
                {current.run.chunks.length <= 1 && (
                  <p className="hint">This prompt has a single instruction, so there is nothing to remove and compare.</p>
                )}

                <div className="legend">
                  <span>
                    <i style={{ background: "var(--green-bg)" }} />
                    Helped
                  </span>
                  <span>
                    <i style={{ background: "var(--grey-bg)" }} />
                    No measured effect
                  </span>
                  <span>
                    <i style={{ background: "var(--red-bg)" }} />
                    Possibly harmful
                  </span>
                  <span>
                    <i style={{ background: "var(--orange)" }} />
                    Pattern warning (underline)
                  </span>
                  <span className="ghost">Missing detail</span>
                </div>

                {current.xray && current.xray.ablations.length > 0 && (
                  <>
                    <table className="effects">
                      <thead>
                        <tr>
                          <th>Part of your prompt</th>
                          <th>Measured effect</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.xray.ablations.map((a) => (
                          <tr key={a.chunkIndex}>
                            <td>{a.text}</td>
                            <td>
                              <strong>{LABEL_TEXT[a.label]}.</strong> {describeEffect(a, current.xray!, current.run)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="hint">
                      Measured on this task with {current.xray.runsPerChunk} run
                      {current.xray.runsPerChunk === 1 ? "" : "s"} per part ({current.xray.modelCalls} model calls,{" "}
                      {(current.xray.ms / 1000).toFixed(1)}s). AI answers vary, so treat this as an observation, not a
                      rule.
                    </p>
                  </>
                )}
              </div>

              {current.run.friction.length > 0 && (
                <div className="panel">
                  <h2>Pattern warnings</h2>
                  <p className="hint">
                    Detected by wording rules. This is a possible risk, not a measurement. The measured effect is shown
                    beside each one.
                  </p>
                  {current.run.friction.map((f, i) => {
                    const label = f.chunkIndex === null ? null : labelFor(f.chunkIndex);
                    return (
                      <div className="finding" key={`${f.category}-${i}`}>
                        <span className="cat">{f.categoryLabel}:</span> <q>{f.phrase}</q>
                        <p>{f.explanation}</p>
                        <p>
                          <strong>Try:</strong> {f.suggestion}
                        </p>
                        <p>
                          <strong>Measured effect of that part:</strong>{" "}
                          {label ? LABEL_TEXT[label] : "not measured yet"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="panel">
                <h2>AI answer</h2>
                <pre>{current.run.output}</pre>
                <p className="hint">
                  {current.run.mock ? "Produced by the offline mock model" : `Produced by ${current.run.model}`} in{" "}
                  {(current.run.ms / 1000).toFixed(1)}s.
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
