import { describe, it, expect } from 'vitest';
import { isValidHttpUrl, isValidMcpCommand } from '../src/helpers';

// ═══════════════════════════════════════════════════════════════════════════════
// isValidHttpUrl
// ═══════════════════════════════════════════════════════════════════════════════

describe('isValidHttpUrl', () => {
  it('accepts valid http URLs', () => {
    expect(isValidHttpUrl('http://127.0.0.1:8912')).toBe(true);
    expect(isValidHttpUrl('http://localhost:3000')).toBe(true);
    expect(isValidHttpUrl('http://example.com')).toBe(true);
  });

  it('accepts valid https URLs', () => {
    expect(isValidHttpUrl('https://api.example.com')).toBe(true);
    expect(isValidHttpUrl('https://127.0.0.1:8912')).toBe(true);
    expect(isValidHttpUrl('https://memorius.local')).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    expect(isValidHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(isValidHttpUrl('')).toBe(false);
    expect(isValidHttpUrl('not-a-url')).toBe(false);
    expect(isValidHttpUrl('http://')).toBe(false);
    expect(isValidHttpUrl('://missing-scheme')).toBe(false);
  });

  it('handles edge cases', () => {
    expect(isValidHttpUrl('http://user:pass@host.com')).toBe(true);
    expect(isValidHttpUrl('http://host.com/path?q=1#hash')).toBe(true);
    expect(isValidHttpUrl('HTTP://UPPERCASE.COM')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isValidMcpCommand
// ═══════════════════════════════════════════════════════════════════════════════

describe('isValidMcpCommand', () => {
  it('accepts simple commands', () => {
    expect(isValidMcpCommand('memorius')).toBe(true);
    expect(isValidMcpCommand('/usr/local/bin/memorius')).toBe(true);
    expect(isValidMcpCommand('python -m memorius')).toBe(true);
    expect(isValidMcpCommand('node /path/to/server.js')).toBe(true);
  });

  it('rejects empty/whitespace', () => {
    expect(isValidMcpCommand('')).toBe(false);
    expect(isValidMcpCommand('   ')).toBe(false);
    expect(isValidMcpCommand('\t')).toBe(false);
  });

  it('rejects shell metacharacters (injection prevention)', () => {
    expect(isValidMcpCommand('memorius; rm -rf /')).toBe(false);
    expect(isValidMcpCommand('memorius | cat /etc/passwd')).toBe(false);
    expect(isValidMcpCommand('memorius && malicious')).toBe(false);
    expect(isValidMcpCommand('memorius`whoami`')).toBe(false);
    expect(isValidMcpCommand('memorius$(whoami)')).toBe(false);
    expect(isValidMcpCommand('memorius{1..100}')).toBe(false);
    expect(isValidMcpCommand('memorius!')).toBe(false);
    expect(isValidMcpCommand('memorius> /tmp/x')).toBe(false);
  });

  it('rejects angle brackets via regex', () => {
    // Use String.fromCharCode to avoid parser issues
    const lt = String.fromCharCode(60); // <
    expect(isValidMcpCommand(`memorius${lt} /etc/passwd`)).toBe(false);
    expect(isValidMcpCommand(`memorius > /tmp/x`)).toBe(false);
  });

  it('rejects newlines and carriage returns', () => {
    expect(isValidMcpCommand('memorius\nwhoami')).toBe(false);
    expect(isValidMcpCommand('memorius\rwhoami')).toBe(false);
  });

  it('rejects overly long commands', () => {
    const longCmd = 'a'.repeat(257);
    expect(isValidMcpCommand(longCmd)).toBe(false);
  });

  it('accepts commands up to 256 chars', () => {
    const maxCmd = 'a'.repeat(256);
    expect(isValidMcpCommand(maxCmd)).toBe(true);
  });

  it('allows hyphens and dots in paths', () => {
    expect(isValidMcpCommand('./memorius-server')).toBe(true);
    expect(isValidMcpCommand('/opt/memorius/bin/memorius')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

import {
  PREVIEW_LENGTH_LONG,
  PREVIEW_LENGTH_MED,
  PREVIEW_LENGTH_SHORT,
  IMPORT_PROGRESS_INTERVAL,
  API_TIMEOUT_MS,
  CONTEXT_ITEMS_LIMIT,
  GRAPH_NODES_LIMIT,
} from '../src/helpers';

describe('constants', () => {
  it('has sane preview lengths', () => {
    expect(PREVIEW_LENGTH_LONG).toBeGreaterThan(PREVIEW_LENGTH_MED);
    expect(PREVIEW_LENGTH_MED).toBeGreaterThan(PREVIEW_LENGTH_SHORT);
    expect(PREVIEW_LENGTH_SHORT).toBeGreaterThanOrEqual(50);
  });

  it('has sane limits', () => {
    expect(CONTEXT_ITEMS_LIMIT).toBeGreaterThan(0);
    expect(GRAPH_NODES_LIMIT).toBeGreaterThan(0);
    expect(IMPORT_PROGRESS_INTERVAL).toBeGreaterThan(0);
    expect(API_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
  });
});
