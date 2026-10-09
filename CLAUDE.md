# The Becoming — Claude handoff

This is Nivetha's personal visual life RPG, exported as a complete editable Next.js project. The desired feel is a cute, calm illustrated world with an avatar, unlockable places, and eight bot characters. Make it comfortable on phone, tablet and desktop. The owner wants to continue design changes in Claude Code.

## Start here

Use Node 22.13+ and npm. Run `npm ci`, then `npm run dev:local`, and open http://127.0.0.1:3000. This explicit design mode needs no credentials and saves progress only in that browser. It is rejected in production and on Vercel. Use `npm test` and `npm run build` before delivering changes.

## Source map

| File | Responsibility |
| --- | --- |
| public/game/index.html | Game DOM, dialogs, navigation and deferred script order |
| public/game/style.css | Layout, typography, colors, responsive styles |
| public/game/app.js | Canvas world drawing, avatar movement, quests, inventory and journal UI |
| public/game/party.js | Eight NPC sprites, SVG portraits, Party roster, bot dialogue and interactions |
| public/game/data.js | World areas and quest definitions |
| public/game/engine.js | Pure state, XP, levels, coins, validation |
| public/game/sync-core.js | Three-way save merge |
| public/game/cloud.js | Polling, offline queue, revision conflict handling, Notion sync trigger and footer status |
| app/page.jsx and app/api/game/route.js | Next.js shell and authenticated game HTML |
| app/api/state/route.js | Authenticated save API |
| lib/auth.mjs | Passphrase sessions and development-only design mode |
| lib/save-store.mjs | Server-only bridge to existing save backend |
| app/api/notion/route.js and lib/notion-sync.mjs | Authenticated one-way mirror of saved quest entries into a Notion database |
| scripts/notion-setup.mjs | Creates or checks the Notion quest-log database |

## Design work

Start by reading `docs/DESIGN.md`. Most visible design changes are in style.css, the canvas draw helpers in app.js, and portraits/sprites in party.js. All art is code-native canvas or inline SVG; no missing external image assets or paid font dependencies. Keep usable touch targets, mobile scroll, keyboard access, reduced-motion support, and legible text. The game is served inside a same-origin iframe; use its document as the scope for UI inspection.

The game scripts share globals. Preserve order: engine.js → data.js → sync-core.js → cloud.js → app.js → party.js. party.js wraps app.js's update/draw functions. Avoid bundling one file in isolation or introducing a variable that collides with another global. Refactoring into modules is possible but requires migrating all dependencies together.

## Behavior and data to preserve

Keep save version 1 and storage keys `nivetha-becoming-v1` and `nivetha-cloud-base-v1` unless implementing and testing a migration. Keep quest IDs and completion keys stable to preserve existing XP. Completing a real-world action requires evidence/a note; keep duplicate award prevention and reward reconciliation. Daily reset uses Asia/Kolkata. Recovery mode is a deliberate alternative to training.

If you change engine.js, copy it exactly to lib/engine.cjs so server validation stays aligned. Never put personal progress, credentials, browser state, .env.local, node_modules or build output in commits. Export progress from the current game in Settings and import it on a new hostname; the code repository contains no private save data.

## Integration state — do not overclaim

Bot dialogue is scripted, not connected to live Grok/Claude sessions. Notion sync is one way only (game → Notion): after a confirmed cloud save, the browser calls POST /api/notion, and the server re-reads the saved state and reconciles it against the database by entry `key`. It creates missing records, updates changed ones, moves undone ones to trash, and removes duplicates. Nothing is read back into the game. It needs `NOTION_TOKEN` and `NOTION_DATABASE_ID` server-side, does nothing in local design mode, and is covered only by mocked-API tests (tests/notion.test.mjs) until someone runs it against the real workspace. Keep the Notion property names in lib/notion-sync.mjs (`PROPS`) aligned with the database. The production save API currently bridges to the existing owner-private Site, so it still needs `SITES_SAVE_TOKEN` supplied securely server-side. For complete hosting independence, replace savedState() with a durable database adapter preserving the GET/POST revision contract; never use Vercel's local filesystem for persistent saves. See docs/DEPLOYMENT.md.

## Suggested first task

Run the project locally, inspect the current world and Party roster at desktop and mobile sizes, then apply Nivetha's requested visual changes. Keep the progression and save format intact. Describe what changed, how it was verified, and which integrations are still pending.
