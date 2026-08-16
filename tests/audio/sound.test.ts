import { describe, expect, it } from 'vitest';
import { classifySoundState, soundSpec } from '../../src/audio/sound.ts';

describe('sound cues', () => {
  it('keeps cue profiles fixed and independent from simulation time', () => {
    expect(soundSpec('bounce')).toEqual({ startHz: 300, endHz: 720, durationMs: 160, gain: 0.05 });
    expect(soundSpec('shock').durationMs).toBe(220);
    expect(soundSpec('hatch').endHz).toBe(80);
    expect(soundSpec('bomb').startHz).toBe(180);
    expect(soundSpec('moya').durationMs).toBe(360);
  });

  it('uses separate result cues', () => {
    expect(soundSpec('win').endHz).toBeGreaterThan(soundSpec('lose').endHz);
    expect(soundSpec('draw').startHz).toBe(soundSpec('draw').endHz);
  });

  it('distinguishes browser audio states without affecting the simulation clock', () => {
    expect(classifySoundState('running')).toBe('running');
    expect(classifySoundState('suspended')).toBe('suspended');
    expect(classifySoundState('interrupted')).toBe('interrupted');
    expect(classifySoundState('closed')).toBe('closed');
    expect(classifySoundState(undefined)).toBe('unavailable');
  });
});
