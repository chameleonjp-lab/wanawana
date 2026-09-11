import {
  applyMovement,
  applyPush,
  autoAimVelocity,
  BOMB_CHAIN_RADIUS_UNITS,
  BOUNCE_PUSH_UNITS,
  BOMB_CONTACT_RADIUS_UNITS,
  BOMB_DAMAGE,
  BOMB_PUSH_UNITS,
  BOMB_RADIUS_UNITS,
  BOMB_TRIGGER_TICKS,
  cellCenterUnits,
  DISARM_RADIUS_UNITS,
  DISARM_TICKS,
  FIRE_COOLDOWN_TICKS,
  FIRE_SLOW_TICKS,
  GEAR_MAX,
  GEAR_RECOVERY_TICKS,
  GEAR_START,
  INVESTIGATE_RADIUS_UNITS,
  INVESTIGATE_TICKS,
  INVESTIGATION_PAUSE_TICKS,
  isTrapKind,
  HATCH_DISABLED_TICKS,
  HATCH_RADIUS_UNITS,
  MAX_ACTIVE_TRAPS,
  MAX_CHAIN_TRAPS,
  MAX_EVENTS_PER_TICK,
  MAX_EVENT_LOG,
  MOYA_CONTACT_RADIUS_UNITS,
  MOYA_EFFECT_TICKS,
  MOYA_RADIUS_UNITS,
  normalizeCommand,
  normalizeTrapLoadout,
  PLAYER_RADIUS_UNITS,
  PUSH_IMMUNITY_TICKS,
  RESPAWN_INVULNERABLE_TICKS,
  SPAWN_PLACEMENT_EXCLUSION_RADIUS_UNITS,
  segmentHitsCircle,
  segmentHitsObstacle,
  movePlayerWithObstacles,
  SHOCK_PUSH_UNITS,
  SHOCK_RADIUS_UNITS,
  SHOT_RANGE_UNITS,
  SHOT_RADIUS_UNITS,
  snapToCell,
  TRAP_ARMING_TICKS,
  TRAP_COOLDOWN_TICKS,
  TRAP_COSTS,
  TRAP_LIFETIME_TICKS,
  TRAP_PLACEMENT_TICKS,
} from './fixed.ts';
import { hashWorld } from './hash.ts';
import { getMapDefinition, spawnCellFor } from './maps.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  DEFAULT_TRAP_LOADOUT,
  DEFAULT_MAP_ID,
  MATCH_TICKS,
  type InputCommand,
  type InvestigationState,
  type MatchResult,
  type MapId,
  type ObstacleCell,
  type PlacementState,
  type PlayerState,
  type ShotState,
  type TrapKind,
  type TrapState,
  type TrapEvent,
  type WorldState,
} from './types.ts';

function createPlayer(id: 0 | 1, mapId: MapId): PlayerState {
  const [spawnCellX, spawnCellY] = spawnCellFor(mapId, id);
  return {
    id,
    x: cellCenterUnits(spawnCellX),
    y: cellCenterUnits(spawnCellY),
    hp: 100,
    fireCooldownTicks: 0,
    fireSlowTicks: 0,
    gasSlowTicks: 0,
    pushImmunityTicks: 0,
    trapCooldownTicks: 0,
    gear: GEAR_START,
    gearRecoveryTicks: GEAR_RECOVERY_TICKS,
    placement: null,
    investigation: null,
    investigationPauseTicks: 0,
    disabledTicks: 0,
    respawnInvulnerableTicks: 0,
  };
}

export function createWorld(
  seed = 1,
  playerLoadout: readonly TrapKind[] = DEFAULT_TRAP_LOADOUT,
  cpuLoadout: readonly TrapKind[] = DEFAULT_TRAP_LOADOUT,
  mapId: MapId | string = DEFAULT_MAP_ID,
): WorldState {
  const normalizedPlayerLoadout = normalizeTrapLoadout(playerLoadout);
  const normalizedCpuLoadout = normalizeTrapLoadout(cpuLoadout);
  const normalizedMapId = getMapDefinition(mapId).id;
  const world: WorldState = {
    phase: 'battle',
    tick: 0,
    seed: Math.trunc(seed) >>> 0,
    mapId: normalizedMapId,
    loadouts: [normalizedPlayerLoadout, normalizedCpuLoadout],
    players: [createPlayer(0, normalizedMapId), createPlayer(1, normalizedMapId)],
    shots: [],
    traps: [],
    nextEntityId: 2,
    shotsFired: [0, 0],
    trapsPlaced: [0, 0],
    trapsDisarmed: [0, 0],
    events: [],
    nextEventId: 1,
    nextChainId: 1,
    maxChain: 0,
    result: null,
    lastHash: '',
  };
  return { ...world, lastHash: hashWorld(world) };
}

interface PlayerStep {
  readonly player: PlayerState;
  readonly shot: ShotState | null;
  readonly completedPlacement: PlacementState | null;
  /** The protection tick is consumed after all effects for this tick resolve. */
  readonly respawnProtectionTick?: boolean;
}

function recoverGear(player: PlayerState): Pick<PlayerState, 'gear' | 'gearRecoveryTicks'> {
  if (player.gear >= GEAR_MAX) return { gear: GEAR_MAX, gearRecoveryTicks: GEAR_RECOVERY_TICKS };
  const nextRecoveryTicks = Math.max(0, player.gearRecoveryTicks - 1);
  if (nextRecoveryTicks > 0) return { gear: player.gear, gearRecoveryTicks: nextRecoveryTicks };
  return { gear: Math.min(GEAR_MAX, player.gear + 1), gearRecoveryTicks: GEAR_RECOVERY_TICKS };
}

function placementCellIsValid(
  player: PlayerState,
  target: PlayerState,
  traps: readonly TrapState[],
  cellX: number,
  cellY: number,
  mapId: MapId,
  obstacles: readonly ObstacleCell[],
): boolean {
  if (obstacles.some((obstacle) => obstacle.cellX === cellX && obstacle.cellY === cellY)) return false;
  if (traps.some((trap) => trap.owner === player.id && trap.cellX === cellX && trap.cellY === cellY)) return false;
  const trapX = cellCenterUnits(cellX);
  const trapY = cellCenterUnits(cellY);
  const spawnRadiusSquared = SPAWN_PLACEMENT_EXCLUSION_RADIUS_UNITS
    * SPAWN_PLACEMENT_EXCLUSION_RADIUS_UNITS;
  for (const spawnId of [0, 1] as const) {
    const [spawnCellX, spawnCellY] = spawnCellFor(mapId, spawnId);
    const dx = trapX - cellCenterUnits(spawnCellX);
    const dy = trapY - cellCenterUnits(spawnCellY);
    if (dx * dx + dy * dy <= spawnRadiusSquared) return false;
  }
  const horizontalOverlap = Math.abs(target.x - trapX) <= CELL_UNITS / 2 + PLAYER_RADIUS_UNITS;
  const verticalOverlap = Math.abs(target.y - trapY) <= CELL_UNITS / 2 + PLAYER_RADIUS_UNITS;
  return !(horizontalOverlap && verticalOverlap);
}

function currentCell(player: PlayerState): { cellX: number; cellY: number } {
  return {
    cellX: snapToCell(player.x, ARENA_WIDTH_CELLS),
    cellY: snapToCell(player.y, ARENA_HEIGHT_CELLS),
  };
}

function placementCommandMatchesCurrentCell(player: PlayerState, command: InputCommand): boolean {
  const hasCellX = command.trapCellX !== undefined;
  const hasCellY = command.trapCellY !== undefined;
  if (hasCellX !== hasCellY) return false;
  if (!hasCellX) return true;
  const cell = currentCell(player);
  return command.trapCellX === cell.cellX && command.trapCellY === cell.cellY;
}

function spawnPosition(id: 0 | 1, mapId: MapId): { x: number; y: number } {
  const [cellX, cellY] = spawnCellFor(mapId, id);
  return { x: cellCenterUnits(cellX), y: cellCenterUnits(cellY) };
}

