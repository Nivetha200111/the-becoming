import Engine from './engine.cjs';
import { localDesignMode } from './auth.mjs';
import { savedState } from './save-store.mjs';
import { notionClient, resolveSource, plain, text, NotionError } from './notion-sync.mjs';

// ACHIEVEMENTS is where Nivetha's bots have always logged real XP: NIVETHA LIFE OS says "Total XP = sum of XP in
// ACHIEVEMENTS". This reads that database into the save, one entry per achievement that carries XP, keyed by its
// Notion page so it is counted once. It runs with the Party HQ exchange, so a new achievement shows up in the game
// the next time it is open. One way only (Notion -> game): entries are added and kept up to date, never removed here.
export const ACHIEVEMENTS = { title: 'Achievement', xp: 'XP', domain: 'Domain', date: 'Date', details: 'Details', why: 'Why It Matters' };
const DEFAULT_DATABASE = '48f1a988655045eca9d0b3399b78ba1b', DEFAULT_SOURCE = '1003a2a2-0422-415d-93c9-2bb163e13099';
// Each LIFE OS domain maps to a stat, the place it belongs to, and the bot whose charter it is.
export const DOMAINS = {
  'ServiceNow Cert': { stat: 'INT', region: 'tower', bot: 'beth' }, 'Claude Cert': { stat: 'INT', region: 'temple', bot: 'beatrix' },
  Work: { stat: 'LEVERAGE', region: 'citadel', bot: 'carmen' }, Career: { stat: 'LEVERAGE', region: 'summit', bot: 'gilfoyle' },
  Systems: { stat: 'BUILD', region: 'lab', bot: 'dexter' }, Body: { stat: 'END', region: 'grove', bot: 'goggins' }, Life: { stat: 'FOCUS', region: 'camp', bot: 'jane' },
};
const OTHER = { stat: 'FOCUS', region: 'camp' }, MAX_XP = 250, FIELDS = ['title', 'stat', 'xp', 'note', 'date', 'region', 'bot'];

export function achievementsConfigured(env = process.env) { return env.ACHIEVEMENTS_SYNC !== 'off' && typeof env.NOTION_TOKEN === 'string' && env.NOTION_TOKEN.length >= 20; }

// One achievement row -> the entry the game keeps. Rows without XP or a name are not achievements to count.
export function achievementEntry(page, today) {
  const p = page.properties || {}, raw = p[ACHIEVEMENTS.xp]?.number, title = plain(p[ACHIEVEMENTS.title]?.title).trim();
  if (!Number.isFinite(raw) || raw <= 0 || !title) return null;
  const d = DOMAINS[p[ACHIEVEMENTS.domain]?.select?.name] || OTHER, id = page.id.replace(/-/g, '');
  let date = (p[ACHIEVEMENTS.date]?.date?.start || page.created_time || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) date = today;
  const note = text(plain(p[ACHIEVEMENTS.details]?.rich_text)).trim() || text(plain(p[ACHIEVEMENTS.why]?.rich_text)).trim() || 'Logged in ACHIEVEMENTS on NIVETHA LIFE OS.';
  // The engine caps a single entry at 250 XP, the size of a boss battle.
  return { key: 'achv:' + id, questId: 'achv:' + id, title: title.slice(0, 200), stat: d.stat, xp: Math.min(MAX_XP, Math.max(1, Math.round(raw))), note: note.slice(0, 2000), date, region: d.region, boss: false, ...(d.bot ? { bot: d.bot } : {}) };
}

// Pure: adds new achievements and refreshes changed ones. Returns the new state and what happened.
export function applyAchievements(state, entries) {
  const next = Engine.validate(JSON.parse(JSON.stringify(state))); let added = 0, updated = 0, xp = 0;
  for (const e of entries) {
    const i = next.entries.findIndex(x => x.key === e.key);
    if (i < 0) { next.entries.push(e); added++; xp += e.xp; }
    else if (FIELDS.some(f => next.entries[i][f] !== e[f])) { xp += e.xp - next.entries[i].xp; next.entries[i] = e; updated++; }
  }
  if (added || updated) {
    // An achievement edited down in Notion can leave less than was spent: settle it the way an undone claim does.
    while (Engine.coins(next) < 0 && next.purchases.length) next.purchases.pop();
    if (next.equipped !== 'sage' && !next.purchases.some(p => p.id === next.equipped)) next.equipped = 'sage';
    Engine.settleGear(next); Engine.validate(next);
  }
  return { state: next, added, updated, xp };
}

async function rows(client, source) {
  const pages = []; let cursor;
  do {
    const r = await client.call('POST', `/data_sources/${source}/query`, { filter: { property: ACHIEVEMENTS.xp, number: { is_not_empty: true } }, sorts: [{ timestamp: 'created_time', direction: 'ascending' }], page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const page of r.results || []) if (page.object === 'page' && !page.in_trash && !page.archived) pages.push(page);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return pages;
}

let queue = Promise.resolve();
const defaultStore = env => ({ load: () => savedState('GET', undefined, env), save: body => savedState('POST', body, env) });
export function syncAchievements(env = process.env, options = {}, store = defaultStore(env)) {
  if (localDesignMode(env)) return Promise.resolve({ status: 'local' });
  if (!achievementsConfigured(env)) return Promise.resolve({ status: 'unconfigured' });
  const run = queue.then(async () => {
    const client = notionClient(env, options), today = options.today || Engine.day();
    let entries;
    try {
      const own = env.NOTION_ACHIEVEMENTS_DATABASE_ID;
      const source = env.NOTION_ACHIEVEMENTS_DATA_SOURCE_ID || (own ? await resolveSource(client, own.replace(/-/g, ''), null, 'NOTION_ACHIEVEMENTS_DATA_SOURCE_ID') : DEFAULT_SOURCE);
      entries = (await rows(client, source)).map(page => achievementEntry(page, today)).filter(Boolean);
    } catch (e) {
      // The game's Notion connection has to be given the ACHIEVEMENTS database once; until then nothing is changed.
      if (e instanceof NotionError && e.status === 404) return { status: 'no-access', error: 'Share the ACHIEVEMENTS database with the game’s Notion connection.' };
      throw e;
    }
    const result = { status: 'synced', total: entries.length, imported: 0, updated: 0, xp: 0 };
    for (let attempt = 1; ; attempt++) {
      const r = await store.load(); if (r.status !== 200) throw new NotionError('Cloud save is unavailable.', 503);
      if (!r.data?.state) return { ...result, status: 'waiting' }; // nothing saved yet: count them once the game has a save
      const applied = applyAchievements(r.data.state, entries);
      if (!applied.added && !applied.updated) return result;
      const w = await store.save({ expectedRevision: r.data.revision, state: applied.state });
      if (w.status === 200) return { ...result, imported: applied.added, updated: applied.updated, xp: applied.xp, revision: w.data.revision };
      if (w.status !== 409 || attempt >= 4) throw new NotionError('The save kept changing. Achievements will retry.', 503);
    }
  });
  queue = run.catch(() => {}); return run;
}
export { DEFAULT_DATABASE };
