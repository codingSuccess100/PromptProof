import { NextResponse } from "next/server";
import { validatePrompt, xrayTask } from "@/lib/engine";
import { allowRequest } from "@/lib/ratelimit";
import { getTask } from "@/lib/tasks";
import type { ApiError, XrayResult } from "@/lib/types";

export const dynamic = "force-dynamic";
// The X-ray makes several model calls. Give it room on serverless hosts.
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse<XrayResult | ApiError>> {
  if (!allowRequest(request, "xray", 12)) {
    return NextResponse.json({ error: "Too many requests from this device. Wait a few minutes and try again." }, { status: 429 });
  }

  let body: { taskId?: unknown; prompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const task = typeof body.taskId === "string" ? getTask(body.taskId) : undefined;
  if (!task) return NextResponse.json({ error: "Unknown task." }, { status: 404 });

  const problem = validatePrompt(body.prompt);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    return NextResponse.json(await xrayTask(task, body.prompt as string));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `The X-ray could not finish (${reason}). Try again.` }, { status: 502 });
  }
}
