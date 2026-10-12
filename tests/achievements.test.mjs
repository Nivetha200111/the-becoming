import { test } from 'node:test';
import assert from 'node:assert/strict';
import Engine from '../lib/engine.cjs';
import Roster from '../lib/roster.cjs';
import { syncAchievements, achievementEntry, applyAchievements, achievementsConfigured, DOMAINS } from '../lib/achievements-sync.mjs';

const TODAY = '2026-10-12';
const env = { NOTION_TOKEN: 'private-test-token-long-enough', NOTION_ACHIEVEMENTS_DATA_SOURCE_ID: 'c'.repeat(32) };
let n = 0;
const row = (name, xp, domain, { date, details, why, created = '2026-09-30T10:00:00.000Z', trashed = false } = {}) => ({
  object: 'page', id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, created_time: created, in_trash: trashed,
  properties: { Achievement: { title: [{ plain_text: name }] }, XP: { number: xp }, Domain: { select: domain ? { name: domain } : null },
    Date: { date: date ? { start: date } : null }, Details: { rich_text: details ? [{ plain_text: details }] : [] }, 'Why It Matters': { rich_text: why ? [{ plain_text: why }] : [] } },
});
function world(rows, state = Engine.fresh()) {
  let revision = 1, saved = JSON.parse(JSON.stringify(state)), queries = 0, conflicts = 0;
  const fetcher = async (url, init) => { queries++; assert(url.includes('/data_sources/' + env.NOTION_ACHIEVEMENTS_DATA_SOURCE_ID + '/query')); assert.equal(init.headers.Authorization, 'Bearer ' + env.NOTION_TOKEN); return Response.json({ results: rows, has_more: false }); };
  const store = { load: async () => ({ status: 200, data: { revision, state: saved && JSON.parse(JSON.stringify(saved)) } }),
    save: async body => { if (conflicts) { conflicts--; revision++; return { status: 409, data: { revision, state: saved } }; } if (body.expectedRevision !== revision) return { status: 409, data: { revision, state: saved } }; saved = Engine.validate(body.state); revision++; return { status: 200, data: { revision, state: saved } }; } };
  return { fetcher, store, state: () => saved, clear: () => { saved = null; }, conflict: k => { conflicts = k; }, queries: () => queries, run: () => syncAchievements(env, { fetcher, sleep: async () => {}, today: TODAY }, store) };
}

test('achievements with XP are counted once, with their domain, date and evidence', async () => {
  const rows = [
    row('Contract management demo closed the client deal', 250, 'Work', { date: '2026-10-08', details: 'Deal closed after the demo.' }),
    row('ServiceNow Certified System Administrator (CSA)', 200, 'ServiceNow Cert', { why: 'Core platform credential.' }),
    row('Claude Code in Action', 75, 'Claude Cert', { date: '2026-06-01' }),
    row('Ruby: built grid + traversal for snake game', 10, 'Career', { date: '2026-09-15' }),
    row('A role with no XP', null, 'Career'), row('Zero is not XP', 0, 'Work'), row('In the trash', 100, 'Work', { trashed: true }),
  ];
  const w = world(rows), out = await w.run();
  assert.deepEqual({ status: out.status, total: out.total, imported: out.imported, updated: out.updated, xp: out.xp }, { status: 'synced', total: 4, imported: 4, updated: 0, xp: 535 });
  const s = w.state(); assert.equal(Engine.total(s), 535);
  const demo = s.entries.find(e => e.title.startsWith('Contract management'));
  assert.deepEqual({ stat: demo.stat, region: demo.region, bot: demo.bot, date: demo.date, note: demo.note, xp: demo.xp }, { stat: 'LEVERAGE', region: 'citadel', bot: 'carmen', date: '2026-10-08', note: 'Deal closed after the demo.', xp: 250 });
  const csa = s.entries.find(e => e.title.includes('CSA'));
  assert.equal(csa.date, '2026-09-30', 'no Date: the day the row was created'); assert.equal(csa.note, 'Core platform credential.'); assert.equal(csa.bot, 'beth');
  assert.equal(s.entries.find(e => e.title === 'Claude Code in Action').note, 'Logged in ACHIEVEMENTS on NIVETHA LIFE OS.');
  assert(s.entries.every(e => /^achv:[0-9a-f]{32}$/.test(e.key)));
  // Running again changes nothing and saves nothing.
  const again = await w.run(); assert.equal(again.imported, 0); assert.equal(again.updated, 0); assert.equal(Engine.total(w.state()), 535);
});

