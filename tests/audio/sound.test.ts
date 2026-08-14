import { describe, expect, it } from 'vitest';
import { soundSpec } from '../../src/audio/sound.ts';

describe('sound cues', () => {
  it('keeps cue profiles fixed and independent from simulation time', () => {
    expect(soundSpec('bounce')).toEqual({ startHz: 300, endHz: 720, durationMs: 160, gain: 0.05 });
    expect(soundSpec('shock').durationMs).toBe(220);
    expect(soundSpec('hatch').endHz).toBe(80);
  });

  it('uses separate result cues', () => {
    expect(soundSpec('win').endHz).toBeGreaterThan(soundSpec('lose').endHz);
    expect(soundSpec('draw').startHz).toBe(soundSpec('draw').endHz);
  });
});
