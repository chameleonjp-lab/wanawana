import { describe, expect, it } from 'vitest';
import { AsyncOperationGate } from '../../src/app/async-operation-gate.ts';

describe('async operation gate', () => {
  it('invalidates an older operation when a new one begins', () => {
    const gate = new AsyncOperationGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('invalidates an operation when the session is interrupted', () => {
    const gate = new AsyncOperationGate();
    const token = gate.begin();

    gate.invalidate();

    expect(gate.isCurrent(token)).toBe(false);
  });
});
