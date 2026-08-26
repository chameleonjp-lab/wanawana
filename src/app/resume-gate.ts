export const RESUME_COUNTDOWN_MS = 3_000;
export const RESUME_COUNTDOWN_STEP_MS = 250;

function normalizeElapsedMs(elapsedMs: number): number | null {
  if (!Number.isFinite(elapsedMs)) return null;
  return Math.max(0, elapsedMs);
}

export function remainingResumeSeconds(elapsedMs: number): number {
  const elapsed = normalizeElapsedMs(elapsedMs);
  if (elapsed === null) return 3;
  if (elapsed >= RESUME_COUNTDOWN_MS) return 0;
  return Math.ceil((RESUME_COUNTDOWN_MS - elapsed) / 1_000);
}

export function resumeCountdownFinished(elapsedMs: number): boolean {
  const elapsed = normalizeElapsedMs(elapsedMs);
  return elapsed !== null && elapsed >= RESUME_COUNTDOWN_MS;
}

export function canStartBattleAfterResume(
  elapsedMs: number,
  orientationReady: boolean,
  viewportStable: boolean,
): boolean {
  return orientationReady && viewportStable && resumeCountdownFinished(elapsedMs);
}