function stepPlayer(
  player: PlayerState,
  command: InputCommand,
  target: PlayerState,
  traps: readonly TrapState[],
  allowedTraps: readonly TrapKind[],
  shotId: number,
  mapId: MapId,
  obstacles: readonly ObstacleCell[],
): PlayerStep {
  const gearState = recoverGear(player);
  const timers = {
    fireCooldownTicks: Math.max(0, player.fireCooldownTicks - 1),
    fireSlowTicks: Math.max(0, player.fireSlowTicks - 1),
    // This field is refreshed from active gas fields at the start of each tick;
    // unlike fireSlowTicks it is not an independent countdown.
    gasSlowTicks: Math.max(0, player.gasSlowTicks ?? 0),
    pushImmunityTicks: Math.max(0, player.pushImmunityTicks - 1),
    trapCooldownTicks: Math.max(0, player.trapCooldownTicks - 1),
    investigationPauseTicks: Math.max(0, player.investigationPauseTicks - 1),
    disabledTicks: Math.max(0, player.disabledTicks - 1),
    respawnInvulnerableTicks: Math.max(0, player.respawnInvulnerableTicks - 1),
    ...gearState,
  };

  if (player.disabledTicks > 0) {
    const position = timers.disabledTicks === 0 ? spawnPosition(player.id, mapId) : { x: player.x, y: player.y };
    return {
      player: {
        ...player,
        ...timers,
        ...position,
        placement: null,
        investigation: null,
        gasSlowTicks: 0,
        respawnInvulnerableTicks: timers.disabledTicks === 0
          ? RESPAWN_INVULNERABLE_TICKS
          : timers.respawnInvulnerableTicks,
      },
      shot: null,
      completedPlacement: null,
    };
  }

  // The short post-respawn grace period is a complete action/effect lock. It
  // is deliberately checked before movement, firing, placement, or
  // investigation so every command source (human, CPU, and replay) follows
  // the same state transition.
  if (player.respawnInvulnerableTicks > 0) {
    return {
      player: {
        ...player,
        ...timers,
        // Keep the current protection value visible to the effect phases. It
        // is decremented only after those phases have observed this tick.
        respawnInvulnerableTicks: player.respawnInvulnerableTicks,
        placement: null,
        investigation: null,
        gasSlowTicks: 0,
      },
      shot: null,
      completedPlacement: null,
      respawnProtectionTick: true,
    };
  }

  if (player.placement) {
    const cell = currentCell(player);
    if (cell.cellX !== player.placement.cellX || cell.cellY !== player.placement.cellY) {
      // A preview is anchored to the cell captured at release. If an external
      // force or a restored state moved the actor away, cancel without
      // consuming gear or creating a trap at a surprising location.
      return {
        player: { ...player, ...timers, placement: null },
        shot: null,
        completedPlacement: null,
      };
    }
  }

  if (player.placement && command.investigate && command.investigateStart) {
    // Placement is a committed preview, not an uninterruptible animation.
    // A deliberate investigation input cancels it before the investigation
    // phase below selects a target. This keeps player and CPU behavior equal.
    return {
      player: { ...player, ...timers, placement: null },
      shot: null,
      completedPlacement: null,
    };
  }

  if (player.placement) {
    const remainingTicks = player.placement.remainingTicks - 1;
    if (remainingTicks > 0) {
      return {
        player: { ...player, ...timers, placement: { ...player.placement, remainingTicks } },
        shot: null,
        completedPlacement: null,
      };
    }
    return {
      player: { ...player, ...timers, placement: null },
      shot: null,
      completedPlacement: player.placement,
    };
  }

  if (
    command.placeTrap
    && isTrapKind(command.placeTrap)
    && allowedTraps.includes(command.placeTrap)
    && placementCommandMatchesCurrentCell(player, command)
    && !player.investigation
    && player.gear >= TRAP_COSTS[command.placeTrap]
    && player.trapCooldownTicks === 0
    && traps.filter((trap) => trap.owner === player.id).length < MAX_ACTIVE_TRAPS
  ) {
    // The core captures the cell from the actor, never from a client-provided
    // destination. The optional command cell is only a preview proof and was
    // checked above to cancel stale/remote commands.
    const cell = currentCell(player);
    if (placementCellIsValid(player, target, traps, cell.cellX, cell.cellY, mapId, obstacles)) {
      return {
        player: {
          ...player,
          ...timers,
          placement: {
            kind: command.placeTrap,
            direction: command.trapDirection,
            cellX: cell.cellX,
            cellY: cell.cellY,
            remainingTicks: TRAP_PLACEMENT_TICKS,
          },
        },
        shot: null,
        completedPlacement: null,
      };
    }
  }

  const canFire = command.fire && player.fireCooldownTicks === 0;
  const moved = applyMovement({
    ...player,
    ...timers,
    fireSlowTicks: canFire ? FIRE_SLOW_TICKS : timers.fireSlowTicks,
  }, command, obstacles);
  if (!canFire) return { player: moved, shot: null, completedPlacement: null };

  const velocity = autoAimVelocity(moved.x, moved.y, target.x, target.y);
  return {
    player: { ...moved, fireCooldownTicks: FIRE_COOLDOWN_TICKS },
    shot: {
      id: shotId,
      owner: player.id,
      x: moved.x,
      y: moved.y,
      vx: velocity.vx,
      vy: velocity.vy,
      travelledUnits: 0,
    },
    completedPlacement: null,
  };
}

function createTrap(owner: 0 | 1, id: number, placement: PlacementState): TrapState {
  return {
    id,
    owner,
    kind: placement.kind,
    direction: placement.direction,
    cellX: placement.cellX,
    cellY: placement.cellY,
    armingTicks: TRAP_ARMING_TICKS,
    remainingTicks: TRAP_LIFETIME_TICKS,
    discoveredBy: owner === 0 ? [true, false] : [false, true],
    triggerTicks: 0,
    effectTicks: 0,
  };
}

function addCompletedTrap(
  player: PlayerState,
  placement: PlacementState | null,
  traps: readonly TrapState[],
  nextEntityId: number,
  cancelled: boolean,
): { player: PlayerState; traps: readonly TrapState[]; nextEntityId: number; placed: boolean } {
  if (!placement || cancelled) return { player, traps, nextEntityId, placed: false };
  const trap = createTrap(player.id, nextEntityId, placement);
  return {
    player: {
      ...player,
      gear: Math.max(0, player.gear - TRAP_COSTS[placement.kind]),
      trapCooldownTicks: TRAP_COOLDOWN_TICKS,
    },
    traps: [...traps, trap],
    nextEntityId: nextEntityId + 1,
    placed: true,
  };
}

function trapDistanceSquared(player: PlayerState, trap: TrapState): number {
  const dx = player.x - cellCenterUnits(trap.cellX);
  const dy = player.y - cellCenterUnits(trap.cellY);
  return dx * dx + dy * dy;
}

function trapIsActive(trap: TrapState): boolean {
  return (trap.triggerTicks ?? 0) > 0 || (trap.effectTicks ?? 0) > 0;
}

/** A disabled or freshly respawned actor is outside every gameplay effect. */
function isPlayerProtected(player: PlayerState): boolean {
  return player.disabledTicks > 0 || player.respawnInvulnerableTicks > 0;
}

function findInvestigationTarget(
  player: PlayerState,
  traps: readonly TrapState[],
): { trap: TrapState; mode: 'reveal' | 'disarm' } | null {
  const candidates: Array<{ trap: TrapState; mode: 'reveal' | 'disarm'; distance: number }> = [];
  for (const trap of traps) {
    if (trap.owner === player.id || trap.armingTicks > 0 || trapIsActive(trap)) continue;
    const distance = trapDistanceSquared(player, trap);
    if (!trap.discoveredBy[player.id] && distance <= INVESTIGATE_RADIUS_UNITS ** 2) {
      candidates.push({ trap, mode: 'reveal', distance });
    } else if (trap.discoveredBy[player.id] && distance <= DISARM_RADIUS_UNITS ** 2) {
      candidates.push({ trap, mode: 'disarm', distance });
    }
  }
  candidates.sort((first, second) => first.distance - second.distance || first.trap.id - second.trap.id);
  const target = candidates[0];
  return target ? { trap: target.trap, mode: target.mode } : null;
}

