import { NextResponse } from "next/server";
import { modelInfo } from "@/lib/model";
import { TASKS, toPublicTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";

// Public task data only. The hidden checklist stays on the server until a run is scored.
export function GET() {
  return NextResponse.json({ tasks: TASKS.map(toPublicTask), ...modelInfo() });
}
