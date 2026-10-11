import test from 'node:test';
import assert from 'node:assert/strict';
import { officePreset } from '../lib/office-config.mjs';
import { issueSession } from '../lib/auth.mjs';
import { GET } from '../app/api/office/route.js';

test('office configuration validates coordinates and exposes only the pin', () => {
  for (const value of ['', 'bad json', 'null', '{}', '{"latitude":91,"longitude":80}', '{"latitude":13,"longitude":181}', '{"latitude":"13","longitude":80}']) assert.equal(officePreset({ OFFICE_LOCATION: value }), null);
  const env = { OFFICE_LOCATION: JSON.stringify({ latitude: 13, longitude: 80, name: 'Test office', secret: 'never expose' }) };
  const preset = officePreset(env);
  assert.deepEqual(preset.office, { latitude: 13, longitude: 80, radius: 250 });
  assert.equal(preset.name, 'Test office');
  assert.equal(preset.id, officePreset(env).id);
  assert.notEqual(preset.id, officePreset({ OFFICE_LOCATION: '{"latitude":14,"longitude":80}' }).id);
  assert(!JSON.stringify(preset).includes('never expose'));
});

test('office endpoint requires a session and prevents shared caching', async () => {
  const env = { APP_PASSWORD: 'test-only-password-long-enough', SESSION_SECRET: 'test-only-secret-of-at-least-thirty-two-characters', OFFICE_LOCATION: '{"latitude":13,"longitude":80,"name":"Test office"}' };
  const keys = [...Object.keys(env), 'APP_PASSWORD_HASH', 'LOCAL_DESIGN_MODE'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    Object.assign(process.env, env); delete process.env.APP_PASSWORD_HASH; delete process.env.LOCAL_DESIGN_MODE;
    const denied = await GET(new Request('https://game.example/api/office'));
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('cache-control'), 'private, no-store');
    assert(!JSON.stringify(await denied.json()).includes('Test office'));
    const allowed = await GET(new Request('https://game.example/api/office', { headers: { Cookie: 'becoming-session=' + issueSession(env) } }));
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await allowed.json(), { preset: officePreset(env) });
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
