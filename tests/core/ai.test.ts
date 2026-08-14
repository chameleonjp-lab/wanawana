import { describe, expect, it } from 'vitest';
import { chooseCpuDecision } from '../../src/core/ai.ts';
import { INVESTIGATE_RADIUS_UNITS } from '../../src/core/fixed.ts';
import { CELL_UNITS, type TrapState, type WorldState } from '../../src/core/types.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';

function enemyTrap(overrides: Partial<TrapState> = {}): TrapState {
  return {
    id: 99,
    owner: 0,
    kind: 'shock',
    direction: 0,
    cellX: 7,
    cellY: 6,
    armingTicks: 0,
    remainingTicks: 1_800,
    discoveredBy: [true, false],
    ...overrides,
  };
}

describe('deterministic CPU cognition', () => {
  it('returns the same decision for the same visible world', () => {
    const world = createWorld(2026);
    expect(chooseCpuDecision(world)).toEqual(chooseCpuDecision(world));
  });

  it('does not expose a hidden enemy trap outside the shared danger cue', () => {
    const base = { ...createWorld(2027), tick: 1 };
    const first = chooseCpuDecision({ ...base, traps: [enemyTrap({ cellX: 1, cellY: 1 })] });
    const second = chooseCpuDecision({ ...base, traps: [enemyTrap({ cellX: 8, cellY: 12 })] });
    expect(first.visibleTrapIds).toEqual([]);
    expect(second.visibleTrapIds).toEqual([]);
    expect(first.reason).toBe('approaching');
    expect(second.reason).toBe('approaching');
  });

  it('uses the same danger cue as the player to start an investigation', () => {
    const base = createWorld(2028);
    const trap = enemyTrap({ cellX: 7, cellY: 6 });
    const world: WorldState = {
      ...base,
      players: [base.players[0], { ...base.players[1], x: 7 * CELL_UNITS - INVESTIGATE_RADIUS_UNITS / 2 }],
      traps: [trap],
      nextEntityId: 100,
    };
    const decision = chooseCpuDecision(world);
    expect(decision.reason).toBe('investigating');
    expect(decision.command.investigate).toBe(true);
    expect(decision.command.investigateStart).toBe(true);
    expect(decision.visibleTrapIds).toEqual([]);
  });

  it('disarms a revealed enemy trap instead of moving through it', () => {
    const base = createWorld(2029);
    const trap = enemyTrap({ cellX: 7, cellY: 6, discoveredBy: [true, true] });
    const world: WorldState = {
      ...base,
      traps: [trap],
      nextEntityId: 100,
    };
    const decision = chooseCpuDecision(world);
    expect(decision.reason).toBe('disarming');
    expect(decision.command.investigate).toBe(true);
    expect(decision.visibleTrapIds).toEqual([99]);
  });

  it('schedules an affordable trap and keeps the target cell valid', () => {
    const base = createWorld(2030);
    const world: WorldState = { ...base, tick: 45 };
    const decision = chooseCpuDecision(world);
    expect(decision.reason).toBe('placing');
    expect(decision.command.placeTrap).toBe('bounce');
    expect(decision.command.trapCellX).toBeDefined();
    expect(decision.command.trapCellY).toBeDefined();

    const next = advanceWorld(world, {}, decision.command);
    expect(next.players[1].placement?.kind).toBe('bounce');
    expect(next.traps).toHaveLength(0);
  });

  it('fires on a fixed cadence when no higher-priority action is active', () => {
    const base = createWorld(2031);
    const world: WorldState = { ...base, tick: 3 };
    const decision = chooseCpuDecision(world);
    expect(decision.reason).toBe('firing');
    expect(decision.command.fire).toBe(true);
    const next = advanceWorld(world, {}, decision.command);
    expect(next.shotsFired[1]).toBe(1);
  });
});
