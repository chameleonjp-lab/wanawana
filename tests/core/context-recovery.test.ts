import { describe, expect, it } from 'vitest';
import { ContextRecovery } from '../../src/app/context-recovery.ts';

describe('WebGL context recovery contract', () => {
  it('requires an active match and a restored context before resuming', () => {
    const recovery = new ContextRecovery();
    expect(recovery.loseContext()).toEqual({ activeMatch: false, lossCount: 0, invalid: false });
    expect(recovery.canResume).toBe(false);

    recovery.startMatch();
    expect(recovery.canResume).toBe(true);
    expect(recovery.loseContext()).toEqual({ activeMatch: true, lossCount: 1, invalid: false });
    expect(recovery.isPending).toBe(true);
    expect(recovery.canResume).toBe(false);
    expect(recovery.markRestored()).toBe(true);
    expect(recovery.isPending).toBe(false);
    expect(recovery.canResume).toBe(true);
    expect(recovery.markResumed()).toBe(true);
  });

  it('invalidates the match on the second context loss', () => {
    const recovery = new ContextRecovery();
    recovery.startMatch();
    expect(recovery.loseContext().invalid).toBe(false);
    expect(recovery.markRestored()).toBe(true);
    expect(recovery.markResumed()).toBe(true);
    expect(recovery.loseContext()).toEqual({ activeMatch: true, lossCount: 2, invalid: true });
    expect(recovery.markRestored()).toBe(false);
  });

  it('clears the match contract when the title screen is reached', () => {
    const recovery = new ContextRecovery();
    recovery.startMatch();
    recovery.loseContext();
    recovery.endMatch();
    expect(recovery.isPending).toBe(false);
    expect(recovery.canResume).toBe(false);
    expect(recovery.loseContext()).toEqual({ activeMatch: false, lossCount: 0, invalid: false });
  });
});