function investigationStillValid(
  player: PlayerState,
  state: InvestigationState,
  traps: readonly TrapState[],
): TrapState | null {
  if (player.x !== state.startX || player.y !== state.startY) return null;
  const trap = traps.find((candidate) => candidate.id === state.targetTrapId);
  if (!trap || trap.owner === player.id || trap.armingTicks > 0 || trapIsActive(trap)) return null;
  if (state.mode === 'reveal' && trap.discoveredBy[player.id]) return null;
  if (state.mode === 'disarm' && !trap.discoveredBy[player.id]) return null;
  const radius = state.mode === 'reveal' ? INVESTIGATE_RADIUS_UNITS : DISARM_RADIUS_UNITS;
  return trapDistanceSquared(player, trap) <= radius ** 2 ? trap : null;
}

interface InvestigationStep {
  readonly player: PlayerState;
  readonly traps: readonly TrapState[];
  readonly disarmed: boolean;
}

function stepInvestigation(
  player: PlayerState,
  command: InputCommand,
  traps: readonly TrapState[],
): InvestigationStep {
  // Investigation is a gameplay input too. Keep the protection contract at
  // this phase as well as in stepPlayer, because investigation runs after
  // movement/placement resolution in the same fixed tick.
  if (isPlayerProtected(player)) {
    return { player: { ...player, investigation: null }, traps, disarmed: false };
  }
  if (player.placement) {
    return { player: { ...player, investigation: null }, traps, disarmed: false };
  }
  if (player.investigation) {
    const state = player.investigation;
    if (!command.investigate) return { player: { ...player, investigation: null }, traps, disarmed: false };
    const target = investigationStillValid(player, state, traps);
    if (!target) return { player: { ...player, investigation: null }, traps, disarmed: false };
    if (player.investigationPauseTicks > 0) {
      return { player: { ...player, investigationPauseTicks: player.investigationPauseTicks - 1 }, traps, disarmed: false };
    }
    const remainingTicks = state.remainingTicks - 1;
    if (remainingTicks > 0) {
      return { player: { ...player, investigation: { ...state, remainingTicks } }, traps, disarmed: false };
    }
    if (state.mode === 'reveal') {
      const updatedTraps = traps.map((trap) => trap.id === target.id
        ? {
          ...trap,
          discoveredBy: (player.id === 0
            ? [true, trap.discoveredBy[1]]
            : [trap.discoveredBy[0], true]) as readonly [boolean, boolean],
        }
        : trap);
      return { player: { ...player, investigation: null }, traps: updatedTraps, disarmed: false };
    }
    return { player: { ...player, investigation: null }, traps: traps.filter((trap) => trap.id !== target.id), disarmed: true };
  }

  if (!command.investigateStart || !command.investigate) return { player, traps, disarmed: false };
  const target = findInvestigationTarget(player, traps);
  if (!target) return { player, traps, disarmed: false };
  return {
    player: {
      ...player,
      investigation: {
        targetTrapId: target.trap.id,
        mode: target.mode,
        startX: player.x,
        startY: player.y,
        remainingTicks: target.mode === 'reveal' ? INVESTIGATE_TICKS : DISARM_TICKS,
      },
    },
    traps,
    disarmed: false,
  };
}

function advanceTrapTimers(traps: readonly TrapState[]): readonly TrapState[] {
  return traps
    .flatMap((trap) => {
      const nextEffectTicks = trap.effectTicks === undefined
        ? undefined
        : Math.max(0, trap.effectTicks - 1);
      if (trap.kind === 'moya' && (trap.effectTicks ?? 0) > 0 && nextEffectTicks === 0) return [];
      const nextTrap: TrapState = {
        ...trap,
        armingTicks: Math.max(0, trap.armingTicks - 1),
        remainingTicks: trap.armingTicks > 0 ? trap.remainingTicks : Math.max(0, trap.remainingTicks - 1),
        ...(trap.triggerTicks === undefined ? {} : { triggerTicks: Math.max(0, trap.triggerTicks - 1) }),
        ...(nextEffectTicks === undefined ? {} : { effectTicks: nextEffectTicks }),
      };
      return nextTrap.remainingTicks > 0 ? [nextTrap] : [];
    });
}

interface TrapSegment {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly sourceActor: 0 | 1;
  readonly parentEventId: number | null;
  readonly chainId: number | null;
  readonly chainLength: number;
}

interface ContactCandidate {
  readonly trap: TrapState;
  /** Integer progress and span used as a fixed rational contact time. */
  readonly progress: ContactProgress;
}

interface ContactProgress {
  readonly numerator: number;
  readonly denominator: number;
}

interface PendingTrapSegment {
  readonly targetId: 0 | 1;
  readonly segment: TrapSegment;
  readonly order: number;
}

interface TrapResolution {
  readonly players: readonly [PlayerState, PlayerState];
  readonly traps: readonly TrapState[];
  readonly events: readonly TrapEvent[];
  readonly nextEventId: number;
  readonly nextChainId: number;
  readonly maxChain: number;
  readonly technicalInvalid: boolean;
}

/**
 * Return the first integer progress at which a segment touches a circle.
 *
 * The simulation orders same-tick contacts by movement progress, not by the
 * distance from the segment start to a trap centre. Progress is sampled in a
 * fixed integer grid and found by binary search; this keeps the rule stable
 * without consulting a frame clock or a floating-point time value.
 */
function firstContactProgress(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  centerX: number,
  centerY: number,
  radius: number,
): ContactProgress | null {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  const pointAt = (progress: number): { x: number; y: number } => ({
    x: startX + Math.trunc(deltaX * progress / steps),
    y: startY + Math.trunc(deltaY * progress / steps),
  });

  if (steps === 0) {
    return segmentHitsCircle(startX, startY, endX, endY, centerX, centerY, radius)
      ? { numerator: 0, denominator: 1 }
      : null;
  }
  // Being inside the contact circle at the beginning of a segment is the
  // earliest possible contact. Returning zero is important when another trap
  // is reached on the first integer step: the starting trap must win even if
  // its entity id is larger.
  if (segmentHitsCircle(startX, startY, startX, startY, centerX, centerY, radius)) {
    return { numerator: 0, denominator: steps };
  }
  if (!segmentHitsCircle(startX, startY, endX, endY, centerX, centerY, radius)) return null;

  let low = 0;
  let high = steps;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    const point = pointAt(middle);
    if (segmentHitsCircle(startX, startY, point.x, point.y, centerX, centerY, radius)) high = middle;
    else low = middle;
  }
  return { numerator: high, denominator: steps };
}

function compareContactProgress(first: ContactProgress, second: ContactProgress): number {
  const left = BigInt(first.numerator) * BigInt(second.denominator);
  const right = BigInt(second.numerator) * BigInt(first.denominator);
  return left < right ? -1 : left > right ? 1 : 0;
}

function pointAtContact(segment: TrapSegment, progress: ContactProgress): { x: number; y: number } {
  if (progress.denominator <= 0) return { x: segment.startX, y: segment.startY };
  return {
    x: segment.startX + Math.trunc((segment.endX - segment.startX) * progress.numerator / progress.denominator),
    y: segment.startY + Math.trunc((segment.endY - segment.startY) * progress.numerator / progress.denominator),
  };
}

function trapContactRadius(trap: TrapState): number {
  if (trap.kind === 'bounce') return CELL_UNITS / 2;
  if (trap.kind === 'shock') return SHOCK_RADIUS_UNITS;
  if (trap.kind === 'hatch') return HATCH_RADIUS_UNITS;
  if (trap.kind === 'bomb') return BOMB_CONTACT_RADIUS_UNITS;
  return MOYA_CONTACT_RADIUS_UNITS;
}

function findFirstContact(segment: TrapSegment, traps: readonly TrapState[]): ContactCandidate | null {
  const candidates = findFirstContacts(segment, traps);
  return candidates[0] ?? null;
}

