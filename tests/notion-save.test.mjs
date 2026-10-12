import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Engine from '../lib/engine.cjs';
import { savedState, saveStore } from '../lib/save-store.mjs';
import { notionSavedState, encodeSave, decodeSave, KEEP } from '../lib/notion-save.mjs';
import { syncParty } from '../lib/party-sync.mjs';

const env = { SAVE_STORE: 'notion', NOTION_TOKEN: 'private-test-token-long-enough', NOTION_PARTY_DATABASE_ID: 'a'.repeat(32), NOTION_PARTY_DATA_SOURCE_ID: 'b'.repeat(32) };
const text = list => (list || []).map(r => r.text.content).join('');
// An in-memory Party HQ that answers the three calls the save store makes.
function fakeNotion() {
  const pages = [], calls = []; let n = 0, clock = Date.UTC(2026, 9, 12);
  const add = (properties, extra = {}) => { const page = { object: 'page', id: 'page-' + String(++n).padStart(4, '0'), created_time: new Date(clock += 1000).toISOString(), in_trash: false, properties, ...extra }; pages.push(page); return page; };
  const hooks = {};
  const fetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null, path = url.replace('https://api.notion.com/v1', ''); calls.push({ method: init.method, path, body });
    assert.equal(init.headers.Authorization, 'Bearer ' + env.NOTION_TOKEN);
    if (path.endsWith('/query')) {
      const saves = pages.filter(p => !p.in_trash && p.properties.Type?.select?.name === 'Save' && text(p.properties['Game key']?.rich_text).startsWith('save:'));
      saves.sort((a, b) => text(b.properties['Game key'].rich_text).localeCompare(text(a.properties['Game key'].rich_text)) || a.created_time.localeCompare(b.created_time));
      return Response.json({ results: saves.slice(0, body.page_size), has_more: false });
    }
    if (path === '/pages') { hooks.beforeCreate?.(body); const page = add(body.properties); hooks.afterCreate?.(page); return Response.json(page); }
    const m = /^\/pages\/(.+)$/.exec(path);
    if (m && init.method === 'PATCH') { const page = pages.find(p => p.id === m[1]); Object.assign(page, body); return Response.json(page); }
    throw Error('unexpected ' + init.method + ' ' + path);
  };
  return { pages, calls, add, hooks, fetcher, live: () => pages.filter(p => !p.in_trash) };
}
function played(xp = 40, note = 'Solved LC 20 with a stack — “edge case” noted ✦ 🙂') {
  const s = Engine.fresh();
  Engine.award(s, { id: 'pattern', title: 'One LeetCode pattern', stat: 'INT', xp, region: 'forge', repeat: true, unlock: 1 }, note, '2026-10-12');
  return s;
}
const call = (n, method, body, options = {}) => notionSavedState(method, body, env, { fetcher: n.fetcher, sleep: async () => {}, ...options });

test('SAVE_STORE selects Notion; without it the original bridge is used unchanged', async () => {
  assert.equal(saveStore({}), 'site'); assert.equal(saveStore(env), 'notion');
  await assert.rejects(savedState('GET', undefined, { SAVE_STORE: 'notion' }), /Notion save storage is not configured/);
  await assert.rejects(savedState('GET', undefined, {}), /not configured/);
});

test('a save round-trips through Notion with its revision, including emoji, quotes and rewards', async () => {
  const n = fakeNotion();
  assert.deepEqual((await call(n, 'GET')).data, { revision: 0, state: null });
  const state = played(); state.rewards.push({ id: 'rw-1', item: 'coffee', cost: 15000, date: '2026-10-12' }); state.entries[0].xp = 100; state.entries.push({ ...state.entries[0], key: 'x:1', xp: 250 }, { ...state.entries[0], key: 'x:2', xp: 250 });
  Engine.validate(state);
  const saved = await call(n, 'POST', { expectedRevision: 0, state });
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1);
  const read = await call(n, 'GET');
  assert.equal(read.data.revision, 1); assert.deepEqual(read.data.state, state);
  const row = n.live()[0].properties;
  assert.equal(row.Type.select.name, 'Save'); assert.equal(text(row['Game key'].rich_text), 'save:000000000001');
  assert.match(text(row.Details.rich_text), /^z1:[0-9a-f]{16}:[A-Za-z0-9+/=]+$/); // ASCII only, safe to chunk
  assert(row.Details.rich_text.every(r => r.text.content.length <= 2000));
  assert.equal(JSON.stringify(n.calls.map(c => c.body)).includes(env.NOTION_TOKEN), false);
});

test('a stale device gets the current save back instead of overwriting it', async () => {
  const n = fakeNotion(), first = played(40), second = played(60);
  await call(n, 'POST', { expectedRevision: 0, state: first });
  const stale = await call(n, 'POST', { expectedRevision: 0, state: second });
  assert.equal(stale.status, 409); assert.equal(stale.data.revision, 1); assert.deepEqual(stale.data.state, first);
  assert.equal(n.live().length, 1);
  const next = await call(n, 'POST', { expectedRevision: 1, state: second });
  assert.equal(next.status, 200); assert.equal(next.data.revision, 2); assert.deepEqual((await call(n, 'GET')).data.state, second);
});

test('two devices writing the same revision at once agree on one winner', async () => {
  const n = fakeNotion(), mine = played(40), theirs = played(100);
  await call(n, 'POST', { expectedRevision: 0, state: played(20) });
  // The other device's row for revision 2 lands just before ours is created.
  n.hooks.beforeCreate = body => { n.hooks.beforeCreate = null; const [details, note] = encodeSave(theirs); n.add({ ...body.properties, Details: { rich_text: [{ text: { content: details } }] }, 'Game note': { rich_text: note ? [{ text: { content: note } }] : [] } }); };
  const lost = await call(n, 'POST', { expectedRevision: 1, state: mine });
  assert.equal(lost.status, 409); assert.equal(lost.data.revision, 2); assert.deepEqual(lost.data.state, theirs);
  assert.equal(n.live().filter(p => text(p.properties['Game key'].rich_text) === 'save:000000000002').length, 1); // our losing row went to trash
  assert.deepEqual((await call(n, 'GET')).data.state, theirs);
});

