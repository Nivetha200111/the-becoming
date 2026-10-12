import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import Engine from '../lib/engine.cjs';
// The browser script is loaded the way the page loads it, with a module shim to collect its API.
const context = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../public/game/villains.js', import.meta.url), 'utf8'), context);
const Villains = context.module.exports;

const TODAY = '2026-10-12';
const quest = (id, stat, extra = {}) => ({ id, title: id, stat, xp: 20, region: 'camp', repeat: true, unlock: 1, ...extra });
const claim = (state, q, date = TODAY) => Engine.award(state, q, 'done', date);
const by = (state, today = TODAY) => Object.fromEntries(Villains.status(state, today).map(v => [v.id, v]));

test('all three lurk on a day with nothing claimed, and never change XP', () => {
  const s = Engine.fresh(), v = by(s);
  assert.deepEqual(Object.keys(v), ['procrastination', 'distraction', 'boredom']);
  for (const x of Object.values(v)) { assert.equal(x.lurking, true); assert.equal(x.banished, false); assert.equal(x.strength, 0); }
  assert.equal(Engine.total(s), 0); assert.deepEqual(Engine.validate(s), s); // nothing was written into the save
});

test('any claim banishes the Procrastination Monster; only a FOCUS claim banishes the Distraction Devil', () => {
  const s = Engine.fresh(); claim(s, quest('train', 'END'));
  let v = by(s);
  assert.equal(v.procrastination.banished, true); assert.equal(v.procrastination.by.questId, 'train');
  assert.equal(v.distraction.lurking, true);
  claim(s, quest('focus', 'FOCUS')); v = by(s);
  assert.equal(v.distraction.banished, true); assert.equal(v.distraction.lurking, false);
  assert.equal(Villains.counters('distraction', quest('loop', 'FOCUS'), s, TODAY), true);
  assert.equal(Villains.counters('distraction', quest('build', 'BUILD'), s, TODAY), false);
  assert.equal(Villains.counters('procrastination', quest('build', 'BUILD'), s, TODAY), true);
});

test('the Boredom Bear yields only to something new this week, or to a boss', () => {
  const s = Engine.fresh();
  for (const d of ['2026-10-09', '2026-10-10', '2026-10-11']) claim(s, quest('focus', 'FOCUS'), d);
  claim(s, quest('focus', 'FOCUS'));
  assert.equal(by(s).boredom.lurking, true, 'the same daily again does not banish it');
  assert.equal(Villains.counters('boredom', quest('focus', 'FOCUS'), s, TODAY), false);
  assert.equal(Villains.counters('boredom', quest('spm', 'INT'), s, TODAY), true);
  assert.equal(Villains.counters('boredom', quest('focus', 'FOCUS', { boss: true }), s, TODAY), true);
  claim(s, quest('spm', 'INT'));
  assert.equal(by(s).boredom.banished, true);
  // Something last done more than a week ago counts as new again.
  const t = Engine.fresh(); claim(t, quest('train', 'END'), '2026-10-01'); claim(t, quest('train', 'END'));
  assert.equal(by(t).boredom.banished, true);
});

test('a recovery day puts the villains to sleep instead of counting as a loss', () => {
  const s = Engine.fresh(); s.mode = 'recovery';
  for (const x of Object.values(by(s))) { assert.equal(x.resting, true); assert.equal(x.lurking, false); assert.equal(x.banished, false); }
  claim(s, quest('recover', 'END'));
  const v = by(s); assert.equal(v.procrastination.banished, true); assert.equal(v.procrastination.resting, false); assert.equal(v.distraction.resting, true);
});

test('an unchallenged villain grows a day at a time, from the first claim only, and is capped', () => {
  const s = Engine.fresh(); claim(s, quest('focus', 'FOCUS'), '2026-10-08');
  let v = by(s);
  assert.equal(v.procrastination.strength, 3); // the 9th, 10th and 11th passed with nothing claimed
  assert.equal(v.distraction.strength, 3);
  claim(s, quest('train', 'END'), '2026-10-11'); v = by(s);
  assert.equal(v.procrastination.strength, 0); assert.equal(v.distraction.strength, 3);
  const old = Engine.fresh(); claim(old, quest('focus', 'FOCUS'), '2026-09-01');
  assert.equal(by(old).procrastination.strength, Villains.MAX_STRENGTH);
});

test('the tally counts the days each villain was banished', () => {
  const s = Engine.fresh();
  claim(s, quest('focus', 'FOCUS'), '2026-10-10'); claim(s, quest('train', 'END'), '2026-10-11'); claim(s, quest('focus', 'FOCUS'), TODAY);
  assert.equal(Villains.tally(s, 'procrastination'), 3);
  assert.equal(Villains.tally(s, 'distraction'), 2);
  assert.equal(Villains.tally(s, 'boredom'), 2); // focus was new on the 10th, train on the 11th, focus again on the 12th was not
  assert.equal(Villains.banishedOn(s, 'boredom', TODAY), false);
});
