export type OfflineUpdateState = 'unavailable' | 'idle' | 'ready';

export function normalizeBuildHash(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  return normalized || 'local';
}

export function serviceWorkerScriptUrl(baseUrl: string, buildHash: string): string {
  const base = new URL(baseUrl, 'https://wanawana.invalid/');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const script = new URL('sw.js', base);
  script.searchParams.set('v', normalizeBuildHash(buildHash));
  return `${script.pathname}${script.search}`;
}

type StateListener = (state: OfflineUpdateState) => void;

/**
 * Keeps a new service worker waiting until the user explicitly accepts it.
 * The battle loop never consults this class, so an update cannot change rules
 * or reload a match in progress.
 */
export class OfflineUpdateManager {
  private registration: ServiceWorkerRegistration | null = null;
  private waitingWorker: ServiceWorker | null = null;
  private stateValue: OfflineUpdateState = 'idle';
  private reloadAfterActivation = false;
  private readonly listeners = new Set<StateListener>();

  public get state(): OfflineUpdateState {
    return this.stateValue;
  }

  public addStateListener(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async register(buildHash: string, baseUrl: string): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      this.setState('unavailable');
      return;
    }

    try {
      const scope = new URL(baseUrl, window.location.href).pathname.replace(/\/?$/, '/');
      const scriptUrl = serviceWorkerScriptUrl(scope, buildHash);
      const registration = await navigator.serviceWorker.register(scriptUrl, {
        scope,
        updateViaCache: 'none',
      });
      this.registration = registration;
      navigator.serviceWorker.addEventListener('controllerchange', this.handleControllerChange);
      registration.addEventListener('updatefound', this.handleUpdateFound);
      if (registration.waiting && navigator.serviceWorker.controller) {
        this.setWaitingWorker(registration.waiting);
      }
    } catch {
      this.setState('unavailable');
    }
  }

  public acceptUpdate(): void {
    if (!this.waitingWorker) return;
    this.reloadAfterActivation = true;
    this.waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  }

  private readonly handleUpdateFound = (): void => {
    const registration = this.registration;
    if (!registration) return;
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        this.setWaitingWorker(worker);
      }
    });
  };

  private readonly handleControllerChange = (): void => {
    if (!this.reloadAfterActivation) return;
    this.reloadAfterActivation = false;
    window.location.reload();
  };

  private setWaitingWorker(worker: ServiceWorker): void {
    this.waitingWorker = worker;
    this.setState('ready');
  }

  private setState(state: OfflineUpdateState): void {
    if (this.stateValue === state) return;
    this.stateValue = state;
    for (const listener of this.listeners) listener(state);
  }
}
