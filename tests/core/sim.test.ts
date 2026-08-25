import { describe, expect, it } from 'vitest';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  MATCH_TICKS,
  type TrapState,
  type WorldState,
} from '../../src/core/types.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';
import {
  BOMB_CHAIN_RADIUS_UNITS,
  BOMB_DAMAGE,
  BOMB_TRIGGER_TICKS,
  cellCenterUnits,
  DISARM_TICKS,
  FIRE_COOLDOWN_TICKS,
  HATCH_RADIUS_UNITS,
  HATCH_DISABLED_TICKS,
  INVESTIGATE_TICKS,
  MAX_ACTIVE_TRAPS,
  MOYA_EFFECT_TICKS,
  MOYA_SLOWED_SPEED_UNITS_PER_TICK,
  SHOT_PUSH_UNITS,
  TRAP_COSTS,
  TRAP_PLACEMENT_TICKS,
} from '../../src/core/fixed.ts';

describe('fixed simulation', () => {
  it('replays the same accepted commands to the same hash', () => {
    let first = createWorld(42);
    let second = createWorld(42);

    for (let tick = 0; tick < 120; tick += 1) {
      const command = { moveX: tick % 3 === 0 ? 1 : 0, moveY: tick % 5 === 0 ? -1 : 0, fire: tick % 11 === 0 } as const;
      first = advanceWorld(first, command);
      second = advanceWorld(second, command);
    }

    expect(first.lastHash).toBe(second.lastHash);
    expect(first).toEqual(second);
  });

  it('keeps players inside the arena', () => {
    let world = createWorld();
    for (let tick = 0; tick < 2_000; tick += 1) {
      world = advanceWorld(world, { moveX: 1, moveY: 1 });
    }

    expect(world.players[0].x).toBeLessThanOrEqual(ARENA_WIDTH_CELLS * 9_600);
    expect(world.players[0].y).toBeLessThanOrEqual(ARENA_HEIGHT_CELLS * 9_600);
    expect(world.players[0].x).toBeGreaterThan(0);
    expect(world.players[0].y).toBeGreaterThan(0);
  });

  it('ends exactly at the configured match length', () => {
    let world = createWorld();
    for (let tick = 0; tick < MATCH_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }
    expect(world.phase).toBe('battle');
    world = advanceWorld(world);
    expect(world.tick).toBe(MATCH_TICKS);
    expect(world.phase).toBe('result');
  });

  it('fires one non-damaging shot and enforces its cooldown', () => {
    let world = createWorld(7);
    world = advanceWorld(world, { fire: true });
    expect(world.shotsFired[0]).toBe(1);
    expect(world.players[1].hp).toBe(100);
    expect(world.shots).toHaveLength(1);

    world = advanceWorld(world, { fire: true });
    expect(world.shotsFired[0]).toBe(1);
    for (let tick = 0; tick < FIRE_COOLDOWN_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }
    world = advanceWorld(world, { fire: true });
    expect(world.shotsFired[0]).toBe(2);
  });

  it('pushes the target on a continuous hit without dealing damage', () => {
    let world = createWorld(9);
    world = advanceWorld(world, { fire: true });
    for (let tick = 0; tick < 40 && world.players[1].pushImmunityTicks === 0; tick += 1) {
      world = advanceWorld(world);
    }
    expect(world.players[1].hp).toBe(100);
    expect(world.players[1].pushImmunityTicks).toBeGreaterThan(0);
    expect(world.players[1].x).toBeGreaterThan(7 * 9_600 - SHOT_PUSH_UNITS);
    expect(world.shots).toHaveLength(0);
  });

  it('starts a trap preview, then consumes one gear only after setup completes', () => {
    let world = createWorld(12);
    world = advanceWorld(world, { placeTrap: 'bounce' });
    expect(world.players[0].placement?.kind).toBe('bounce');
    expect(world.players[0].gear).toBe(3);
    expect(world.traps).toHaveLength(0);

    for (let tick = 0; tick < TRAP_PLACEMENT_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }
    expect(world.traps).toHaveLength(0);
    world = advanceWorld(world);
    expect(world.traps).toHaveLength(1);
    expect(world.traps[0].kind).toBe('bounce');
    expect(world.traps[0].cellX).toBe(2);
    expect(world.traps[0].cellY).toBe(6);
    expect(world.players[0].gear).toBe(2);
  });

  it('cancels placement when investigation is deliberately started', () => {
    const base = createWorld(125);
    const enemyTrap: TrapState = {
      id: 2,
      owner: 1,
      kind: 'bounce',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    let world: WorldState = {
      ...base,
      players: [{
        ...base.players[0],
        x: 21_600,
        placement: {
          kind: 'shock',
          direction: 0,
          cellX: 2,
          cellY: 6,
          remainingTicks: 12,
        },
      }, base.players[1]],
      traps: [enemyTrap],
      nextEntityId: 3,
    };
    world = advanceWorld(world, { investigate: true, investigateStart: true });
    expect(world.players[0].placement).toBeNull();
    expect(world.players[0].investigation?.mode).toBe('reveal');
    expect(world.players[0].gear).toBe(3);
    expect(world.trapsPlaced[0]).toBe(0);
    expect(world.traps).toHaveLength(1);
  });

  it('uses the declared gear cost and rejects a trap without enough gear', () => {
    let world = createWorld(121);
    world = advanceWorld(world, { placeTrap: 'shock' });
    for (let tick = 0; tick < TRAP_PLACEMENT_TICKS; tick += 1) {
      world = advanceWorld(world);
    }
    expect(world.traps[0].kind).toBe('shock');
    expect(world.players[0].gear).toBe(3 - TRAP_COSTS.shock);

    world = { ...world, players: [{ ...world.players[0], gear: 1 }, world.players[1]] };
    world = advanceWorld(world, { placeTrap: 'hatch' });
    expect(world.players[0].placement).toBeNull();
  });

  it('enforces the selected three-trap loadout and hashes it into the match', () => {
    const defaultWorld = createWorld(124);
    let world = createWorld(124, ['bounce', 'bomb', 'moya']);
    expect(world.loadouts[0]).toEqual(['bounce', 'bomb', 'moya']);
    expect(world.lastHash).not.toBe(defaultWorld.lastHash);

    world = advanceWorld(world, { placeTrap: 'shock' });
    expect(world.players[0].placement).toBeNull();
    world = advanceWorld(world, { placeTrap: 'bomb' });
    expect(world.players[0].placement?.kind).toBe('bomb');
  });

  it('does not exceed four active traps owned by one player', () => {
    const base = createWorld(122);
    const traps: TrapState[] = Array.from({ length: MAX_ACTIVE_TRAPS }, (_, index) => ({
      id: index + 2,
      owner: 0,
      kind: 'bounce',
      direction: 0,
      cellX: index + 2,
      cellY: 6,
      armingTicks: 1,
      remainingTicks: 1_800,
      discoveredBy: [true, false],
    }));
    let world: WorldState = {
      ...base,
      players: [{ ...base.players[0], gear: 5 }, base.players[1]],
      traps,
      nextEntityId: traps.length + 2,
    };
    expect(world.traps.filter((trap) => trap.owner === 0)).toHaveLength(MAX_ACTIVE_TRAPS);
    world = advanceWorld(world, { placeTrap: 'bounce' });
    expect(world.players[0].placement).toBeNull();
  });

  it('cancels installation when a projectile lands on the completing tick', () => {
    let world = createWorld(123);
    world = advanceWorld(world, { placeTrap: 'bounce' });
    for (let tick = 0; tick < TRAP_PLACEMENT_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }
    const player = world.players[0];
    const shot = {
      id: world.nextEntityId,
      owner: 1 as const,
      x: player.x - 1_600,
      y: player.y,
      vx: 1_600,
      vy: 0,
      travelledUnits: 0,
    };
    world = {
      ...world,
      shots: [shot],
      nextEntityId: shot.id + 1,
    };
    world = advanceWorld(world);
    expect(world.traps).toHaveLength(0);
    expect(world.players[0].gear).toBe(3);
    expect(world.players[0].placement).toBeNull();
    expect(world.players[0].pushImmunityTicks).toBeGreaterThan(0);
  });

  it('does not use an enemy hidden trap to reject placement', () => {
    const base = createWorld(13);
    const enemyTrap: TrapState = {
      id: 2,
      owner: 1,
      kind: 'bounce',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 1,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    const world: WorldState = { ...base, traps: [enemyTrap], nextEntityId: 3 };
    const next = advanceWorld(world, { placeTrap: 'shock' });
    expect(next.players[0].placement?.kind).toBe('shock');
  });

  it('reveals and then disarms a nearby trap with a fixed target', () => {
    const base = createWorld(14);
    const enemyTrap: TrapState = {
      id: 2,
      owner: 1,
      kind: 'bounce',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    let world: WorldState = {
      ...base,
      // Stay just outside the bounce contact radius while remaining inside the
      // reveal/disarm radius; otherwise the first tick would trigger the trap.
      players: [{ ...base.players[0], x: cellCenterUnits(3) - 6_000 }, base.players[1]],
      traps: [enemyTrap],
      nextEntityId: 3,
    };
    world = advanceWorld(world, { investigate: true, investigateStart: true });
    expect(world.players[0].investigation?.mode).toBe('reveal');
    for (let tick = 0; tick < INVESTIGATE_TICKS; tick += 1) {
      world = advanceWorld(world, { investigate: true });
    }
    expect(world.traps[0].discoveredBy[0]).toBe(true);
    expect(world.players[0].investigation).toBeNull();

    world = advanceWorld(world, { investigate: true, investigateStart: true });
    expect(world.players[0].investigation?.mode).toBe('disarm');
    for (let tick = 0; tick < DISARM_TICKS; tick += 1) {
      world = advanceWorld(world, { investigate: true });
    }
    expect(world.traps).toHaveLength(0);
    expect(world.trapsDisarmed[0]).toBe(1);
  });

  it('does not start investigation later when the button began invalid', () => {
    let world = createWorld(15);
    world = advanceWorld(world, { investigate: true, investigateStart: true });
    const enemyTrap: TrapState = {
      id: world.nextEntityId,
      owner: 1,
      kind: 'bounce',
      direction: 0,
      cellX: 2,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    world = { ...world, traps: [enemyTrap], nextEntityId: enemyTrap.id + 1 };
    world = advanceWorld(world, { investigate: true });
    expect(world.players[0].investigation).toBeNull();
  });

  it('triggers a bounce trap and records a root event', () => {
    const base = createWorld(16);
    const trap: TrapState = {
      id: 2,
      owner: 1,
      kind: 'bounce',
      direction: 1,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    const world: WorldState = {
      ...base,
      players: [{ ...base.players[0], x: cellCenterUnits(3) - 512 }, base.players[1]],
      traps: [trap],
      nextEntityId: 3,
    };
    const next = advanceWorld(world, { moveX: 1 });
    expect(next.traps).toHaveLength(0);
    expect(next.events).toHaveLength(1);
    expect(next.events[0]).toMatchObject({
      trapId: 2,
      kind: 'bounce',
      target: 0,
      parentEventId: null,
      chainLength: 1,
      damage: 0,
    });
    expect(next.players[0].x).toBeGreaterThan(cellCenterUnits(3) - 512);
  });

  it('orders a trap already under the player before a trap reached on the first step', () => {
    const base = createWorld(161);
    const traps: TrapState[] = [
      {
        id: 10,
        owner: 1,
        kind: 'bounce',
        direction: 0,
        cellX: 2,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
      {
        id: 2,
        owner: 1,
        kind: 'bounce',
        direction: 0,
        cellX: 3,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
    ];
    const world: WorldState = {
      ...base,
      players: [{ ...base.players[0], x: cellCenterUnits(3) - 5_100, y: cellCenterUnits(6) }, {
        ...base.players[1], x: cellCenterUnits(7) - 5_000, y: cellCenterUnits(6),
      }],
      traps,
      nextEntityId: 11,
    };

    const next = advanceWorld(world, { moveX: 1 });

    expect(next.events[0]).toMatchObject({ trapId: 10, kind: 'bounce' });
  });

  it('orders contacts by normalized movement time when segment lengths differ', () => {
    const base = createWorld(162);
    const traps: TrapState[] = [
      {
        id: 2,
        owner: 1,
        kind: 'bounce',
        direction: 0,
        cellX: 3,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
      {
        id: 3,
        owner: 0,
        kind: 'hatch',
        direction: 0,
        cellX: 7,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [true, false],
      },
    ];
    const shot = {
      id: 5,
      owner: 0 as const,
      x: cellCenterUnits(7) - 6_800,
      y: cellCenterUnits(6),
      vx: 1_600,
      vy: 0,
      travelledUnits: 0,
    };
    const world: WorldState = {
      ...base,
      players: [
        { ...base.players[0], x: cellCenterUnits(3) - 5_300, y: cellCenterUnits(6) },
        { ...base.players[1], x: cellCenterUnits(7) - 5_200, y: cellCenterUnits(6) },
      ],
      shots: [shot],
      traps,
      nextEntityId: 6,
    };

    const next = advanceWorld(world, { moveX: 1 });

    expect(next.events.map((event) => event.trapId)).toEqual([3, 2]);
  });

  it('records and resolves a trap at the first contact point on a movement segment', () => {
    const base = createWorld(163);
    const trap: TrapState = {
      id: 2,
      owner: 1,
      kind: 'hatch',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    const startX = cellCenterUnits(3) - HATCH_RADIUS_UNITS - 1;
    const world: WorldState = {
      ...base,
      players: [{ ...base.players[0], x: startX, y: cellCenterUnits(6) }, base.players[1]],
      traps: [trap],
      nextEntityId: 3,
    };

    const next = advanceWorld(world, { moveX: 1 });

    expect(next.events[0]).toMatchObject({ trapId: 2, x: startX + 1, y: cellCenterUnits(6) });
    expect(next.players[0].x).toBe(startX + 1);
    expect(next.players[0].x).toBeLessThan(startX + 512);
  });

  it('connects a bounce into a shock trap within the same tick', () => {
    const base = createWorld(17);
    const traps: TrapState[] = [
      {
        id: 2,
        owner: 1,
        kind: 'bounce',
        direction: 1,
        cellX: 2,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
      {
        id: 3,
        owner: 1,
        kind: 'shock',
        direction: 0,
        cellX: 4,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
    ];
    const world: WorldState = { ...base, traps, nextEntityId: 4 };
    const next = advanceWorld(world);
    expect(next.traps).toHaveLength(0);
    expect(next.players[0].hp).toBe(82);
    expect(next.events).toHaveLength(2);
    expect(next.events[1]).toMatchObject({
      trapId: 3,
      parentEventId: next.events[0].id,
      chainId: next.events[0].chainId,
      chainLength: 2,
      damage: 18,
    });
    expect(next.maxChain).toBe(2);
  });

  it('temporarily removes a hatch target and returns it to its spawn point', () => {
    const base = createWorld(18);
    const trap: TrapState = {
      id: 2,
      owner: 1,
      kind: 'hatch',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    let world: WorldState = {
      ...base,
      players: [{ ...base.players[0], x: cellCenterUnits(3) - 1_000 }, base.players[1]],
      traps: [trap],
      nextEntityId: 3,
    };
    world = advanceWorld(world);
    expect(world.players[0].hp).toBe(74);
    expect(world.players[0].disabledTicks).toBe(HATCH_DISABLED_TICKS);
    for (let tick = 0; tick < HATCH_DISABLED_TICKS; tick += 1) {
      world = advanceWorld(world, { moveX: 1, fire: true });
    }
    expect(world.players[0].disabledTicks).toBe(0);
    expect(world.players[0].x).toBe(cellCenterUnits(2));
    expect(world.players[0].respawnInvulnerableTicks).toBeGreaterThan(0);
    expect(world.shotsFired[0]).toBe(0);
  });

  it('arms a Pon玉 on contact and explodes after the fixed fuse', () => {
    const base = createWorld(181);
    const bomb: TrapState = {
      id: 2,
      owner: 1,
      kind: 'bomb',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    let world: WorldState = {
      ...base,
      players: [{ ...base.players[0], x: 28_288 }, base.players[1]],
      traps: [bomb],
      nextEntityId: 3,
    };
    world = advanceWorld(world, { moveX: 1 });
    expect(world.players[0].hp).toBe(100);
    expect(world.events).toHaveLength(0);
    expect(world.traps[0].triggerTicks).toBe(BOMB_TRIGGER_TICKS - 1);

    for (let tick = 0; tick < BOMB_TRIGGER_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }
    expect(world.players[0].hp).toBe(100 - BOMB_DAMAGE);
    expect(world.traps).toHaveLength(0);
    expect(world.events).toHaveLength(1);
    expect(world.events[0]).toMatchObject({
      kind: 'bomb',
      damage: BOMB_DAMAGE,
      chainLength: 1,
      x: cellCenterUnits(3),
      y: cellCenterUnits(6),
    });
  });

  it('does not allow an active bomb or gas field to be investigated or disarmed', () => {
    const base = createWorld(186);
    const activeTraps: TrapState[] = [
      {
        id: 2,
        owner: 1,
        kind: 'bomb',
        direction: 0,
        cellX: 3,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [true, true],
        triggerTicks: 12,
      },
      {
        id: 3,
        owner: 1,
        kind: 'moya',
        direction: 0,
        cellX: 5,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [true, true],
        effectTicks: 12,
      },
    ];

    for (const trap of activeTraps) {
      let world: WorldState = {
        ...base,
        players: [{
          ...base.players[0],
          x: cellCenterUnits(trap.cellX),
          y: cellCenterUnits(trap.cellY),
        }, base.players[1]],
        traps: [trap],
        nextEntityId: 4,
      };
      world = advanceWorld(world, { investigate: true, investigateStart: true });
      expect(world.players[0].investigation).toBeNull();
      expect(world.traps).toHaveLength(1);
      expect(world.traps[0].id).toBe(trap.id);
    }
  });

  it('primes a nearby armed bomb and preserves the delayed chain context', () => {
    const base = createWorld(183);
    const bombs: TrapState[] = [
      {
        id: 2,
        owner: 1,
        kind: 'bomb',
        direction: 0,
        cellX: 3,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
      {
        id: 3,
        owner: 1,
        kind: 'bomb',
        direction: 0,
        cellX: 4,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
    ];
    expect(BOMB_CHAIN_RADIUS_UNITS).toBeGreaterThan(9_600);
    let world: WorldState = {
      ...base,
      players: [{ ...base.players[0], x: 28_288 }, base.players[1]],
      traps: bombs,
      nextEntityId: 4,
    };

    world = advanceWorld(world, { moveX: 1 });
    for (let tick = 0; tick < BOMB_TRIGGER_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }
    const primed = world.traps.find((trap) => trap.id === 3);
    expect(world.events[0]).toMatchObject({ trapId: 2, chainLength: 1 });
    expect(primed?.triggerTicks).toBe(BOMB_TRIGGER_TICKS - 1);
    expect(primed?.triggerParentEventId).toBe(world.events[0].id);
    expect(primed?.triggerChainId).toBe(world.events[0].chainId);
    expect(primed?.triggerChainLength).toBe(1);

    for (let tick = 0; tick < BOMB_TRIGGER_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }
    expect(world.events[1]).toMatchObject({
      trapId: 3,
      parentEventId: world.events[0].id,
      chainId: world.events[0].chainId,
      chainLength: 2,
    });
    expect(world.maxChain).toBe(2);
  });

  it('triggers one nearby non-bomb trap from a bomb blast', () => {
    const base = createWorld(184);
    const bomb: TrapState = {
      id: 2,
      owner: 1,
      kind: 'bomb',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    const hatch: TrapState = {
      id: 3,
      owner: 1,
      kind: 'hatch',
      direction: 0,
      cellX: 4,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    let world: WorldState = {
      ...base,
      players: [
        { ...base.players[0], x: cellCenterUnits(3) + 256, y: cellCenterUnits(6) },
        base.players[1],
      ],
      traps: [bomb, hatch],
      nextEntityId: 4,
    };

    world = advanceWorld(world);
    for (let tick = 0; tick < BOMB_TRIGGER_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }

    expect(world.events).toHaveLength(2);
    expect(world.events[0]).toMatchObject({ trapId: 2, kind: 'bomb', chainLength: 1 });
    expect(world.events[1]).toMatchObject({
      trapId: 3,
      kind: 'hatch',
      parentEventId: world.events[0].id,
      chainId: world.events[0].chainId,
      chainLength: 2,
      damage: 26,
      x: cellCenterUnits(4),
      y: cellCenterUnits(6),
    });
    expect(world.players[0].hp).toBe(100 - BOMB_DAMAGE - 26);
    expect(world.maxChain).toBe(2);
  });

  it('continues a bomb-induced bounce into a further shock trap', () => {
    const base = createWorld(185);
    const traps: TrapState[] = [
      {
        id: 2,
        owner: 1,
        kind: 'bomb',
        direction: 0,
        cellX: 3,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
      {
        id: 3,
        owner: 1,
        kind: 'bounce',
        direction: 1,
        cellX: 4,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
      {
        id: 4,
        owner: 1,
        kind: 'shock',
        direction: 0,
        cellX: 6,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 1_800,
        discoveredBy: [false, true],
      },
    ];
    let world: WorldState = {
      ...base,
      players: [
        { ...base.players[0], x: cellCenterUnits(3) + 256, y: cellCenterUnits(6) },
        base.players[1],
      ],
      traps,
      nextEntityId: 5,
    };

    world = advanceWorld(world);
    for (let tick = 0; tick < BOMB_TRIGGER_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }

    expect(world.events).toHaveLength(3);
    expect(world.events.map((event) => event.trapId)).toEqual([2, 3, 4]);
    expect(world.events[1]).toMatchObject({
      parentEventId: world.events[0].id,
      chainId: world.events[0].chainId,
      chainLength: 2,
      kind: 'bounce',
    });
    expect(world.events[2]).toMatchObject({
      parentEventId: world.events[1].id,
      chainId: world.events[0].chainId,
      chainLength: 3,
      kind: 'shock',
      damage: 18,
    });
    expect(world.players[0].hp).toBe(100 - BOMB_DAMAGE - 18);
    expect(world.maxChain).toBe(3);
  });

  it('slows movement only while a モヤびん field is active', () => {
    const base = createWorld(182);
    const moya: TrapState = {
      id: 2,
      owner: 1,
      kind: 'moya',
      direction: 0,
      cellX: 3,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    };
    let world: WorldState = {
      ...base,
      players: [{ ...base.players[0], x: 28_800 }, base.players[1]],
      traps: [moya],
      nextEntityId: 3,
    };
    world = advanceWorld(world);
    expect(world.events[0].kind).toBe('moya');
    expect(world.traps[0].effectTicks).toBe(MOYA_EFFECT_TICKS - 1);
    const before = world.players[0].x;
    world = advanceWorld(world, { moveX: 1 });
    expect(world.players[0].x - before).toBe(MOYA_SLOWED_SPEED_UNITS_PER_TICK);
    expect(world.players[0].gasSlowTicks).toBeGreaterThan(0);
  });

  it('ends immediately when trap damage defeats one player', () => {
    const base = createWorld(19);
    const traps: TrapState[] = Array.from({ length: 4 }, (_, index) => ({
      id: index + 2,
      owner: 1,
      kind: 'hatch',
      direction: 0,
      cellX: 2,
      cellY: 6,
      armingTicks: 0,
      remainingTicks: 1_800,
      discoveredBy: [false, true],
    }));
    const world: WorldState = {
      ...base,
      players: [{ ...base.players[0], hp: 20 }, base.players[1]],
      traps,
      nextEntityId: 6,
    };
    const next = advanceWorld(world);
    expect(next.players[0].hp).toBe(0);
    expect(next.result).toBe('cpu-win');
    expect(next.phase).toBe('result');
    expect(next.events).toHaveLength(1);
  });
});
