// ═══════════════════════════════════════════════════════════════════════════════
// Pure helper functions — extracted for testability
// ═══════════════════════════════════════════════════════════════════════════════

export function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Shell metacharacters that indicate potential command injection
// eslint-disable-next-line no-control-regex
const SHELL_META_CHARS = /[;&|`$(){}!<>\x0a\x0d]/;

export function isValidMcpCommand(cmd: string): boolean {
  if (!cmd || cmd.trim().length === 0) return false;
  if (SHELL_META_CHARS.test(cmd)) return false;
  // Must be a reasonable length
  if (cmd.length > 256) return false;
  return true;
}

export const PREVIEW_LENGTH_LONG = 300;
export const PREVIEW_LENGTH_MED = 200;
export const PREVIEW_LENGTH_SHORT = 150;
export const IMPORT_PROGRESS_INTERVAL = 50;
export const DASHBOARD_REFRESH_MS = 30000;
export const API_TIMEOUT_MS = 10000;
export const CONTEXT_ITEMS_LIMIT = 8;
export const GRAPH_NODES_LIMIT = 10;

export type ChildProcessLike = {
  kill: (signal?: string) => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
};
