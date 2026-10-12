import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Engine from '../lib/engine.cjs';
import { savedState } from '../lib/save-store.mjs';
const sandbox = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../public/game/sync-core.js', import.meta.url), 'utf8'), sandbox);
const { merge } = sandbox.module.exports; // runs in its own realm, so arrays are copied before comparing

const q = (id, xp, extra = {}) => ({ id, title: id, stat: 'INT', xp, region: 'camp', repeat: false, unlock: 1, ...extra });
const copy = s => JSON.parse(JSON.stringify(s));
function rich(n = 4) { const s = Engine.fresh(); for (let i = 0; i < n; i++) Engine.award(s, q('boss' + i, 250, { boss: true }), 'done', '2026-10-0' + (i + 1)); return s; }

test('bronze is earned from claims, one for every two XP, and is never stored', () => {
  const s = Engine.fresh(); assert.equal(Engine.bronze(s), 0);
  Engine.award(s, q('a', 40), 'n', '2026-10-01'); Engine.award(s, q('b', 60), 'n', '2026-10-01'); Engine.award(s, q('c', 250, { boss: true }), 'n', '2026-10-02');
  assert.equal(Engine.bronzeEarned(s), 20 + 30 + 125); assert.equal(Engine.bronze(s), 175);
  assert.equal('bronze' in s, false);
  assert.equal(Engine.coins(s), 35); // adventure coins and gold are untouched by the new currency
});

test('weapons are forged in order and each costs more than the last', () => {
  const costs = Engine.WEAPONS.map(w => w.cost), powers = Engine.WEAPONS.map(w => w.power);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b)); assert.equal(new Set(costs).size, costs.length);
  assert.deepEqual(powers, [...powers].sort((a, b) => a - b));
  const s = rich(); // 500 bronze
  assert.throws(() => Engine.buyGear(s, 'w2'), /in order/);
  Engine.buyGear(s, 'w1', '2026-10-05'); assert.equal(Engine.bronze(s), 450); assert.equal(Engine.nextWeapon(s).id, 'w2');
  assert.throws(() => Engine.buyGear(s, 'w1'), /already own/);
  Engine.buyGear(s, 'w2', '2026-10-06'); Engine.buyGear(s, 'w3', '2026-10-07');
  assert.equal(Engine.bronze(s), 80); assert.throws(() => Engine.buyGear(s, 'w4'), /Not enough bronze/);
  assert.equal(Engine.weaponPower(s, '2026-10-04'), 1); assert.equal(Engine.weaponPower(s, '2026-10-05'), 2); assert.equal(Engine.weaponPower(s, '2026-10-09'), 5);
  assert.equal(Engine.bestWeapon(s).name, 'Focus Bow');
  Engine.validate(s);
});

test('each villain has its own shield, bought once', () => {
  const s = rich();
  Engine.buyGear(s, 'shield-distraction', '2026-10-05');
  assert.equal(Engine.owns(s, 'shield-distraction'), true); assert.equal(Engine.owns(s, 'shield-boredom'), false);
  assert.throws(() => Engine.buyGear(s, 'shield-distraction'), /already own/); assert.throws(() => Engine.buyGear(s, 'shield-nobody'), /Unknown gear/);
  assert.deepEqual(Engine.SHIELDS.map(x => x.foe), ['procrastination', 'distraction', 'boredom']);
});

test('saves from before the armoury stay valid, and tampered armouries are refused', () => {
  const old = rich(); delete old.armory; assert.deepEqual(Engine.validate(old).armory, []);
  const bad = (change, why) => { const s = rich(); Engine.buyGear(s, 'w1', '2026-10-05'); change(s); assert.throws(() => Engine.validate(s), why); };
  bad(s => { s.armory[0].cost = 1; }, /armoury purchase/);
  bad(s => { s.armory.push({ ...s.armory[0] }); }, /armoury purchase/);
  bad(s => { s.armory = [{ id: 'ar-w3', item: 'w3', cost: 250, date: '2026-10-05' }]; }, /weapon order/);
  bad(s => { s.armory.push({ id: 'ar-nothing', item: 'nothing', cost: 0, date: '2026-10-05' }); }, /armoury purchase/);
  bad(s => { s.entries = []; }, /bronze balance/);
});

