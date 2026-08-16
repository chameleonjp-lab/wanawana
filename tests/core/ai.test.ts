import { describe, expect, it } from 'vitest';
import { chooseCpuDecision } from '../../src/core/ai.ts';
import {
  CPU_DIFFICULTY_PROFILES,
  getCpuDifficultyProfile,
  isCpuAimAligned,
  normalizeCpuDifficulty,
} from '../../src/core/difficulty.ts';
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
  it('keeps the three difficulty profiles inside the visible-rule contract', () => {
    expect(normalizeCpuDifficulty('unknown')).toBe('normal');
    expect(CPU_DIFFICULTY_PROFILES.easy.reactionCadenceTicks).toBe(24);
    expect(CPU_DIFFICULTY_PROFILES.normal.reactionCadenceTicks).toBe(17);
    expect(CPU_DIFFICULTY_PROFILES.hard.reactionCadenceTicks).toBe(13);
    expect(CPU_DIFFICULTY_PROFILES.easy.chainPlanning).toBe(1);
    expect(CPU_DIFFICULTY_PROFILES.normal.chainPlanning).toBe(2);
    expect(CPU_DIFFICULTY_PROFILES.hard.chainPlanning).toBe(3);
  });

  it('uses deterministic integer arithmetic for aiming variation', () => {
    const profile = getCpuDifficultyProfile('easy');
    expect(isCpuAimAligned(99, 12, profile)).toBe(isCpuAimAligned(99, 12, profile));
    expect(isCpuAimAligned(99, 12, getCpuDifficultyProfile('hard'))).toBe(true);
  });

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

  it('interrupts placement when the shared danger cue arrives', () => {
    const base = createWorld(2028);
    const trap = enemyTrap({ cellX: 7, cellY: 6 });
    const world: WorldState = {
      ...base,
      tick: 13,
      players: [base.players[0], {
        ...base.players[1],
        x: 7 * CELL_UNITS - INVESTIGATE_RADIUS_UNITS / 2,
        placement: {
          kind: 'bounce',
          direction: 0,
          cellX: 8,
          cellY: 6,
          remainingTicks: 12,
        },
      }],
      traps: [trap],
      nextEntityId: 100,
    };
    const decision = chooseCpuDecision(world, 'hard');
    expect(decision.reason).toBe('investigating');
    expect(decision.command.investigate).toBe(true);
    expect(decision.command.investigateStart).toBe(true);
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

  it('makes the difficulty affect response timing without revealing hidden traps', () => {
    const base = createWorld(2032);
    const trap = enemyTrap({ cellX: 7, cellY: 6 });
    const world: WorldState = {
      ...base,
      tick: 13,
      players: [base.players[0], { ...base.players[1], x: 7 * CELL_UNITS - INVESTIGATE_RADIUS_UNITS / 2 }],
      traps: [trap],
      nextEntityId: 100,
    };
    const easy = chooseCpuDecision(world, 'easy');
    const hard = chooseCpuDecision(world, 'hard');
    expect(easy.visibleTrapIds).toEqual([]);
    expect(hard.visibleTrapIds).toEqual([]);
    expect(easy.reason).not.toBe('investigating');
    expect(hard.reason).toBe('investigating');
  });

  it('limits easy planning and lets hard plan the terminal trap role', () => {
    const base = createWorld(2033);
    const intermediate: WorldState = { ...base, tick: 225 };
    expect(chooseCpuDecision(intermediate, 'easy').command.placeTrap).toBe('bounce');
    expect(chooseCpuDecision(intermediate, 'normal').command.placeTrap).toBe('shock');

    const terminal: WorldState = { ...base, tick: 405 };
    expect(chooseCpuDecision(terminal, 'normal').command.placeTrap).toBe('bounce');
    expect(chooseCpuDecision(terminal, 'hard').command.placeTrap).toBe('hatch');
  });

  it('lets hard planning reach the delayed and field trap roles', () => {
    const base = createWorld(2034, ['bounce', 'shock', 'hatch'], ['bounce', 'bomb', 'moya']);
    expect(chooseCpuDecision({ ...base, tick: 585 }, 'hard').command.placeTrap).toBe('bomb');
    expect(chooseCpuDecision({ ...base, tick: 765 }, 'hard').command.placeTrap).toBe('moya');
  });
});
