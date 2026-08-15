import { describe, expect, it } from 'vitest';
import { applyPush, PLAYER_RADIUS_UNITS } from '../../src/core/fixed.ts';
import { getMapDefinition } from '../../src/core/maps.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';
import { CELL_UNITS, type WorldState } from '../../src/core/types.ts';

const gearworks = getMapDefinition('gearworks');
const wallLeft = 4 * CELL_UNITS - PLAYER_RADIUS_UNITS;
const wallCenterY = 4 * CELL_UNITS + CELL_UNITS / 2;

describe('map obstacle collisions', () => {
  it('stops a player at the first wall boundary', () => {
    const base = createWorld(901);
    let world: WorldState = {
      ...base,
      players: [
        { ...base.players[0], x: wallLeft, y: wallCenterY },
        base.players[1],
      ],
    };

    world = advanceWorld(world, { moveX: 1 });

    expect(world.players[0].x).toBeLessThanOrEqual(wallLeft);
    expect(world.players[0].y).toBe(wallCenterY);
  });

  it('stops trap pushback at a wall instead of passing through it', () => {
    const world = createWorld(902);
    const pushed = applyPush(
      { ...world.players[0], x: wallLeft, y: wallCenterY },
      1,
      0,
      gearworks.obstacleCells,
    );

    expect(pushed.x).toBeLessThanOrEqual(wallLeft);
    expect(pushed.y).toBe(wallCenterY);
  });

  it('removes a shot when its line reaches a wall', () => {
    const base = createWorld(903);
    let world: WorldState = {
      ...base,
      players: [
        { ...base.players[0], x: 2 * CELL_UNITS, y: wallCenterY },
        { ...base.players[1], x: 7 * CELL_UNITS, y: wallCenterY },
      ],
    };

    world = advanceWorld(world, { fire: true });
    for (let tick = 0; tick < 30; tick += 1) world = advanceWorld(world);

    expect(world.shots).toHaveLength(0);
    expect(world.players[1].pushImmunityTicks).toBe(0);
    expect(world.players[1].x).toBe(7 * CELL_UNITS);
  });

  it('rejects trap placement on a wall cell', () => {
    const world = createWorld(904, ['bounce', 'bomb', 'shock'], ['bounce', 'bomb', 'shock']);
    const next = advanceWorld(world, {
      placeTrap: 'bomb',
      trapCellX: 4,
      trapCellY: 4,
    });

    expect(next.players[0].placement).toBeNull();
    expect(next.traps).toHaveLength(0);
  });
});
