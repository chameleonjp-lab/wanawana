import { describe, expect, it } from 'vitest';
import { chooseCpuDecision } from '../../src/core/ai.ts';
import {
  MAX_CHAIN_TRAPS,
} from '../../src/core/fixed.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';
import {
  MATCH_TICKS,
  type CpuDifficulty,
  type InputCommand,
  type MatchResult,
  type WorldState,
} from '../../src/core/types.ts';

type BalanceScenario = 'pressure' | 'hold';

interface BalanceSample {
  readonly seed: number;
  readonly difficulty: CpuDifficulty;
  readonly scenario: BalanceScenario;
  readonly result: MatchResult | null;
  readonly durationTicks: number;
  readonly finalHash: string;
  readonly maxChain: number;
}

function sign(value: number): -1 | 0 | 1 {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

function playerCommand(
  world: WorldState,
  tick: number,
  scenario: BalanceScenario,
): Partial<InputCommand> {
  const player = world.players[0];
  const cpu = world.players[1];
  const horizontalFirst = Math.abs(cpu.x - player.x) > Math.abs(cpu.y - player.y);
  const moveX = scenario === 'hold' ? 0 : horizontalFirst ? sign(cpu.x - player.x) : 0;
  const moveY = scenario === 'hold' ? 0 : horizontalFirst ? 0 : sign(cpu.y - player.y);
  return {
    moveX,
    moveY,
    fire: tick % 39 === 0,
    ...(tick >= 45 && (tick - 45) % 180 === 0
      ? {
        placeTrap: tick % 360 === 45 ? 'bounce' : 'shock',
        trapDirection: 1,
      }
      : {}),
  };
}

function runMatch(seed: number, difficulty: CpuDifficulty, scenario: BalanceScenario): BalanceSample {
  let world = createWorld(seed, ['bounce', 'shock', 'bomb'], ['bounce', 'shock', 'bomb']);
  for (let tick = 0; tick < MATCH_TICKS && world.phase === 'battle'; tick += 1) {
    const playerInput = playerCommand(world, tick, scenario);
    const cpuInput = chooseCpuDecision(world, difficulty).command;
    world = advanceWorld(world, playerInput, cpuInput);
  }
  return {
    seed,
    difficulty,
    scenario,
    result: world.result,
    durationTicks: world.tick,
    finalHash: world.lastHash,
    maxChain: world.maxChain,
  };
}

function runMatrix(): readonly BalanceSample[] {
  const samples: BalanceSample[] = [];
  for (const scenario of ['pressure', 'hold'] as const) {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      for (const seed of [1, 2, 3] as const) {
        samples.push(runMatch(seed, difficulty, scenario));
      }
    }
  }
  return samples;
}

describe('CPU balance audit benchmark', () => {
  it('keeps fixed-input benchmark results deterministic and bounded', () => {
    const first = runMatrix();
    const second = runMatrix();

    expect(first).toEqual(second);
    expect(first).toHaveLength(18);
    for (const sample of first) {
      expect(sample.result).not.toBeNull();
      expect(sample.durationTicks).toBeLessThanOrEqual(MATCH_TICKS);
      expect(sample.maxChain).toBeLessThanOrEqual(MAX_CHAIN_TRAPS);
      expect(sample.finalHash).toMatch(/^[0-9a-f]{8}$/);
    }
    // The cell-centre correction changes the fixed benchmark's terminal tie
    // for hard pressure runs; normal pressure remains a deterministic CPU win.
    expect(first.some((sample) => sample.scenario === 'pressure' && sample.difficulty === 'normal' && sample.result === 'cpu-win')).toBe(true);
    expect(first.some((sample) => sample.scenario === 'pressure' && sample.difficulty === 'easy' && sample.result === 'time-draw')).toBe(true);
  }, 30_000);
});
