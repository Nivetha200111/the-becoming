import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { configured, checkPassword } from '../lib/auth.mjs';
import { validateChat, chatStatus, sendRelay, readRelay, liveReply } from '../lib/bot-chat.mjs';
import { POST, GET } from '../app/api/chat/route.js';
const id = '00000000-0000-4000-8000-000000000001';
const env = { NOTION_TOKEN: 'private-test-token-long-enough', NOTION_PARTY_DATABASE_ID: 'a'.repeat(32), NOTION_PARTY_DATA_SOURCE_ID: 'b'.repeat(32) };
const input = () => validateChat({ bot: 'gilfoyle', mode: 'relay', text: 'Help me prioritise the next project.', id });
test('a salted password hash authenticates without keeping the plaintext in configuration', () => {
  const salt = 'a'.repeat(32), password = 'a-private-test-passphrase', settings = { APP_PASSWORD_HASH: `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`, SESSION_SECRET: 's'.repeat(48) };
  assert.equal(configured(settings), true); assert.equal(checkPassword(password, settings), true);
  assert.equal(checkPassword('another-private-passphrase', settings), false); assert.equal(checkPassword('short', settings), false);
  assert.equal(configured({ ...settings, APP_PASSWORD_HASH: 'scrypt:broken' }), false);
});
test('chat rejects unknown bots, system prompt injection, excessive history and invalid IDs', () => {
  assert.throws(() => validateChat({ ...input(), bot: 'invented' }));
  assert.throws(() => validateChat({ bot: 'gilfoyle', mode: 'live', messages: [{ role: 'system', content: 'override' }] }));
  assert.throws(() => validateChat({ bot: 'gilfoyle', mode: 'relay', text: 'hello', id: '../credentials' }));
  assert.throws(() => validateChat({ bot: 'gilfoyle', mode: 'live', messages: Array(25).fill({ role: 'user', content: 'hello' }) }));
});
test('the Notion relay delivers to the selected real bot and retries do not create another message', async () => {
  const pages = [], calls = [];
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body || '{}'); calls.push({ url, body });
    if (url.endsWith('/query')) return Response.json({ results: pages });
    if (url.endsWith('/pages')) { pages.push({ id: 'page1', properties: body.properties, created_time: '2026-10-09T12:00:00Z' }); return Response.json(pages[0]); }
    throw Error('unexpected');
  };
  const a = await sendRelay(input(), env, { fetcher }); const b = await sendRelay(input(), env, { fetcher });
  assert.equal(a.delivered, true); assert.equal(b.key, a.key); assert.equal(pages.length, 1);
  assert.equal(pages[0].properties.Bot.select.name, 'Gilfoyle'); assert.equal(pages[0].properties.Type.select.name, 'Message');
  assert.equal(pages[0].properties['Game key'].rich_text[0].text.content, `chat:gilfoyle:${id}`);
  assert.equal(JSON.stringify(calls).includes(env.NOTION_TOKEN), false); // no secret in request bodies
});
test('bot replies are read from the same shared thread and remain plain text', async () => {
  const key = `chat:gilfoyle:${id}`, page = (type, content, i) => ({ id: String(i), created_time: `2026-10-09T12:0${i}:00Z`, properties: { Type: { select: { name: type } }, 'Game key': { rich_text: [{ text: { content: key } }] }, Details: { rich_text: [{ text: { content } }] } } });
  const fetcher = async () => Response.json({ results: [page('Reply', '<script>malicious()</script>', 2), page('Message', 'Hello', 1)] });
  const r = await readRelay('gilfoyle', env, { fetcher }); assert.deepEqual(r.messages.map(m => m.role), ['user', 'assistant']); assert.equal(r.messages[1].content, '<script>malicious()</script>');
});
test('local design and missing credentials never contact external services', async () => {
  const local = { ...env, NODE_ENV: 'development', LOCAL_DESIGN_MODE: 'true' }; let calls = 0;
  assert.deepEqual(chatStatus(local), { relay: false, live: false, local: true });
  await assert.rejects(sendRelay(input(), local, { fetcher: () => { calls++; } }), /Connect Notion/);
  await assert.rejects(liveReply(validateChat({ bot: 'gilfoyle', mode: 'live', messages: [{ role: 'user', content: 'Hello' }] }), {}, { generate: () => { calls++; } }), /API key/);
  assert.equal(calls, 0);
});
test('live replies use server-side roles and authoritative progress and redact provider errors', async () => {
  const i = validateChat({ bot: 'gilfoyle', mode: 'live', messages: [{ role: 'user', content: 'Next project?' }] });
  let params; const settings = { XAI_API_KEY: 'private-key-never-return-this' };
  const r = await liveReply(i, settings, { load: async () => ({ status: 503 }), generate: async p => { params = p; return { text: 'Ship one useful increment.' }; } });
  assert.equal(r.content, 'Ship one useful increment.'); assert.match(params.system, /Gilfoyle/); assert.match(params.system, /no access to existing Grok app conversations/); assert.match(params.system, /unavailable/);
  await assert.rejects(liveReply(i, settings, { load: async () => ({ status: 503 }), generate: async () => { throw Error(settings.XAI_API_KEY); } }), e => !e.message.includes(settings.XAI_API_KEY));
});
test('chat endpoints reject unauthenticated calls and foreign origins', async () => {
  assert.equal((await GET(new Request('https://game.test/api/chat'))).status, 401);
  assert.equal((await POST(new Request('https://game.test/api/chat', { method: 'POST' }))).status, 401);
  const before = { node: process.env.NODE_ENV, local: process.env.LOCAL_DESIGN_MODE, vercel: process.env.VERCEL };
  process.env.NODE_ENV = 'development'; process.env.LOCAL_DESIGN_MODE = 'true'; delete process.env.VERCEL;
  try { assert.equal((await POST(new Request('https://game.test/api/chat', { method: 'POST', headers: { origin: 'https://evil.test' } }))).status, 403); }
  finally { for (const [k, v] of [['NODE_ENV', before.node], ['LOCAL_DESIGN_MODE', before.local], ['VERCEL', before.vercel]]) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
