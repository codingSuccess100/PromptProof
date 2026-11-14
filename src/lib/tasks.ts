import type { PublicTask, Task } from "./types";

// Three hand-written tasks with different instruction patterns:
//   1. summarize for a specific reader   2. compose with facts   3. extract, filter, and format
// Every requirement is checked by a rule, so a score is a fact and not a model's opinion.
// The situation card holds facts the model cannot guess. The user decides what to pass on.

export const TASKS: Task[] = [
  {
    id: "cfo-summary",
    title: "Feedback summary for the CFO",
    blurb: "Summarize customer comments for one specific reader.",
    situationCard: [
      "You are writing for Dana Ruiz, the CFO.",
      "She is about to meet the billing vendor, so lead with the billing errors, not the delivery complaints.",
      "Refunds for billing errors cost $1,200 last month. She will want that number.",
      "She has to decide by Friday.",
      "She reads on her phone: one plain paragraph, under 60 words, no bullet points.",
    ],
    sourceMaterial: [
      "Customer comments from this month:",
      '1. "My order arrived six days late and nobody told me."',
      '2. "Delivery was late again. Third time this year."',
      '3. "I was charged twice for the same order and had to call to fix it."',
      '4. "Support was friendly and fixed my issue in one call."',
      '5. "Package showed up a week after the promised date."',
      '6. "The invoice had the wrong amount on it. Took two emails to correct."',
      '7. "Late delivery ruined a gift I had planned."',
      '8. "Great support team. Quick replies every time."',
    ].join("\n"),
    checks: [
      {
        id: "words",
        label: "60 words or fewer",
        kind: "maxWords",
        value: 60,
        ghostClause: "Keep it under 60 words.",
        promptCue: "\\b(60|sixty)\\s*-?\\s*words?\\b|\\bwords?\\b[^.]*\\b(60|sixty)\\b",
      },
      {
        id: "billing-first",
        label: "Opens with the billing errors",
        kind: "firstSentenceMatches",
        pattern: "billing|invoice|charged|overcharg",
        ghostClause: "Lead with the billing errors.",
        promptCue:
          "(lead|start|open|begin|first)[^.]*\\b(billing|invoice|charg)|\\b(billing|invoice)[^.]*\\b(first|lead|top|start)",
      },
      {
        id: "refund-cost",
        label: "Includes the $1,200 refund cost",
        kind: "matches",
        pattern: "\\$\\s?1,?200",
        ghostClause: "Mention that refunds for billing errors cost $1,200 last month.",
        promptCue: "1,?200",
      },
      {
        id: "plain-paragraph",
        label: "One plain paragraph, no bullets",
        kind: "noListFormatting",
        ghostClause: "Write one plain paragraph with no bullet points.",
        promptCue: "no (bullets?|lists?)|without (bullets?|lists?)|(one|single|plain) paragraph|no formatting",
      },
      {
        id: "friday",
        label: "Mentions the Friday decision deadline",
        kind: "matches",
        pattern: "\\bFriday\\b",
        ghostClause: "Say that a decision is needed by Friday.",
        promptCue: "friday",
      },
    ],
  },
  {
    id: "extension-email",
    title: "Extension email to a professor",
    blurb: "Compose a short message that carries the right facts.",
    situationCard: [
      "Professor Lin teaches your course, CS 320.",
      "Assignment 3 is due Thursday. You need until Monday.",
      "A teammate dropped the course last week.",
      "You are 60% done and can show your progress.",
      "She prefers emails under 80 words that start with a subject line.",
    ],
    sourceMaterial: "",
    checks: [
      {
        id: "course",
        label: "Names the course, CS 320",
        kind: "matches",
        pattern: "CS\\s?320",
        ghostClause: "The course is CS 320.",
        promptCue: "cs\\s?320",
      },
      {
        id: "new-date",
        label: "Asks for the new date, Monday",
        kind: "matches",
        pattern: "\\bMonday\\b",
        ghostClause: "Ask to submit by Monday.",
        promptCue: "monday",
      },
      {
        id: "progress",
        label: "States progress so far, 60%",
        kind: "matches",
        pattern: "60\\s?%|sixty percent|60 percent",
        ghostClause: "Say I am 60% done.",
        promptCue: "60\\s?%|sixty percent|60 percent",
      },
      {
        id: "words",
        label: "80 words or fewer",
        kind: "maxWords",
        value: 80,
        ghostClause: "Keep the email under 80 words.",
        promptCue: "\\b(80|eighty)\\s*-?\\s*words?\\b|\\bwords?\\b[^.]*\\b(80|eighty)\\b",
      },
      {
        id: "subject",
        label: "Starts with a subject line",
        kind: "startsWith",
        pattern: "^\\W*subject\\W*:",
        ghostClause: "Start with a subject line.",
        promptCue: "subject line|subject:",
      },
    ],
  },
  {
    id: "action-items",
    title: "Action items for a tracker",
    blurb: "Pull the right items out of messy notes, in an exact format.",
    situationCard: [
      "You manage Priya and only want her action items.",
      "Marcus and Dana report to someone else, so leave their names out.",
      "Today is November 14, 2026. Anything past due should be marked with the word OVERDUE.",
      "You will paste this into a tracker: a numbered list and nothing else, no intro or closing line.",
      "The tracker needs each due date written as YYYY-MM-DD.",
    ],
    sourceMaterial: [
      "Team sync notes, Nov 12",
      "- Priya to send the budget draft to finance. Was due Nov 10.",
      "- Marcus will book the venue for the offsite by Nov 21.",
      "- Priya: update the hiring plan, due Nov 18.",
      "- Dana to renew the software licenses before Nov 25.",
      "- Marcus owes legal the signed vendor contract, Nov 19.",
      "- Priya will schedule customer interviews by Nov 22.",
      "Misc: parking passes arrive next week.",
    ].join("\n"),
    checks: [
      {
        id: "three-numbered",
        label: "Exactly 3 numbered items",
        kind: "numberedItemsExactly",
        value: 3,
        ghostClause: "Use a numbered list.",
        promptCue: "numbered|number(ed)? list|enumerat",
      },
      {
        id: "only-priya",
        label: "Leaves out Marcus and Dana",
        kind: "notMatches",
        pattern: "\\b(Marcus|Dana)\\b",
        ghostClause: "Include only Priya's action items.",
        promptCue: "only[^.]*priya|priya'?s|just priya|priya only",
      },
      {
        id: "list-only",
        label: "Nothing but the list",
        kind: "onlyNumberedLines",
        ghostClause: "Output the list and nothing else, with no intro or closing line.",
        promptCue: "nothing else|no intro|only the list|no (preamble|commentary|extra)|just the list",
      },
      {
        id: "overdue",
        label: "Marks the past-due item with OVERDUE",
        kind: "matches",
        pattern: "OVERDUE",
        flags: "",
        ghostClause: "Today is November 14, 2026. Mark anything past due with the word OVERDUE.",
        promptCue: "overdue",
      },
      {
        id: "iso-dates",
        label: "Due dates written as YYYY-MM-DD",
        kind: "minMatches",
        pattern: "2026-11-\\d{2}",
        value: 3,
        ghostClause: "Write each due date as YYYY-MM-DD.",
        promptCue: "yyyy-mm-dd|iso (date|format)|\\d{4}-\\d{2}-\\d{2}",
      },
    ],
  },
];

export function getTask(id: string): Task | undefined {
  return TASKS.find((t) => t.id === id);
}

export function toPublicTask(task: Task): PublicTask {
  return {
    id: task.id,
    title: task.title,
    blurb: task.blurb,
    situationCard: task.situationCard,
    sourceMaterial: task.sourceMaterial,
    checkCount: task.checks.length,
  };
}
