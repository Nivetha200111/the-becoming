# The Becoming

Nivetha’s personal life RPG: an explorable illustrated world, avatar, eight bot characters, quests, levels, skill branches, wardrobe rewards, and private cross-device saves.

## Run

Use Node 22.13 or later:

```sh
npm ci
npm test
npm run dev:local
```

Open http://127.0.0.1:3000. Local design mode needs no credentials, uses browser saves, and makes no cloud-save requests. It only works in development outside Vercel. For authenticated integration testing, configure `.env.local` and run `npm run dev` instead.

## Continue in Claude

Clone the private repository `https://github.com/Nivetha200111/the-becoming.git`, or extract the ZIP into a folder. Open that folder in Claude Code and ask it to read `CLAUDE.md`, then run the app and apply your design changes. All editable game code, canvas/SVG art, eight NPC characters, API routes, tests and configuration are included. There are no missing image assets. Your personal game progress and secrets are intentionally separate; export your current save from Settings before moving hosts.

See `docs/DESIGN.md` for the visual source map and `docs/DEPLOYMENT.md` for hosting and independent database migration.

## Vercel migration

This is a standard Next.js application. It does not require Vinext, Cloudflare Workers packages or ChatGPT-hosted authentication to render.

The **private** GitHub repository `Nivetha200111/the-becoming` has been created. Import it into Vercel with the Next.js preset. A successful Vercel deployment has not yet been verified.

Set runtime environment variables in Vercel, never in source:

| Variable | Required setup |
| --- | --- |
| `APP_PASSWORD` | A random personal passphrase of at least 16 characters |
| `SESSION_SECRET` | An independent random secret of at least 32 characters |
| `SITES_SAVE_TOKEN` | Supported service-access credential for the existing owner-private save backend |

Authentication fails closed until the access settings are configured. Sessions use signed HttpOnly cookies and same-origin write checks.

## Save continuity

During migration, Vercel’s server calls the existing owner-private save backend using a server-only service credential. Cloud saves therefore remain in the existing durable store, preserving its revision checks and existing progress. The browser never receives that credential. This is a migration bridge, not a transfer of the database to Vercel.

The bridge targets exactly `https://nivetha-life-world.niv2001.chatgpt.site/api/state`. Keep that Site owner-private and available while using the bridge. If the credential stops working, the game reports offline status and retains its device backup.

Browser storage is scoped to a hostname. Export your current game’s save before migration; on the new deployment, sign in and import that backup if any recent device-only actions have not reached the shared save backend. The server save is shared, but the two hosts' browser backups are separate.

## Bots

Jane, Lelouch, Carmy, Gilfoyle, Goggins, Beth, Beatrix and Dexter appear as characters. Tap them on the map or open the Party tab for dialogue and their quests. Dialogue is scripted; this release does not connect live AI bot sessions.

## Notion

Live Notion sync is not implemented in this migration. Hosting on Vercel permits a future server-side Notion integration, but moving hosts alone does not grant Notion credentials or page access. The existing manual log export remains available.

## Verification

Tests cover concurrent progress merging, duplicate XP, offline undo, stale-device deletions, reward reconciliation, session expiry and tampering, production rejection of local design mode, and credential isolation in the save bridge. The production Next.js build passes. Full device/browser QA is pending. See the final handoff for the actual published GitHub commit and Vercel deployment outcome.
