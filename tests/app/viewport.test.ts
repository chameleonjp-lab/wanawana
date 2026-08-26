import { describe, expect, it } from 'vitest';
import { createViewportSize, viewportSizeChanged } from '../../src/app/viewport.ts';

describe('viewport resize boundaries', () => {
  it('rounds finite dimensions and clamps invalid values', () => {
    expect(createViewportSize(375.4, 667.6)).toEqual({ width: 375, height: 668 });
    expect(createViewportSize(Number.NaN, -4)).toEqual({ width: 0, height: 0 });
  });

  it('ignores the first baseline and detects later dimension changes', () => {
    const current = createViewportSize(375, 667);
    expect(viewportSizeChanged(null, current)).toBe(false);
    expect(viewportSizeChanged(current, createViewportSize(375, 667))).toBe(false);
    expect(viewportSizeChanged(current, createViewportSize(390, 667))).toBe(true);
  });
});
