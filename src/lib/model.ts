import { mockGenerate } from "./mock";
import type { Task } from "./types";

// The single place that talks to an AI provider. Server-side only.
// With no OPENAI_API_KEY the app falls back to the labeled offline mock.
// The key is read from the environment, sent only in the Authorization header,
// and never logged or returned.

// Checked against the OpenAI pricing and model pages on Nov 13, 2026:
// the lowest-cost current-generation model, rated "Fast", and it allows reasoning to be turned off.
// Override with OPENAI_MODEL.
export const DEFAULT_MODEL = "gpt-6-luna";
export const FALLBACK_MODELS = ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-nano", "gpt-5-nano"];

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 25_000;
const MAX_OUTPUT_TOKENS = 1024;

export interface ModelReply {
  text: string;
  model: string;
  mock: boolean;
}

export interface RawReply {
  status: number; // HTTP status, or 0 for a network error or timeout
  text: string;
  ms: number;
  note: string; // short, safe description of what went wrong (never contains the key)
}

export function configuredModel(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function modelInfo(): { model: string; mock: boolean } {
  return process.env.OPENAI_API_KEY
    ? { model: configuredModel(), mock: false }
    : { model: "offline mock model", mock: true };
}

/** What the model actually receives: the user's prompt, then the task material. Never the situation card. */
export function buildModelInput(task: Task, prompt: string): string {
  return task.sourceMaterial ? `${prompt.trim()}\n\n---\n${task.sourceMaterial}` : prompt.trim();
}

// Some models reject optional settings (for example temperature while reasoning is on).
// When the API says so, we drop that setting for the model and remember it.
const unsupported = new Map<string, Set<string>>();

function requestBody(model: string, input: string): Record<string, unknown> {
  const skip = unsupported.get(model) ?? new Set<string>();
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: input }],
    max_completion_tokens: MAX_OUTPUT_TOKENS,
  };
  // No reasoning step: faster, cheaper, and it lets us set temperature to 0 for repeatable answers.
  if (!skip.has("reasoning_effort")) body.reasoning_effort = process.env.OPENAI_REASONING_EFFORT || "none";
  if (!skip.has("temperature")) body.temperature = 0;
  return body;
}

function safeNote(status: number, code: string, message: string): string {
  if (status === 401) return "the API key was rejected";
  if (code === "insufficient_quota") return "the OpenAI account has no credit (add billing credit)";
  if (status === 429) return "rate limited";
  if (status === 404 || code === "model_not_found") return "model not found or not available to this key";
  // Strip anything that looks like a key before keeping a short excerpt.
  return `${code || `status ${status}`}: ${message.replace(/sk-[A-Za-z0-9_\-*]+/g, "[key]").slice(0, 140)}`;
}

/** One request, no retry on failure. Exposed so the benchmark can see statuses and timings. */
export async function rawCall(input: string, key: string, model: string): Promise<RawReply> {
  const started = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(requestBody(model, input)),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string | null }; finish_reason?: string }[];
        error?: { message?: string; code?: string; param?: string };
      };
      if (res.ok) {
        const text = (data.choices?.[0]?.message?.content ?? "").trim();
        const note = text ? "" : `empty answer (finish reason: ${data.choices?.[0]?.finish_reason ?? "unknown"})`;
        return { status: res.status, text, ms: Date.now() - started, note };
      }
      const message = data.error?.message ?? "";
      const param = data.error?.param ?? "";
      // Adapt once per optional setting the model does not accept, then try again.
      if (res.status === 400) {
        const skip = unsupported.get(model) ?? new Set<string>();
        const bad = ["temperature", "reasoning_effort"].find(
          (name) => !skip.has(name) && (param === name || message.includes(name)),
        );
        if (bad) {
          skip.add(bad);
          unsupported.set(model, skip);
          continue;
        }
      }
      return { status: res.status, text: "", ms: Date.now() - started, note: safeNote(res.status, data.error?.code ?? "", message) };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      return { status: 0, text: "", ms: Date.now() - started, note: timedOut ? "the model timed out" : "network error" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 400, text: "", ms: Date.now() - started, note: "the model rejected the request settings" };
}

/** Which optional settings were dropped for a model, for the benchmark report. */
export function droppedSettings(model: string): string[] {
  return [...(unsupported.get(model) ?? [])];
}

async function callOpenAI(input: string, key: string, model: string): Promise<string> {
  let last: RawReply | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await rawCall(input, key, model);
    if (last.status === 200 && last.text) return last.text;
    // Retry once on rate limits, server errors, timeouts, and empty answers only.
    const retryable = last.status === 429 || last.status >= 500 || last.status === 0 || last.status === 200;
    if (!retryable || last.note.includes("no credit")) break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error(last?.note || "unknown error");
}

export async function generate(task: Task, prompt: string): Promise<ModelReply> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { text: mockGenerate(task, prompt), model: "offline mock model", mock: true };
  }
  const model = configuredModel();
  const text = await callOpenAI(buildModelInput(task, prompt), key, model);
  return { text, model, mock: false };
}

/** Runs async jobs with a cap on how many are in flight at once. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
