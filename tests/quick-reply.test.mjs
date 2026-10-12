import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChat, sendRelay, readRelay, quickReply } from '../lib/bot-chat.mjs';

const env = { NOTION_TOKEN: 'private-test-token-long-enough', NOTION_PARTY_DATABASE_ID: 'a'.repeat(32), NOTION_PARTY_DATA_SOURCE_ID: 'b'.repeat(32), GROK_WEBHOOK_URL: 'https://hooks.example/grok', GROK_WEBHOOK_AUTH: 'Bearer test' };
const text = list => (list || []).map(r => r.text?.content ?? r.plain_text ?? '').join('');
// An in-memory Party HQ inbox plus a record of every webhook ping, which is what wakes a bot.
function inbox() {
  const pages = [], pings = []; let n = 0, failNextCreate = false;
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body || '{}');
    if (url.endsWith('/query')) {
      const want = JSON.stringify(body.filter);
      const types = ['Message', 'Reply'].filter(t => want.includes(`"equals":"${t}"`));
      const results = pages.filter(p => !types.length || types.includes(p.properties.Type.select.name))
        .filter(p => { const key = /"rich_text":\{"equals":"([^"]+)"/.exec(want); return !key || text(p.properties['Game key'].rich_text) === key[1]; })
        .map(p => ({ ...p, properties: Object.fromEntries(Object.entries(p.properties).map(([k, v]) => [k, v.rich_text ? { rich_text: v.rich_text.map(r => ({ plain_text: r.text.content })) } : v])) }));
      if (body.sorts?.[0]?.direction === 'descending') results.reverse(); // newest first, as the thread reader asks
      return Response.json({ results, has_more: false });
    }
    if (url.endsWith('/pages')) {
      if (failNextCreate) { failNextCreate = false; return Response.json({ message: 'boom' }, { status: 400 }); }
      const page = { object: 'page', id: 'page-' + ++n, created_time: `2026-10-12T06:00:${String(n).padStart(2, '0')}.000Z`, properties: body.properties }; pages.push(page); return Response.json(page);
    }
    throw Error('unexpected ' + url);
  };
  const webhookFetcher = async (url, init) => { pings.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  return { pages, pings, options: { fetcher, webhookFetcher, sleep: async () => {} }, failCreate: () => { failNextCreate = true; }, of: type => pages.filter(p => p.properties.Type.select.name === type) };
}
let seq = 0;
const message = (words, bot = 'gilfoyle') => validateChat({ bot, mode: 'relay', text: words, id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` });

test('only a message that is nothing but small talk gets a quick reply', () => {
  for (const words of ['hi', 'Hi!', 'hiii', 'hey', 'Hello there', 'good morning', 'ok', 'OK.', 'okay', 'k', 'cool', 'got it', 'noted', 'thanks', 'Thank you!!', 'ty', 'bye', 'good night', 'gn', 'lol', 'hahaha', '👍', '🙏🙏', 'ok 👍'])
    assert.equal(typeof quickReply(words, 'seed'), 'string', words);
  for (const words of ['hi, can you help me plan today?', 'ok do it', 'thanks, that helps a lot — what next?', 'yes', 'no', 'sure', 'done', 'what should I focus on next?', 'k8s is broken', 'high', 'okr review', '?', '...', '', 'a'.repeat(41), 'LC 20 done'])
    assert.equal(quickReply(words, 'seed'), null, words);
  assert.equal(quickReply(42), null);
  assert.equal(quickReply('hi', 'a'), quickReply('hi', 'a'), 'the same message always gets the same reply');
});

test('small talk is answered by the game and never wakes a bot', async () => {
  const box = inbox(), out = await sendRelay(message('hi'), env, box.options);
  assert.equal(out.delivered, true); assert.equal(typeof out.quick, 'string');
  assert.equal(box.pings.length, 0, 'no webhook: no bot turn is used');
  const [sent] = box.of('Message'), [reply] = box.of('Reply');
  assert.equal(sent.properties.Status.select.name, 'Answered', 'the dispatcher only looks for New');
  assert.equal(text(sent.properties.Details.rich_text), 'hi'); assert.equal(text(reply.properties.Details.rich_text), out.quick);
  assert.equal(text(reply.properties['Game key'].rich_text), out.key); assert.equal(text(reply.properties['Game note'].rich_text), 'quick');
  assert.equal(reply.properties.Bot.select.name, 'Gilfoyle');
  // The thread reads back with the reply marked as the game's own.
  const thread = await readRelay('gilfoyle', env, box.options);
  assert.deepEqual(thread.messages.map(m => [m.role, m.content, !!m.quick]), [['user', 'hi', false], ['assistant', out.quick, true]]);
});

test('a real question still goes to the bot exactly as before', async () => {
  const box = inbox(), out = await sendRelay(message('What should I focus on next?'), env, box.options);
  assert.equal(out.quick, undefined); assert.equal(box.pings.length, 1); assert.equal(box.pings[0].bot, 'Gilfoyle');
  assert.equal(box.of('Message')[0].properties.Status.select.name, 'New'); assert.equal(box.of('Reply').length, 0);
  assert.equal(box.of('Message')[0].properties['Game note'], undefined);
});

test('retrying small talk never doubles the message or the reply, and finishes a half-sent one', async () => {
  const box = inbox(), input = message('thanks');
  const first = await sendRelay(input, env, box.options), again = await sendRelay(input, env, box.options);
  assert.equal(again.quick, first.quick); assert.equal(box.of('Message').length, 1); assert.equal(box.of('Reply').length, 1);
  // The message is written but the reply fails: the retry adds only the missing reply.
  const half = inbox(), cut = message('ok');
  await sendRelay(cut, env, { ...half.options, fetcher: async (url, init) => { if (url.endsWith('/pages') && half.pages.length === 1) half.failCreate(); return half.options.fetcher(url, init); } }).catch(() => {});
  assert.equal(half.of('Message').length, 1); assert.equal(half.of('Reply').length, 0);
  const healed = await sendRelay(cut, env, half.options);
  assert.equal(typeof healed.quick, 'string'); assert.equal(half.of('Message').length, 1); assert.equal(half.of('Reply').length, 1); assert.equal(half.pings.length, 0);
});

test('Kreese keeps the Fletcher mailbox name for quick replies too', async () => {
  const box = inbox(); await sendRelay(message('hey', 'fletcher'), env, box.options);
  assert.equal(box.of('Message')[0].properties.Bot.select.name, 'Fletcher'); assert.equal(box.of('Reply')[0].properties.Bot.select.name, 'Fletcher');
});
