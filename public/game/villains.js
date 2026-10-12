(function (root) {
  'use strict';
  // Three villains stand for the ways a day slips away. Each one lurks until a real, claimed action banishes it
  // for that day. Everything here is derived from the save's claimed entries: nothing is stored, and a villain
  // never awards or removes XP. Pure rules shared by the world, the daily card and the tests.
  const LIST = [
    { id: 'procrastination', name: 'The Procrastination Monster', title: 'Procrastination Monster',
      taunts: ['Later is a lovely time. Let’s do it later.', 'Five more minutes. Then five more.', 'You could start… or you could tidy your desk first.'],
      weakness: 'Claim any quest today. One small finished thing is enough.',
      defeat: 'One finished thing, and it has nothing left to say.' },
    { id: 'distraction', name: 'The Distraction Devil', title: 'Distraction Devil',
      taunts: ['Psst. Just one quick look. What could it hurt?', 'Seventeen tabs is a perfectly normal number of tabs.', 'Ooh, a notification. Probably important.'],
      weakness: 'Claim a FOCUS quest today: protect a focus block or close an open loop.',
      defeat: 'Your attention stayed yours today.' },
    { id: 'boredom', name: 'The Boredom Bear', title: 'Boredom Bear',
      taunts: ['The same thing again? Yaaawn.', 'Nothing new under the sun. Might as well nap.', 'Wake me when something interesting happens.'],
      weakness: 'Claim something you haven’t done in the past week, or take on a boss battle.',
      defeat: 'Something new happened, and it wandered off.' },
  ];
  const LOOKBACK = 7, MAX_STRENGTH = 5;
  // Each villain has three forms to wear down, then endless ones. The numbers are the health of each form.
  const FORMS = [10, 25, 50], ENDLESS = 100;
  function shift(date, n) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  const questOf = e => e.questId || e.title;
  // What was claimed in the week before `date`; the Boredom Bear only yields to something outside it.
  function recent(state, date) { const from = shift(date, -LOOKBACK); return new Set(state.entries.filter(e => e.date >= from && e.date < date).map(questOf)); }
  // The claimed entries on `date` that banish a villain.
  function banishers(state, id, date) {
    const claimed = state.entries.filter(e => e.date === date);
    if (id === 'procrastination') return claimed;
    if (id === 'distraction') return claimed.filter(e => e.stat === 'FOCUS');
    const seen = recent(state, date); return claimed.filter(e => e.boss || !seen.has(questOf(e)));
  }
  const banishedOn = (state, id, date) => banishers(state, id, date).length > 0;
  // Would claiming this quest today banish the villain?
  function counters(id, quest, state, today) {
    if (id === 'procrastination') return true;
    if (id === 'distraction') return quest.stat === 'FOCUS';
    return !!quest.boss || !recent(state, today).has(quest.id);
  }
  // How many days in a row, up to yesterday, it went unchallenged. It only starts counting once the adventure has begun.
  function strength(state, id, today) {
    const first = state.entries.reduce((min, e) => !min || e.date < min ? e.date : min, '');
    let n = 0; if (!first) return 0;
    for (let d = shift(today, -1); n < MAX_STRENGTH && d >= first && !banishedOn(state, id, d); d = shift(d, -1)) n++;
    return n;
  }
  // The long fight. Every day a villain is banished it takes damage: 1 bare-handed, or the best weapon owned that day
  // (`gear` is the engine, which knows the armoury). Wearing a form down to nothing brings on the next, tougher one.
  function battle(state, id, gear) {
    let damage = 0;
    for (const date of new Set(state.entries.map(e => e.date))) if (banishedOn(state, id, date)) damage += gear ? gear.weaponPower(state, date) : 1;
    let form = 1, left = damage;
    for (;;) { const max = FORMS[form - 1] || ENDLESS; if (left < max) return { form, max, hp: max - left, damage }; left -= max; form++; }
  }
  // On a recovery day the villains sleep: rest is a deliberate choice, not a defeat. A shield against a villain
  // (bought in the armoury) stops it growing, however long it goes unchallenged.
  function status(state, today, gear) {
    const resting = state.mode === 'recovery';
    return LIST.map(v => {
      const by = banishers(state, v.id, today)[0] || null, shielded = !!gear && gear.owns(state, 'shield-' + v.id);
      return { ...v, banished: !!by, by, resting: resting && !by, lurking: !resting && !by, shielded, strength: shielded ? 0 : strength(state, v.id, today), battle: battle(state, v.id, gear) };
    });
  }
  // On how many days so far it was banished.
  function tally(state, id) { return [...new Set(state.entries.map(e => e.date))].filter(date => banishedOn(state, id, date)).length; }
  const api = { LIST, status, counters, banishedOn, strength, tally, battle, MAX_STRENGTH, FORMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Villains = api;
})(typeof window !== 'undefined' ? window : globalThis);