function findFirstContacts(segment: TrapSegment, traps: readonly TrapState[]): ContactCandidate[] {
  const candidates: ContactCandidate[] = [];
  for (const trap of traps) {
    if (trap.armingTicks > 0 || (trap.triggerTicks ?? 0) > 0 || (trap.effectTicks ?? 0) > 0) continue;
    const centerX = cellCenterUnits(trap.cellX);
    const centerY = cellCenterUnits(trap.cellY);
    const progress = firstContactProgress(
      segment.startX,
      segment.startY,
      segment.endX,
      segment.endY,
      centerX,
      centerY,
      trapContactRadius(trap),
    );
    if (progress === null) continue;
    candidates.push({ trap, progress });
  }
  candidates.sort((first, second) => compareContactProgress(first.progress, second.progress) || first.trap.id - second.trap.id);
  const first = candidates[0];
  if (!first) return [];
  return candidates.filter((candidate) => compareContactProgress(candidate.progress, first.progress) === 0);
}

function moveByDirection(
  player: PlayerState,
  direction: 0 | 1 | 2 | 3,
  distance: number,
  obstacles: readonly ObstacleCell[],
): PlayerState {
  const vectors = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  const [dx, dy] = vectors[direction];
  return movePlayerWithObstacles(player, dx * distance, dy * distance, obstacles);
}

function moveAwayFromTrap(
  player: PlayerState,
  trap: TrapState,
  distance: number,
  obstacles: readonly ObstacleCell[],
): PlayerState {
  const dx = player.x - cellCenterUnits(trap.cellX);
  const dy = player.y - cellCenterUnits(trap.cellY);
  if (dx === 0 && dy === 0) return moveByDirection(player, 0, distance, obstacles);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return moveByDirection(player, dx < 0 ? 3 : 1, distance, obstacles);
  }
  return moveByDirection(player, dy < 0 ? 0 : 2, distance, obstacles);
}

interface PushVector {
  readonly x: number;
  readonly y: number;
}

/**
 * Return the force a radial trap intends to apply before obstacle resolution.
 *
 * Trap effects are collected against one snapshot. Applying this vector only
 * after the collection phase prevents one bomb's resolved position from
 * changing another bomb's hit test. The strongest single displacement in the
 * current rule set is a bounce, so combined force is capped at that distance.
 */
function intendedPushAwayFromTrap(player: PlayerState, trap: TrapState, distance: number): PushVector {
  const dx = player.x - cellCenterUnits(trap.cellX);
  const dy = player.y - cellCenterUnits(trap.cellY);
  if (dx === 0 && dy === 0) return { x: 0, y: -distance };
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx < 0 ? -distance : distance, y: 0 };
  return { x: 0, y: dy < 0 ? -distance : distance };
}

function intendedPushForTrap(player: PlayerState, trap: TrapState): PushVector {
  if (trap.kind === 'bounce') {
    const vectors = [[0, -BOUNCE_PUSH_UNITS], [BOUNCE_PUSH_UNITS, 0], [0, BOUNCE_PUSH_UNITS], [-BOUNCE_PUSH_UNITS, 0]] as const;
    const [x, y] = vectors[trap.direction];
    return { x, y };
  }
  return intendedPushAwayFromTrap(player, trap, SHOCK_PUSH_UNITS);
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) return value;
  let low = 1n;
  let high = 2n;
  while (high * high <= value) high *= 2n;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (middle * middle <= value) low = middle;
    else high = middle;
  }
  return low;
}

function ceilIntegerSquareRoot(value: bigint): bigint {
  const floor = integerSquareRoot(value);
  return floor * floor === value ? floor : floor + 1n;
}

function capCombinedPush(push: PushVector): PushVector {
  const magnitudeSquared = BigInt(push.x) * BigInt(push.x) + BigInt(push.y) * BigInt(push.y);
  const limit = BigInt(BOUNCE_PUSH_UNITS);
  if (magnitudeSquared === 0n || magnitudeSquared <= limit * limit) return push;
  const magnitudeCeiling = ceilIntegerSquareRoot(magnitudeSquared);
  return {
    x: Number((BigInt(push.x) * limit) / magnitudeCeiling),
    y: Number((BigInt(push.y) * limit) / magnitudeCeiling),
  };
}

function applyCombinedPush(
  player: PlayerState,
  push: PushVector,
  obstacles: readonly ObstacleCell[],
): PlayerState {
  if (push.x === 0 && push.y === 0) return player;
  return movePlayerWithObstacles(
    { ...player, placement: null, investigation: null },
    push.x,
    push.y,
    obstacles,
  );
}

interface TrapEffectResult {
  readonly player: PlayerState;
  readonly damage: number;
  readonly pushX: number;
  readonly pushY: number;
}

function applyTrapEffect(
  player: PlayerState,
  trap: TrapState,
  obstacles: readonly ObstacleCell[],
): TrapEffectResult {
  const protectedTarget = isPlayerProtected(player);
  let nextPlayer = player;
  let damage = 0;
  let pushX = 0;
  let pushY = 0;

  if (!protectedTarget) {
    if (trap.kind === 'bounce') {
      nextPlayer = moveByDirection({ ...player, placement: null, investigation: null }, trap.direction, BOUNCE_PUSH_UNITS, obstacles);
      pushX = nextPlayer.x - player.x;
      pushY = nextPlayer.y - player.y;
    } else if (trap.kind === 'shock') {
      damage = 18;
      nextPlayer = moveAwayFromTrap({
        ...player,
        hp: Math.max(0, player.hp - damage),
        placement: null,
        investigation: null,
      }, trap, SHOCK_PUSH_UNITS, obstacles);
      pushX = nextPlayer.x - player.x;
      pushY = nextPlayer.y - player.y;
    } else if (trap.kind === 'hatch') {
      damage = 26;
      nextPlayer = {
        ...player,
        hp: Math.max(0, player.hp - damage),
        disabledTicks: HATCH_DISABLED_TICKS,
        placement: null,
        investigation: null,
      };
    }
  }

  if (trap.kind === 'moya' && !protectedTarget) {
    nextPlayer = {
      ...nextPlayer,
      placement: null,
      investigation: null,
      gasSlowTicks: MOYA_EFFECT_TICKS - 1,
    };
  }

  return { player: nextPlayer, damage, pushX, pushY };
}

