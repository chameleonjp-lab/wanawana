import { describe, expect, it } from 'vitest';
import { AppStateMachine } from '../../src/app/state.ts';

describe('application state machine', () => {
  it('allows the main battle flow', () => {
    const machine = new AppStateMachine();
    machine.transition('battle');
    machine.transition('paused');
    machine.transition('battle');
    machine.transition('result');
    machine.transition('title');
    expect(machine.state).toBe('title');
  });

  it('rejects an invalid jump', () => {
    const machine = new AppStateMachine();
    expect(() => machine.transition('result')).toThrow('Invalid transition');
  });
});
