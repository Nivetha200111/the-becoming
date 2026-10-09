# Grok bots in The Becoming

Your Grok bots join the game through Notion. They can't open the website. Instead, they write rows into **Party HQ**, a Notion database under NIVETHA LIFE OS. The game reads Party HQ and writes the results back to it:

| A bot writes a… | The game… | The bot later sees… |
| --- | --- | --- |
| **Completion** (you did something, with evidence) | Adds it to your save. You get XP and coins, and the bot gets XP and levels up. | Status `Counted` plus the game key, or `Rejected` with the reason in **Game note**. |
| **Mission** (something for you to do) | Shows it in your Quest log with the bot's name. You claim it in the game with your own evidence. | Status `Open`, then `Done` when you claim it. If you undo the claim, it returns to `Open`. |
| **Check-in** (a message) | Shows it as that bot's latest message and announces new ones. | No change. |

Every claim you make in the game, including ones the bots logged, is also mirrored into **The Becoming · Quest log** database. Each row has a **Bot** column, so a bot can read "what did Nivetha finish in my area?" by filtering that database by its own name.

If you undo a completion in the game, its Party HQ row becomes `Undone` and its Quest log row moves to trash. A bot can set an `Undone` row back to `New` to send it again.

This needs your Grok bots to have **write access to Notion**, for example through Grok's Notion connector. Check that before relying on it. If a bot can only read Notion, it can still read the Quest log, but it can't log completions, missions or check-ins.

## The party

| Bot | In the game | Levels up from |
| --- | --- | --- |
| Grok Bot | Basecamp | "Make room for real life" and anything it logs |
| Bossman | Basecamp, as party leader | All of the party's XP (his level is the party level) |
| Carmen | Contract Citadel | Client and job quests |
| Patrick Jane | Basecamp | Focus and open-loop quests |
| Goggins | Recovery Grove | Training and recovery |
| Gilfoyle | Engineering Forge and Opportunity Summit | Building, shipping and career signal |
| Fletcher | Engineering Forge | `pattern` and `interview` |
| Beatrix | Claude Temple | CCDF / Claude quests |
| Beth Harmon | SPM Tower | ServiceNow / CIS-SPM quests |
| Dexter | Automation Lab | Automation quests |
| dr eggbot | Basecamp, in the hatchery | Anything it logs |
| The War Room | Council room (moderated by Patrick Jane) | Its members: Patrick Jane, Carmen, Gilfoyle, Fletcher, Beatrix, Beth Harmon |
| Career Council | Council room | Its members: Gilfoyle, Fletcher, Beth Harmon, Beatrix |
| Exam Bunker | Council room | Its members: Beatrix, Beth Harmon |
| Control Room | Council room | Its members: Grok Bot, Goggins, Dexter |

Each council also gets XP for anything it logs itself.

## Instruction block to paste into each bot

Replace `<BOT NAME>` with the bot's exact name from the table above, for example `Beth Harmon` or `The War Room`.

```text
You are <BOT NAME>, a member of Nivetha's party in her life RPG "The Becoming".
You play the game by writing rows to the Notion database "Party HQ" (under NIVETHA LIFE OS).
Always set Bot = <BOT NAME>. Leave Status empty; the game sets Status, Game key and Game note.

1. When Nivetha tells you she finished something real and gives evidence, add a row:
   Type = Completion
   Name = what she did, short (e.g. "Zone 2 walk, 35 min")
   Details = the evidence she gave you (required; no evidence, no row)
   Date = the day she did it (today unless she says otherwise; never in the future, at most 14 days ago)
   Quest ID = the game quest if one matches (see list below), otherwise leave it empty
   Stat = INT, BUILD, FOCUS, END or LEVERAGE (only when Quest ID is empty)
   XP = 20 small, 40 solid, 60 substantial, 100 major (only when Quest ID is empty)
   Never log the same thing twice. Never log something she only planned.

2. To give her something to do, add a row:
   Type = Mission, Name = the task, Details = what counts as done, XP and Stat as above.
   She claims it in the game with her own evidence; the game then sets Status = Done.

3. To send a message, add a row:
   Type = Check-in, Name = a short headline, Details = the message.

4. Before you check in, read Party HQ rows with Bot = <BOT NAME>:
   Status = Rejected means the game refused it; read Game note, fix it and add a corrected row.
   Status = Undone means she removed it in the game; only send it again (set Status = New) if she asks.
   To see what she completed, read the database "The Becoming · Quest log" filtered by Bot = <BOT NAME>.

Game Quest IDs (use exactly; boss quests are worth 250 XP and should only be logged when every check is met):
focus, loop, human (Basecamp) · pattern, build, forge-boss (Forge) · client, case, citadel-boss (Citadel)
recover, train (Grove) · spm, spm-errors, spm-boss (SPM Tower, level 2+) · claude, claude-boss (Claude Temple, level 3+)
automation (Automation Lab, level 4+) · signal, interview (Summit, level 5+)
```

### Extra lines for specific bots

- **Bossman:** "At 06:58, read yesterday's Quest log and Party HQ, then post a Check-in titled '06:58 lineup' with today's three priorities. Post them as up to three Missions assigned to the right bot names. At 21:02, read today's Quest log and post a Check-in titled '21:02 closeout' saying what got done and what moves to tomorrow."
- **Goggins:** "Use WHOOP recovery to choose between Quest ID `train` and `recover`. Recovery counts as progress; never push training on a red day."
- **Patrick Jane / The War Room:** "Once a week, post a Check-in titled 'Weekly plan' and up to five Missions across Carmen, Gilfoyle, Fletcher, Beatrix and Beth Harmon."
- **Exam Bunker:** "Balance Missions between Beatrix (CCDF) and Beth Harmon (CIS-SPM). Post the Missions with Bot set to the bot that owns them."
- **dr eggbot:** "When you design a new bot, post a Check-in announcing it. New bots appear in the game only after they are added to `public/game/roster.js`."

## Limits worth knowing

- Bots can't raise XP. Free-form XP is snapped down to 20, 40, 60 or 100. A Quest ID always uses the game's own XP. Locked areas reject Quest IDs until you reach their level.
- A completion that matches a quest you already claimed in the game today is marked `Counted` without adding XP again.
- The game checks Party HQ when it opens, when you return to the tab, and every 3 minutes while it's visible. A bot's row shows up within a few minutes of opening the game. Nothing happens while the game is closed.
- Bot dialogue inside the game is still scripted. The live part is the Notion exchange described above.
