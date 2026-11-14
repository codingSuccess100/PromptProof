# Demo script (about 2 minutes 40 seconds)

Roles: one person talks, one person drives. Do not switch mid-demo.
Before you start: Task 1 open, prompt box empty, a second tab with the backup recording.

## 0:00 to 0:25  The problem

"Everyone here wrote prompts this weekend. Almost nobody can say which words in them actually did anything. We copy phrases like 'you are an expert' because they feel right. Research from Wharton found expert personas do not reliably improve accuracy. So how would you know?"

## 0:25 to 0:50  The setup

"This is PromptProof. Here is a real task: summarize customer feedback for a CFO. This card is what I know and the AI does not. She cares about billing errors, refunds cost $1,200, and she decides by Friday."

Type the weak prompt: `Summarize this feedback.` Click Run.

"Zero to two out of five. These are fixed rules, not an AI grading itself."

## 0:50 to 1:50  The proof moment

Paste: `You are an expert analyst. Summarize this feedback for our CFO under 60 words, put billing errors first, mention the $1,200 refund cost.` Click Run.

"Better. Now the X-ray. PromptProof deletes one part of my prompt at a time and reruns the task."

Point at the grey phrase.

"'You are an expert analyst.' Removing it caused no measurable decline on this task. And these green parts: remove 'under 60 words' and that exact check fails. This is measured, not guessed."

Point at the faded text.

"The faded text is what I left out. The Friday deadline."

## 1:50 to 2:15  The fix

Click the ghost chips. Click Run again.

"Five out of five. I did not learn a rule. I ran an experiment on my own prompt."

## 2:15 to 2:40  Honesty and close

"Ablation is an existing research method. We adapted it into an interactive learning and debugging experience for everyday users. A label is one observation on one task, and the app says so. [If you have test data: We tested it with N hackers this weekend, and X of N improved their score on the second try.] PromptProof: debug your prompt before you trust the output."

## If something breaks

- Model slow or failing: say "the live model is rate limited, here is a recorded run" and switch to the recording. Say that it is recorded.
- Scores differ from rehearsal: say what you see. Do not claim the rehearsed numbers.
- Never present the offline mock as a real model. The header labels it.

## Likely judge questions

- "Is this just a prompt tutorial?" A tutorial gives rules. This measures your own prompt.
- "Is one run reliable?" Not fully. We report it as one observation and can run three per part.
- "Does this exist already?" Developer tools for prompt ablation exist. We found none built for everyday users around tasks with hidden requirements.
- "Why rules instead of an AI judge?" So the score cannot be argued with and costs no extra model calls.
