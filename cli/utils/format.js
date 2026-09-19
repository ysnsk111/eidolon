import pc from 'picocolors';

export function formatScore(score, isScaled = false) {
  const num = typeof score === 'number' ? score : parseFloat(score) || 0;
  const val = isScaled ? num : (num * 100);
  const formatted = val.toFixed(1);
  if (val >= 80) return pc.green(`${formatted}%`);
  if (val >= 70) return pc.yellow(`${formatted}%`);
  return pc.red(`${formatted}%`);
}

export function formatStatus(status) {
  switch (status?.toUpperCase()) {
    case 'PASS':
    case 'OK':
    case 'RUNNING':
    case 'CONNECTED':
      return pc.green(`● ${status}`);
    case 'FAIL':
    case 'ERROR':
    case 'STOPPED':
      return pc.red(`● ${status}`);
    case 'NEEDS_OPTIMIZATION':
    case 'DEGRADED':
    case 'WARN':
      return pc.yellow(`● ${status}`);
    default:
      return pc.dim(`● ${status || 'UNKNOWN'}`);
  }
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
