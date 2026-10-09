# Hosting and save migration

## Local design

`npm ci` then `npm run dev:local` opens a loopback-only development server. The flag is effective only when NODE_ENV is development and VERCEL is absent. It bypasses the passphrase only for local design, disables cloud traffic, and uses the existing browser backup. Restart without that command to test real authentication and cloud behavior.

## Production on Vercel

Import the private `Nivetha200111/the-becoming` GitHub repository. Use the Next.js preset, root directory `.`, `npm run build`, and a supported Node 22+ runtime. Configure APP_PASSWORD (16+ characters), SESSION_SECRET (32+ characters) and SITES_SAVE_TOKEN as server-side encrypted environment variables. Do not set LOCAL_DESIGN_MODE in hosting settings. Redeploy after configuring secrets. No secrets are included in this project.

Production fails closed if private access isn't configured. Login uses a personal passphrase and signed HttpOnly cookie. Keep the GitHub repository private. A live Vercel deployment has not been verified unless the handoff explicitly supplies its URL and a successful deployment result.

## Existing save bridge

The current adapter forwards GET/POST to exactly https://nivetha-life-world.niv2001.chatgpt.site/api/state using a supported owner-private service credential. The token must be obtained/configured securely and remains server-only. This keeps the existing store's revision conflict checks, but requires the current Site to remain available. The frontend performs 12-second visible-page polling, refreshes on return and queues offline changes; this is polling sync, not a websocket live stream.

## Independent database adapter

To remove the Site dependency, implement savedState(method, body) in lib/save-store.mjs against a durable database (for example Postgres). Preserve:

- GET: `{revision: nonnegative integer, state: saved object or null}` with status 200.
- POST input: `{expectedRevision, state}`. Validate before writing.
- Atomic compare-and-swap: update only if stored revision equals expectedRevision, then increment revision and return status 200 with the resulting revision/state.
- Stale POST: return status 409 with the current revision/state so the client can merge and retry.
- First save: no state and revision 0. Two concurrent first writes must not both succeed.
- Keep one private main-player record for this single-owner app. Add explicit owner scoping before adding multiple users.

Never use local JSON files or `/tmp` for persistent production data. Provisioning a database and transferring real progress are separate from deploying source code.

## Progress transfer

From the current game, open Settings and export the JSON save. Retain it privately. On the new host, sign in, open Settings and import it. Validate cloud readback before retiring the old host. Browser backups belong to each hostname; this ZIP and GitHub repo do not contain your personal progress.

## Pending integrations

Notion live sync needs a server-side integration authorized to the Life OS page, a mapping from game events to Notion records, and idempotent writes/retries. Bot chat needs actual provider credentials and a server route. Neither is implemented by this hosting migration. Keep secrets out of frontend assets and source control.
