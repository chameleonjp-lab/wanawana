import { describe, expect, it } from 'vitest';
import { BOMB_DAMAGE, BOUNCE_PUSH_UNITS, cellCenterUnits } from '../../src/core/fixed.ts';
import { CELL_UNITS, type TrapState, type WorldState } from '../../src/core/types.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';

function bomb(id: number, cellX: number): TrapState {
  return {
    id,
    owner: 1,
    kind: 'bomb',
    direction: 0,
    cellX,
    cellY: 6,
    armingTicks: 0,
    remainingTicks: 1_800,
    discoveredBy: [false, true],
    triggerTicks: 1,
  };
}

function a03Fixture(swappedIds: boolean): WorldState {
  const base = createWorld(203);
  const first = swappedIds ? bomb(3, 3) : bomb(2, 3);
  const second = swappedIds ? bomb(2, 4) : bomb(3, 4);
  return {
    ...base,
    players: [
      { ...base.players[0], x: Math.trunc(4.7 * CELL_UNITS), y: cellCenterUnits(6) },
      base.players[1],
    ],
    traps: [first, second],
    nextEntityId: 4,
  };
}

function overlappingBounceFixture(swappedIds: boolean): WorldState {
  const base = createWorld(204);
  const right: TrapState = {
    id: swappedIds ? 3 : 2,
    owner: 0,
    kind: 'bounce',
    direction: 1,
    cellX: 3,
    cellY: 6,
    armingTicks: 0,
    remainingTicks: 1_800,
    discoveredBy: [true, false],
  };
  const left: TrapState = {
    id: swappedIds ? 2 : 3,
    owner: 1,
    kind: 'bounce',
    direction: 3,
    cellX: 3,
    cellY: 6,
    armingTicks: 0,
    remainingTicks: 1_800,
    discoveredBy: [false, true],
  };
  return {
    ...base,
    players: [
      { ...base.players[0], x: cellCenterUnits(3), y: cellCenterUnits(6) },
      base.players[1],
    ],
    traps: swappedIds ? [left, right] : [right, left],
    nextEntityId: 4,
  };
}

describe('simultaneous effects', () => {
  it('resolves A03 bombs from one common starting position after an ID exchange', () => {
    const normal = advanceWorld(a03Fixture(false));
    const swapped = advanceWorld(a03Fixture(true));

    expect(normal.players[0].hp).toBe(100 - BOMB_DAMAGE * 2);
    expect(swapped.players[0].hp).toBe(100 - BOMB_DAMAGE * 2);
  });

  it('resolves coincident opposing bounce effects together', () => {
    const normal = advanceWorld(overlappingBounceFixture(false));
    const swapped = advanceWorld(overlappingBounceFixture(true));
    for (const world of [normal, swapped]) {
      expect(world.traps).toHaveLength(0);
      expect(world.events).toHaveLength(2);
      expect(world.players[0].x).toBe(cellCenterUnits(3));
      expect(world.players[0].y).toBe(cellCenterUnits(6));
    }
  });

  it('caps a diagonal combination by vector length, not by one axis', () => {
    const base = createWorld(205);
    const bounce: TrapState = {
      id: 2,
      owner: 0,
      kind: 'bounce',
      direction: 1,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [true, false],
    };
    const shock: TrapState = {
      id: 3,
      owner: 1,
      kind: 'shock',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    const world = advanceWorld({
      ...base,
      players: [{ ...base.players[0], x: cellCenterUnits(3), y: cellCenterUnits(6) }, base.players[1]],
      traps: [bounce, shock],
      nextEntityId: 4,
    });
    const dx = world.players[0].x - cellCenterUnits(3);
    const dy = world.players[0].y - cellCenterUnits(6);

    expect(dx * dx + dy * dy).toBeLessThanOrEqual(BOUNCE_PUSH_UNITS * BOUNCE_PUSH_UNITS);
    expect(world.events).toHaveLength(2);
  });
});