function resolveTrapContacts(
  tick: number,
  players: readonly [PlayerState, PlayerState],
  traps: readonly TrapState[],
  previousPositions: readonly [{ x: number; y: number }, { x: number; y: number }],
  pushedBy: readonly [0 | 1 | null, 0 | 1 | null],
  nextEventId: number,
  nextChainId: number,
  currentMaxChain: number,
  obstacles: readonly ObstacleCell[],
): TrapResolution {
  const nextPlayers: [PlayerState, PlayerState] = [...players];
  let remainingTraps: readonly TrapState[] = traps;
  const segments: Array<TrapSegment | null> = [
    isPlayerProtected(players[0]) ? null : {
      startX: previousPositions[0].x,
      startY: previousPositions[0].y,
      endX: players[0].x,
      endY: players[0].y,
      sourceActor: pushedBy[0] ?? 0,
      parentEventId: null,
      chainId: null,
      chainLength: 0,
    },
    isPlayerProtected(players[1]) ? null : {
      startX: previousPositions[1].x,
      startY: previousPositions[1].y,
      endX: players[1].x,
      endY: players[1].y,
      sourceActor: pushedBy[1] ?? 1,
      parentEventId: null,
      chainId: null,
      chainLength: 0,
    },
  ];
  const events: TrapEvent[] = [];
  let eventId = nextEventId;
  let chainId = nextChainId;
  let maxChain = currentMaxChain;
  let technicalInvalid = false;
  const triggeredBombIds = new Set<number>();

  for (let eventCount = 0; eventCount < MAX_EVENTS_PER_TICK && !technicalInvalid; eventCount += 1) {
    const firstCandidates = segments.map((segment, targetId) => (
      segment && !isPlayerProtected(nextPlayers[targetId])
        ? findFirstContacts(segment, remainingTraps)
        : []
    ));
    let earliest: ContactProgress | null = null;
    for (const candidates of firstCandidates) {
      const candidate = candidates[0];
      if (!candidate) continue;
      if (!earliest || compareContactProgress(candidate.progress, earliest) < 0) earliest = candidate.progress;
    }
    if (!earliest) break;

    // Contacts with the same fixed-rational progress are one effect phase.
    // Gather them before consuming a trap or moving either target, so an
    // overlapping trap cannot be won by entity-array order.
    const batches: Array<{
      readonly targetId: 0 | 1;
      readonly segment: TrapSegment;
      readonly candidates: readonly ContactCandidate[];
    }> = [];
    for (const targetId of [0, 1] as const) {
      const segment = segments[targetId];
      const candidates = firstCandidates[targetId];
      if (!segment || candidates.length === 0) continue;
      if (compareContactProgress(candidates[0].progress, earliest) !== 0) continue;
      batches.push({ targetId, segment, candidates });
      segments[targetId] = null;
    }

    // A trap may be contacted by both players in the same phase. The trap is
    // consumed once, while each target receives the effect from the shared
    // snapshot. Contact batches are ordered by target then physical trap key;
    // only event identifiers use this order, never hit resolution.
    batches.sort((first, second) => first.targetId - second.targetId);
    const consumedTrapIds = new Set<number>();
    const activatedMoyaIds = new Set<number>();

    for (const batch of batches) {
      const { targetId, segment, candidates } = batch;
      const contactPoint = pointAtContact(segment, candidates[0].progress);
      const basePlayer = { ...nextPlayers[targetId], x: contactPoint.x, y: contactPoint.y };
      const protectedTarget = isPlayerProtected(basePlayer);
      let totalDamage = 0;
      let push: PushVector = { x: 0, y: 0 };
      let hasHatch = false;
      let hasMoya = false;
      let clearAction = false;
      let representativeEvent: TrapEvent | null = null;

      const orderedCandidates = [...candidates].sort((first, second) => first.trap.cellY - second.trap.cellY
        || first.trap.cellX - second.trap.cellX
        || first.trap.owner - second.trap.owner
        || first.trap.kind.localeCompare(second.trap.kind)
        || first.trap.id - second.trap.id);
      // A legal placement cannot contain two traps from one owner on one
      // cell. Keep that invariant for legacy/hand-authored states while
      // allowing the intended enemy-on-enemy overlap to resolve together.
      const ownerCells = new Set<string>();
      for (const candidate of orderedCandidates) {
        const trap = candidate.trap;
        const ownerCell = `${trap.owner}:${trap.cellX}:${trap.cellY}`;
        if (ownerCells.has(ownerCell)) continue;
        ownerCells.add(ownerCell);
        const parentEventId = segment.parentEventId;
        const eventChainId = segment.chainId ?? chainId++;
        const eventChainLength = segment.chainLength + 1;
        if (eventChainLength > MAX_CHAIN_TRAPS) technicalInvalid = true;
        maxChain = Math.max(maxChain, eventChainLength);

        if (trap.kind === 'bomb') {
          if (!triggeredBombIds.has(trap.id)) {
            triggeredBombIds.add(trap.id);
            remainingTraps = remainingTraps.map((current) => current.id === trap.id
              ? {
                ...current,
                triggerTicks: BOMB_TRIGGER_TICKS,
                triggerParentEventId: parentEventId,
                triggerChainId: eventChainId,
                triggerChainLength: segment.chainLength,
                triggerResponsibleActor: parentEventId === null
                  ? segment.sourceActor
                  : (events.find((event) => event.id === parentEventId)?.responsibleActor ?? segment.sourceActor),
              }
              : current);
          }
          continue;
        }

        if (events.length >= MAX_EVENTS_PER_TICK) {
          technicalInvalid = true;
          break;
        }
        const activeMoya = trap.kind === 'moya'
          && !protectedTarget
          && (trap.effectTicks ?? 0) === 0;
        if (activeMoya) {
          if (!activatedMoyaIds.has(trap.id)) {
            activatedMoyaIds.add(trap.id);
            remainingTraps = remainingTraps.map((current) => current.id === trap.id
              ? { ...current, effectTicks: MOYA_EFFECT_TICKS }
              : current);
          }
        } else if (!consumedTrapIds.has(trap.id)) {
          consumedTrapIds.add(trap.id);
          remainingTraps = remainingTraps.filter((current) => current.id !== trap.id);
        }

        const damage = !protectedTarget && (trap.kind === 'shock' || trap.kind === 'hatch')
          ? trap.kind === 'shock' ? 18 : 26
          : 0;
        const contribution = !protectedTarget && (trap.kind === 'bounce' || trap.kind === 'shock')
          ? intendedPushForTrap(basePlayer, trap)
          : { x: 0, y: 0 };
        totalDamage += damage;
        push = { x: push.x + contribution.x, y: push.y + contribution.y };
        if (trap.kind === 'hatch') hasHatch = !protectedTarget || hasHatch;
        if (trap.kind === 'moya' && !protectedTarget) hasMoya = true;
        if (!protectedTarget) clearAction = true;

        const event: TrapEvent = {
          id: eventId,
          tick,
          chainId: eventChainId,
          parentEventId,
          chainLength: eventChainLength,
          trapId: trap.id,
          owner: trap.owner,
          kind: trap.kind,
          target: targetId,
          responsibleActor: parentEventId === null
            ? segment.sourceActor
            : (events.find((event) => event.id === parentEventId)?.responsibleActor ?? segment.sourceActor),
          x: contactPoint.x,
          y: contactPoint.y,
          damage,
          pushX: contribution.x,
          pushY: contribution.y,
        };
        eventId += 1;
        events.push(event);
        if (representativeEvent === null) representativeEvent = event;
        if (eventChainLength > MAX_CHAIN_TRAPS || events.length >= MAX_EVENT_LOG) {
          technicalInvalid = true;
          break;
        }
      }
      if (technicalInvalid) break;

      const damagedPlayer = totalDamage > 0
        ? {
          ...basePlayer,
          hp: Math.max(0, basePlayer.hp - totalDamage),
          placement: null,
          investigation: null,
        }
        : clearAction
          ? { ...basePlayer, placement: null, investigation: null }
          : basePlayer;
      const withHatch = hasHatch
        ? { ...damagedPlayer, disabledTicks: HATCH_DISABLED_TICKS, placement: null, investigation: null }
        : damagedPlayer;
      if (hasMoya) {
        remainingTraps = remainingTraps.map((current) => activatedMoyaIds.has(current.id)
          ? { ...current, effectTicks: MOYA_EFFECT_TICKS }
          : current);
      }
      const cappedPush = capCombinedPush(push);
      const nextPlayer = applyCombinedPush(withHatch, cappedPush, obstacles);
      nextPlayers[targetId] = nextPlayer;
      if (representativeEvent
        && !isPlayerProtected(nextPlayer)
        && (nextPlayer.x !== contactPoint.x || nextPlayer.y !== contactPoint.y)) {
        segments[targetId] = {
          startX: contactPoint.x,
          startY: contactPoint.y,
          endX: nextPlayer.x,
          endY: nextPlayer.y,
          sourceActor: representativeEvent.responsibleActor,
          parentEventId: representativeEvent.id,
          chainId: representativeEvent.chainId,
          chainLength: representativeEvent.chainLength,
        };
      }
    }
  }

  if (events.length >= MAX_EVENTS_PER_TICK) technicalInvalid = true;
  return {
    players: nextPlayers,
    traps: remainingTraps,
    events,
    nextEventId: eventId,
    nextChainId: chainId,
    maxChain,
    technicalInvalid,
  };
}

