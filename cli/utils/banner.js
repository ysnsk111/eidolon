import pc from 'picocolors';

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
  console.log(pc.bold(pc.white('  Persona Distillation & Memory Runtime  v1.0.0')));
  console.log(pc.dim('  «Preserve expression. Reconstruct context. Measure fidelity.»\n'));
}
