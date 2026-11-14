# Demo script (about 2 minutes 50 seconds)

Roles: one person talks, one person drives. Do not switch mid-demo.
Before you start: open `/workspace`, click "Clear session", and have the backup recording in a second tab.
Nothing here is scripted to fail or to succeed. Say what actually appears on screen. Rehearse on the live site first, because the wording of live answers differs from the offline mock.

## 0:00 to 0:20  The problem

"You ask an AI for something, the answer is off, and you rewrite the prompt by guesswork. You never find out what the problem was or whether your change helped. PromptProof turns a rough prompt into a tested one."

## 0:20 to 1:00  A perfect score that is wrong

Stay on "Try an example". Read the goal aloud: a summary of customer feedback for the CFO.

Paste: `Write to our billing vendor asking them to refund the $1,200 from last month by Friday. Lead with the billing errors. One plain paragraph, no bullet points, under 60 words.` Click Run.

"Every rule-based check can pass here. Word limit, the refund figure, the deadline. And the answer is wrong: it is a message to the vendor, and the goal was a summary for the CFO. A checklist alone would have told me I was done."

Point at the goal review, then at "What to change".

"A separate goal review, labeled as model-assisted, flags the mismatch. It does not change the check results. It sits next to them."

## 1:00 to 1:40  One proposed prompt, tested

Point at the proposed prompt.

"I get one complete revised prompt, marked as a proposal that has not been tested. It tells me what changed. It also checked my original for amounts and dates, and kept the $1,200 and Friday. If it had added a detail I never gave, I would see a placeholder, not an invented fact. I can edit it."

Click "Test revised prompt".

"Same goal, same checks, same model settings. Both prompts, both answers, check by check."

If a check regressed, say so. A trade or no improvement is a legitimate result.

## 1:40 to 2:25  Your own prompt, without building a rubric

Click "Use my own prompt". Prompt: `i want to study for calc 3 midterm`. Goal: `I want a full study guide with dates on what to do each day.` Click "Review proposed evaluation".

"It read my prompt, so it does not ask me what kind of subject calculus is. It asks for the exam date, with a date field. I can skip it, and then I get an undated Day 1, Day 2 plan. It will not make up an exam date. My answers are stored as details. They are not pasted into my goal."

Click Run.

"There are no rule-based checks here, so there is no score. It does not invent a number. It shows me what the AI actually received, which was only my one-line prompt, and proposes a prompt that carries my goal into it."

## 2:25 to 2:50  Honesty and close

"Rule-based checks are repeatable, not complete. The goal review can be wrong and says so. A cut-off answer is marked incomplete and not judged. Comparisons only happen under identical criteria. We adapted ablation analysis and evaluation practice into something a non-engineer can use. PromptProof."

## Optional, if asked

- X-ray: "It removes each instruction in turn and reruns three times. It leads with one finding, and every run is inspectable. It is a diagnostic, not a list of deletions. The instruction that states the task is never offered for deletion."
- Helper: "Up to three revisions. It keeps one on its own only if a rule-based check improves and none gets worse. If only the review changed, it shows me the candidate and I decide."

## If something breaks

- Model failing: the error offers "Show the last saved result from this device". It is labeled as recorded. Say so out loud.
- Open `/api/health` to see why the model is unreachable.
- Never present the offline mock as a real model. The page labels it.

## Likely judge questions

- "Isn't the goal review just another AI opinion?" Yes, and it is labeled that way. It is kept apart from the rule-based checks, its quotes are verified against the actual text, and it never changes a score.
- "Does a wording check prove the answer is right?" No. It shows the wording appears. The app states its matching policy next to the check and asks once whether I meant the wording or the topic.
- "Could the revision invent things or drop my constraints?" Amounts, dates, and identifiers from my prompt are restored if dropped, and unsupported ones become a visible placeholder. That guard covers those detail types, not every possible change of meaning, which is why the proposal is editable and labeled untested.
- "Is three runs enough?" It is three observations. The app reports counts, not confidence.
- "Does this exist already?" Prompt evaluation and ablation tools exist for developers. This is built for people who are not prompt engineers.

## User testing protocol

Ask someone to complete one task with no explanation. Note where they hesitate, whether the questions in "Review proposed evaluation" made sense, whether the proposed prompt helped, and whether they can say in their own words what the comparison showed. Record the number of people and what happened. Do not round up.
