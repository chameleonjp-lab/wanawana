export interface MotionProfile {
  /** Maximum visible age of an activation marker, in fixed render ticks. */
  readonly eventMarkerTicks: number;
  /** Duration of the optional expanding burst. */
  readonly burstTicks: number;
  readonly showRays: boolean;
}

const NORMAL_MOTION: MotionProfile = {
  eventMarkerTicks: 30,
  burstTicks: 12,
  showRays: true,
};

const REDUCED_MOTION: MotionProfile = {
  eventMarkerTicks: 36,
  burstTicks: 0,
  showRays: false,
};

/**
 * Chooses rendering-only feedback. This must never be used by the fixed
 * simulation, input acceptance, collision, or result rules.
 */
export function getMotionProfile(reducedMotion: boolean): MotionProfile {
  return reducedMotion ? REDUCED_MOTION : NORMAL_MOTION;
}
