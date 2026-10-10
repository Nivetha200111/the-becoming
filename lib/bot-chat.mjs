import Roster from './roster.cjs';
import Engine from './engine.cjs';
import { localDesignMode } from './auth.mjs';
import { partyConfigured, PARTY } from './party-sync.mjs';
import { notionClient, resolveSource, rich, plain } from './notion-sync.mjs';

export class ChatError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function chatStatus(env = process.env) {
  if (localDesignMode(env)) return { relay: false, local: true };
  return { relay: partyConfigured(env), local: false };
}
export function validateChat(body) {
  const bot = Roster.ALL.find(b => b.id === body?.bot);
  if (!bot) throw new ChatError('Choose a bot from your party.');
  if (body.mode !== 'relay') throw new ChatError('Chat uses your Notion inbox. Paid AI connections are disabled.');
  if (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.id)) throw new ChatError('Message ID is invalid.');
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) throw new ChatError('Use a message of 1–2000 characters.');
  return { bot, id: body.id, text: body.text.trim(), mode: 'relay' };
}
const select = (property, name) => ({ property, select: { equals: name } });
const keyFilter = key => ({ property: PARTY.key, rich_text: { equals: key } });
const messageKey = (bot, id) => `chat:${bot.id}:${id}`;
async function connection(env, options) {
  if (!chatStatus(env).relay) throw new ChatError('Connect Notion Party HQ to message your existing bots.', 503);
  const client = notionClient(env, options);
  const source = await resolveSource(client, env.NOTION_PARTY_DATABASE_ID.replace(/-/g, ''), env.NOTION_PARTY_DATA_SOURCE_ID, 'NOTION_PARTY_DATA_SOURCE_ID');
  return { client, source };
}
export async function sendRelay(input, env = process.env, options = {}) {
  const { client, source } = await connection(env, options), key = messageKey(input.bot, input.id);
  // Retries reuse one UUID. Notion is the durable inbox; no server filesystem is used.
  const existing = await client.call('POST', `/data_sources/${source}/query`, { filter: { and: [keyFilter(key), select(PARTY.type, 'Message')] }, page_size: 10 });
  const previous = existing.results?.find(p => !p.in_trash && !p.archived);
  if (previous) {
    if (plain(previous.properties?.[PARTY.details]?.rich_text) !== input.text) throw new ChatError('That message ID was already used.', 409);
    return { id: input.id, key, delivered: true };
  }
  const page = await client.call('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: source }, properties: {
    [PARTY.title]: { title: rich(`Nivetha → ${input.bot.name}`) }, [PARTY.bot]: { select: { name: input.bot.name } },
    [PARTY.type]: { select: { name: 'Message' } }, [PARTY.status]: { select: { name: 'New' } },
    [PARTY.details]: { rich_text: rich(input.text) }, [PARTY.key]: { rich_text: rich(key) }, [PARTY.date]: { date: { start: Engine.day() } },
  } });
  await pingGrokWebhook({ gameKey: key, bot: input.bot.name, notionPageId: page?.id || null }, env, options);
  return { id: input.id, key, delivered: true };
}
// Server-side only: nudges the Grok Bot routine so a new Message row is dispatched instantly.
// Bounded to ~3s and never throws, so a webhook failure cannot break sending the message.
export async function pingGrokWebhook(payload, env = process.env, options = {}) {
  const url = (env.GROK_WEBHOOK_URL || '').trim();
  let auth = (env.GROK_WEBHOOK_AUTH || '').trim().replace(/^authorization\s*:\s*/i, '').replace(/^["']|["']$/g, '').trim();
  if (auth && !/^bearer\s+/i.test(auth)) auth = 'Bearer ' + auth;
  auth = auth.replace(/^bearer\s+(bearer\s+)+/i, 'Bearer ');
  if (!url || !auth) { console.warn('grok webhook skipped: env missing', { url: !!url, auth: !!auth }); return false; }
  const send = options.webhookFetcher || globalThis.fetch;
  try {
    const res = await send(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(options.webhookTimeoutMs ?? 3000) });
    console.log('grok webhook status', res?.status);
    return !!res?.ok;
  } catch (e) { console.warn('grok webhook error', e?.name, e?.message); return false; }
}
export async function readRelay(botId, env = process.env, options = {}) {
  const bot = Roster.ALL.find(b => b.id === botId); if (!bot) throw new ChatError('Choose a bot from your party.');
  const { client, source } = await connection(env, options);
  const r = await client.call('POST', `/data_sources/${source}/query`, { filter: { and: [select(PARTY.bot, bot.name), { property: PARTY.key, rich_text: { starts_with: `chat:${bot.id}:` } }, { or: [select(PARTY.type, 'Message'), select(PARTY.type, 'Reply')] }] }, sorts: [{ timestamp: 'created_time', direction: 'descending' }], page_size: 100 });
  const seen = new Set(), messages = [];
  for (const p of [...(r.results || [])].reverse()) {
    if (p.in_trash || p.archived) continue;
    const props = p.properties || {}, role = props[PARTY.type]?.select?.name === 'Reply' ? 'assistant' : 'user';
    const key = plain(props[PARTY.key]?.rich_text), content = plain(props[PARTY.details]?.rich_text).slice(0, 4000), unique = role + ':' + key;
    if (!content || seen.has(unique)) continue; seen.add(unique);
    messages.push({ id: p.id, key, role, content, at: p.created_time });
  }
  return { messages, more: !!r.has_more };
}
