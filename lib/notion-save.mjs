import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import Engine from './engine.cjs';
import { notionClient, resolveSource, validId, rich, plain, NotionError } from './notion-sync.mjs';
import { PARTY } from './party-sync.mjs';

// The save kept in Notion. Each successful save is a new row of Type "Save" whose Game key carries the revision
// ("save:000000000042") and whose Details and Game note hold the compressed state. Notion has no conditional
// update, so rows are only ever added: the highest readable revision is the save, two devices that write the same
// revision at once resolve to the same winner (earliest created, then page id), and the loser gets a conflict to
// merge. The last few revisions stay as backups; older ones go to Notion's trash.
export const SAVE_TYPE = 'Save', KEEP = 6;
const PART = 190000; // one rich_text property holds 100 chunks of 2000 characters
const keyOf = revision => 'save:' + String(revision).padStart(12, '0');
const sum = json => createHash('sha256').update(json).digest('hex').slice(0, 16);

const databaseId = env => env.NOTION_SAVE_DATABASE_ID || env.NOTION_PARTY_DATABASE_ID;
export function notionSaveConfigured(env = process.env) {
  return typeof env.NOTION_TOKEN === 'string' && env.NOTION_TOKEN.length >= 20 && validId(databaseId(env));
}

// Compressed and base64-encoded, so the text is plain ASCII that survives being split into chunks.
export function encodeSave(state) {
  const json = JSON.stringify(state), body = `z1:${sum(json)}:${gzipSync(json).toString('base64')}`;
  if (body.length > PART * 2) throw new NotionError('This save is too large to keep in Notion. Export a backup from Settings.', 413);
  return [body.slice(0, PART), body.slice(PART)];
}
export function decodeSave(body) {
  const m = /^z1:([0-9a-f]{16}):/.exec(body); if (!m) throw Error('Unrecognised save.');
  const json = gunzipSync(Buffer.from(body.slice(m[0].length), 'base64')).toString();
  if (sum(json) !== m[1]) throw Error('Save checksum mismatch.');
  return Engine.validate(JSON.parse(json));
}

function saveRow(page) {
  const p = page.properties || {}, m = /^save:(\d{12})$/.exec(plain(p[PARTY.key]?.rich_text));
  if (!m) return null;
  const row = { id: page.id, created: page.created_time || '', revision: Number(m[1]), state: null };
  try { row.state = decodeSave(plain(p[PARTY.details]?.rich_text) + plain(p[PARTY.note]?.rich_text)); } catch {} // damaged or hand-edited: skipped
  return row;
}
// Newest revision first; within a revision every device agrees on the same order.
const order = (a, b) => b.revision - a.revision || (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
async function rows(client, source, limit) {
  const r = await client.call('POST', `/data_sources/${source}/query`, {
    filter: { and: [{ property: PARTY.type, select: { equals: SAVE_TYPE } }, { property: PARTY.key, rich_text: { starts_with: 'save:' } }] },
    sorts: [{ property: PARTY.key, direction: 'descending' }, { timestamp: 'created_time', direction: 'ascending' }], page_size: limit });
  return (r.results || []).filter(p => p.object === 'page' && !p.in_trash && !p.archived).map(saveRow).filter(Boolean).sort(order);
}
async function latest(client, source) {
  let list = await rows(client, source, 3), found = list.find(r => r.state);
  // The newest rows may all be damaged; look further back before deciding nothing is saved.
  if (!found && list.length >= 3) { list = await rows(client, source, 25); found = list.find(r => r.state); }
  return found || null;
}
const trash = (client, id) => client.call('PATCH', '/pages/' + id, { in_trash: true });

async function write(client, source, revision, state) {
  const [details, note] = encodeSave(state);
  const page = await client.call('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: source }, properties: {
    [PARTY.title]: { title: rich(`The Becoming save · r${revision}`) }, [PARTY.type]: { select: { name: SAVE_TYPE } },
    [PARTY.key]: { rich_text: rich(keyOf(revision)) }, [PARTY.details]: { rich_text: rich(details) }, [PARTY.note]: { rich_text: rich(note) },
    [PARTY.date]: { date: { start: Engine.day() } } } });
  // Re-read: another device may have written this revision, or a later one, at the same moment.
  const list = await rows(client, source, KEEP + 6), winner = list.find(r => r.state);
  if (winner && winner.id !== page.id && winner.revision >= revision) {
    await trash(client, page.id);
    return { status: 409, data: { revision: winner.revision, state: winner.state } };
  }
  // Tidy a little on every save: duplicates and damaged rows at this revision, then revisions past the backups kept.
  let budget = 4;
  for (const old of list) {
    if (old.id === page.id || !(old.revision >= revision || old.revision <= revision - KEEP)) continue;
    if (!budget--) break;
    await trash(client, old.id);
  }
  return { status: 200, data: { revision, state } };
}

let queue = Promise.resolve();
// Same contract as the save bridge: GET -> {revision, state|null}; POST {expectedRevision, state} -> 200 or 409.
// `legacy` reads the previous store once, so the first request after switching carries the existing save across.
export function notionSavedState(method, body, env = process.env, { legacy = null, ...options } = {}) {
  if (!notionSaveConfigured(env)) return Promise.reject(Error('Notion save storage is not configured.'));
  const run = queue.then(async () => {
    const client = notionClient(env, options), own = !!env.NOTION_SAVE_DATABASE_ID;
    const source = await resolveSource(client, databaseId(env).replace(/-/g, ''), own ? env.NOTION_SAVE_DATA_SOURCE_ID : env.NOTION_PARTY_DATA_SOURCE_ID, own ? 'NOTION_SAVE_DATA_SOURCE_ID' : 'NOTION_PARTY_DATA_SOURCE_ID');
    let current = await latest(client, source);
    if (!current && legacy) {
      const old = await legacy(); if (old?.status !== 200) throw new NotionError('Your earlier save could not be read yet. Try again shortly.', 503);
      if (old.data?.state) {
        const revision = Math.max(1, Number.isSafeInteger(old.data.revision) ? old.data.revision : 1);
        const moved = await write(client, source, revision, Engine.validate(old.data.state));
        current = { revision: moved.data.revision, state: moved.data.state };
      }
    }
    if (method === 'GET') return { status: 200, data: { revision: current ? current.revision : 0, state: current ? current.state : null } };
    // An empty store accepts the first save at whatever revision the device last knew.
    if (current && current.revision !== body.expectedRevision) return { status: 409, data: { revision: current.revision, state: current.state } };
    return write(client, source, body.expectedRevision + 1, body.state);
  });
  queue = run.catch(() => {}); return run;
}
