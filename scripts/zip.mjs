/**
 * zip.mjs — packages dist/ into cursor-capture.zip for Chrome Web Store submission
 * Run: node scripts/zip.mjs
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const distDir = resolve(root, 'dist');
const outZip = resolve(root, 'cursor-capture.zip');

if (!existsSync(distDir)) {
  console.error('❌  dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

// Remove old zip
try { execSync(`rm -f "${outZip}"`); } catch (_) {}

execSync(`cd "${distDir}" && zip -r "${outZip}" .`, { stdio: 'inherit' });
console.log(`✅  Created ${outZip}`);
