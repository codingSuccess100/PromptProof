import { NextResponse } from "next/server";
import { resolveTask } from "@/lib/custom";
import { validatePrompt } from "@/lib/engine";
import { proposeRevision } from "@/lib/improve";
import { allowRequest } from "@/lib/ratelimit";
import type { ApiError, Proposal } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Reply = { proposal: Proposal | null; needsChoice: string | null; note: string | null };

// One complete candidate prompt for the current result. It is a proposal: nothing is tested here.
export async function POST(request: Request): Promise<NextResponse<Reply | ApiError>> {
  if (!allowRequest(request, "propose", 60)) {
    return NextResponse.json({ error: "Too many requests from this device. Wait a few minutes and try again." }, { status: 429 });
  }
  let body: { taskId?: unknown; prompt?: unknown; custom?: unknown; long?: unknown; output?: unknown; failedCheckIds?: unknown; concerns?: unknown; reviewStatus?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const resolved = resolveTask(body.taskId, body.custom, body.long);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const problem = validatePrompt(body.prompt);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const strings = (value: unknown, max: number) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, max).map((v) => v.slice(0, 400)) : [];
  try {
    const { proposal, needsChoice, note } = await proposeRevision(resolved.task, body.prompt as string, typeof body.output === "string" ? body.output : "", strings(body.failedCheckIds, 12), strings(body.concerns, 4), [], body.reviewStatus !== "aligned");
    return NextResponse.json({ proposal, needsChoice, note });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `A revised prompt could not be proposed (${reason}). Your result above is unaffected.` }, { status: 502 });
  }
}
