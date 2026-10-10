(function (root) {
  'use strict';
  // Pure rules shared by the UI and tests. GPS never becomes quest evidence or XP.
  function distance(a, b) {
    const rad = x => x * Math.PI / 180;
    const dlat = rad(b.latitude - a.latitude), dlon = rad(b.longitude - a.longitude);
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dlon / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  function validOffice(o) {
    return !!o && Number.isFinite(o.latitude) && Math.abs(o.latitude) <= 90 &&
      Number.isFinite(o.longitude) && Math.abs(o.longitude) <= 180 &&
      Number.isFinite(o.radius) && o.radius >= 100 && o.radius <= 1000;
  }
  function presence(office, fix, previous = 'unknown', now = Date.now()) {
    if (!validOffice(office) || !fix || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 ||
      !Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90 ||
      !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180 ||
      !Number.isFinite(fix.timestamp) || now - fix.timestamp > 120000 || fix.timestamp > now + 10000) return 'unknown';
    const d = distance(office, fix);
    // Require the uncertainty circle to be inside/outside; a buffer prevents border jitter.
    if (d + fix.accuracy <= office.radius) return 'office';
    if (d - fix.accuracy > office.radius + 75) return 'away';
    return previous;
  }
  function milestones(before, after, engine, areas) {
    const oldKeys = new Set(before.entries.map(e => e.key));
    const fresh = after.entries.filter(e => !oldKeys.has(e.key));
    if (!fresh.length) return [];
    const from = engine.level(engine.total(before)), to = engine.level(engine.total(after));
    const events = [{ kind: 'xp', title: `+${fresh.reduce((n, e) => n + e.xp, 0)} XP`,
      detail: `+${Math.max(0, engine.goldEarned(after) - engine.goldEarned(before)).toLocaleString('en-IN')} gold · ${fresh.length === 1 ? fresh[0].title : fresh.length + ' quests completed'}` }];
    if (to > from) events.push({ kind: 'level', title: `Level ${to} reached`, detail: 'Your next chapter is open.' });
    for (const r of areas) if (r.unlock > from && r.unlock <= to)
      events.push({ kind: 'area', title: `${r.name} unlocked`, detail: 'A new place to explore.', area: r.id });
    const a = engine.statTotals(before), b = engine.statTotals(after);
    for (const stat of engine.stats) for (const threshold of [100, 300, 750])
      if (a[stat] < threshold && b[stat] >= threshold)
        events.push({ kind: 'skill', title: `${stat} milestone`, detail: `${threshold} skill XP · a new branch blooms.` });
    for (const tier of engine.TIERS) if (!engine.tierOpen(before, tier) && engine.tierOpen(after, tier))
      events.push({ kind: 'treasury', title: `${tier.name} treasures unlocked`, detail: 'New rewards await in the Treasury.' });
    return events;
  }
  const api = { distance, validOffice, presence, milestones };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LifeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
