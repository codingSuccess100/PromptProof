import { NextResponse } from "next/server";
import { validatePrompt, xrayTask } from "@/lib/engine";
import { allowRequest } from "@/lib/ratelimit";
import { resolveTask } from "@/lib/custom";
import type { ApiError, XrayResult } from "@/lib/types";

export const dynamic = "force-dynamic";
// The X-ray makes several model calls. Give it room on serverless hosts.
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse<XrayResult | ApiError>> {
  if (!allowRequest(request, "xray", 60)) {
    return NextResponse.json({ error: "Too many requests from this device. Wait a few minutes and try again." }, { status: 429 });
  }

  let body: { taskId?: unknown; prompt?: unknown; custom?: unknown; runs?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const resolved = resolveTask(body.taskId, body.custom);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const { task } = resolved;

  const problem = validatePrompt(body.prompt);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const requested = Math.floor(Number(body.runs));
  const runs = Number.isFinite(requested) && requested >= 1 ? Math.min(3, requested) : undefined;

  try {
    return NextResponse.json(await xrayTask(task, body.prompt as string, runs ? { runs } : {}));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `The X-ray could not finish (${reason}). Try again.` }, { status: 502 });
  }
}