/** Resolve fuse-driven bombs after all ordinary movement and contact chains. */
function resolveDelayedTrapEffects(
  tick: number,
  players: readonly [PlayerState, PlayerState],
  traps: readonly TrapState[],
  nextEventId: number,
  nextChainId: number,
  currentMaxChain: number,
  existingEventCount: number,
  obstacles: readonly ObstacleCell[],
): TrapResolution {
  const nextPlayers: [PlayerState, PlayerState] = [...players];
  let remainingTraps: readonly TrapState[] = traps;
  const events: TrapEvent[] = [];
  let eventId = nextEventId;
  let chainId = nextChainId;
  let maxChain = currentMaxChain;
  let technicalInvalid = false;

  // A delayed blast can push a player through another trap. Keep those paths
  // as ordered segments so recursive same-tick propagation has the same
  // collision rules as ordinary movement.
  const pendingSegments: PendingTrapSegment[] = [];
  let pendingOrder = 0;
  const enqueueSegment = (targetId: 0 | 1, segment: TrapSegment): void => {
    pendingSegments.push({ targetId, segment, order: pendingOrder });
    pendingOrder += 1;
  };

  const resolvePendingSegments = (): void => {
    while (pendingSegments.length > 0 && !technicalInvalid) {
      pendingSegments.sort((first, second) => first.order - second.order || first.targetId - second.targetId);
      const pending = pendingSegments.shift();
      if (!pending) break;
      if (isPlayerProtected(nextPlayers[pending.targetId])) continue;
      const candidate = findFirstContact(pending.segment, remainingTraps);
      if (!candidate) continue;

      const { targetId, segment } = pending;
      const trap = candidate.trap;
      const parentEventId = segment.parentEventId;
      const eventChainId = segment.chainId ?? chainId++;
      const eventChainLength = segment.chainLength + 1;
      const contactPoint = pointAtContact(segment, candidate.progress);
      if (eventChainLength > MAX_CHAIN_TRAPS) technicalInvalid = true;
      maxChain = Math.max(maxChain, eventChainLength);

      // A bomb keeps its event delayed, but carries the complete chain
      // context so its later explosion remains a deterministic child event.
      if (trap.kind === 'bomb' && (trap.triggerTicks ?? 0) === 0) {
        remainingTraps = remainingTraps.map((current) => current.id === trap.id
          ? {
            ...current,
            triggerTicks: BOMB_TRIGGER_TICKS,
            triggerParentEventId: parentEventId,
            triggerChainId: eventChainId,
            triggerChainLength: segment.chainLength,
            triggerResponsibleActor: segment.sourceActor,
          }
          : current);
        nextPlayers[targetId] = { ...nextPlayers[targetId], x: contactPoint.x, y: contactPoint.y };
        continue;
      }

      if (existingEventCount + events.length >= MAX_EVENTS_PER_TICK) {
        technicalInvalid = true;
        break;
      }

      const moyaActivation = trap.kind === 'moya' && (trap.effectTicks ?? 0) === 0;
      if (moyaActivation) {
        remainingTraps = remainingTraps.map((current) => current.id === trap.id
          ? { ...current, effectTicks: MOYA_EFFECT_TICKS }
          : current);
      } else {
        remainingTraps = remainingTraps.filter((current) => current.id !== trap.id);
      }

      const currentPlayer = { ...nextPlayers[targetId], x: contactPoint.x, y: contactPoint.y };
      const effect = applyTrapEffect(currentPlayer, trap, obstacles);
      const event: TrapEvent = {
        id: eventId,
        tick,
        chainId: eventChainId,
        parentEventId,
        chainLength: eventChainLength,
        trapId: trap.id,
        owner: trap.owner,
        kind: trap.kind,
        target: targetId,
        responsibleActor: segment.sourceActor,
        x: contactPoint.x,
        y: contactPoint.y,
        damage: effect.damage,
        pushX: effect.pushX,
        pushY: effect.pushY,
      };
      eventId += 1;
      events.push(event);
      nextPlayers[targetId] = effect.player;

      if (eventChainLength > MAX_CHAIN_TRAPS || existingEventCount + events.length >= MAX_EVENT_LOG) {
        technicalInvalid = true;
        break;
      }

      if ((trap.kind === 'bounce' || trap.kind === 'shock')
        && (effect.pushX !== 0 || effect.pushY !== 0)) {
        enqueueSegment(targetId, {
          startX: currentPlayer.x,
          startY: currentPlayer.y,
          endX: effect.player.x,
          endY: effect.player.y,
          sourceActor: segment.sourceActor,
          parentEventId: event.id,
          chainId: event.chainId,
          chainLength: event.chainLength,
        });
      }
    }
  };

  /**
   * Every due bomb observes this same player snapshot. We intentionally keep
   * it separate from nextPlayers: applying the first blast must never alter a
   * later blast's hit set for this tick.
   */
  const blastSnapshot: readonly [PlayerState, PlayerState] = [
    { ...players[0] },
    { ...players[1] },
  ];
  const dueBombs = traps
    .filter((trap) => trap.kind === 'bomb' && (trap.triggerTicks ?? 0) === 1)
    // Physical position is the primary key. IDs break ties only for truly
    // indistinguishable entities; changing an ID cannot change a hit result.
    .sort((first, second) => first.cellY - second.cellY
      || first.cellX - second.cellX
      || first.owner - second.owner
      || first.direction - second.direction
      || first.id - second.id);
  const dueBombIds = new Set(dueBombs.map((bomb) => bomb.id));
  remainingTraps = remainingTraps.filter((trap) => !dueBombIds.has(trap.id));

  interface DueBombContext {
    readonly bomb: TrapState;
    readonly eventChainId: number;
    readonly eventChainLength: number;
    readonly parentEventId: number | null;
    readonly responsibleActor: 0 | 1;
    readonly explosionEventId: number;
  }
  interface BombImpact {
    readonly bomb: TrapState;
    readonly targetId: 0 | 1;
    readonly inBlast: boolean;
    readonly protectedTarget: boolean;
    readonly push: PushVector;
    readonly event: TrapEvent;
  }

  const dueContexts: DueBombContext[] = [];
  const impacts: BombImpact[] = [];
  for (const bomb of dueBombs) {
    const centerX = cellCenterUnits(bomb.cellX);
    const centerY = cellCenterUnits(bomb.cellY);
    const eventChainId = bomb.triggerChainId ?? chainId++;
    const eventChainLength = (bomb.triggerChainLength ?? 0) + 1;
    const parentEventId = bomb.triggerParentEventId ?? null;
    const responsibleActor = bomb.triggerResponsibleActor ?? bomb.owner;
    if (eventChainLength > MAX_CHAIN_TRAPS) technicalInvalid = true;
    maxChain = Math.max(maxChain, eventChainLength);

    const distanceSquaredToCenter = (targetId: 0 | 1): number => {
      const dx = blastSnapshot[targetId].x - centerX;
      const dy = blastSnapshot[targetId].y - centerY;
      return dx * dx + dy * dy;
    };
    const blastTargets = ([0, 1] as const).filter(
      (targetId) => distanceSquaredToCenter(targetId) <= BOMB_RADIUS_UNITS * BOMB_RADIUS_UNITS,
    );
    // Keep the existing event contract for a blast that hits nobody: an
    // explosion still has one target record, but it carries no damage/push.
    const eventTargets: readonly (0 | 1)[] = blastTargets.length > 0
      ? blastTargets
      : ([0, 1] as (0 | 1)[]).sort((first, second) => distanceSquaredToCenter(first)
        - distanceSquaredToCenter(second) || first - second).slice(0, 1);
    let explosionEventId: number | null = null;

    for (const targetId of eventTargets) {
      if (existingEventCount + events.length >= MAX_EVENTS_PER_TICK) {
        technicalInvalid = true;
        break;
      }
      const inBlast = blastTargets.includes(targetId);
      const protectedTarget = isPlayerProtected(blastSnapshot[targetId]);
      const push = inBlast && !protectedTarget
        ? intendedPushAwayFromTrap(blastSnapshot[targetId], bomb, BOMB_PUSH_UNITS)
        : { x: 0, y: 0 };
      const event: TrapEvent = {
        id: eventId,
        tick,
        chainId: eventChainId,
        parentEventId,
        chainLength: eventChainLength,
        trapId: bomb.id,
        owner: bomb.owner,
        kind: bomb.kind,
        target: targetId,
        responsibleActor,
        x: centerX,
        y: centerY,
        damage: inBlast && !protectedTarget ? BOMB_DAMAGE : 0,
        pushX: push.x,
        pushY: push.y,
      };
      if (explosionEventId === null) explosionEventId = event.id;
      events.push(event);
      eventId += 1;
      impacts.push({ bomb, targetId, inBlast, protectedTarget, push, event });
      if (eventChainLength > MAX_CHAIN_TRAPS || existingEventCount + events.length >= MAX_EVENT_LOG) {
        technicalInvalid = true;
        break;
      }
    }
    if (explosionEventId !== null) {
      dueContexts.push({
        bomb,
        eventChainId,
        eventChainLength,
        parentEventId,
        responsibleActor,
        explosionEventId,
      });
    }
    if (technicalInvalid) break;
  }

  // Aggregate all due effects before changing either player's state. Damage
  // adds normally; force is capped once and then resolved against obstacles in
  // one movement call. This keeps coincident blasts commutative and prevents
  // walls from being applied once per entity in array order.
  const totalDamage: [number, number] = [0, 0];
  const combinedPush: [PushVector, PushVector] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  for (const impact of impacts) {
    if (!impact.inBlast || impact.protectedTarget) continue;
    const targetId = impact.targetId;
    totalDamage[targetId] += impact.event.damage;
    combinedPush[targetId] = {
      x: combinedPush[targetId].x + impact.push.x,
      y: combinedPush[targetId].y + impact.push.y,
    };
  }
  for (const targetId of [0, 1] as const) {
    const snapshotPlayer = blastSnapshot[targetId];
    const damagedPlayer = totalDamage[targetId] > 0
      ? {
        ...snapshotPlayer,
        hp: Math.max(0, snapshotPlayer.hp - totalDamage[targetId]),
        placement: null,
        investigation: null,
      }
      : nextPlayers[targetId];
    const cappedPush = capCombinedPush(combinedPush[targetId]);
    const pushedPlayer = applyCombinedPush(damagedPlayer, cappedPush, obstacles);
    nextPlayers[targetId] = pushedPlayer;

    const representative = impacts.find((impact) => impact.targetId === targetId
      && impact.inBlast && !impact.protectedTarget);
    if (representative && !isPlayerProtected(snapshotPlayer)
      && (cappedPush.x !== 0 || cappedPush.y !== 0)) {
      enqueueSegment(targetId, {
        startX: snapshotPlayer.x,
        startY: snapshotPlayer.y,
        endX: pushedPlayer.x,
        endY: pushedPlayer.y,
        sourceActor: representative.event.responsibleActor,
        parentEventId: representative.event.id,
        chainId: representative.event.chainId,
        chainLength: representative.event.chainLength,
      });
    }
  }

  // Prime all armed bombs from the same pre-chain set. If two explosions can
  // prime one bomb, use the canonical physical source as its one parent;
  // this is the event-level representation of a multi-parent simultaneous
  // effect and is stable under trap array reordering/ID substitution.
  const armableBombs = remainingTraps.filter((trap) => trap.kind === 'bomb'
    && trap.armingTicks === 0 && (trap.triggerTicks ?? 0) === 0);
  const primeParents = new Map<number, DueBombContext>();
  const chainRadiusSquared = BOMB_CHAIN_RADIUS_UNITS * BOMB_CHAIN_RADIUS_UNITS;
  for (const context of dueContexts) {
    const centerX = cellCenterUnits(context.bomb.cellX);
    const centerY = cellCenterUnits(context.bomb.cellY);
    for (const candidate of armableBombs) {
      const dx = cellCenterUnits(candidate.cellX) - centerX;
      const dy = cellCenterUnits(candidate.cellY) - centerY;
      if (dx * dx + dy * dy > chainRadiusSquared) continue;
      const previous = primeParents.get(candidate.id);
      if (!previous
        || context.bomb.cellY < previous.bomb.cellY
        || (context.bomb.cellY === previous.bomb.cellY && context.bomb.cellX < previous.bomb.cellX)
        || (context.bomb.cellY === previous.bomb.cellY && context.bomb.cellX === previous.bomb.cellX
          && context.bomb.id < previous.bomb.id)) {
        primeParents.set(candidate.id, context);
      }
    }
  }
  if (!technicalInvalid) {
    remainingTraps = remainingTraps.map((trap) => {
      const parent = primeParents.get(trap.id);
      if (!parent) return trap;
      return {
        ...trap,
        triggerTicks: BOMB_TRIGGER_TICKS,
        triggerParentEventId: parent.explosionEventId,
        triggerChainId: parent.eventChainId,
        triggerChainLength: parent.eventChainLength,
        triggerResponsibleActor: parent.responsibleActor,
      };
    });
  }

  // Only now follow causal forced movement into the next contact. The
  // segment starts at the shared snapshot and carries one representative
  // parent for the event log; the physical displacement above includes every
  // simultaneous force contribution.
  resolvePendingSegments();
  if (existingEventCount + events.length >= MAX_EVENTS_PER_TICK) technicalInvalid = true;

  return {
    players: nextPlayers,
    traps: remainingTraps,
    events,
    nextEventId: eventId,
    nextChainId: chainId,
    maxChain,
    technicalInvalid,
  };
}

