import { promptMentions } from "./ghost";
import type { Task } from "./types";

// Offline mock model. It is used only when no API key is configured, and the UI labels it.
// It behaves like a literal-minded assistant: it follows an instruction only if the prompt
// contains it, and otherwise falls back to a generic default. That makes the whole loop
// (run, score, X-ray, ghosts, rerun) testable without a network or a key.
// It is NOT evidence about how a real model behaves.

function asked(task: Task, checkId: string, prompt: string): boolean {
  const spec = task.checks.find((c) => c.id === checkId);
  return spec ? promptMentions(spec.promptCue, prompt) : false;
}

function cfoSummary(task: Task, prompt: string): string {
  const short = asked(task, "words", prompt);
  const billingFirst = asked(task, "billing-first", prompt);
  const refund = asked(task, "refund-cost", prompt);
  const plain = asked(task, "plain-paragraph", prompt);
  const friday = asked(task, "friday", prompt);

  const billing =
    "Two of eight customers reported billing errors, including a double charge and a wrong invoice amount." +
    (refund ? " Refunds for these errors cost $1,200 last month." : "");
  const delivery = "Four customers reported late deliveries, some by a week.";
  const support = "Two praised support.";
  const points = billingFirst ? [billing, delivery, support] : [delivery, billing, support];
  if (friday) points.push("A decision is needed by Friday.");
  if (!short) {
    points.push(
      "Overall, the feedback points to operational issues that deserve a closer look, since they affect customer trust, repeat purchases, and the workload of the support team that has to resolve every single case.",
    );
  }

  if (plain) return points.join(" ");
  return ["Here is a summary of the customer feedback:", "", ...points.map((p) => `- ${p}`)].join("\n");
}

function extensionEmail(task: Task, prompt: string): string {
  const course = asked(task, "course", prompt);
  const monday = asked(task, "new-date", prompt);
  const progress = asked(task, "progress", prompt);
  const short = asked(task, "words", prompt);
  const subject = asked(task, "subject", prompt);

  const what = course ? "CS 320 Assignment 3" : "the upcoming assignment";
  const lines: string[] = [];
  if (subject) lines.push(`Subject: Extension request for ${what}`, "");
  lines.push("Dear Professor,", "");
  let body = `I am writing to ask for an extension on ${what}.`;
  body += monday ? " Could I submit it by Monday?" : " Could I have a few extra days?";
  if (progress) body += " I am 60% done and can share my progress.";
  if (!short) {
    body +=
      " I hope this message finds you well. Due to unforeseen circumstances I have fallen behind, and I would be very grateful for some additional time so that I can complete the work to the standard it deserves. I understand that deadlines matter and I apologize sincerely for any inconvenience this request may cause you. Please let me know whether this would be possible.";
  }
  lines.push(body, "", "Thank you,", "[Your Name]");
  return lines.join("\n");
}

function actionItems(task: Task, prompt: string): string {
  const numbered = asked(task, "three-numbered", prompt);
  const onlyPriya = asked(task, "only-priya", prompt);
  const listOnly = asked(task, "list-only", prompt);
  const overdue = asked(task, "overdue", prompt);
  const iso = asked(task, "iso-dates", prompt);

  const items = [
    { owner: "Priya", text: "send the budget draft to finance", day: 10, late: true },
    { owner: "Marcus", text: "book the venue for the offsite", day: 21, late: false },
    { owner: "Priya", text: "update the hiring plan", day: 18, late: false },
    { owner: "Dana", text: "renew the software licenses", day: 25, late: false },
    { owner: "Marcus", text: "send legal the signed vendor contract", day: 19, late: false },
    { owner: "Priya", text: "schedule customer interviews", day: 22, late: false },
  ].filter((item) => !onlyPriya || item.owner === "Priya");

  const lines = items.map((item, i) => {
    const date = iso ? `2026-11-${String(item.day).padStart(2, "0")}` : `Nov ${item.day}`;
    const who = onlyPriya ? "" : `${item.owner}: `;
    const text = who ? item.text : item.text.charAt(0).toUpperCase() + item.text.slice(1);
    const flag = overdue && item.late ? " OVERDUE" : "";
    const marker = numbered ? `${i + 1}.` : "-";
    return `${marker} ${who}${text} (due ${date})${flag}`;
  });

  if (listOnly) return lines.join("\n");
  return ["Here are the action items from the meeting:", "", ...lines, "", "Let me know if you need anything else."].join(
    "\n",
  );
}

export function mockGenerate(task: Task, prompt: string): string {
  switch (task.id) {
    case "cfo-summary":
      return cfoSummary(task, prompt);
    case "extension-email":
      return extensionEmail(task, prompt);
    case "action-items":
      return actionItems(task, prompt);
    default:
      return "This task has no offline mock. Add an API key to run it.";
  }
}
