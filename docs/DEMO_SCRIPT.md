# Demo script (about 2 minutes 45 seconds)

Roles: one person talks, one person drives. Do not switch mid-demo.
Before you start: open `/workspace`, click "Clear session", and have the backup recording in a second tab.
Nothing here is scripted to fail. Say what actually appears on screen.

## 0:00 to 0:20  The problem

"You ask an AI for something, the answer is off, and you rewrite the prompt by guesswork. You never find out which change helped. PromptProof makes that a test instead of a guess."

## 0:20 to 0:55  A real goal and a first answer

Click "Use my own prompt", then "Fill in a sample". Point at the three fields.

"This is my prompt. This is the notes it works from. And this is what a good answer must do: under 70 words, name the new date and the reason, and never mention the budget. I chose these checks, so I know what the result means."

Click Run.

"The answer, next to the requirements it met and missed, with the evidence for each."

## 0:55 to 1:35  A finding and a targeted edit

Point at "What to fix".

"It does not just say 'be more specific'. This requirement was missed because the prompt never asked for it. Here is the exact edit to try, and it is marked as untested."

Click "Add to draft" on one or two items, then "Test this revision".

## 1:35 to 2:10  A valid comparison

"Same task, same requirements, same model settings. Both prompts with the change highlighted, both answers, and which requirements improved, stayed the same, or regressed. If I change the requirements, it starts a new experiment instead of pretending the scores are comparable."

If a requirement did not improve, say so: "That one did not move. No improvement is a legitimate result."

## 2:10 to 2:35  The X-ray, or the helper (pick one)

X-ray: click "Run the X-ray". "It removes each instruction in turn and reruns three times. This one changed a check every time. This persona changed none of the checks I selected, which is not the same as useless."

Or helper: click "Improve and test". "It tries one edit at a time, keeps it only if something improves and nothing regresses, shows the rejected attempts, and stops after three."

## 2:35 to 2:45  Close

"We adapted ablation analysis into an interactive learning and debugging experience. It counts requirements met, not answer quality, and it says so. PromptProof."

## If something breaks

- Model failing: the error offers "Show the last saved result from this device". It is labeled as recorded. Say so out loud.
- Open `/api/health` to see why the model is unreachable.
- Never present the offline mock as a real model. The page labels it.

## Likely judge questions

- "Is the score objective?" The checks are fixed rules, so they are repeatable. That does not make them complete or correct. It counts requirements met.
- "Does the keyword check prove the answer is right?" No. An exact-text check shows the text appears. The app says that next to the check.
- "Why did an instruction show no change?" None of the selected checks moved in three runs. It may matter for things they do not measure.
- "Could the helper game the checks?" It cannot change them, an edit that drops most of the prompt or adds a number I did not supply is blocked, and every attempt is shown. A higher count is evidence, not proof.
- "Does this exist already?" Developer tools for prompt ablation and evaluation exist. This is built for people who are not prompt engineers.

## User testing protocol

Ask someone to complete one task with no explanation. Note: where they hesitate, whether the suggested edit helped, and whether they can say in their own words what the comparison showed. Record the number of people and what happened. Do not round up.