function isInsideShotArena(x: number, y: number): boolean {
  return x >= 0 && x <= ARENA_WIDTH_CELLS * CELL_UNITS
    && y >= 0 && y <= ARENA_HEIGHT_CELLS * CELL_UNITS;
}

interface ShotStep {
  readonly players: readonly [PlayerState, PlayerState];
  readonly shots: readonly ShotState[];
  readonly placementCancelled: readonly [boolean, boolean];
  readonly pushedBy: readonly [0 | 1 | null, 0 | 1 | null];
}

function stepShots(
  shots: readonly ShotState[],
  players: readonly [PlayerState, PlayerState],
  placementInProgress: readonly [boolean, boolean],
  obstacles: readonly ObstacleCell[],
): ShotStep {
  const nextPlayers: [PlayerState, PlayerState] = [...players];
  const nextShots: ShotState[] = [];
  const placementCancelled: [boolean, boolean] = [false, false];
  const pushedBy: [0 | 1 | null, 0 | 1 | null] = [null, null];

  for (const shot of [...shots].sort((first, second) => first.id - second.id)) {
    const nextX = shot.x + shot.vx;
    const nextY = shot.y + shot.vy;
    if (obstacles.some((obstacle) => segmentHitsObstacle(
      shot.x,
      shot.y,
      nextX,
      nextY,
      obstacle,
      SHOT_RADIUS_UNITS,
    ))) continue;
    const targetId: 0 | 1 = shot.owner === 0 ? 1 : 0;
    const target = nextPlayers[targetId];
    const hit = !isPlayerProtected(target)
      && segmentHitsCircle(shot.x, shot.y, nextX, nextY, target.x, target.y, PLAYER_RADIUS_UNITS + SHOT_RADIUS_UNITS);
    if (hit) {
      const pushed = target.pushImmunityTicks === 0 ? applyPush(target, shot.vx, shot.vy, obstacles) : target;
      pushedBy[targetId] = shot.owner;
      if (placementInProgress[targetId]) placementCancelled[targetId] = true;
      const investigation = target.investigation && pushed !== target
        ? {
          ...target.investigation,
          startX: pushed.x,
          startY: pushed.y,
        }
        : target.investigation;
      nextPlayers[targetId] = {
        ...pushed,
        placement: null,
        investigation,
        investigationPauseTicks: Math.max(target.investigationPauseTicks, INVESTIGATION_PAUSE_TICKS),
        pushImmunityTicks: target.pushImmunityTicks === 0 ? PUSH_IMMUNITY_TICKS : target.pushImmunityTicks,
      };
      continue;
    }

    const travelledUnits = shot.travelledUnits + Math.abs(shot.vx) + Math.abs(shot.vy);
    if (travelledUnits > SHOT_RANGE_UNITS || !isInsideShotArena(nextX, nextY)) continue;
    nextShots.push({ ...shot, x: nextX, y: nextY, travelledUnits });
  }
  return { players: nextPlayers, shots: nextShots, placementCancelled, pushedBy };
}

