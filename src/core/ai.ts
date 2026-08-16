import {
  DISARM_RADIUS_UNITS,
  INVESTIGATE_RADIUS_UNITS,
  MAX_ACTIVE_TRAPS,
  TRAP_COSTS,
  cellCenterUnits,
  clampInteger,
  normalizeCommand,
  snapToCell,
} from './fixed.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  DEFAULT_TRAP_LOADOUT,
  type InputCommand,
  type TrapDirection,
  type TrapKind,
  type TrapState,
  type CpuDifficulty,
  type WorldState,
} from './types.ts';
import {
  getCpuDifficultyProfile,
  isCpuAimAligned,
  isCpuReactionTick,
} from './difficulty.ts';

/** A short label explaining why the CPU accepted its command for this tick. */
export type CpuActionReason =
  | 'disabled'
  | 'holding-placement'
  | 'disarming'
  | 'investigating'
  | 'placing'
  | 'firing'
  | 'retreating'
  | 'approaching'
  | 'holding';

export interface CpuDecision {
  readonly command: InputCommand;
  readonly reason: CpuActionReason;
  /** Own traps and enemy traps already revealed to the CPU. */
  readonly visibleTrapIds: readonly number[];
}

function signAxis(value: number): -1 | 0 | 1 {
  if (value < 0) return -1;
  if (value > 0) return 1;
  return 0;
}

function distanceSquared(
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number,
): number {
  const dx = firstX - secondX;
  const dy = firstY - secondY;
  return dx * dx + dy * dy;
}

function trapDistanceSquared(player: WorldState['players'][number], trap: TrapState): number {
  return distanceSquared(player.x, player.y, cellCenterUnits(trap.cellX), cellCenterUnits(trap.cellY));
}

function command(overrides: Partial<InputCommand>): InputCommand {
  return normalizeCommand(overrides);
}

function visibleTraps(world: WorldState): readonly TrapState[] {
  return world.traps
    .filter((trap) => trap.owner === 1 || trap.discoveredBy[1])
    .sort((first, second) => first.id - second.id);
}

function nearestVisibleEnemyTrap(
  player: WorldState['players'][number],
  traps: readonly TrapState[],
  radius: number,
): TrapState | null {
  return traps
    .filter((trap) => trap.owner === 0 && trap.discoveredBy[1] && trap.armingTicks === 0)
    .map((trap) => ({ trap, distance: trapDistanceSquared(player, trap) }))
    .filter((candidate) => candidate.distance <= radius * radius)
    .sort((first, second) => first.distance - second.distance || first.trap.id - second.trap.id)[0]?.trap ?? null;
}

function hasDangerCue(
  player: WorldState['players'][number],
  traps: readonly TrapState[],
): boolean {
  const radiusSquared = INVESTIGATE_RADIUS_UNITS * INVESTIGATE_RADIUS_UNITS;
  return traps.some((trap) => trap.owner === 0
    && trap.armingTicks === 0
    && !trap.discoveredBy[1]
    && trapDistanceSquared(player, trap) <= radiusSquared);
}

function chooseTrapKind(world: WorldState, chainPlanning: 1 | 2 | 3): TrapKind {
  const available = world.loadouts?.[1] ?? DEFAULT_TRAP_LOADOUT;
  const plannedRoles: readonly TrapKind[] = chainPlanning >= 3
    ? ['bounce', 'shock', 'hatch', 'bomb', 'moya']
    : chainPlanning >= 2
      ? ['bounce', 'shock']
      : ['bounce'];
  const cycle = Math.trunc(Math.max(0, world.tick - 45) / 180) % plannedRoles.length;
  const preferred = plannedRoles[cycle];
  if (available.includes(preferred) && world.players[1].gear >= TRAP_COSTS[preferred]) return preferred;
  return plannedRoles.find((kind) => available.includes(kind) && world.players[1].gear >= TRAP_COSTS[kind])
    ?? available[0]
    ?? 'bounce';
}

function directionTowardCpu(cpu: WorldState['players'][number], target: WorldState['players'][number]): TrapDirection {
  const horizontalDistance = Math.abs(target.x - cpu.x);
  const verticalDistance = Math.abs(target.y - cpu.y);
  if (horizontalDistance >= verticalDistance) return cpu.x < target.x ? 1 : 3;
  return cpu.y < target.y ? 2 : 0;
}

function candidateCells(
  cpu: WorldState['players'][number],
  target: WorldState['players'][number],
): readonly { cellX: number; cellY: number; direction: TrapDirection }[] {
  const targetCellX = snapToCell(target.x, ARENA_WIDTH_CELLS);
  const targetCellY = snapToCell(target.y, ARENA_HEIGHT_CELLS);
  const horizontal = Math.abs(target.x - cpu.x) >= Math.abs(target.y - cpu.y);
  const primaryDirection = directionTowardCpu(cpu, target);
  const offsets: readonly (readonly [number, number])[] = horizontal
    ? [[primaryDirection === 1 ? 1 : -1, 0], [0, -1], [0, 1], [primaryDirection === 1 ? -1 : 1, 0]]
    : [[0, primaryDirection === 2 ? 1 : -1], [-1, 0], [1, 0], [0, primaryDirection === 2 ? -1 : 1]];
  return offsets.map(([offsetX, offsetY]) => ({
    cellX: clampInteger(targetCellX + offsetX, 0, ARENA_WIDTH_CELLS - 1),
    cellY: clampInteger(targetCellY + offsetY, 0, ARENA_HEIGHT_CELLS - 1),
    direction: primaryDirection,
  }));
}

