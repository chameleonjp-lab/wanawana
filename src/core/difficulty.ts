import type { CpuDifficulty } from './types.ts';

export interface CpuDifficultyProfile {
  readonly id: CpuDifficulty;
  readonly label: string;
  /** The CPU may answer a new cue only on these fixed ticks. */
  readonly reactionCadenceTicks: number;
  /** Minimum fixed interval between the CPU's firing decisions. */
  readonly fireCadenceTicks: number;
  /** A deterministic period that represents an occasional aiming miss. */
  readonly aimMissPeriodTicks: number;
  /** How many trap roles the CPU is allowed to plan around. */
  readonly chainPlanning: 1 | 2 | 3;
}

export const CPU_DIFFICULTY_PROFILES: Readonly<Record<CpuDifficulty, CpuDifficultyProfile>> = {
  easy: {
    id: 'easy',
    label: 'やさしい',
    reactionCadenceTicks: 24,
    fireCadenceTicks: 6,
    aimMissPeriodTicks: 5,
    chainPlanning: 1,
  },
  normal: {
    id: 'normal',
    label: 'ふつう',
    reactionCadenceTicks: 17,
    fireCadenceTicks: 3,
    aimMissPeriodTicks: 13,
    chainPlanning: 2,
  },
  hard: {
    id: 'hard',
    label: 'むずかしい',
    reactionCadenceTicks: 13,
    fireCadenceTicks: 3,
    aimMissPeriodTicks: 0,
    chainPlanning: 3,
  },
};

export const CPU_DIFFICULTY_OPTIONS: readonly CpuDifficultyProfile[] = [
  CPU_DIFFICULTY_PROFILES.easy,
  CPU_DIFFICULTY_PROFILES.normal,
  CPU_DIFFICULTY_PROFILES.hard,
];

export function normalizeCpuDifficulty(value: string | null | undefined): CpuDifficulty {
  return value === 'easy' || value === 'hard' ? value : 'normal';
}

export function getCpuDifficultyProfile(difficulty: CpuDifficulty): CpuDifficultyProfile {
  return CPU_DIFFICULTY_PROFILES[difficulty];
}

export function isCpuReactionTick(tick: number, profile: CpuDifficultyProfile): boolean {
  return tick % profile.reactionCadenceTicks === 0;
}

/**
 * Uses only unsigned integer arithmetic so a profile never introduces a
 * browser-dependent random source into the match.
 */
export function isCpuAimAligned(seed: number, tick: number, profile: CpuDifficultyProfile): boolean {
  if (profile.aimMissPeriodTicks === 0) return true;
  const sample = (Math.imul(seed >>> 0, 1_664_525) + Math.imul(tick, 1_013_904_223)) >>> 0;
  return sample % profile.aimMissPeriodTicks !== 0;
}
