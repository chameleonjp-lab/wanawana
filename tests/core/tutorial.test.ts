import { describe, expect, it } from 'vitest';
import { advanceTutorial, createTutorialState, TUTORIAL_HINT_TICKS } from '../../src/core/tutorial.ts';
import { createWorld } from '../../src/core/sim.ts';

describe('tutorial progress', () => {
  it('requires movement and firing before leaving the first step', () => {
    const first = createWorld(11);
    const moved = { ...first, players: [{ ...first.players[0], x: first.players[0].x + 1 }, first.players[1]] as const };
    const noFire = { ...moved, shotsFired: [0, 0] as const };
    expect(advanceTutorial(createTutorialState(), first, noFire).state.step).toBe(1);

    const fired = { ...noFire, shotsFired: [1, 0] as const };
    expect(advanceTutorial(createTutorialState(), first, fired)).toMatchObject({ advanced: true, state: { step: 2 } });
  });

  it('uses simulation counters for placement, chain, and disarm steps', () => {
    const base = createWorld(12);
    const stepTwo = advanceTutorial(createTutorialState(), base, {
      ...base,
      players: [{ ...base.players[0], x: base.players[0].x + 1 }, base.players[1]] as const,
      shotsFired: [1, 0] as const,
    }).state;
    const placed = { ...base, trapsPlaced: [1, 0] as const };
    const stepThree = advanceTutorial(stepTwo, base, placed);
    expect(stepThree.state.step).toBe(3);
    const chained = { ...placed, maxChain: 2 };
    const stepFour = advanceTutorial(stepThree.state, placed, chained);
    expect(stepFour.state.step).toBe(4);
    const disarmed = { ...chained, trapsDisarmed: [1, 0] as const };
    expect(advanceTutorial(stepFour.state, chained, disarmed).state.completed).toBe(true);
  });

  it('shows a hint after a bounded amount of fixed ticks', () => {
    const base = createWorld(13);
    let state = createTutorialState();
    for (let tick = 0; tick < TUTORIAL_HINT_TICKS - 1; tick += 1) {
      state = advanceTutorial(state, base, { ...base, tick: tick + 1 }).state;
    }
    expect(state.hintVisible).toBe(false);
    state = advanceTutorial(state, base, { ...base, tick: TUTORIAL_HINT_TICKS }).state;
    expect(state.hintVisible).toBe(true);
  });
});
