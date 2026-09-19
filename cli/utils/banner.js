import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let version = '1.1.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
  version = pkg.version;
} catch (_) {}

export function printBanner() {
  const art = `
  ███████╗██╗██████╗  ██████╗ ██╗      ██████╗ ███╗   ██╗
  ██╔════╝██║██╔══██╗██╔═══██╗██║     ██╔═══██╗████╗  ██║
  █████╗  ██║██║  ██║██║   ██║██║     ██║   ██║██╔██╗ ██║
  ██╔══╝  ██║██║  ██║██║   ██║██║     ██║   ██║██║╚██╗██║
  ███████╗██║██████╔╝╚██████╔╝███████╗╚██████╔╝██║ ╚████║
  ╚══════╝╚═╝╚═════╝  ╚═════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
  `;
  console.log(pc.cyan(art));
  console.log(pc.bold(pc.white(`  Persona Distillation & Memory Runtime  v${version}`)));
  console.log(pc.dim('  «Preserve expression. Reconstruct context. Measure fidelity.»\n'));
}
