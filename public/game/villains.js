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
  // On a recovery day the villains sleep: rest is a deliberate choice, not a defeat.
  function status(state, today) {
    const resting = state.mode === 'recovery';
    return LIST.map(v => { const by = banishers(state, v.id, today)[0] || null; return { ...v, banished: !!by, by, resting: resting && !by, lurking: !resting && !by, strength: strength(state, v.id, today) }; });
  }
  // On how many days so far it was banished.
  function tally(state, id) { return [...new Set(state.entries.map(e => e.date))].filter(date => banishedOn(state, id, date)).length; }
  const api = { LIST, status, counters, banishedOn, strength, tally, MAX_STRENGTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Villains = api;
})(typeof window !== 'undefined' ? window : globalThis);
