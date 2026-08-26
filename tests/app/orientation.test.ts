import { describe, expect, it } from 'vitest';
import {
  battleOrientationMessage,
  classifyBattleOrientation,
  isPortraitBattleOrientation,
} from '../../src/app/orientation.ts';
import { createViewportSize } from '../../src/app/viewport.ts';

describe('portrait battle orientation contract', () => {
  it('accepts a positive portrait viewport only', () => {
    const portrait = createViewportSize(393, 659);
    expect(classifyBattleOrientation(portrait)).toBe('portrait');
    expect(isPortraitBattleOrientation(portrait)).toBe(true);
    expect(battleOrientationMessage(portrait)).toBe('');
  });

  it('rejects landscape and square/unknown viewports', () => {
    const landscape = createViewportSize(659, 393);
    const square = createViewportSize(500, 500);
    const empty = createViewportSize(0, 0);
    expect(classifyBattleOrientation(landscape)).toBe('landscape');
    expect(isPortraitBattleOrientation(landscape)).toBe(false);
    expect(battleOrientationMessage(landscape)).toContain('縦向きに戻してください');
    expect(classifyBattleOrientation(square)).toBe('unknown');
    expect(isPortraitBattleOrientation(square)).toBe(false);
    expect(classifyBattleOrientation(empty)).toBe('unknown');
  });
});
