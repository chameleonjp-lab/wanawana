import type { WorldState } from './types.ts';

export const TUTORIAL_HINT_TICKS = 900;

export type TutorialStep = 1 | 2 | 3 | 4;

export interface TutorialState {
  readonly step: TutorialStep;
  readonly stepTicks: number;
  readonly movementSeen: boolean;
  readonly fireSeen: boolean;
  readonly hintVisible: boolean;
  readonly completed: boolean;
}

export interface TutorialUpdate {
  readonly state: TutorialState;
  readonly advanced: boolean;
}

export function createTutorialState(): TutorialState {
  return {
    step: 1,
    stepTicks: 0,
    movementSeen: false,
    fireSeen: false,
    hintVisible: false,
    completed: false,
  };
}

function nextStep(state: TutorialState): TutorialState {
  if (state.step === 4) return { ...state, completed: true, hintVisible: false };
  return {
    step: (state.step + 1) as TutorialStep,
    stepTicks: 0,
    movementSeen: false,
    fireSeen: false,
    hintVisible: false,
    completed: false,
  };
}

/**
 * Tutorial progress is derived from the same accepted world counters as a
 * normal match. It never changes the simulation and therefore cannot affect
 * replay hashes or match statistics.
 */
export function advanceTutorial(
  state: TutorialState,
  previous: WorldState,
  current: WorldState,
): TutorialUpdate {
  if (state.completed) return { state, advanced: false };

  const movementSeen = state.movementSeen
    || previous.players[0].x !== current.players[0].x
    || previous.players[0].y !== current.players[0].y;
  const fireSeen = state.fireSeen || current.shotsFired[0] > 0;
  const stepTicks = Math.min(TUTORIAL_HINT_TICKS, state.stepTicks + 1);
  const hintVisible = stepTicks >= TUTORIAL_HINT_TICKS;
  const ready = state.step === 1
    ? movementSeen && fireSeen
    : state.step === 2
      ? current.trapsPlaced[0] > 0
      : state.step === 3
        ? current.maxChain >= 2
        : current.trapsDisarmed[0] > 0;

  if (!ready) {
    return {
      state: { ...state, stepTicks, movementSeen, fireSeen, hintVisible },
      advanced: false,
    };
  }
  return { state: nextStep({ ...state, stepTicks, movementSeen, fireSeen }), advanced: true };
}

export function tutorialStepTitle(step: TutorialStep): string {
  if (step === 1) return '動いて、誘導弾を当てる';
  if (step === 2) return '足元へ罠を置く';
  if (step === 3) return '2つの罠を連鎖させる';
  return '危険を調査して解除する';
}

export function tutorialStepInstruction(step: TutorialStep): string {
  if (step === 1) return '左の移動パッドで少し動き、右の射撃を短く押して離します。';
  if (step === 2) return '罠札を押し、足元の予告を確認してから離します。';
  if (step === 3) return '舞台の矢印へ進みます。ハネ板が次の罠へ押し出します。';
  return '黄色い危険表示の近くで、中央の調査・解除を長押しします。';
}

export function tutorialHint(step: TutorialStep): string {
  if (step === 1) return '移動パッドを上下左右へ倒し、射撃ボタンは「離した瞬間」に1発です。';
  if (step === 2) return '設置中に弾や罠の効果を受けると取り消されます。成功時だけ歯車を使います。';
  if (step === 3) return '右へ進むと最初のハネ板に触れます。発動順の輪が2つ続けば成功です。';
  return '危険表示は種類や方向を教えません。近くで止まり、調査が終わるまで指を離しません。';
}
