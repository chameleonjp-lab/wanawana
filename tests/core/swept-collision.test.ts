import { describe, expect, it } from 'vitest';
import {
  BOUNCE_PUSH_UNITS,
  cellCenterUnits,
  circleIntersectsObstacle,
  movePlayerWithObstacles,
  PLAYER_RADIUS_UNITS,
  segmentHitsObstacle,
} from '../../src/core/fixed.ts';
import { CELL_UNITS } from '../../src/core/types.ts';
import { createWorld } from '../../src/core/sim.ts';

const wall = { cellX: 4, cellY: 3 } as const;

function playerAt(x: number, y: number) {
  return {
    ...createWorld(905).players[0],
    x,
    y,
  };
}

describe('swept player obstacle collision', () => {
  it('follows the direct diagonal segment instead of an implicit L path', () => {
    const start = playerAt(cellCenterUnits(3), cellCenterUnits(2));
    const moved = movePlayerWithObstacles(start, BOUNCE_PUSH_UNITS, BOUNCE_PUSH_UNITS, [wall]);

    expect(moved.x).toBeLessThan(start.x + BOUNCE_PUSH_UNITS);
    expect(moved.y).toBeLessThan(start.y + BOUNCE_PUSH_UNITS);
    expect(circleIntersectsObstacle(moved.x, moved.y, PLAYER_RADIUS_UNITS, [wall])).toBe(false);
  });

  it('keeps a diagonal path clear of a rounded wall corner', () => {
    const start = playerAt(cellCenterUnits(2), cellCenterUnits(2));
    const moved = movePlayerWithObstacles(start, CELL_UNITS, 0, [wall]);

    expect(moved.x).toBe(start.x + CELL_UNITS);
    expect(moved.y).toBe(start.y);
  });

  it('stops at a rounded corner when the line enters its radius', () => {
    const start = playerAt(cellCenterUnits(2), 3 * CELL_UNITS - 2_400);
    const moved = movePlayerWithObstacles(start, 2 * CELL_UNITS, 0, [wall]);

    expect(moved.x).toBeLessThan(start.x + 2 * CELL_UNITS);
    expect(circleIntersectsObstacle(moved.x, moved.y, PLAYER_RADIUS_UNITS, [wall])).toBe(false);
  });

  it('lets a player leave a wall boundary and blocks movement into it', () => {
    const touchingX = 4 * CELL_UNITS - PLAYER_RADIUS_UNITS;
    const start = playerAt(touchingX, cellCenterUnits(3));
    const away = movePlayerWithObstacles(start, -512, 0, [wall]);
    const toward = movePlayerWithObstacles(start, 512, 0, [wall]);

    expect(away.x).toBe(touchingX - 512);
    expect(toward.x).toBe(touchingX);
  });

  it('allows a tangent player to slide along a wall', () => {
    const start = playerAt(4 * CELL_UNITS - PLAYER_RADIUS_UNITS, cellCenterUnits(3));
    const moved = movePlayerWithObstacles(start, 0, CELL_UNITS, [wall]);

    expect(moved.x).toBe(start.x);
    expect(moved.y).toBe(start.y + CELL_UNITS);
  });

  it('clips a diagonal boundary move at its first edge without changing direction', () => {
    const start = playerAt(7.5 * CELL_UNITS, 6.5 * CELL_UNITS);
    const moved = movePlayerWithObstacles(start, BOUNCE_PUSH_UNITS, BOUNCE_PUSH_UNITS);

    expect(moved.x).toBe(9 * CELL_UNITS - PLAYER_RADIUS_UNITS);
    expect(moved.y).toBe(start.y + moved.x - start.x);
  });

  it('is invariant to obstacle order and left/right reflection', () => {
    const otherWall = { cellX: 6, cellY: 3 } as const;
    const leftStart = playerAt(cellCenterUnits(3), cellCenterUnits(3));
    const rightStart = playerAt(cellCenterUnits(5), cellCenterUnits(3));
    const left = movePlayerWithObstacles(leftStart, 4 * CELL_UNITS, 0, [wall, otherWall]);
    const reversed = movePlayerWithObstacles(leftStart, 4 * CELL_UNITS, 0, [otherWall, wall]);
    const right = movePlayerWithObstacles(rightStart, -4 * CELL_UNITS, 0, [wall]);
    const reflectionAxis = 4.5 * CELL_UNITS;

    expect(reversed).toEqual(left);
    expect(right.x).toBe(2 * reflectionAxis - left.x);
    expect(right.y).toBe(left.y);
  });

  it('uses a rounded shot radius instead of a padded square at a corner', () => {
    const left = wall.cellX * CELL_UNITS;
    const top = wall.cellY * CELL_UNITS;
    const start = { x: left - 700, y: top - 100 };
    const end = { x: left - 100, y: top - 700 };

    expect(segmentHitsObstacle(start.x, start.y, end.x, end.y, wall, 512)).toBe(false);
  });
});
