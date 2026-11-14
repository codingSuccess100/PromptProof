# Demo script (about 2 minutes 50 seconds)

Roles: one person talks, one person drives. Do not switch mid-demo.
Before you start: page loaded at the top, a second tab with the backup recording, and one full practice run already done in this browser (that saves a labeled fallback).

## 0:00 to 0:20  The problem

"Everyone here wrote prompts this weekend. Almost nobody can say which words in them actually did anything. We copy phrases like 'you are an expert' because they feel right. Research from Wharton found expert personas do not reliably improve accuracy. So how would you know?"

## 0:20 to 0:45  The idea, on the scroll walkthrough

Scroll slowly through "How it works". Let the prompt turn green and grey.

"PromptProof runs an experiment. It deletes one part of your prompt at a time and reruns the task. Green parts moved the score. Grey parts changed nothing we could measure. These labels are from a real run this morning."

## 0:45 to 1:35  Live: practice scenario

Click "Try it". Paste: `You are an expert analyst. Summarize this feedback for our CFO under 60 words, put billing errors first, mention the $1,200 refund cost.` Click Run.

"This card is what I know and the AI does not. The score comes from fixed rules. No AI grades itself."

When the X-ray appears:

"'You are an expert analyst.' Removing it caused no measurable decline on this task, three runs out of three. Remove 'under 60 words' and that exact check fails."

Click "Show what I missed", click the Friday detail, click Run again.

"Before and after, side by side."

## 1:35 to 2:20  Live: your own prompt

Click "Your own prompt", then "Load an example". Click Run.

"This is the part that matters after today. Paste a prompt you actually use, say what a good answer must do, and get the same experiment. The requirements are rules I choose, so the score is still a fact. The model can suggest requirements, and I approve them."

## 2:20 to 2:50  Honesty and close

"Ablation is an existing research method. We adapted it into an interactive learning and debugging experience for everyday users. It measures whether requirements were met, not whether the writing is good, and only on the model shown. The app says all of that on screen. [If you have test data: We tested it with N hackers, and X of N improved on the second try.] PromptProof: debug your prompt before you trust the output."

## If something breaks

- Model slow or failing: click "Show the last recorded run from this device". The app labels it as recorded. Say so out loud too.
- Scores differ from rehearsal: say what you see. Do not claim the rehearsed numbers.
- Never present the offline mock as a real model. The page labels it.

## Likely judge questions

- "Is this just a prompt tutorial?" A tutorial gives rules. This measures your own prompt, including ones you bring yourself.
- "Why do core instructions show no measured effect?" Because none of the checks changed without them. The model summarizes anyway when handed feedback. The label is about this task, not the phrase in general.
- "Is one run reliable?" No, which is why each label is confirmed with three runs and shows how many agreed.
- "Does this exist already?" Developer tools for prompt ablation exist. We found none built for everyday users.
- "Why rules instead of an AI judge?" So the score cannot be argued with. The cost is that it measures compliance, not quality, and we say so.
- "Could I game the practice scenarios by copying the card?" Yes. They teach the habit. Own-prompt mode is the product.
