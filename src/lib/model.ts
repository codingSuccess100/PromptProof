import { mockGenerate } from "./mock";

// Checked against the Gemini pricing page on Nov 13, 2026. Override with GEMINI_MODEL.
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
import type { Task } from "./types";

// The single place that talks to an AI provider. Server-side only.
// With no GEMINI_API_KEY the app falls back to the labeled offline mock.

export interface ModelReply {
  text: string;
  model: string;
  mock: boolean;
}

const TIMEOUT_MS = 25_000;

export function modelInfo(): { model: string; mock: boolean } {
  const key = process.env.GEMINI_API_KEY;
  return key
    ? { model: process.env.GEMINI_MODEL || DEFAULT_MODEL, mock: false }
    : { model: "offline mock model", mock: true };
}

/** What the model actually receives: the user's prompt, then the task material. Never the situation card. */
export function buildModelInput(task: Task, prompt: string): string {
  return task.sourceMaterial ? `${prompt.trim()}\n\n---\n${task.sourceMaterial}` : prompt.trim();
}

async function callGemini(input: string, key: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const generationConfig: Record<string, unknown> = { temperature: 0, maxOutputTokens: 2048 };
  // Optional: some models think before answering, which adds latency. Set to 0 to turn that off
  // if the chosen model supports it. Leave unset if the API rejects the field.
  if (process.env.GEMINI_THINKING_BUDGET) {
    generationConfig.thinkingConfig = { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET) };
  }

  let lastError = "unknown error";
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: input }] }], generationConfig }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        if (text.trim()) return text.trim();
        lastError = "the model returned an empty answer";
      } else {
        lastError = `model request failed with status ${res.status}`;
        // Retry once on rate limits and server errors only.
        if (res.status !== 429 && res.status < 500) break;
      }
    } catch (err) {
      lastError = err instanceof Error && err.name === "AbortError" ? "the model timed out" : "network error";
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error(lastError);
}

export async function generate(task: Task, prompt: string): Promise<ModelReply> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return { text: mockGenerate(task, prompt), model: "offline mock model", mock: true };
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const text = await callGemini(buildModelInput(task, prompt), key, model);
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
