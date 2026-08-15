import { MATCH_TICKS } from './types.ts';
import type { MatchResult, TrapEvent, TrapKind, WorldState } from './types.ts';

export interface PlayerReport {
  readonly hp: number;
  readonly shotsFired: number;
  readonly trapsPlaced: number;
  readonly trapsDisarmed: number;
}

export interface ChainReport {
  readonly chainId: number;
  readonly eventIds: readonly number[];
  readonly length: number;
  readonly responsibleActor: 0 | 1;
  readonly damage: number;
  readonly description: string;
}

export interface MatchReport {
  readonly result: MatchResult | null;
  readonly resultLabel: string;
  readonly resultReason: string;
  readonly durationTicks: number;
  readonly eventCount: number;
  readonly maxChain: number;
  readonly players: readonly [PlayerReport, PlayerReport];
  readonly chains: readonly ChainReport[];
}

function trapLabel(kind: TrapKind): string {
  if (kind === 'bounce') return 'ハネ板';
  if (kind === 'shock') return 'ビリビリ盤';
  if (kind === 'hatch') return 'パカット床';
  if (kind === 'bomb') return 'ポン玉';
  return 'モヤびん';
}

function targetLabel(target: 0 | 1): string {
  return target === 0 ? 'あなた' : 'CPU';
}

function actorLabel(actor: 0 | 1): string {
  return actor === 0 ? 'あなたの仕掛け' : 'CPUの仕掛け';
}

function resultLabel(result: MatchResult | null): string {
  if (result === 'player-win') return 'あなたの勝ち';
  if (result === 'cpu-win') return 'CPUの勝ち';
  if (result === 'technical-invalid') return '技術的に無効';
  if (result === 'draw' || result === 'time-draw') return '引き分け';
  return '試合中';
}

function resultReason(world: WorldState): string {
  if (world.result === 'technical-invalid') return '処理上限に達したため、試合を無効にしました。';
  if (world.result === 'draw') return '同じtickに両者の体力が0になりました。';
  if (world.result === 'time-draw') return '時間切れ時の体力が同じでした。';
  if (world.tick >= MATCH_TICKS) return '時間切れ時の体力を比べました。';
  if (world.players[0].hp <= 0) return 'あなたの体力が0になりました。';
  if (world.players[1].hp <= 0) return 'CPUの体力が0になりました。';
  return '試合はまだ終わっていません。';
}

function eventDescription(event: TrapEvent): string {
  const damageText = event.damage > 0 ? `・${event.damage}ダメージ` : '';
  const pushText = event.pushX !== 0 || event.pushY !== 0 ? '・押し出し' : '';
  return `${trapLabel(event.kind)}→${targetLabel(event.target)}${damageText}${pushText}`;
}

function makeChains(events: readonly TrapEvent[]): readonly ChainReport[] {
  const grouped = new Map<number, TrapEvent[]>();
  for (const event of [...events].sort((first, second) => first.id - second.id)) {
    const chain = grouped.get(event.chainId) ?? [];
    chain.push(event);
    grouped.set(event.chainId, chain);
  }
  return [...grouped.entries()]
    .sort(([first], [second]) => first - second)
    .map(([chainId, chain]) => ({
      chainId,
      eventIds: chain.map((event) => event.id),
      length: Math.max(...chain.map((event) => event.chainLength)),
      responsibleActor: chain[0].responsibleActor,
      damage: chain.reduce((total, event) => total + event.damage, 0),
      description: chain.map(eventDescription).join(' → '),
    }));
}

export function buildMatchReport(world: WorldState): MatchReport {
  const players: readonly [PlayerReport, PlayerReport] = [
    {
      hp: world.players[0].hp,
      shotsFired: world.shotsFired[0],
      trapsPlaced: world.trapsPlaced[0],
      trapsDisarmed: world.trapsDisarmed[0],
    },
    {
      hp: world.players[1].hp,
      shotsFired: world.shotsFired[1],
      trapsPlaced: world.trapsPlaced[1],
      trapsDisarmed: world.trapsDisarmed[1],
    },
  ];
  return {
    result: world.result,
    resultLabel: resultLabel(world.result),
    resultReason: resultReason(world),
    durationTicks: world.tick,
    eventCount: world.events.length,
    maxChain: world.maxChain,
    players,
    chains: makeChains(world.events),
  };
}

export function chainHeading(chain: ChainReport): string {
  return `連鎖${chain.chainId}・${chain.length}段・${actorLabel(chain.responsibleActor)}`;
}
