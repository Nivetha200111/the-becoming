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

## Notion quest log (one-way sync)

Each claimed quest becomes one record in a Notion database under NIVETHA LIFE OS. Undoing a claim moves that record to Notion's trash. Sync runs one way only: edits made in Notion are never copied back into the game.

### How it works

- After `/api/state` confirms a save, `cloud.js` calls `POST /api/notion` if the saved entries have changed since the last Notion sync. It also calls once when the page loads. The request has no body.
- The route uses the same session-cookie authentication as `/api/state`, plus the same-origin check. It re-reads the saved state from the save store, so only progress that is durably saved reaches Notion. It then reconciles that state against every active database page that has an `Entry key`:
  - It creates a page for each missing key.
  - It updates a page whose title, date, stat, XP or note changed, for example after an undo and a new claim on the same day.
  - It moves a page to trash when its key is no longer in the save.
  - It keeps one page per key. If two devices race, both keep the earliest page (by `created_time`, then page id), so they archive the same extras.
- Database rows without an `Entry key` are never touched.
- One call makes at most 30 writes. When more work is left, the response includes `pending: true` and the browser calls again. Notion 429 and 5xx responses are retried, and `Retry-After` is honoured.
- Failures never block saving. The footer shows `Notion synced`, `Notion syncing…`, `Notion sync paused · will retry` (with backoff up to 5 minutes), `Notion sync not set up`, or `Notion sync off · local design`.
- Local design mode returns before reading any Notion configuration and never contacts Notion. Missing or malformed configuration returns `unconfigured` without any network call.
- The API version is `Notion-Version: 2025-09-03`. Pages are written to the database's data source, and trashing uses `in_trash`.

Why the trigger is "client after save, server reconciles saved state" instead of a hook inside `POST /api/state`:
- The save route stays fast and cannot fail because of Notion.
- Avatar-position saves don't cause Notion traffic, because the browser only calls when entries change.
- The browser can show the result in the footer.
- Every page load heals anything missed earlier.
- Because the server reads the authoritative save rather than trusting the request, the result is the same whichever device triggers it.

### Required database properties

| Property | Type |
| --- | --- |
| Quest | Title |
| Entry key | Text |
| Date | Date |
| Stat | Select (INT, BUILD, FOCUS, END, LEVERAGE) |
| XP | Number |
| Evidence | Text |

The names must match exactly. They are defined in `PROPS` in `lib/notion-sync.mjs`. Other properties are allowed and left alone.

### Setup steps

1. Create the integration. Go to https://www.notion.so/profile/integrations and choose **New integration**. Pick the workspace that contains NIVETHA LIFE OS and keep the type **Internal**. Under **Capabilities**, enable Read content, Update content and Insert content. Save, then copy the **Internal Integration Secret**. Treat it as a password.
2. Share the page with the integration. Open NIVETHA LIFE OS in Notion, then use **•••** → **Connections** → **Connect to**, and pick the integration. Child pages and databases inherit the access.
3. Choose a database:
   - **To create a new one** (recommended), run this in a local shell from the repository, entering the secret only in that shell:

     ```bash
     NOTION_TOKEN=<secret> node scripts/notion-setup.mjs create
     ```

     It creates "The Becoming · Quest log" under NIVETHA LIFE OS and prints `NOTION_DATABASE_ID=…`.
   - **To use an existing database**, add the properties above, connect the integration to it, and check it:

     ```bash
     NOTION_TOKEN=<secret> node scripts/notion-setup.mjs check <database-id>
     ```

     The database id is the 32-character id in the database URL.
4. In Vercel, open Project → Settings → Environment Variables. Add `NOTION_TOKEN` and `NOTION_DATABASE_ID` as encrypted, server-side variables, for Production (and Preview if you want). `NOTION_DATA_SOURCE_ID` is needed only if that database has several data sources. Redeploy.
5. Open the game, claim a quest, and watch the footer change to `Notion synced`. Confirm the row appears in the database. `GET /api/health` reports `notionSync: "configured"` once the variables are present. That shows configuration only; the footer status shows whether the writes actually succeeded.

The first sync after setup backfills every entry already in the save, 30 writes per call. Never put the token in `public/`, in client code or in a commit.

## Pending integrations

Bot chat needs real provider credentials and a server route; it is not implemented. Keep secrets out of frontend assets and source control.
