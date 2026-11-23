// Copies the Nuckle web fonts into public/fonts: from the given folder, the Job Pricer folder in
// Google Drive, or the sumo-joe-studio checkout. The fonts are gitignored: Joe's desktop licence
// does not cover web servers (the Pricer only serves them to the Mac it runs on).
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync, existsSync } from 'node:fs';
const cloud = join(homedir(), 'Library/CloudStorage');
let drive = [];
try { drive = readdirSync(cloud).filter(d => d.startsWith('GoogleDrive-')).map(d => join(cloud, d, 'My Drive/06_Claude_Work/Job Pricer/fonts')); } catch { /* no Drive */ }
const from = process.argv[2] || [...drive, join(homedir(), 'Projects/sumo-joe-studio/area-coad/public/fonts')].find(d => existsSync(d)) || '(nowhere)';
const to = new URL('../public/fonts/', import.meta.url);
await mkdir(to, { recursive: true });
for (const f of ['Nuckle-Medium.woff2', 'Nuckle-Semibold.woff2']) {
  try { await copyFile(join(from, f), new URL(f, to)); console.log('copied', f); }
  catch { console.log('missing', join(from, f), '(the page falls back to Helvetica)'); }
}
