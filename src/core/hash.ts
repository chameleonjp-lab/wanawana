import type { WorldState } from './types.ts';

function fnv1a(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function serializeWorld(world: WorldState): string {
  const players = world.players.map((player) => [
    player.id,
    player.x,
    player.y,
    player.hp,
    player.fireCooldownTicks,
    player.fireSlowTicks,
    player.gasSlowTicks,
    player.pushImmunityTicks,
    player.trapCooldownTicks,
    player.gear,
    player.gearRecoveryTicks,
    player.placement ? [
      player.placement.kind,
      player.placement.direction,
      player.placement.cellX,
      player.placement.cellY,
      player.placement.remainingTicks,
    ].join(',') : '-',
    player.investigation ? [
      player.investigation.targetTrapId,
      player.investigation.mode,
      player.investigation.startX,
      player.investigation.startY,
      player.investigation.remainingTicks,
    ].join(',') : '-',
    player.investigationPauseTicks,
    player.disabledTicks,
    player.respawnInvulnerableTicks,
  ].join(',')).join('|');
  const shots = [...world.shots]
    .sort((first, second) => first.id - second.id)
    .map((shot) => [shot.id, shot.owner, shot.x, shot.y, shot.vx, shot.vy, shot.travelledUnits].join(','))
    .join('|');
  const traps = [...world.traps]
    .sort((first, second) => first.id - second.id)
    .map((trap) => [
      trap.id,
      trap.owner,
      trap.kind,
      trap.direction,
      trap.cellX,
      trap.cellY,
      trap.armingTicks,
      trap.remainingTicks,
      trap.discoveredBy.join(''),
      trap.triggerTicks ?? '-',
      trap.effectTicks ?? '-',
      trap.triggerParentEventId ?? '-',
      trap.triggerChainId ?? '-',
      trap.triggerChainLength ?? '-',
      trap.triggerResponsibleActor ?? '-',
    ].join(','))
    .join('|');
  const events = [...world.events]
    .sort((first, second) => first.id - second.id)
    .map((event) => [
      event.id,
      event.tick,
      event.chainId,
      event.parentEventId ?? '-',
      event.chainLength,
      event.trapId,
      event.owner,
      event.kind,
      event.target,
      event.responsibleActor,
      event.x,
      event.y,
      event.damage,
      event.pushX,
      event.pushY,
    ].join(',')).join('|');
  return [
    world.phase,
    world.tick,
    world.seed,
    world.mapId ?? 'gearworks',
    (world.loadouts ?? [['bounce', 'shock', 'hatch'], ['bounce', 'shock', 'hatch']])
      .map((loadout) => loadout.join(','))
      .join('|'),
    world.nextEntityId,
    players,
    shots,
    traps,
    events,
    world.nextEventId,
    world.nextChainId,
    world.maxChain,
    world.result ?? '-',
    world.shotsFired.join(','),
    world.trapsPlaced.join(','),
    world.trapsDisarmed.join(','),
  ].join(';');
}

export function hashWorld(world: WorldState): string {
  return fnv1a(serializeWorld(world));
}
