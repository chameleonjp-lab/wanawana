import { describe, expect, it } from 'vitest';
import { getMotionProfile } from '../../src/app/motion.ts';

describe('render motion profile', () => {
  it('keeps the normal activation burst for clear feedback', () => {
    expect(getMotionProfile(false)).toEqual({
      eventMarkerTicks: 30,
      burstTicks: 12,
      showRays: true,
    });
  });

  it('removes expanding rays while retaining a visible activation marker', () => {
    expect(getMotionProfile(true)).toEqual({
      eventMarkerTicks: 36,
      burstTicks: 0,
      showRays: false,
    });
  });
});
