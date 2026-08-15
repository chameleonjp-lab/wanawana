import type { MatchResult } from './types.ts';

export const MATCH_SUMMARY_SCHEMA_VERSION = 1 as const;
const MAX_COUNTER = 1_000_000_000;

export interface MatchSummary {
  readonly schemaVersion: typeof MATCH_SUMMARY_SCHEMA_VERSION;
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly technicalInvalid: number;
  readonly bestChain: number;
  readonly trapsPlaced: number;
  readonly trapsDisarmed: number;
}

export interface MatchSummaryInput {
  readonly result: MatchResult | null;
  readonly maxChain: number;
  readonly trapsPlaced: number;
  readonly trapsDisarmed: number;
}

export function emptyMatchSummary(): MatchSummary {
  return {
    schemaVersion: MATCH_SUMMARY_SCHEMA_VERSION,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    technicalInvalid: 0,
    bestChain: 0,
    trapsPlaced: 0,
    trapsDisarmed: 0,
  };
}

function isSafeCounter(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_COUNTER;
}

function isSummary(value: unknown): value is MatchSummary {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === MATCH_SUMMARY_SCHEMA_VERSION
    && isSafeCounter(candidate.matches)
    && isSafeCounter(candidate.wins)
    && isSafeCounter(candidate.losses)
    && isSafeCounter(candidate.draws)
    && isSafeCounter(candidate.technicalInvalid)
    && isSafeCounter(candidate.bestChain)
    && isSafeCounter(candidate.trapsPlaced)
    && isSafeCounter(candidate.trapsDisarmed)
    && candidate.wins <= candidate.matches
    && candidate.losses <= candidate.matches
    && candidate.draws <= candidate.matches
    && candidate.technicalInvalid <= candidate.matches;
}

export function readMatchSummary(raw: string | null | undefined): MatchSummary {
  if (!raw) return emptyMatchSummary();
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSummary(parsed) ? parsed : emptyMatchSummary();
  } catch {
    return emptyMatchSummary();
  }
}

export function serializeMatchSummary(summary: MatchSummary): string {
  return JSON.stringify(summary);
}

function addCounter(value: number, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) return value;
  return Math.min(MAX_COUNTER, value + amount);
}

export function recordMatchSummary(summary: MatchSummary, input: MatchSummaryInput): MatchSummary {
  if (!input.result) return summary;

  const next: MatchSummary = {
    ...summary,
    matches: addCounter(summary.matches, 1),
    wins: input.result === 'player-win' ? addCounter(summary.wins, 1) : summary.wins,
    losses: input.result === 'cpu-win' ? addCounter(summary.losses, 1) : summary.losses,
    draws: input.result === 'draw' || input.result === 'time-draw' ? addCounter(summary.draws, 1) : summary.draws,
    technicalInvalid: input.result === 'technical-invalid'
      ? addCounter(summary.technicalInvalid, 1)
      : summary.technicalInvalid,
    bestChain: isSafeCounter(input.maxChain) ? Math.max(summary.bestChain, input.maxChain) : summary.bestChain,
    trapsPlaced: addCounter(summary.trapsPlaced, input.trapsPlaced),
    trapsDisarmed: addCounter(summary.trapsDisarmed, input.trapsDisarmed),
  };
  return next;
}
