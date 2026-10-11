import { requestAuthenticated } from '../../../lib/auth.mjs';
import { officePreset } from '../../../lib/office-config.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req) {
  if (!requestAuthenticated(req)) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  return Response.json({ preset: officePreset() }, { headers: { 'Cache-Control': 'private, no-store' } });
}
