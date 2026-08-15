import { sanitizeForLog } from './sanitize.js';

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
const originalConsole: Record<LogLevel, (...args: unknown[]) => void> = {
  log: console.log.bind(console), info: console.info.bind(console), warn: console.warn.bind(console), error: console.error.bind(console), debug: console.debug.bind(console),
};

function write(level: LogLevel, message: string, detail?: unknown): void {
  const args: unknown[] = [sanitizeForLog(message)];
  if (detail !== undefined) args.push(sanitizeForLog(detail));
  originalConsole[level](...args);
}

export const logger = {
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
  debug: (message: string, detail?: unknown) => write('debug', message, detail),
};

/** Guard legacy console use so an overlooked diagnostic cannot bypass redaction. */
export function installSanitizedConsole(): void {
  for (const level of Object.keys(originalConsole) as LogLevel[]) {
    console[level] = (...args: unknown[]) => originalConsole[level](...args.map((arg) => sanitizeForLog(arg)));
  }
}
