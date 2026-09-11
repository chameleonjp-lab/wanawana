import { describe, expect, it } from 'vitest';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';
import {
  BOMB_DAMAGE,
  RESPAWN_INVULNERABLE_TICKS,
  SPAWN_PLACEMENT_EXCLUSION_RADIUS_UNITS,
  cellCenterUnits,
  TRAP_PLACEMENT_TICKS,
} from '../../src/core/fixed.ts';
import type { TrapState, WorldState } from '../../src/core/types.ts';

function atCell(world: WorldState, playerId: 0 | 1, cellX: number, cellY: number): WorldState {
  const players = [...world.players] as [WorldState['players'][0], WorldState['players'][1]];
  players[playerId] = {
    ...players[playerId],
    x: cellCenterUnits(cellX),
    y: cellCenterUnits(cellY),
  };
  return { ...world, players };
}

function bombAt(cellX: number, cellY: number, overrides: Partial<TrapState> = {}): TrapState {
  return {
    id: 2,
    owner: 1,
    kind: 'bomb',
    direction: 0,
    cellX,
    cellY,
    armingTicks: 0,
    remainingTicks: 100,
    discoveredBy: [true, true],
    triggerTicks: 1,
    ...overrides,
  };
}

describe('common action and respawn contract', () => {
  it('rejects a remote placement cell and captures the actor cell in core', () => {
    let world = atCell(createWorld(300), 0, 5, 6);
    world = advanceWorld(world, {
      placeTrap: 'bounce',
      trapDirection: 1,
      trapCellX: 2,
      trapCellY: 5,
    });
    expect(world.players[0].placement).toBeNull();

    world = advanceWorld(world, {
      placeTrap: 'bounce',
      trapCellX: 2.5,
      trapCellY: 5.5,
    } as never);
    expect(world.players[0].placement).toBeNull();

    world = advanceWorld(world, {
      placeTrap: 'bounce',
      trapDirection: 1,
      trapCellX: 5,
      trapCellY: 6,
    });
    expect(world.players[0].placement).toMatchObject({ kind: 'bounce', cellX: 5, cellY: 6 });
  });

  it('cancels a preview when the actor leaves its captured cell', () => {
    let world = atCell(createWorld(301), 0, 5, 6);
    world = advanceWorld(world, { placeTrap: 'shock', trapCellX: 5, trapCellY: 6 });
    const movedPlayers = [...world.players] as [WorldState['players'][0], WorldState['players'][1]];
    movedPlayers[0] = { ...movedPlayers[0], x: cellCenterUnits(6) };
    world = { ...world, players: movedPlayers };
    world = advanceWorld(world);
    expect(world.players[0].placement).toBeNull();
    expect(world.players[0].gear).toBe(3);
    expect(world.traps).toHaveLength(0);
  });

  it('rejects placement inside the 1.5-cell exclusion around either spawn', () => {
    let world = createWorld(302);
    world = advanceWorld(world, { placeTrap: 'bounce' });
    expect(world.players[0].placement).toBeNull();

    // Two cells away from the player spawn is outside the exclusion radius,
    // while remaining far enough from the CPU for the target overlap rule.
    world = atCell(world, 0, 4, 6);
    world = advanceWorld(world, { placeTrap: 'bounce' });
    expect(world.players[0].placement).toMatchObject({ cellX: 4, cellY: 6 });
    expect(SPAWN_PLACEMENT_EXCLUSION_RADIUS_UNITS).toBe(14_400);
  });

  it('locks every input during the post-respawn protection window', () => {
    let world = atCell(createWorld(303), 0, 5, 6);
    const players = [...world.players] as [WorldState['players'][0], WorldState['players'][1]];
    players[0] = { ...players[0], respawnInvulnerableTicks: RESPAWN_INVULNERABLE_TICKS };
    world = {
      ...world,
      players,
      traps: [{
        id: 2,
        owner: 1,
        kind: 'shock',
        direction: 0,
        cellX: 5,
        cellY: 7,
        armingTicks: 0,
        remainingTicks: 100,
        discoveredBy: [false, true],
      }],
      nextEntityId: 3,
    };
    for (let tick = 0; tick < RESPAWN_INVULNERABLE_TICKS; tick += 1) {
      const before = world.players[0];
      world = advanceWorld(world, {
        moveX: 1,
        moveY: -1,
        fire: true,
        placeTrap: 'bounce',
        trapCellX: 5,
        trapCellY: 6,
        investigate: true,
        investigateStart: true,
      });
      expect(world.players[0].x).toBe(before.x);
      expect(world.players[0].y).toBe(before.y);
      expect(world.shotsFired[0]).toBe(0);
      expect(world.players[0].placement).toBeNull();
      expect(world.players[0].investigation).toBeNull();
    }
    expect(world.players[0].respawnInvulnerableTicks).toBe(0);
    world = advanceWorld(world, { moveX: 1 });
    expect(world.players[0].x).toBeGreaterThan(cellCenterUnits(5));
  });

  it('ignores bomb damage and push while disabled or respawn-protected', () => {
    for (const protection of ['disabled', 'respawn'] as const) {
      let world = atCell(createWorld(protection === 'disabled' ? 304 : 305), 0, 5, 6);
      const players = [...world.players] as [WorldState['players'][0], WorldState['players'][1]];
      players[0] = {
        ...players[0],
        ...(protection === 'disabled'
          ? { disabledTicks: 4 }
          : { respawnInvulnerableTicks: 2 }),
      };
      const bomb = bombAt(5, 6);
      world = { ...world, players, traps: [bomb], nextEntityId: 3 };
      const x = world.players[0].x;
      const y = world.players[0].y;
      world = advanceWorld(world);
      expect(world.players[0].hp).toBe(100);
      expect(world.players[0].x).toBe(x);
      expect(world.players[0].y).toBe(y);
      expect(world.events[0]).toMatchObject({ kind: 'bomb', damage: 0, pushX: 0, pushY: 0 });
      expect(BOMB_DAMAGE).toBe(20);
    }
  });

  it('does not apply a gas field to a protected actor', () => {
    let world = atCell(createWorld(306), 0, 5, 6);
    const players = [...world.players] as [WorldState['players'][0], WorldState['players'][1]];
    players[0] = { ...players[0], respawnInvulnerableTicks: 2 };
    const moya: TrapState = {
      id: 2,
      owner: 1,
      kind: 'moya',
      direction: 0,
      cellX: 5,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: TRAP_PLACEMENT_TICKS,
      discoveredBy: [true, true],
    };
    world = { ...world, players, traps: [moya], nextEntityId: 3 };
    world = advanceWorld(world);
    expect(world.players[0].gasSlowTicks).toBe(0);
  });
});
