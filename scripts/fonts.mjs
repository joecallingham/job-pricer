// Copies the Nuckle web fonts from the sumo-joe-studio checkout into public/fonts.
// The fonts are gitignored: Joe's desktop licence does not cover web servers.
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
const from = process.argv[2] || join(homedir(), 'Projects/sumo-joe-studio/area-coad/public/fonts');
const to = new URL('../public/fonts/', import.meta.url);
await mkdir(to, { recursive: true });
for (const f of ['Nuckle-Medium.woff2', 'Nuckle-Semibold.woff2']) {
  try { await copyFile(join(from, f), new URL(f, to)); console.log('copied', f); }
  catch { console.log('missing', join(from, f), '(the page falls back to Helvetica)'); }
}
