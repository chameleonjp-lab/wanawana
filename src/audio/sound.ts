export type SoundCue = 'shot' | 'hit' | 'bounce' | 'shock' | 'hatch' | 'bomb' | 'moya' | 'win' | 'lose' | 'draw';

export interface SoundSpec {
  readonly startHz: number;
  readonly endHz: number;
  readonly durationMs: number;
  readonly gain: number;
}

const MAX_VOICES = 8;

export function soundSpec(cue: SoundCue): SoundSpec {
  if (cue === 'shot') return { startHz: 520, endHz: 260, durationMs: 80, gain: 0.04 };
  if (cue === 'hit') return { startHz: 180, endHz: 100, durationMs: 120, gain: 0.06 };
  if (cue === 'bounce') return { startHz: 300, endHz: 720, durationMs: 160, gain: 0.05 };
  if (cue === 'shock') return { startHz: 900, endHz: 240, durationMs: 220, gain: 0.045 };
  if (cue === 'hatch') return { startHz: 160, endHz: 80, durationMs: 280, gain: 0.06 };
  if (cue === 'bomb') return { startHz: 180, endHz: 60, durationMs: 260, gain: 0.06 };
  if (cue === 'moya') return { startHz: 220, endHz: 520, durationMs: 360, gain: 0.035 };
  if (cue === 'win') return { startHz: 440, endHz: 880, durationMs: 360, gain: 0.055 };
  if (cue === 'lose') return { startHz: 260, endHz: 120, durationMs: 360, gain: 0.055 };
  return { startHz: 330, endHz: 330, durationMs: 240, gain: 0.05 };
}

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const extendedWindow = window as Window & {
    webkitAudioContext?: AudioContextConstructor;
  };
  return window.AudioContext ?? extendedWindow.webkitAudioContext ?? null;
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private activeVoices = 0;
  private enabled = false;

  public get isEnabled(): boolean {
    return this.enabled && this.context?.state === 'running';
  }

  public async resume(): Promise<boolean> {
    const Constructor = audioContextConstructor();
    if (!Constructor) return false;
    if (!this.context) {
      try {
        this.context = new Constructor();
        this.context.addEventListener('statechange', this.handleStateChange);
      } catch {
        this.context = null;
        return false;
      }
    }
    if (this.context.state === 'closed') {
      this.enabled = false;
      return false;
    }
    try {
      await this.context.resume();
      this.enabled = this.context.state === 'running';
      return this.enabled;
    } catch {
      this.enabled = false;
      return false;
    }
  }

  public async toggle(): Promise<boolean> {
    if (this.isEnabled) {
      this.suspend();
      return false;
    }
    return this.resume();
  }

  public suspend(): void {
    this.enabled = false;
    if (!this.context || this.context.state === 'closed') return;
    void this.context.suspend().catch(() => undefined);
  }

  public play(cue: SoundCue): void {
    if (!this.isEnabled || this.activeVoices >= MAX_VOICES || !this.context) return;
    const context = this.context;
    const spec = soundSpec(cue);
    const now = context.currentTime;
    const durationSeconds = spec.durationMs / 1_000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = cue === 'shock' ? 'square' : 'sine';
    oscillator.frequency.setValueAtTime(spec.startHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, spec.endHz), now + durationSeconds);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.gain, now + Math.min(0.02, durationSeconds / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    oscillator.connect(gain);
    gain.connect(context.destination);
    this.activeVoices += 1;
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    }, { once: true });
    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.01);
  }

  public syncWorld(previous: WorldStateLike, next: WorldStateLike): void {
    if (!this.isEnabled) return;
    if (next.shotsFired[0] > previous.shotsFired[0] || next.shotsFired[1] > previous.shotsFired[1]) this.play('shot');
    if (next.players[0].hp < previous.players[0].hp || next.players[1].hp < previous.players[1].hp) this.play('hit');
    for (const event of next.events.slice(previous.events.length)) this.play(event.kind);
    if (!previous.result && next.result) {
      this.play(next.result === 'player-win' ? 'win' : next.result === 'cpu-win' ? 'lose' : 'draw');
    }
  }

  private handleStateChange = (): void => {
    if (!this.context || this.context.state !== 'running') this.enabled = false;
  };
}

interface WorldStateLike {
  readonly players: readonly [{ readonly hp: number }, { readonly hp: number }];
  readonly shotsFired: readonly [number, number];
  readonly events: readonly { readonly kind: 'bounce' | 'shock' | 'hatch' | 'bomb' | 'moya' }[];
  readonly result: string | null;
}
