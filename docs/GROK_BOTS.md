# Grok bots in The Becoming

Every bot already follows the **bot protocol on the NIVETHA LIFE OS Notion page**. Notion is the shared dashboard, XP is only for real output, and replies are kept short. The game joins that system as one more Notion surface, so you don't need to paste anything into 15 chats. Add the **protocol addendum** below to the existing protocol on NIVETHA LIFE OS once. Bossman passes it on in the next lineup.

Bots never sign in to the website and must never be given its passphrase. They take part through two databases under NIVETHA LIFE OS:
- **Party HQ:** bots write here and the game reads it.
- **The Becoming · Quest log:** the game writes here and bots read it.

| A bot writes to Party HQ… | The game… | The bot later sees… |
| --- | --- | --- |
| **Completion** (you did it, with evidence) | Adds it to your save: XP and coins for you, XP for the bot. | `Counted` with a game key, or `Rejected` with the reason in **Game note**. |
| **Mission** (something for you to do) | Shows it in your quest log under the bot's name. You claim it in the game with your own evidence. | `Open`, then `Done`. If you undo the claim, it goes back to `Open`. |
| **Check-in** (a message) | Shows it as that bot's latest message and announces new ones. | No change. |

The game also keeps one **Scoreboard** row in Party HQ, with Bot set to Bossman. It holds your level, XP, the next threshold, today's claims, coins, mode and the party's levels. That answers "what's my XP and next level?" without opening the site. The row is rewritten only when the numbers change.

If you undo a claim in the game, its Party HQ row becomes `Undone` and its Quest log row moves to trash.

This needs the bots to have **write** access to Party HQ and read access to the Quest log through Grok's Notion connection. Check that before relying on it.

## The party in the game

| Bot | Charter, from its own chat | Lives at | Levels up from |
| --- | --- | --- | --- |
| Grok Bot | Main bot; routes tasks to the party | Basecamp | Everything the party logs for you |
| Bossman | Runs the bots: lineup, closeout, calendar, charter checks | Basecamp | The whole party's XP (his level is the party level) |
| Carmen ("Carmy") | Work OS: projects, deadlines, demos, blockers | Contract Citadel | Work quests |
| Patrick Jane | Life OS: personal tasks, attention, open loops, decisions | Basecamp | Focus, open-loop and real-life quests |
| Goggins | Training and recovery: daily WHOOP call | Recovery Grove | `train`, `recover` |
| Gilfoyle | Career OS: strategy, skills, certs, achievements | Engineering Forge and Opportunity Summit | Builds, shipping, career signal |
| Fletcher | Interview prep: Java DSA, mocks (hatched by dr eggbot) | Engineering Forge | `pattern` (lunch LeetCode), `interview` |
| Beatrix | CCDF prep | Claude Temple | `claude`, `ccdf-mock`, `ccdf-pass`, `claude-boss` |
| Beth Harmon | CIS-SPM prep, test-first | SPM Tower | `spm`, `spm-errors`, `spm-boss`, `spm-pass` |
| Dexter | Systems OS: automation, subscriptions, devices | Automation Lab | `automation` |
| dr eggbot | Bot designer | Basecamp, in the hatchery | What it logs |
| The War Room | Weekly planning, moderated by Patrick Jane | Council room | Jane, Carmen, Gilfoyle, Fletcher, Beatrix, Beth Harmon |
| Career Council | Career decisions and exam priority | Council room | Gilfoyle, Fletcher, Beatrix, Beth Harmon |
| Exam Bunker | Cert time split; Gilfoyle decides | Council room | Gilfoyle, Beatrix, Beth Harmon |
| Control Room | Sleep, routines, errands, devices, subscriptions | Council room | Jane, Goggins, Dexter, plus `lights-out` |

Bot names are matched loosely: "Carmy", "Beth", "Jane", "Bea", "Grok", "eggbot" and "War Room" all work.

## Protocol addendum (add once to the bot protocol on NIVETHA LIFE OS)

```text
THE BECOMING (game) — Party HQ rules. Keep rows short.
Write to the Notion database "Party HQ". Set Bot = your own name. Leave Status, Game key, Game note empty (the game fills them).
- Nivetha finished something real and gave evidence -> Type=Completion. Name=what she did. Details=her evidence (required). Date=day done (today by default; max 14 days back; never future).
  Quest ID if it matches one below; otherwise Stat (INT/BUILD/FOCUS/END/LEVERAGE) and XP (20 small, 40 solid, 60 big, 100 major).
  No plans, no duplicates, no XP for intentions.
- A task for her -> Type=Mission, Name=task, Details=what counts as done, XP+Stat as above.
- A message -> Type=Check-in, Name=headline, Details=message.
- Before checking in, read your own rows: Rejected = read Game note, fix, add a corrected row. Undone = she removed it; resend (Status=New) only if she asks.
- Her level, XP and next level: read the Party HQ row Type=Scoreboard. Her claims: database "The Becoming · Quest log", filter Bot = your name.
- Anything she marked private stays out of Notion. Log the output only (e.g. "LC 20 Valid Parentheses solved"), not plans or personal context.
- Never ask for or store passwords, cookies, tokens or the game passphrase.
Quest IDs: focus, loop, human, lights-out (Basecamp) · pattern = lunch LeetCode in Java, build, forge-boss (Forge)
client, case, citadel-boss (Citadel) · train = WHOOP call done, recover = RECOVER/rest day (Grove)
spm = test-first drill, spm-errors, spm-boss, spm-pass (SPM Tower) · claude = CCDF study block, ccdf-mock (>=80%), ccdf-pass, claude-boss (Claude Temple)
automation (Lab, level 4+) · signal, interview (Summit, level 5+). Bosses = 250 XP: only when every check is met.
```