test('every domain maps to a real stat and a bot in the roster', () => {
  for (const [name, d] of Object.entries(DOMAINS)) { assert(Engine.stats.includes(d.stat), name); assert(Roster.find(d.bot), name + ' → ' + d.bot); }
  const other = achievementEntry(row('Something unfiled', 20, null), TODAY); assert.equal(other.stat, 'FOCUS'); assert.equal(other.region, 'camp'); assert.equal('bot' in other, false);
});

test('odd rows are made safe: big XP is capped, fractions rounded, future dates pulled back', () => {
  assert.equal(achievementEntry(row('Huge', 900, 'Work'), TODAY).xp, 250);
  assert.equal(achievementEntry(row('Fraction', 12.6, 'Work'), TODAY).xp, 13);
  assert.equal(achievementEntry(row('Planned ahead', 50, 'Work', { date: '2027-01-01' }), TODAY).date, TODAY);
  assert.equal(achievementEntry(row('', 50, 'Work'), TODAY), null); assert.equal(achievementEntry(row('Negative', -5, 'Work'), TODAY), null);
  const s = Engine.fresh(); s.entries.push(achievementEntry(row('Huge', 900, 'Work', { details: 'x'.repeat(5000) }), TODAY)); Engine.validate(s);
});

test('game claims are kept, and an achievement edited in Notion updates its entry instead of counting twice', async () => {
  const mine = Engine.fresh(); Engine.award(mine, { id: 'focus', title: 'Protect one focus block', stat: 'FOCUS', xp: 40, region: 'camp', repeat: true, unlock: 1 }, 'Done', TODAY);
  const cert = row('Contract Management Pro certification', 150, 'ServiceNow Cert', { date: '2026-10-09' }), w = world([cert], mine);
  await w.run(); assert.equal(Engine.total(w.state()), 190); assert.equal(w.state().entries.length, 2);
  cert.properties.XP.number = 200; cert.properties.Achievement.title[0].plain_text = 'Contract Management Pro certification (verified)';
  const out = await w.run();
  assert.deepEqual({ imported: out.imported, updated: out.updated, xp: out.xp }, { imported: 0, updated: 1, xp: 50 });
  assert.equal(Engine.total(w.state()), 240); assert.equal(w.state().entries.length, 2);
  // Removing the row in Notion leaves the XP in the game.
  cert.in_trash = true; await w.run(); assert.equal(Engine.total(w.state()), 240);
});

test('an achievement lowered in Notion settles anything it no longer pays for', () => {
  const s = Engine.fresh(), big = achievementEntry(row('Big win', 250, 'Work'), TODAY), small = achievementEntry(row('Small win', 60, 'Work'), TODAY); s.entries.push(big, small); // 31 coins, 155 bronze
  Engine.buyGear(s, 'w1', TODAY); s.purchases.push({ id: 'ember', cost: 30 }); s.equipped = 'ember'; Engine.validate(s); // 50 bronze and 30 coins spent
  const lowered = applyAchievements(s, [{ ...big, xp: 20 }, small]); // now 8 coins and 40 bronze: neither purchase is covered
  assert.equal(lowered.updated, 1); assert.equal(lowered.xp, -230);
  assert.deepEqual(lowered.state.armory, []); assert.deepEqual(lowered.state.purchases, []); assert.equal(lowered.state.equipped, 'sage');
  Engine.validate(lowered.state);
});

test('it waits for a save, retries a conflict, and stays out of the way when it cannot read Notion', async () => {
  const rows = [row('First', 50, 'Work', { date: '2026-10-01' })];
  const empty = world(rows); empty.clear(); assert.equal((await empty.run()).status, 'waiting');
  const busy = world(rows); busy.conflict(2); const out = await busy.run(); assert.equal(out.imported, 1); assert.equal(Engine.total(busy.state()), 50);
  const store = { load: async () => { throw Error('must not be touched'); }, save: async () => { throw Error('must not be touched'); } };
  const denied = await syncAchievements(env, { fetcher: async () => Response.json({ code: 'object_not_found' }, { status: 404 }), sleep: async () => {}, today: TODAY }, store);
  assert.equal(denied.status, 'no-access'); assert.match(denied.error, /Share the ACHIEVEMENTS database/);
  assert.equal((await syncAchievements({ ...env, ACHIEVEMENTS_SYNC: 'off' })).status, 'unconfigured'); assert.equal((await syncAchievements({})).status, 'unconfigured');
  assert.equal((await syncAchievements({ ...env, NODE_ENV: 'development', LOCAL_DESIGN_MODE: 'true' })).status, 'local');
  assert.equal(achievementsConfigured(env), true);
});
