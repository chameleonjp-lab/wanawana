import { describe, expect, it } from 'vitest';
import { normalizeBuildHash, serviceWorkerScriptUrl } from '../../src/app/offline.ts';

describe('offline update boundaries', () => {
  it('keeps cache identifiers to a safe build-hash alphabet', () => {
    expect(normalizeBuildHash('commit/abc?%')).toBe('commitabc');
    expect(normalizeBuildHash('')).toBe('local');
    expect(normalizeBuildHash('x'.repeat(100))).toHaveLength(64);
  });

  it('registers the worker under the game scope with an explicit version', () => {
    expect(serviceWorkerScriptUrl('/wanawana/', 'abc123')).toBe('/wanawana/sw.js?v=abc123');
    expect(serviceWorkerScriptUrl('/wanawana', 'abc 123')).toBe('/wanawana/sw.js?v=abc123');
  });
});