test('switching stores carries the existing save across once, keeping its revision', async () => {
  const n = fakeNotion(), old = played(40); let reads = 0;
  const legacy = async () => { reads++; return { status: 200, data: { revision: 7, state: old } }; };
  const first = await call(n, 'GET', undefined, { legacy });
  assert.equal(first.data.revision, 7); assert.deepEqual(first.data.state, old); assert.equal(n.live().length, 1);
  const again = await call(n, 'POST', { expectedRevision: 7, state: played(60) }, { legacy });
  assert.equal(again.status, 200); assert.equal(again.data.revision, 8); assert.equal(reads, 1); // never consulted again
  await assert.rejects(call(fakeNotion(), 'GET', undefined, { legacy: async () => ({ status: 503, data: {} }) }), /earlier save could not be read/);
  // A device that still remembers an old revision can make the first save into an empty store.
  const empty = fakeNotion(), started = await call(empty, 'POST', { expectedRevision: 5, state: old });
  assert.equal(started.status, 200); assert.equal(started.data.revision, 6);
});

test('a damaged or hand-edited newest row is skipped in favour of the last good revision', async () => {
  const n = fakeNotion(), good = played(40);
  await call(n, 'POST', { expectedRevision: 0, state: good });
  await call(n, 'POST', { expectedRevision: 1, state: played(60) });
  n.live().find(p => text(p.properties['Game key'].rich_text) === 'save:000000000002').properties.Details.rich_text[0].text.content = 'z1:0000000000000000:not-a-save';
  const read = await call(n, 'GET');
  assert.equal(read.data.revision, 1); assert.deepEqual(read.data.state, good);
  const repaired = await call(n, 'POST', { expectedRevision: 1, state: played(100) });
  assert.equal(repaired.status, 200); assert.equal(repaired.data.revision, 2);
  assert.equal((await call(n, 'GET')).data.state.entries[0].xp, 100);
  assert.throws(() => decodeSave('plain text'), /Unrecognised/);
});

test('old revisions are trashed and only the recent backups remain', async () => {
  const n = fakeNotion();
  for (let i = 0; i < KEEP + 9; i++) assert.equal((await call(n, 'POST', { expectedRevision: i, state: played(20 + (i % 2) * 20) })).status, 200);
  assert.equal(n.live().length, KEEP); assert.equal((await call(n, 'GET')).data.revision, KEEP + 9);
});

test('a large save still fits, and one beyond Notion\'s limits is refused clearly', async () => {
  const n = fakeNotion(), big = Engine.fresh();
  for (let i = 0; i < 1500; i++) big.entries.push({ key: 'k:' + i, questId: 'k', title: 'Quest ' + i, stat: 'INT', xp: 20, note: 'Evidence for quest number ' + i + ' with a link and what changed. '.repeat(3), date: '2026-10-12', region: 'camp', boss: false });
  Engine.validate(big);
  assert.equal((await call(n, 'POST', { expectedRevision: 0, state: big })).status, 200);
  assert.deepEqual((await call(n, 'GET')).data.state, big);
  const random = Engine.fresh(); // incompressible notes, far past anything a real save holds
  for (let i = 0; i < 400; i++) random.entries.push({ key: 'r:' + i, questId: 'r', title: 'Noise', stat: 'INT', xp: 20, note: randomBytes(1425).toString('base64'), date: '2026-10-12', region: 'camp', boss: false });
  assert.throws(() => encodeSave(Engine.validate(random)), /too large to keep in Notion/);
});

test('bot completions from Party HQ are counted into a save kept in Notion', async () => {
  const n = fakeNotion(); await call(n, 'POST', { expectedRevision: 0, state: played(40) });
  const store = { load: () => call(n, 'GET'), save: body => call(n, 'POST', body) };
  const completion = { object: 'page', id: 'c'.repeat(32), created_time: '2026-10-12T05:00:00.000Z', properties: { Name: { title: [{ plain_text: 'Closed the open loop' }] }, Bot: { select: { name: 'Patrick Jane' } }, Type: { select: { name: 'Completion' } }, Details: { rich_text: [{ plain_text: 'Booked the appointment; confirmation saved.' }] }, XP: { number: 40 }, Stat: { select: { name: 'FOCUS' } }, Date: { date: { start: '2026-10-12' } } } };
  const partyFetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    if (url.endsWith('/query')) { const wantsCompletions = JSON.stringify(body.filter).includes('"Completion"') && JSON.stringify(body.filter).includes('"New"'); return Response.json({ results: wantsCompletions && !completion.properties.Status ? [completion] : [], has_more: false }); }
    if (init.method === 'PATCH') { Object.assign(completion.properties, body.properties); return Response.json(completion); }
    return Response.json({ id: 'scoreboard', object: 'page', properties: body.properties });
  };
  const out = await syncParty(env, { fetcher: partyFetcher, sleep: async () => {}, today: '2026-10-12', quests: [] }, store);
  assert.equal(out.imported, 1); assert.equal(completion.properties.Status.select.name, 'Counted');
  const after = await call(n, 'GET');
  assert.equal(after.data.revision, 2); assert.equal(Engine.total(after.data.state), 80); assert.equal(after.data.state.entries[1].bot, 'jane');
});
