import { describe, expect, it } from 'vitest';
import {
  MAX_CHAIN_TRAPS,
  MAX_EVENT_LOG,
} from '../../src/core/fixed.ts';
import { chooseCpuDecision } from '../../src/core/ai.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';
import {
  MAP_IDS,
  MATCH_TICKS,
  TRAP_KINDS,
  type CpuDifficulty,
  type InputCommand,
  type MapId,
  type MatchResult,
  type TrapKind,
  type TrapLoadout,
  type WorldState,
} from '../../src/core/types.ts';

type BalanceScenario = 'pressure' | 'hold';

const DEFAULT_BALANCE_LOADOUT: TrapLoadout = ['bounce', 'shock', 'bomb'];
const AUDIT_SCENARIOS = ['pressure', 'hold'] as const;
const AUDIT_DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
const AUDIT_LOADOUTS: readonly TrapLoadout[] = [
  ['bounce', 'shock', 'hatch'],
  ['bounce', 'shock', 'bomb'],
  ['bounce', 'shock', 'moya'],
  ['bounce', 'hatch', 'bomb'],
  ['shock', 'hatch', 'moya'],
  ['hatch', 'bomb', 'moya'],
];
const AUDIT_MATCH_COUNT = 100;

interface BalanceSample {
  readonly seed: number;
  readonly difficulty: CpuDifficulty;
  readonly scenario: BalanceScenario;
  readonly mapId: MapId;
  readonly finalPhase: WorldState['phase'];
  readonly result: MatchResult | null;
  readonly durationTicks: number;
  readonly finalHash: string;
  readonly maxChain: number;
  readonly eventCount: number;
  readonly trapKindsPlaced: readonly TrapKind[];
}

