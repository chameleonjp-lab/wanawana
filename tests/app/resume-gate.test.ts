import { describe, expect, it } from 'vitest';
import {
  canStartBattleAfterResume,
  remainingResumeSeconds,
  resumeCountdownFinished,
  RESUME_COUNTDOWN_MS,
} from '../../src/app/resume-gate.ts';

describe('resume countdown contract', () => {
  it('keeps the countdown at three seconds until the first second passes', () => {
    expect(remainingResumeSeconds(0)).toBe(3);
    expect(remainingResumeSeconds(999)).toBe(3);
    expect(remainingResumeSeconds(1_000)).toBe(2);
    expect(remainingResumeSeconds(2_000)).toBe(1);
    expect(remainingResumeSeconds(RESUME_COUNTDOWN_MS)).toBe(0);
    expect(resumeCountdownFinished(RESUME_COUNTDOWN_MS - 1)).toBe(false);
    expect(resumeCountdownFinished(RESUME_COUNTDOWN_MS)).toBe(true);
  });

  it('requires portrait orientation and a stable viewport before resuming', () => {
    expect(canStartBattleAfterResume(RESUME_COUNTDOWN_MS, true, true)).toBe(true);
    expect(canStartBattleAfterResume(RESUME_COUNTDOWN_MS, false, true)).toBe(false);
    expect(canStartBattleAfterResume(RESUME_COUNTDOWN_MS, true, false)).toBe(false);
    expect(canStartBattleAfterResume(Number.NaN, true, true)).toBe(false);
  });
});
