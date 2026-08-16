/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { GEAR_MAX, MAX_ACTIVE_TRAPS, MAX_EVENT_LOG } from '../../src/core/fixed.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  MAP_IDS,
  MATCH_TICKS,
  type InputCommand,
  type WorldState,
} from '../../src/core/types.ts';

const configuredSeedCount = Number.parseInt(import.meta.env.VITE_DETERMINISM_SEEDS ?? '10000', 10);
const SEED_COUNT = Number.isSafeInteger(configuredSeedCount) && configuredSeedCount >= 10_000
  ? configuredSeedCount
  : 10_000;
const TICKS_PER_SEED = 4;

function mix32(value: number): number {
  let next = value >>> 0;
  next ^= next >>> 16;
  next = Math.imul(next, 0x7feb352d) >>> 0;
  next ^= next >>> 15;
  next = Math.imul(next, 0x846ca68b) >>> 0;
  return (next ^ (next >>> 16)) >>> 0;
}

function axis(value: number): -1 | 0 | 1 {
  return (value % 3) - 1 as -1 | 0 | 1;
}

function commandFor(seed: number, tick: number, player: 0 | 1): InputCommand {
  const salt = mix32(seed ^ Math.imul(tick + 1, 0x9e3779b9) ^ (player === 0 ? 0x13579bdf : 0x2468ace0));
  return {
    moveX: axis(salt),
    moveY: axis(salt >>> 8),
    fire: (salt & 0x1f) === 0,
    trapDirection: ((salt >>> 13) & 3) as 0 | 1 | 2 | 3,
    investigate: false,
    investigateStart: false,
  };
}

function assertIntegerRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label}: ${String(value)} is outside ${minimum}..${maximum}`);
  }
}

function assertWorldInvariants(world: WorldState): void {
  assertIntegerRange(world.tick, 0, MATCH_TICKS, 'world tick');
  if (!/^[0-9a-f]{8}$/.test(world.lastHash)) throw new Error(`world hash: ${world.lastHash}`);
  assertIntegerRange(world.nextEntityId, 2, Number.MAX_SAFE_INTEGER, 'next entity id');
  assertIntegerRange(world.nextEventId, 1, Number.MAX_SAFE_INTEGER, 'next event id');
  assertIntegerRange(world.nextChainId, 1, Number.MAX_SAFE_INTEGER, 'next chain id');
  assertIntegerRange(world.maxChain, 0, 8, 'max chain');

  for (const player of world.players) {
    assertIntegerRange(player.x, 0, ARENA_WIDTH_CELLS * CELL_UNITS, `player ${player.id} x`);
    assertIntegerRange(player.y, 0, ARENA_HEIGHT_CELLS * CELL_UNITS, `player ${player.id} y`);
    assertIntegerRange(player.hp, 0, 100, `player ${player.id} hp`);
    assertIntegerRange(player.gear, 0, GEAR_MAX, `player ${player.id} gear`);
    const timers: readonly [string, number][] = [
      ['fireCooldownTicks', player.fireCooldownTicks],
      ['fireSlowTicks', player.fireSlowTicks],
      ['gasSlowTicks', player.gasSlowTicks],
      ['pushImmunityTicks', player.pushImmunityTicks],
      ['trapCooldownTicks', player.trapCooldownTicks],
      ['gearRecoveryTicks', player.gearRecoveryTicks],
      ['investigationPauseTicks', player.investigationPauseTicks],
      ['disabledTicks', player.disabledTicks],
      ['respawnInvulnerableTicks', player.respawnInvulnerableTicks],
    ];
    for (const [name, timer] of timers) {
      assertIntegerRange(timer, 0, MATCH_TICKS, `player ${player.id} ${name}`);
    }
  }

  const trapIds = new Set<number>();
  const trapsByOwner: [number, number] = [0, 0];
  for (const trap of world.traps) {
    if (trapIds.has(trap.id)) throw new Error(`duplicate trap id: ${trap.id}`);
    trapIds.add(trap.id);
    trapsByOwner[trap.owner] += 1;
    if (trapsByOwner[trap.owner] > MAX_ACTIVE_TRAPS) throw new Error(`too many traps for owner ${trap.owner}`);
    assertIntegerRange(trap.id, 2, world.nextEntityId - 1, 'trap id');
    assertIntegerRange(trap.cellX, 0, ARENA_WIDTH_CELLS - 1, 'trap cell x');
    assertIntegerRange(trap.cellY, 0, ARENA_HEIGHT_CELLS - 1, 'trap cell y');
    assertIntegerRange(trap.armingTicks, 0, MATCH_TICKS, 'trap arming ticks');
    assertIntegerRange(trap.remainingTicks, 0, MATCH_TICKS, 'trap remaining ticks');
    if (trap.triggerTicks !== undefined) assertIntegerRange(trap.triggerTicks, 0, MATCH_TICKS, 'trap trigger ticks');
    if (trap.effectTicks !== undefined) assertIntegerRange(trap.effectTicks, 0, MATCH_TICKS, 'trap effect ticks');
  }

  const shotIds = new Set<number>();
  for (const shot of world.shots) {
    if (shotIds.has(shot.id)) throw new Error(`duplicate shot id: ${shot.id}`);
    shotIds.add(shot.id);
    assertIntegerRange(shot.id, 2, world.nextEntityId - 1, 'shot id');
    assertIntegerRange(shot.x, 0, ARENA_WIDTH_CELLS * CELL_UNITS, 'shot x');
    assertIntegerRange(shot.y, 0, ARENA_HEIGHT_CELLS * CELL_UNITS, 'shot y');
    assertIntegerRange(shot.travelledUnits, 0, 8 * CELL_UNITS, 'shot range');
  }

  if (world.events.length > MAX_EVENT_LOG) throw new Error('event log exceeded its limit');
  const eventIds = new Set<number>();
  for (const event of world.events) {
    if (eventIds.has(event.id)) throw new Error(`duplicate event id: ${event.id}`);
    eventIds.add(event.id);
    assertIntegerRange(event.id, 1, world.nextEventId - 1, 'event id');
    assertIntegerRange(event.tick, 0, MATCH_TICKS, 'event tick');
    assertIntegerRange(event.chainLength, 1, 8, 'event chain length');
    assertIntegerRange(event.damage, 0, 100, 'event damage');
  }
}

describe('determinism stress invariants', () => {
  it('keeps 10,000 fixed-seed command streams bounded and reproducible', () => {
    for (let seed = 0; seed < SEED_COUNT; seed += 1) {
      const mapId = MAP_IDS[seed % MAP_IDS.length];
      let first = createWorld(seed, ['bounce', 'shock', 'bomb'], ['bounce', 'hatch', 'moya'], mapId);
      let second = createWorld(seed, ['bounce', 'shock', 'bomb'], ['bounce', 'hatch', 'moya'], mapId);
      assertWorldInvariants(first);
      for (let tick = 0; tick < TICKS_PER_SEED && first.phase === 'battle'; tick += 1) {
        const playerCommand = commandFor(seed, tick, 0);
        const cpuCommand = commandFor(seed, tick, 1);
        first = advanceWorld(first, playerCommand, cpuCommand);
        second = advanceWorld(second, playerCommand, cpuCommand);
        assertWorldInvariants(first);
        if (first.lastHash !== second.lastHash) {
          throw new Error(`determinism mismatch at seed ${seed}, tick ${first.tick}`);
        }
      }
    }
    expect(SEED_COUNT).toBeGreaterThanOrEqual(10_000);
  }, 60_000);
});
