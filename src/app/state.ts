export type AppState = 'title' | 'battle' | 'paused' | 'result' | 'unsupported';

const transitions: Record<AppState, readonly AppState[]> = {
  title: ['battle', 'paused', 'unsupported'],
  battle: ['paused', 'result', 'title'],
  paused: ['battle', 'title', 'unsupported'],
  result: ['battle', 'title'],
  unsupported: ['title'],
};

export class AppStateMachine {
  public constructor(private currentState: AppState = 'title') {}

  public get state(): AppState {
    return this.currentState;
  }

  public transition(nextState: AppState): void {
    if (!transitions[this.currentState].includes(nextState)) {
      throw new Error(`Invalid transition: ${this.currentState} -> ${nextState}`);
    }
    this.currentState = nextState;
  }
}