function gasSlowTicksFor(player: PlayerState, traps: readonly TrapState[]): number {
  if (isPlayerProtected(player)) return 0;
  let effectTicks = 0;
  for (const trap of traps) {
    if (trap.kind !== 'moya' || (trap.effectTicks ?? 0) <= 0) continue;
    const dx = player.x - cellCenterUnits(trap.cellX);
    const dy = player.y - cellCenterUnits(trap.cellY);
    if (dx * dx + dy * dy <= MOYA_RADIUS_UNITS * MOYA_RADIUS_UNITS) {
      effectTicks = Math.max(effectTicks, trap.effectTicks ?? 0);
    }
  }
  return effectTicks;
}

function finishRespawnProtectionTick(player: PlayerState, consumed: boolean): PlayerState {
  if (!consumed) return player;
  return {
    ...player,
    respawnInvulnerableTicks: Math.max(0, player.respawnInvulnerableTicks - 1),
    gasSlowTicks: 0,
  };
}

function determineResult(
  tick: number,
  players: readonly [PlayerState, PlayerState],
  technicalInvalid: boolean,
): MatchResult | null {
  if (technicalInvalid) return 'technical-invalid';
  const playerDefeated = players[0].hp <= 0;
  const cpuDefeated = players[1].hp <= 0;
  if (playerDefeated && cpuDefeated) return 'draw';
  if (playerDefeated) return 'cpu-win';
  if (cpuDefeated) return 'player-win';
  if (tick < MATCH_TICKS) return null;
  if (players[0].hp === players[1].hp) return 'time-draw';
  return players[0].hp > players[1].hp ? 'player-win' : 'cpu-win';
}

export function advanceWorld(
  world: WorldState,
  playerCommand: Partial<InputCommand> = {},
  cpuCommand: Partial<InputCommand> = {},
): WorldState {
  if (world.phase !== 'battle') return world;

  const playerInput = normalizeCommand(playerCommand);
  const cpuInput = normalizeCommand(cpuCommand);
  const previousPositions: readonly [{ x: number; y: number }, { x: number; y: number }] = [
    { x: world.players[0].x, y: world.players[0].y },
    { x: world.players[1].x, y: world.players[1].y },
  ];
  const loadouts = world.loadouts ?? [DEFAULT_TRAP_LOADOUT, DEFAULT_TRAP_LOADOUT];
  const mapId = getMapDefinition(world.mapId ?? DEFAULT_MAP_ID).id;
  const obstacles = getMapDefinition(mapId).obstacleCells;
  let nextEntityId = world.nextEntityId;
  const preparedPlayers: readonly [PlayerState, PlayerState] = [
    {
      ...world.players[0],
      gasSlowTicks: gasSlowTicksFor(world.players[0], world.traps),
    },
    {
      ...world.players[1],
      gasSlowTicks: gasSlowTicksFor(world.players[1], world.traps),
    },
  ];
  const playerStep = stepPlayer(
    preparedPlayers[0],
    playerInput,
    preparedPlayers[1],
    world.traps,
    loadouts[0],
    nextEntityId,
    mapId,
    obstacles,
  );
  if (playerStep.shot) nextEntityId += 1;
  const cpuStep = stepPlayer(
    preparedPlayers[1],
    cpuInput,
    playerStep.player,
    world.traps,
    loadouts[1],
    nextEntityId,
    mapId,
    obstacles,
  );
  if (cpuStep.shot) nextEntityId += 1;

  const placementInProgress: readonly [boolean, boolean] = [
    Boolean(world.players[0].placement || playerStep.completedPlacement),
    Boolean(world.players[1].placement || cpuStep.completedPlacement),
  ];
  const shotStep = stepShots(
    [
      ...world.shots,
      ...(playerStep.shot ? [playerStep.shot] : []),
      ...(cpuStep.shot ? [cpuStep.shot] : []),
    ],
    [playerStep.player, cpuStep.player],
    placementInProgress,
    obstacles,
  );

  let traps: readonly TrapState[] = world.traps;
  let player = shotStep.players[0];
  let cpu = shotStep.players[1];
  const playerTrap = addCompletedTrap(
    player,
    playerStep.completedPlacement,
    traps,
    nextEntityId,
    shotStep.placementCancelled[0],
  );
  player = playerTrap.player;
  traps = playerTrap.traps;
  nextEntityId = playerTrap.nextEntityId;
  const cpuTrap = addCompletedTrap(
    cpu,
    cpuStep.completedPlacement,
    traps,
    nextEntityId,
    shotStep.placementCancelled[1],
  );
  cpu = cpuTrap.player;
  traps = cpuTrap.traps;

  const trapStep = resolveTrapContacts(
    world.tick,
    [player, cpu],
    traps,
    previousPositions,
    shotStep.pushedBy,
    world.nextEventId,
    world.nextChainId,
    world.maxChain,
    obstacles,
  );
  player = trapStep.players[0];
  cpu = trapStep.players[1];
  traps = trapStep.traps;

  const delayedTrapStep = resolveDelayedTrapEffects(
    world.tick,
    [player, cpu],
    traps,
    trapStep.nextEventId,
    trapStep.nextChainId,
    trapStep.maxChain,
    trapStep.events.length,
    obstacles,
  );
  player = delayedTrapStep.players[0];
  cpu = delayedTrapStep.players[1];
  traps = delayedTrapStep.traps;

  const playerInvestigation = stepInvestigation(player, playerInput, traps);
  player = playerInvestigation.player;
  traps = playerInvestigation.traps;
  const cpuInvestigation = stepInvestigation(cpu, cpuInput, traps);
  cpu = cpuInvestigation.player;
  traps = cpuInvestigation.traps;

  const nextTick = world.tick + 1;
  const tickEvents = [...trapStep.events, ...delayedTrapStep.events];
  const events = [...world.events, ...tickEvents];
  const nextTraps = advanceTrapTimers(traps);
  const finishedPlayer = finishRespawnProtectionTick(player, Boolean(playerStep.respawnProtectionTick));
  const finishedCpu = finishRespawnProtectionTick(cpu, Boolean(cpuStep.respawnProtectionTick));
  const nextPlayers: readonly [PlayerState, PlayerState] = [
    { ...finishedPlayer, gasSlowTicks: gasSlowTicksFor(finishedPlayer, nextTraps) },
    { ...finishedCpu, gasSlowTicks: gasSlowTicksFor(finishedCpu, nextTraps) },
  ];
  const result = determineResult(
    nextTick,
    nextPlayers,
    trapStep.technicalInvalid || delayedTrapStep.technicalInvalid || events.length > MAX_EVENT_LOG,
  );
  const nextWorld: WorldState = {
    phase: result ? 'result' : world.phase,
    tick: nextTick,
    seed: world.seed,
    mapId,
    loadouts,
    players: nextPlayers,
    shots: shotStep.shots,
    traps: nextTraps,
    nextEntityId,
    shotsFired: [
      world.shotsFired[0] + (playerStep.shot ? 1 : 0),
      world.shotsFired[1] + (cpuStep.shot ? 1 : 0),
    ],
    trapsPlaced: [
      world.trapsPlaced[0] + (playerTrap.placed ? 1 : 0),
      world.trapsPlaced[1] + (cpuTrap.placed ? 1 : 0),
    ],
    trapsDisarmed: [
      world.trapsDisarmed[0] + (playerInvestigation.disarmed ? 1 : 0),
      world.trapsDisarmed[1] + (cpuInvestigation.disarmed ? 1 : 0),
    ],
    events,
    nextEventId: delayedTrapStep.nextEventId,
    nextChainId: delayedTrapStep.nextChainId,
    maxChain: delayedTrapStep.maxChain,
    result,
    lastHash: '',
  };
  return { ...nextWorld, lastHash: hashWorld(nextWorld) };
}