test('undoing a claim hands back gear, dearest weapon first, until the bronze balances', () => {
  const s = rich(2); // 250 bronze
  Engine.buyGear(s, 'w1', '2026-10-03'); Engine.buyGear(s, 'w2', '2026-10-03'); Engine.buyGear(s, 'shield-procrastination', '2026-10-03'); // 230 spent
  s.entries.pop(); assert.equal(Engine.bronze(s), 125 - 230);
  assert.equal(Engine.settleGear(s), 1); // the Bronze Dagger goes back; the sword and the shield stay
  assert.deepEqual(s.armory.map(a => a.item), ['w1', 'shield-procrastination']); assert.equal(Engine.bronze(s), 15);
  Engine.validate(s); assert.equal(Engine.settleGear(s), 0);
});

test('two devices buying gear merge into one valid armoury', () => {
  const base = rich(), a = copy(base), b = copy(base);
  Engine.buyGear(a, 'w1', '2026-10-05'); Engine.buyGear(b, 'w1', '2026-10-05'); Engine.buyGear(b, 'shield-boredom', '2026-10-05');
  const both = merge(base, a, b); assert.deepEqual(Array.from(both.state.armory, x => x.item).sort(), ['shield-boredom', 'w1']); assert.equal(both.refunds, 0);
  Engine.validate(both.state);
  // One device handed a weapon back while the other forged the next: the ladder is repaired, never left with a gap.
  const base2 = copy(base); Engine.buyGear(base2, 'w1', '2026-10-05'); Engine.buyGear(base2, 'w2', '2026-10-05');
  const local = copy(base2); local.armory = local.armory.filter(x => x.item !== 'w2');
  const remote = copy(base2); Engine.buyGear(remote, 'w3', '2026-10-06');
  const fixed = merge(base2, local, remote).state; assert.deepEqual(Array.from(fixed.armory, x => x.item), ['w1']); Engine.validate(fixed);
  // Bronze spent on one device and lost on another (an undone claim) is refunded rather than left negative.
  const base3 = rich(1), spent = copy(base3); Engine.buyGear(spent, 'w1', '2026-10-02'); Engine.buyGear(spent, 'shield-procrastination', '2026-10-02');
  const undone = copy(base3); undone.entries = [];
  const settled = merge(base3, spent, undone); assert.equal(settled.state.armory.length, 0); assert.equal(settled.refunds, 2); Engine.validate(settled.state);
});

test('the armoury survives a save backend that drops unknown fields', async () => {
  const s = rich(); Engine.buyGear(s, 'w1', '2026-10-05'); Engine.buyGear(s, 'shield-distraction', '2026-10-05'); Engine.redeem(s, 'monster', '2026-10-05');
  s.custom.push({ id: 'custom-mine', title: 'Mine', detail: 'd', region: 'camp', stat: 'FOCUS', xp: 20, unlock: 1, repeat: false });
  let stored = null;
  const strict = st => ({ version: st.version, entries: st.entries, custom: st.custom.map(c => ({ id: c.id, title: c.title, detail: c.detail, region: c.region, stat: c.stat, xp: c.xp, unlock: c.unlock, repeat: c.repeat })), purchases: st.purchases, equipped: st.equipped, mode: st.mode, position: st.position, seenIntro: st.seenIntro });
  const fetcher = async (url, opts) => { if (opts.method === 'POST') { stored = strict(JSON.parse(opts.body).state); return Response.json({ revision: 1 }); } return Response.json({ revision: 1, state: stored }); };
  const env = { SITES_SAVE_TOKEN: 'test-only-token' };
  await savedState('POST', { expectedRevision: 0, state: s }, env, fetcher);
  assert.equal('armory' in stored, false);
  const back = (await savedState('GET', undefined, env, fetcher)).data.state;
  assert.deepEqual(back.armory.map(a => a.item).sort(), ['shield-distraction', 'w1']); assert.equal(back.rewards.length, 1);
  assert.deepEqual(back.custom.map(c => c.id), ['custom-mine']); // the hidden carriers never show up as quests
  assert.equal(Engine.bronze(Engine.validate(back)), Engine.bronze(s));
});
