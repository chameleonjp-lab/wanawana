import { describe, expect, it } from 'vitest';
import { rendererPreferences } from '../../src/app/renderer-support.ts';

describe('renderer fallback', () => {
  it('keeps WebGL first while allowing Canvas fallback', () => {
    expect(rendererPreferences(true)).toEqual(['webgl', 'canvas']);
  });

  it('selects Canvas when WebGL is unavailable', () => {
    expect(rendererPreferences(false)).toEqual(['canvas']);
  });
});
