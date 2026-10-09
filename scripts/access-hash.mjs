import { createInterface } from 'node:readline';
import { randomBytes, scryptSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
// Run this yourself in a terminal. The passphrase is never printed, logged or saved.
if (!process.stdin.isTTY) throw Error('Run npm run access:hash in your own interactive terminal.');
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const ask = text => new Promise(resolve => rl.question(text, resolve));
const restore = () => spawnSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
process.on('SIGINT', () => { restore(); process.exit(130); });
try {
  spawnSync('stty', ['-echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
  let passphrase = await ask('Choose a private passphrase (16+ characters, hidden): ');
  process.stdout.write('\n');
  let confirmation = await ask('Enter it again (hidden): '); process.stdout.write('\n');
  if (passphrase.length < 16 || passphrase.length > 256 || passphrase !== confirmation) throw Error('Use 16–256 characters and enter the same passphrase twice.');
  const salt = randomBytes(16).toString('hex'), hash = `scrypt:${salt}:${scryptSync(passphrase, salt, 64).toString('hex')}`;
  passphrase = confirmation = '';
  const copied = spawnSync('pbcopy', [], { input: hash, encoding: 'utf8', stdio: ['pipe', 'ignore', 'ignore'] });
  if (copied.status !== 0) throw Error('Could not copy the hash. This helper currently needs macOS clipboard access.');
  console.log('Only the hash is now on your clipboard. Paste it into APP_PASSWORD_HASH in Vercel Production settings, then redeploy. Your actual passphrase was never saved.');
} finally { restore(); rl.close(); }
