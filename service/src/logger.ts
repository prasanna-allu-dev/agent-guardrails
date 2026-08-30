/**
 * Logs go somewhere that outlives the request and is read by more people than
 * the database is. `no-pii-in-logs` exists because of that second half.
 */
export const logger = {
  info: (message: string, fields: Record<string, unknown> = {}) => write('info', message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}) => write('warn', message, fields),
  error: (message: string, fields: Record<string, unknown> = {}) => write('error', message, fields),
};

function write(level: string, message: string, fields: Record<string, unknown>): void {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`);
  console.log(`[${level}] ${message}${parts.length ? ` ${parts.join(' ')}` : ''}`);
}