function sign(value: number): -1 | 0 | 1 {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

function playerCommand(
  world: WorldState,
  tick: number,
  scenario: BalanceScenario,
  rotatingLoadout?: readonly TrapKind[],
): Partial<InputCommand> {
  const player = world.players[0];
  const cpu = world.players[1];
  const horizontalFirst = Math.abs(cpu.x - player.x) > Math.abs(cpu.y - player.y);
  const moveX = scenario === 'hold' ? 0 : horizontalFirst ? sign(cpu.x - player.x) : 0;
  const moveY = scenario === 'hold' ? 0 : horizontalFirst ? 0 : sign(cpu.y - player.y);
  const placementTick = tick >= 45 && (tick - 45) % 180 === 0;
  const rotatingKind = placementTick && rotatingLoadout
    ? rotatingLoadout[Math.trunc((tick - 45) / 180) % rotatingLoadout.length] ?? 'bounce'
    : undefined;
  const defaultKind = placementTick
    ? tick % 360 === 45 ? 'bounce' : 'shock'
    : undefined;
  const placeTrap = rotatingKind ?? defaultKind;

  return {
    moveX,
    moveY,
    fire: tick % 39 === 0,
    ...(placeTrap ? { placeTrap, trapDirection: 1 } : {}),
  };
}

function runMatch(
  seed: number,
  difficulty: CpuDifficulty,
  scenario: BalanceScenario,
  mapId: MapId = 'gearworks',
  playerLoadout: readonly TrapKind[] = DEFAULT_BALANCE_LOADOUT,
  cpuLoadout: readonly TrapKind[] = DEFAULT_BALANCE_LOADOUT,
  rotatePlayerTraps = false,
): BalanceSample {
  let world = createWorld(seed, playerLoadout, cpuLoadout, mapId);
  const placedKinds = new Set<TrapKind>();

  for (let tick = 0; tick < MATCH_TICKS && world.phase === 'battle'; tick += 1) {
    const playerInput = playerCommand(
      world,
      tick,
      scenario,
      rotatePlayerTraps ? playerLoadout : undefined,
    );
    const cpuInput = chooseCpuDecision(world, difficulty).command;
    world = advanceWorld(world, playerInput, cpuInput);

    for (const trap of world.traps) placedKinds.add(trap.kind);
    for (const event of world.events) placedKinds.add(event.kind);
  }

  return {
    seed,
    difficulty,
    scenario,
    mapId,
    finalPhase: world.phase,
    result: world.result,
    durationTicks: world.tick,
    finalHash: world.lastHash,
    maxChain: world.maxChain,
    eventCount: world.events.length,
    trapKindsPlaced: TRAP_KINDS.filter((kind) => placedKinds.has(kind)),
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

function runAuditMatrix(): readonly BalanceSample[] {
  const samples: BalanceSample[] = [];
  for (let index = 0; index < AUDIT_MATCH_COUNT; index += 1) {
    const scenario = AUDIT_SCENARIOS[index % AUDIT_SCENARIOS.length] ?? 'pressure';
    const difficulty = AUDIT_DIFFICULTIES[Math.trunc(index / 2) % AUDIT_DIFFICULTIES.length] ?? 'easy';
    const mapId = MAP_IDS[Math.trunc(index / 6) % MAP_IDS.length] ?? 'gearworks';
    const playerLoadout = AUDIT_LOADOUTS[index % AUDIT_LOADOUTS.length] ?? DEFAULT_BALANCE_LOADOUT;
    const cpuLoadout = AUDIT_LOADOUTS[(index + 2) % AUDIT_LOADOUTS.length] ?? DEFAULT_BALANCE_LOADOUT;

    samples.push(runMatch(
      10_000 + index,
      difficulty,
      scenario,
      mapId,
      playerLoadout,
      cpuLoadout,
      true,
    ));
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
      expect(sample.result).not.toBe('technical-invalid');
      expect(sample.durationTicks).toBeLessThanOrEqual(MATCH_TICKS);
      expect(sample.maxChain).toBeLessThanOrEqual(MAX_CHAIN_TRAPS);
      expect(sample.eventCount).toBeLessThanOrEqual(MAX_EVENT_LOG);
      expect(sample.finalHash).toMatch(/^[0-9a-f]{8}$/);
    }
    // The cell-centre correction changes the fixed benchmark's terminal tie
    // for hard pressure runs; normal pressure remains a deterministic CPU win.
    expect(first.some((sample) => sample.scenario === 'pressure' && sample.difficulty === 'normal' && sample.result === 'cpu-win')).toBe(true);
    expect(first.some((sample) => sample.scenario === 'pressure' && sample.difficulty === 'easy' && sample.result === 'time-draw')).toBe(true);
  }, 30_000);

  it('closes 100 fixed-input matches across maps, difficulties, and loadouts', () => {
    const samples = runAuditMatrix();
    const usedTrapKinds = new Set<TrapKind>();

    expect(samples).toHaveLength(AUDIT_MATCH_COUNT);
    for (const sample of samples) {
      expect(sample.finalPhase).toBe('result');
      expect(sample.result).not.toBeNull();
      expect(sample.result).not.toBe('technical-invalid');
      expect(sample.durationTicks).toBeLessThanOrEqual(MATCH_TICKS);
      expect(sample.maxChain).toBeLessThanOrEqual(MAX_CHAIN_TRAPS);
      expect(sample.eventCount).toBeLessThanOrEqual(MAX_EVENT_LOG);
      expect(sample.finalHash).toMatch(/^[0-9a-f]{8}$/);
      for (const kind of sample.trapKindsPlaced) usedTrapKinds.add(kind);
    }

    expect(new Set(samples.map((sample) => sample.mapId))).toEqual(new Set(MAP_IDS));
    expect(new Set(samples.map((sample) => sample.difficulty))).toEqual(new Set(AUDIT_DIFFICULTIES));
    expect(new Set(samples.map((sample) => sample.scenario))).toEqual(new Set(AUDIT_SCENARIOS));
    expect([...usedTrapKinds].sort()).toEqual([...TRAP_KINDS].sort());
  }, 60_000);
});
