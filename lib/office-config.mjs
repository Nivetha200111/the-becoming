import { createHash } from 'node:crypto';

export function officePreset(env = process.env) {
  try {
    const value = JSON.parse(env.OFFICE_LOCATION || 'null');
    if (!value || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) return null;
    const office = { latitude: value.latitude, longitude: value.longitude, radius: 250 };
    const name = typeof value.name === 'string' ? value.name.trim().slice(0, 100) : 'Your office';
    return { id: createHash('sha256').update(JSON.stringify(office)).digest('hex').slice(0, 16), name: name || 'Your office', office };
  } catch { return null; }
}