function choosePlacement(
  world: WorldState,
): { cellX: number; cellY: number; direction: TrapDirection } | null {
  const cpu = world.players[1];
  const target = world.players[0];
  const candidates = candidateCells(cpu, target);
  const ownTraps = world.traps.filter((trap) => trap.owner === 1);
  return candidates.find(({ cellX, cellY }) => {
    if (ownTraps.some((trap) => trap.cellX === cellX && trap.cellY === cellY)) return false;
    const overlapsTarget = Math.abs(target.x - cellCenterUnits(cellX)) <= CELL_UNITS / 2 + 3_072
      && Math.abs(target.y - cellCenterUnits(cellY)) <= CELL_UNITS / 2 + 3_072;
    return !overlapsTarget;
  }) ?? null;
}

function shouldPlace(world: WorldState, kind: TrapKind): boolean {
  const cpu = world.players[1];
  if (world.tick < 45 || (world.tick - 45) % 180 !== 0) return false;
  if (cpu.placement || cpu.investigation || cpu.trapCooldownTicks > 0) return false;
  if (cpu.gear < TRAP_COSTS[kind]) return false;
  return world.traps.filter((trap) => trap.owner === 1).length < MAX_ACTIVE_TRAPS;
}

function movementAwayFromTrap(
  player: WorldState['players'][number],
  trap: TrapState,
): Pick<InputCommand, 'moveX' | 'moveY'> {
  const dx = player.x - cellCenterUnits(trap.cellX);
  const dy = player.y - cellCenterUnits(trap.cellY);
  if (Math.abs(dx) >= Math.abs(dy)) return { moveX: signAxis(dx), moveY: 0 };
  return { moveX: 0, moveY: signAxis(dy) };
}

function movementTowardTarget(
  player: WorldState['players'][number],
  target: WorldState['players'][number],
): Pick<InputCommand, 'moveX' | 'moveY'> {
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { moveX: signAxis(dx), moveY: 0 };
  return { moveX: 0, moveY: signAxis(dy) };
}

/**
 * Decide one CPU command from the current world only.
 * Hidden enemy traps are not included in visibleTrapIds; only the shared danger cue can trigger investigation.
 */
export function chooseCpuDecision(world: WorldState, difficulty: CpuDifficulty = 'normal'): CpuDecision {
  const cpu = world.players[1];
  const target = world.players[0];
  const profile = getCpuDifficultyProfile(difficulty);
  const visible = visibleTraps(world);
  const visibleTrapIds = visible.map((trap) => trap.id);

  if (cpu.disabledTicks > 0) {
    return { command: command({}), reason: 'disabled', visibleTrapIds };
  }
  if (cpu.placement) {
    // Setting a trap is interruptible: once the shared danger cue appears,
    // the CPU must be able to abandon setup and investigate instead of being
    // locked into a blind placement until completion.
    if (hasDangerCue(cpu, world.traps) && isCpuReactionTick(world.tick, profile)) {
      return {
        command: command({ investigate: true, investigateStart: true }),
        reason: 'investigating',
        visibleTrapIds,
      };
    }
    return { command: command({}), reason: 'holding-placement', visibleTrapIds };
  }
  if (cpu.investigation) {
    return { command: command({ investigate: true }), reason: 'disarming', visibleTrapIds };
  }

  const revealedEnemyTrap = nearestVisibleEnemyTrap(cpu, visible, DISARM_RADIUS_UNITS);
  if (revealedEnemyTrap && isCpuReactionTick(world.tick, profile)) {
    return {
      command: command({ investigate: true, investigateStart: true }),
      reason: 'disarming',
      visibleTrapIds,
    };
  }
  if (hasDangerCue(cpu, world.traps) && isCpuReactionTick(world.tick, profile)) {
    return {
      command: command({ investigate: true, investigateStart: true }),
      reason: 'investigating',
      visibleTrapIds,
    };
  }

  const kind = chooseTrapKind(world, profile.chainPlanning);
  if (shouldPlace(world, kind)) {
    const placement = choosePlacement(world);
    if (placement) {
      return {
        command: command({
          placeTrap: kind,
          trapDirection: placement.direction,
          trapCellX: placement.cellX,
          trapCellY: placement.cellY,
        }),
        reason: 'placing',
        visibleTrapIds,
      };
    }
  }

  if (
    cpu.fireCooldownTicks === 0
    && !cpu.investigation
    && world.tick % profile.fireCadenceTicks === 0
    && isCpuAimAligned(world.seed, world.tick, profile)
  ) {
    return {
      command: command({ fire: true }),
      reason: 'firing',
      visibleTrapIds,
    };
  }

  const nearbyRevealedTrap = nearestVisibleEnemyTrap(cpu, visible, INVESTIGATE_RADIUS_UNITS * 2);
  if (nearbyRevealedTrap) {
    return {
      command: command(movementAwayFromTrap(cpu, nearbyRevealedTrap)),
      reason: 'retreating',
      visibleTrapIds,
    };
  }

  const movement = movementTowardTarget(cpu, target);
  const reason: CpuActionReason = movement.moveX === 0 && movement.moveY === 0 ? 'holding' : 'approaching';
  return { command: command(movement), reason, visibleTrapIds };
}
