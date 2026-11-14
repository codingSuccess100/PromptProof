# Demo script (about 2 minutes 50 seconds)

Roles: one person talks, one person drives. Do not switch mid-demo.
Before you start: open `/workspace`, click "Clear session", and have the backup recording in a second tab.
Nothing here is scripted to fail or to succeed. Say what actually appears on screen.

## 0:00 to 0:20  The problem

"You ask an AI for something, the answer is off, and you rewrite the prompt by guesswork. You never find out what the problem was or whether your change helped. PromptProof turns a rough prompt into a tested one."

## 0:20 to 1:05  A perfect score that is wrong

Stay on "Try an example". Read the goal aloud: a summary of customer feedback for the CFO.

Paste: `Write to our billing vendor asking them to refund the $1,200 from last month by Friday. Lead with the billing errors. One plain paragraph, no bullet points, under 60 words.` Click Run.

"Every rule-based check passes. Word limit, the refund figure, the deadline. And the answer is wrong: it is a message to the vendor, and the goal was a summary for the CFO. This is why a checklist is not enough."

Point at the goal review.

"A separate goal review, clearly labeled as model-assisted, flags a possible task mismatch and quotes the words in my prompt that caused it. It does not change the check results. It sits next to them."

## 1:05 to 1:45  A specific revision, tested

Click "Replace my opening sentence", then "Test revision".

"It did not rewrite my prompt for me. It proposed one edit, marked it untested, and I applied it. Now the comparison: same goal, same checks. Prompt changes here, answer changes here."

If checks regressed, say so: "Two checks regressed because that sentence carried the refund figure and the deadline. It tells me exactly which, with the edit to restore each. No improvement, or a trade, is a legitimate result."

## 1:45 to 2:25  Your own prompt, without building a rubric

Click "Use my own prompt". Type a prompt and a goal such as `A comprehensive study plan for my calculus midterm`. Click "Review proposed evaluation".

"I did not have to become an evaluation engineer. 'Comprehensive' cannot be checked by a rule, so it asks me what I mean, and offers options. If I add a word limit, it proposes that as a check and leaves the rest to the goal review. Nothing is used until I accept it. If I accept nothing, the answer is simply unscored. It does not invent a number."

## 2:25 to 2:50  Honesty and close

"Rule-based checks are repeatable, not complete. The goal review can be wrong and says so. Comparisons only happen under identical criteria. We adapted ablation analysis and evaluation practice into something a non-engineer can use. PromptProof."

## Optional, if asked

- X-ray: "It removes each instruction in turn and reruns, and reports per check what changed. A diagnostic, not a list of deletions."
- Improve and test: "Up to three single edits. It keeps one only if a check improves, none regresses, and the review sees no drift. It will not force an odd exact phrase into my prompt to pass a check. It stops and asks."

## If something breaks

- Model failing: the error offers "Show the last saved result from this device". It is labeled as recorded. Say so out loud.
- Open `/api/health` to see why the model is unreachable.
- Never present the offline mock as a real model. The page labels it.

## Likely judge questions

- "Isn't the goal review just another AI opinion?" Yes, and it is labeled that way. It is kept apart from the rule-based checks, its quotes are verified against the actual text, and it never changes a score.
- "Does an exact-text check prove the answer is right?" No. It shows the text appears. The app says that next to the check, and asks before treating an odd spelling as required.
- "Could the helper game the checks?" It cannot change them. It blocks edits that drop most of the prompt or add a number, date, or name I did not supply, and it shows every rejected attempt.
- "Is three runs enough?" It is three observations. The app reports counts, not confidence.
- "Does this exist already?" Prompt evaluation and ablation tools exist for developers. This is built for people who are not prompt engineers.

## User testing protocol

Ask someone to complete one task with no explanation. Note where they hesitate, whether "Review proposed evaluation" made sense, whether the suggested edit helped, and whether they can say in their own words what the comparison showed. Record the number of people and what happened. Do not round up.
