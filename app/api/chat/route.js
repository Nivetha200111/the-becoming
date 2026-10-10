import { requestAuthenticated, sameOrigin } from '../../../lib/auth.mjs';
import { after } from 'next/server.js';
import { chatStatus, validateChat, sendRelay, readRelay, ChatError } from '../../../lib/bot-chat.mjs';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'; export const maxDuration = 60;
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const errorReply = e => reply({ error: e instanceof ChatError ? e.message : 'Your party connection is unavailable. Try again shortly.' }, e instanceof ChatError ? e.status : 502);
export async function GET(req) {
  if (!requestAuthenticated(req)) return reply({ error: 'Sign in to chat with your party.' }, 401);
  const status = chatStatus(), bot = new URL(req.url).searchParams.get('bot');
  if (!bot) return reply(status);
  try { return reply(await readRelay(bot)); } catch (e) { return errorReply(e); }
}
export async function POST(req) {
  if (!requestAuthenticated(req)) return reply({ error: 'Sign in to chat with your party.' }, 401);
  if (!sameOrigin(req)) return reply({ error: 'Request origin rejected.' }, 403);
  if (Number(req.headers.get('content-length') || 0) > 24000) return reply({ error: 'Message is too large.' }, 413);
  try {
    const raw = await req.text(); if (raw.length > 24000) return reply({ error: 'Message is too large.' }, 413);
    let body; try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid message.' }, 400); }
    const input = validateChat(body);
    return reply(await sendRelay(input, process.env, { schedule: after }));
  } catch (e) { return errorReply(e); }
}
