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
    player.pushImmunityTicks,
  ].join(',')).join('|');
  const shots = [...world.shots]
    .sort((first, second) => first.id - second.id)
    .map((shot) => [shot.id, shot.owner, shot.x, shot.y, shot.vx, shot.vy, shot.travelledUnits].join(','))
    .join('|');
  return [world.phase, world.tick, world.seed, world.nextEntityId, players, shots, world.shotsFired.join(',')].join(';');
}

export function hashWorld(world: WorldState): string {
  return fnv1a(serializeWorld(world));
}