### Lines that fit specific charters

- **Bossman (lineup and closeout):** "In the morning lineup, read the Scoreboard and yesterday's Quest log, post a Check-in titled 'Lineup' with today's three priorities, and post them as Missions under the owning bot's name. In the evening closeout, post a Check-in titled 'Closeout' with what got done (from the Quest log) and what moves to tomorrow. Relay Rejected rows to their bot."
- **Goggins:** "After the daily call, a PUSH, NORMAL or LIGHT session done = Quest ID `train`. A RECOVER call or rest day followed = `recover`. Never log training on a RECOVER day."
- **Fletcher:** "One solved problem = Quest ID `pattern`, with Details = problem number and name plus the pattern. A missed day is never doubled. A timed mock = `interview`."
- **Beatrix:** "A study block = `claude`. A mock at 80% or more = `ccdf-mock`, with the score in Details. The exam passed = `ccdf-pass`."
- **Beth Harmon:** "A drill = `spm`, with the score in Details. Errors reworked = `spm-errors`. The exam passed = `spm-pass`."
- **Control Room / Patrick Jane:** "Lights out by the set time = `lights-out`. A closed open loop = `loop`."
- **dr eggbot:** "A new bot appears in the game only after it is added to `public/game/roster.js`. Post a Check-in when you hatch one."

## Limits

- Bots can't inflate XP. Free-form XP snaps down to 20, 40, 60 or 100, and a Quest ID always uses the game's own XP.
- A quest you already claimed in the game today is marked `Counted` without counting twice.
- The Automation Lab unlocks at level 4 and the Opportunity Summit at level 5; Quest IDs there are rejected until then. SPM Tower and Claude Temple are open from level 1 because CCDF and CIS-SPM are this month's campaign.
- The game checks Party HQ when it opens, when you return to the tab, and every 3 minutes while it's visible. It does nothing while closed, so bot rows wait until you next open the game.
- In-game bot dialogue is still scripted. The live exchange is through Notion.

## In-game chat: the shared inbox

The game's chat sends a real Party HQ row to the selected bot or council. Your character sends to Notion; your existing Grok bots read it and write replies to the same mailbox. The game does not call an AI provider or require a paid AI API key. Replies are asynchronous. A Grok routine must actually be created and enabled; writing the protocol is not sufficient.

Add this to each existing bot's Party HQ protocol once:

1. Read rows addressed to your Bot name with Type `Message`, Status `New`, and a Game key starting `chat:`. `Details` contains Nivetha's message; Name is `Nivetha → <bot>`.
2. Read earlier Message/Reply rows for your Bot if context is needed. Respect your existing charter and anti-jobs.
3. Write a row with Type `Reply`, Bot set to the same bot, Game key **exactly copied from the message**, Details set to your answer, Name set to a short description, and Date set to today.
4. Before creating a Reply, check whether a Reply with that Game key already exists. Reuse it on retries rather than producing duplicates.
5. Mark the original Message `Answered` only after the Reply exists.
6. Chat messages never award XP. Real completions still go through the existing evidence-based Completion protocol.

The game polls the selected bot's inbox every 30 seconds while chat is visible. It reports delivery only after Notion confirms the row. A message remains labelled waiting until a Reply with its key exists. Notion is the durable shared store across devices.


## Periodic bot check

The active Party HQ is `56e07643-a9fb-4a40-a642-8691b4843e60`, with data source `e42eb197-9855-4a6c-a600-b9526ee2a6d8`. It contains the original “Grok Bot connected” row. The empty duplicate HQ is not the chat mailbox. Message, Reply and Answered options have been added, and the chat protocol is appended to BOT PROTOCOL // GROK → NOTION.

Ask the actual **Grok Bot** to create one inbox dispatcher routine every five minutes, Asia/Kolkata. It should query only Type=Message, Status=New, up to 20 rows oldest first, and route to the real addressed bot using existing bot collaboration. Each owning bot follows the Message/Reply rules above; the dispatcher never impersonates another bot. Check for an existing Reply by Game key before writing and mark the original Message Answered only after its Reply exists. Do nothing when the inbox is empty. Leave messages New when Notion or an addressed bot is unavailable and report the blocker in the dispatcher conversation. Never use a paid AI API, buy credits, or give bots the game passphrase.

Test the routine and confirm its next run in Grok. These runs use the existing Grok app plan; they are not guaranteed unlimited or free. One dispatcher avoids fifteen idle polling routines. The game uses only Notion's REST transport and checks for replies while the chat is visible.
