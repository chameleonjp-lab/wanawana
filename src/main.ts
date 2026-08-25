import { Application, Graphics } from 'pixi.js';
import './styles.css';
import { ContextRecovery } from './app/context-recovery.ts';
import { getMotionProfile } from './app/motion.ts';
import { OfflineUpdateManager } from './app/offline.ts';
import { AppStateMachine } from './app/state.ts';
import { SoundEngine } from './audio/sound.ts';
import { chooseCpuDecision } from './core/ai.ts';
import {
  getCpuDifficultyProfile,
  normalizeCpuDifficulty,
} from './core/difficulty.ts';
import {
  cellCenterUnits,
  cellToPixels,
  INVESTIGATE_RADIUS_UNITS,
  isTrapKind,
  MOYA_RADIUS_UNITS,
  TRAP_LIFETIME_TICKS,
  normalizeTrapLoadout,
  snapToCell,
} from './core/fixed.ts';
import { buildMatchReport, chainHeading, type MatchReport } from './core/result.ts';
import {
  ReplayRecorder,
  readReplayRecord,
  serializeReplayRecord,
  verifyReplayRecord,
  type MatchReplay,
} from './core/replay.ts';
import { getMapDefinition } from './core/maps.ts';
import { hashWorld } from './core/hash.ts';
import {
  emptyMatchSummary,
  readMatchSummary,
  recordMatchSummary,
  serializeMatchSummary,
  type MatchSummary,
} from './core/progress.ts';
import {
  createMatchSettings,
  defaultMatchSettings,
  readMatchSettings,
  serializeMatchSettings,
  SETTINGS_STORAGE_KEY,
} from './core/settings.ts';
import {
  createMatchResume,
  readMatchResume,
  serializeMatchResume,
  type MatchResume,
} from './core/resume.ts';
import {
  advanceTutorial,
  createTutorialState,
  tutorialHint,
  tutorialStepInstruction,
  tutorialStepTitle,
  type TutorialState,
} from './core/tutorial.ts';
import { advanceWorld, createWorld } from './core/sim.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  DEFAULT_TRAP_LOADOUT,
  DEFAULT_MAP_ID,
  type MapId,
  TICK_RATE,
  type CpuDifficulty,
  type InputCommand,
  type TrapKind,
  type TrapLoadout,
  type TrapState,
  type WorldState,
} from './core/types.ts';
import { InputController } from './input/controller.ts';

const FRAME_MS = 1_000 / 60;
const MAX_TICKS_PER_FRAME = 5;
const MAX_BACKLOG_TICKS = 8;
const CONTEXT_RECOVERY_TIMEOUT_MS = 5_000;
const RESUME_STORAGE_KEY = 'wanawana:v1:resume';
const TUTORIAL_STORAGE_KEY = 'wanawana:v1:tutorial';
const RESUME_SAVE_INTERVAL_TICKS = 2 * TICK_RATE;
const BLUEPRINT_TRAIL_TICKS = 5 * TICK_RATE;

const machine = new AppStateMachine();
const status = getElement<HTMLParagraphElement>('status');
const titleView = getElement<HTMLElement>('title-view');
const unsupportedView = getElement<HTMLElement>('unsupported-view');
const battleView = getElement<HTMLElement>('battle-view');
const pauseView = getElement<HTMLElement>('pause-view');
const resultView = getElement<HTMLElement>('result-view');
const arena = getElement<HTMLElement>('arena');
const timeValue = getElement<HTMLElement>('time-value');
const playerHp = getElement<HTMLElement>('player-hp');
const cpuHp = getElement<HTMLElement>('cpu-hp');
const gearValue = getElement<HTMLElement>('gear-value');
const tickValue = getElement<HTMLElement>('tick-value');
const resultSummary = getElement<HTMLElement>('result-summary');
const resultDetails = getElement<HTMLElement>('result-details');
const blueprintNote = getElement<HTMLElement>('blueprint-note');
const resultBlueprint = getElement<HTMLElement>('result-blueprint');
const resultHistory = getElement<HTMLElement>('result-history');
const resultHash = getElement<HTMLElement>('result-hash');
const copyRecordButton = getElement<HTMLButtonElement>('copy-record-button');
const replayCopyStatus = getElement<HTMLElement>('replay-copy-status');
const trapPreview = getElement<HTMLElement>('trap-preview');
const inspectButton = getElement<HTMLButtonElement>('inspect-button');
const soundButton = getElement<HTMLButtonElement>('sound-button');
const difficultySelect = getElement<HTMLSelectElement>('difficulty-select');
const difficultyHelp = getElement<HTMLElement>('difficulty-help');
const difficultyValue = getElement<HTMLElement>('difficulty-value');
const loadoutSlot2 = getElement<HTMLSelectElement>('loadout-slot-2');
const loadoutSlot3 = getElement<HTMLSelectElement>('loadout-slot-3');
const loadoutHelp = getElement<HTMLElement>('loadout-help');
const mapSelect = getElement<HTMLSelectElement>('map-select');
const mapHelp = getElement<HTMLElement>('map-help');
const stageEyebrow = getElement<HTMLElement>('stage-eyebrow');
const battleHeading = getElement<HTMLElement>('battle-heading');
const careerSummaryValue = getElement<HTMLElement>('career-summary-value');
const careerSummaryNote = getElement<HTMLElement>('career-summary-note');
const clearCareerSummaryButton = getElement<HTMLButtonElement>('clear-career-summary');
const settingsNote = getElement<HTMLElement>('settings-note');
const resetSettingsButton = getElement<HTMLButtonElement>('reset-settings');
const practiceEntryNote = getElement<HTMLElement>('practice-entry-note');
const practiceButton = getElement<HTMLButtonElement>('practice-button');
const tutorialCard = getElement<HTMLElement>('tutorial-card');
const tutorialHeading = getElement<HTMLElement>('tutorial-heading');
const tutorialInstruction = getElement<HTMLElement>('tutorial-instruction');
const tutorialHintElement = getElement<HTMLElement>('tutorial-hint');
const tutorialProgressBar = getElement<HTMLElement>('tutorial-progress-bar');
const tutorialCompleteActions = getElement<HTMLElement>('tutorial-complete-actions');
const practiceQuitButton = getElement<HTMLButtonElement>('practice-quit-button');
const practiceStartMatchButton = getElement<HTMLButtonElement>('practice-start-match-button');
const practiceTitleButton = getElement<HTMLButtonElement>('practice-title-button');
const resumeCard = getElement<HTMLElement>('resume-card');
const resumeSummary = getElement<HTMLElement>('resume-summary');
const resumeMatchButton = getElement<HTMLButtonElement>('resume-match-button');
const discardResumeButton = getElement<HTMLButtonElement>('discard-resume-button');
const replayInput = getElement<HTMLTextAreaElement>('replay-input');
const replayVerifyButton = getElement<HTMLButtonElement>('replay-verify-button');
const replayVerifyStatus = getElement<HTMLElement>('replay-verify-status');
const controls = getElement<HTMLElement>('controls');
const pauseButton = getElement<HTMLButtonElement>('pause-button');
const updateCard = getElement<HTMLElement>('update-card');
const updateButton = getElement<HTMLButtonElement>('update-button');

const SUMMARY_STORAGE_KEY = 'wanawana:v1:summary';
const BUILD_COMMIT = import.meta.env.VITE_BUILD_COMMIT ?? 'local';
let pixiApp: Application | null = null;
let world: WorldState | null = null;
let frameId = 0;
let resizeFrameId: number | null = null;
let lastFrameTime = 0;
let accumulator = 0;
let cpuDifficulty: CpuDifficulty = 'normal';
let selectedLoadout: TrapLoadout = DEFAULT_TRAP_LOADOUT;
let selectedMap: MapId = DEFAULT_MAP_ID;
let matchSummary: MatchSummary = emptyMatchSummary();
let summaryStorageAvailable = true;
let settingsStorageAvailable = true;
let resumeSnapshot: MatchResume | null = null;
let resumeStorageAvailable = true;
let summaryRecordedWorld: WorldState | null = null;
let replayRecorder: ReplayRecorder | null = null;
let completedReplay: MatchReplay | null = null;
interface MovementSample {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
}

interface TrapPlacementSample {
  readonly id: number;
  readonly owner: 0 | 1;
  readonly kind: TrapKind;
  readonly direction: 0 | 1 | 2 | 3;
  readonly cellX: number;
  readonly cellY: number;
}

let movementTrail: MovementSample[] = [];
let trapPlacementSamples: TrapPlacementSample[] = [];
let practiceMode = false;
let practiceComplete = false;
let tutorialState: TutorialState = createTutorialState();
let tutorialStorageAvailable = true;
let tutorialCompleted = false;
const inputController = new InputController(controls);
const soundEngine = new SoundEngine();
const contextRecovery = new ContextRecovery();
const offlineUpdates = new OfflineUpdateManager();
let contextRecoveryTimer: number | null = null;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element as T;
}

function setVisible(element: HTMLElement, visible: boolean): void {
  element.classList.toggle('is-hidden', !visible);
}

function updateScreen(): void {
  const state = machine.state;
  setVisible(titleView, state === 'title');
  setVisible(unsupportedView, state === 'unsupported');
  setVisible(battleView, state === 'battle');
  setVisible(pauseView, state === 'paused');
  setVisible(resultView, state === 'result');
  setVisible(tutorialCard, state === 'battle' && practiceMode);
  status.textContent = state === 'battle'
    ? practiceMode
      ? practiceComplete ? '練習を完了しました' : '操作練習を固定tickで進めています'
      : '固定tickで舞台を動かしています'
    : state === 'paused' ? '試合を停止しています' : '';
  updateTrapButtons();
  updateTutorialCard();
  practiceButton.disabled = state !== 'title';
  pauseButton.disabled = practiceMode && practiceComplete;
  updateResumePanel();
  updateOfflineCard();
}

function updateSoundButton(): void {
  const state = soundEngine.state;
  soundButton.textContent = soundEngine.isEnabled
    ? '音: オン'
    : state === 'interrupted'
      ? '音: 中断中'
      : state === 'closed' || state === 'unavailable'
        ? '音: 利用不可'
        : '音: オフ';
  soundButton.setAttribute('aria-pressed', String(soundEngine.isEnabled));
  soundButton.title = state === 'interrupted'
    ? 'ブラウザが音声を中断しています。もう一度押すと再開を試します。'
    : state === 'closed' || state === 'unavailable'
      ? '音声を使えないため、音なしで試合を続けます。'
      : '音のオン・オフ';
}

function handleSoundStateChange(): void {
  updateSoundButton();
  if (machine.state !== 'battle') return;
  if (soundEngine.state === 'interrupted') {
    status.textContent = '音が中断されています。試合は続きます。';
  } else if (soundEngine.state === 'closed' || soundEngine.state === 'unavailable') {
    status.textContent = '音なしで試合を続けます。';
  }
}

function updateDifficultyLabel(): void {
  cpuDifficulty = normalizeCpuDifficulty(difficultySelect.value);
  const profile = getCpuDifficultyProfile(cpuDifficulty);
  difficultySelect.value = profile.id;
  difficultyValue.textContent = profile.label;
  difficultyHelp.textContent = cpuDifficulty === 'easy'
    ? '反応がゆっくりで、射撃を外すことがあります。'
    : cpuDifficulty === 'hard'
      ? '危険への反応が早く、5種類の罠を連鎖に使います。'
      : '反応、射撃の正確さ、連鎖の考え方が標準です。';
}

function updateLoadoutLabel(): void {
  const requested: TrapKind[] = [
    'bounce',
    isTrapKind(loadoutSlot2.value) ? loadoutSlot2.value : 'shock',
    isTrapKind(loadoutSlot3.value) ? loadoutSlot3.value : 'hatch',
  ];
  selectedLoadout = normalizeTrapLoadout(requested);
  loadoutSlot2.value = selectedLoadout[1];
  loadoutSlot3.value = selectedLoadout[2];
  loadoutHelp.textContent = `試合中は${selectedLoadout.map(trapName).join('・')}だけ設置できます。`;
}

function updateMapLabel(): void {
  const requested = mapSelect.value;
  const map = getMapDefinition(requested);
  selectedMap = map.id;
  mapSelect.value = map.id;
  mapHelp.textContent = `${map.subtitle}。開始位置、壁、舞台の色が固定されます。`;
  stageEyebrow.textContent = `試作ステージ ／ ${map.id}`;
  battleHeading.textContent = map.name;
}

function summaryHeadline(summary: MatchSummary): string {
  return `全${summary.matches}試合　${summary.wins}勝・${summary.losses}敗・${summary.draws}分`;
}

function summaryDetail(summary: MatchSummary): string {
  return `最高連鎖 ${summary.bestChain}段　罠設置 ${summary.trapsPlaced}　解除 ${summary.trapsDisarmed}`;
}

function updateCareerSummary(): void {
  careerSummaryValue.textContent = summaryHeadline(matchSummary);
  careerSummaryNote.textContent = summaryStorageAvailable
    ? `${summaryDetail(matchSummary)}（この端末に保存）`
    : `${summaryDetail(matchSummary)}（保存できないため、この画面を閉じると消えます）`;
  resultHistory.textContent = `${summaryHeadline(matchSummary)}。${summaryDetail(matchSummary)}`;
}

function updateSettingsNote(): void {
  settingsNote.textContent = settingsStorageAvailable
    ? '難度・舞台・罠ロードアウトは、この端末に保存されます。'
    : '設定を保存できない端末です。選んだ内容はこの画面を閉じると初期値へ戻ります。';
}

function updatePracticeEntry(): void {
  practiceEntryNote.textContent = tutorialCompleted
    ? '練習済みです。必要なときは何度でもやり直せます。'
    : '60〜90秒の練習で、移動・射撃・罠の連鎖・調査解除を実際に試せます。';
  practiceButton.textContent = tutorialCompleted ? '操作をもう一度練習する' : '操作を練習する';
}

function updateTutorialCard(): void {
  if (!practiceMode) return;
  if (practiceComplete || tutorialState.completed) {
    tutorialHeading.textContent = '練習完了';
    tutorialInstruction.textContent = '4つの操作を試せました。本戦では、相手を罠へ誘い込んでみましょう。';
    tutorialHintElement.classList.add('is-hidden');
    tutorialCompleteActions.classList.remove('is-hidden');
    tutorialProgressBar.style.width = '100%';
    practiceQuitButton.disabled = true;
    return;
  }
  tutorialHeading.textContent = `${tutorialState.step} / 4　${tutorialStepTitle(tutorialState.step)}`;
  tutorialInstruction.textContent = tutorialStepInstruction(tutorialState.step);
  tutorialHintElement.textContent = tutorialState.hintVisible ? tutorialHint(tutorialState.step) : '';
  tutorialHintElement.classList.toggle('is-hidden', !tutorialState.hintVisible);
  tutorialCompleteActions.classList.add('is-hidden');
  tutorialProgressBar.style.width = `${tutorialState.step * 25}%`;
  practiceQuitButton.disabled = false;
}

function loadTutorialCompletion(): void {
  try {
    tutorialCompleted = window.localStorage.getItem(TUTORIAL_STORAGE_KEY) === 'done';
  } catch {
    tutorialStorageAvailable = false;
    tutorialCompleted = false;
  }
  updatePracticeEntry();
}

function persistTutorialCompletion(): void {
  if (!tutorialStorageAvailable) return;
  try {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, 'done');
    tutorialCompleted = true;
  } catch {
    tutorialStorageAvailable = false;
  }
  updatePracticeEntry();
}

function updateOfflineCard(): void {
  setVisible(updateCard, (machine.state === 'title' || machine.state === 'result') && offlineUpdates.state === 'ready');
}

function loadMatchSettings(): void {
  try {
    const settings = readMatchSettings(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
    difficultySelect.value = settings.difficulty;
    mapSelect.value = settings.mapId;
    loadoutSlot2.value = settings.loadout[1];
    loadoutSlot3.value = settings.loadout[2];
  } catch {
    settingsStorageAvailable = false;
  }
  updateSettingsNote();
}

function persistMatchSettings(): void {
  if (!settingsStorageAvailable) return;
  try {
    const settings = createMatchSettings(cpuDifficulty, selectedMap, selectedLoadout);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, serializeMatchSettings(settings));
  } catch {
    settingsStorageAvailable = false;
    updateSettingsNote();
  }
}

function resetMatchSettings(): void {
  if (!window.confirm('ワナワナの難度・舞台・罠ロードアウトを初期値へ戻しますか？')) return;
  const defaults = defaultMatchSettings();
  difficultySelect.value = defaults.difficulty;
  mapSelect.value = defaults.mapId;
  loadoutSlot2.value = defaults.loadout[1];
  loadoutSlot3.value = defaults.loadout[2];
  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    settingsStorageAvailable = true;
  } catch {
    settingsStorageAvailable = false;
  }
  updateDifficultyLabel();
  updateLoadoutLabel();
  updateMapLabel();
  updateSettingsNote();
  status.textContent = settingsStorageAvailable
    ? '設定を初期値へ戻しました。'
    : '設定を初期値へ戻しました（保存は利用できません）。';
}

function updateResumePanel(): void {
  const visible = machine.state === 'title' && resumeSnapshot !== null;
  setVisible(resumeCard, visible);
  if (!resumeSnapshot) return;
  const map = getMapDefinition(resumeSnapshot.world.mapId);
  resumeSummary.textContent = `${map.name}・${resumeSnapshot.world.tick}tick（残り約${Math.max(0, 150 - resumeSnapshot.world.tick / TICK_RATE).toFixed(1)}秒）。${resumeStorageAvailable ? '30分以内なら再開できます。' : '保存を確認できません。'}`;
}

function loadMatchSummary(): void {
  try {
    matchSummary = readMatchSummary(window.localStorage.getItem(SUMMARY_STORAGE_KEY));
  } catch {
    summaryStorageAvailable = false;
    matchSummary = emptyMatchSummary();
  }
}

function persistMatchSummary(): void {
  if (!summaryStorageAvailable) return;
  try {
    window.localStorage.setItem(SUMMARY_STORAGE_KEY, serializeMatchSummary(matchSummary));
  } catch {
    summaryStorageAvailable = false;
  }
}

function clearMatchSummary(): void {
  if (!window.confirm('ワナワナの端末内戦績を削除しますか？')) return;
  try {
    window.localStorage.removeItem(SUMMARY_STORAGE_KEY);
    summaryStorageAvailable = true;
  } catch {
    summaryStorageAvailable = false;
  }
  matchSummary = emptyMatchSummary();
  updateCareerSummary();
}

function loadResumeSnapshot(): void {
  try {
    resumeSnapshot = readMatchResume(window.localStorage.getItem(RESUME_STORAGE_KEY), Date.now());
    if (!resumeSnapshot) window.localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    resumeStorageAvailable = false;
    resumeSnapshot = null;
  }
  updateResumePanel();
}

function clearResumeSnapshot(): void {
  try {
    window.localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    resumeStorageAvailable = false;
  }
  resumeSnapshot = null;
  updateResumePanel();
}

function persistResumeSnapshot(): void {
  if (practiceMode || !resumeStorageAvailable || !world || machine.state === 'result' || world.phase !== 'battle') return;
  try {
    const snapshot = createMatchResume(world, cpuDifficulty, Date.now());
    window.localStorage.setItem(RESUME_STORAGE_KEY, serializeMatchResume(snapshot));
    resumeSnapshot = snapshot;
  } catch {
    resumeStorageAvailable = false;
  }
}

function recordFinishedMatch(report: MatchReport): void {
  if (!world || summaryRecordedWorld === world || !report.result) return;
  matchSummary = recordMatchSummary(matchSummary, {
    result: report.result,
    maxChain: report.maxChain,
    trapsPlaced: report.players[0].trapsPlaced,
    trapsDisarmed: report.players[0].trapsDisarmed,
  });
  summaryRecordedWorld = world;
  persistMatchSummary();
  updateCareerSummary();
}

function updateTrapButtons(): void {
  const active = machine.state === 'battle' && !practiceComplete;
  const buttons = controls.querySelectorAll<HTMLButtonElement>('[data-input-role^="trap-"]');
  for (const button of buttons) {
    const rawKind = button.dataset.inputRole?.slice(5);
    const enabled = !active || (isTrapKind(rawKind) && selectedLoadout.includes(rawKind));
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', String(!enabled));
  }
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function reducedMotionPreferred(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clearContextRecoveryTimer(): void {
  if (contextRecoveryTimer === null) return;
  window.clearTimeout(contextRecoveryTimer);
  contextRecoveryTimer = null;
}

function scheduleViewportRedraw(): void {
  if (resizeFrameId !== null) window.cancelAnimationFrame(resizeFrameId);
  resizeFrameId = window.requestAnimationFrame(() => {
    resizeFrameId = null;
    if (!world || !pixiApp || machine.state === 'title' || machine.state === 'unsupported') return;
    updateHud();
    drawWorld();
  });
}

function handleViewportResize(message = '画面サイズが変わったため停止しました。表示が落ち着いてから再開してください。'): void {
  inputController.reset();
  if (machine.state === 'battle') pauseGame(message);
  scheduleViewportRedraw();
}

function invalidateContextRecovery(message: string): void {
  clearContextRecoveryTimer();
  contextRecovery.endMatch();
  returnToTitle(message);
}

function handleWebglContextLost(event: Event): void {
  event.preventDefault();
  const outcome = contextRecovery.loseContext();
  if (!outcome.activeMatch) return;
  inputController.reset();
  soundEngine.suspend();
  if (outcome.invalid) {
    invalidateContextRecovery('描画領域を再び失ったため、この試合を無効にしました。');
    return;
  }
  clearContextRecoveryTimer();
  contextRecoveryTimer = window.setTimeout(() => {
    contextRecoveryTimer = null;
    if (contextRecovery.isPending) {
      invalidateContextRecovery('描画領域を5秒以内に復旧できなかったため、この試合を無効にしました。');
    }
  }, CONTEXT_RECOVERY_TIMEOUT_MS);
  if (machine.state === 'battle') {
    pauseGame('描画領域を失ったため停止しました。復旧を確認しています。');
  } else if (machine.state === 'paused') {
    status.textContent = '描画領域を失ったため、復旧を確認しています';
  }
}

function handleWebglContextRestored(): void {
  if (!contextRecovery.isPending) return;
  window.requestAnimationFrame(() => {
    if (!contextRecovery.isPending || !world || !pixiApp) return;
    try {
      drawWorld();
    } catch {
      return;
    }
    if (!contextRecovery.markRestored()) return;
    clearContextRecoveryTimer();
    updateScreen();
    status.textContent = '描画を復旧しました。再開するボタンを押してください。';
  });
}

async function ensurePixi(): Promise<boolean> {
  if (pixiApp) return true;
  if (!webglAvailable()) {
    machine.transition('unsupported');
    updateScreen();
    return false;
  }

  try {
    const app = new Application();
    await app.init({
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl',
      resizeTo: arena,
      backgroundColor: 0x0f0d1b,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preserveDrawingBuffer: false,
    });
    arena.replaceChildren(app.canvas);
    (app.canvas as HTMLCanvasElement).addEventListener('webglcontextlost', handleWebglContextLost);
    (app.canvas as HTMLCanvasElement).addEventListener('webglcontextrestored', handleWebglContextRestored);
    pixiApp = app;
    drawWorld();
    return true;
  } catch {
    machine.transition('unsupported');
    updateScreen();
    return false;
  }
}

function readInput(): InputCommand {
  if (world && inputController.previewTrap) {
    inputController.capturePreviewCell(
      snapToCell(world.players[0].x, ARENA_WIDTH_CELLS),
      snapToCell(world.players[0].y, ARENA_HEIGHT_CELLS),
    );
  }
  return inputController.readCommand();
}

function drawWorld(): void {
  if (!pixiApp || !world) return;
  const motion = getMotionProfile(reducedMotionPreferred());
  const map = getMapDefinition(world.mapId);
  const width = Math.max(1, arena.clientWidth);
  const height = Math.max(1, arena.clientHeight);
  const pixelsPerCell = Math.min(width / ARENA_WIDTH_CELLS, height / ARENA_HEIGHT_CELLS);
  const offsetX = (width - pixelsPerCell * ARENA_WIDTH_CELLS) / 2;
  const offsetY = (height - pixelsPerCell * ARENA_HEIGHT_CELLS) / 2;
  const stage = pixiApp.stage;
  for (const child of stage.removeChildren()) {
    child.destroy({ children: true });
  }

  const background = new Graphics();
  background.rect(0, 0, width, height).fill({ color: map.backgroundColor });
  stage.addChild(background);

  const grid = new Graphics();
  for (let column = 0; column <= ARENA_WIDTH_CELLS; column += 1) {
    const x = offsetX + column * pixelsPerCell;
    grid.moveTo(x, offsetY).lineTo(x, offsetY + ARENA_HEIGHT_CELLS * pixelsPerCell);
  }
  for (let row = 0; row <= ARENA_HEIGHT_CELLS; row += 1) {
    const y = offsetY + row * pixelsPerCell;
    grid.moveTo(offsetX, y).lineTo(offsetX + ARENA_WIDTH_CELLS * pixelsPerCell, y);
  }
  grid.stroke({ color: map.gridColor, alpha: 0.72, width: 1 });
  stage.addChild(grid);

  for (const obstacle of map.obstacleCells) {
    const wall = new Graphics();
    const x = offsetX + obstacle.cellX * pixelsPerCell;
    const y = offsetY + obstacle.cellY * pixelsPerCell;
    wall.roundRect(x + pixelsPerCell * 0.08, y + pixelsPerCell * 0.08, pixelsPerCell * 0.84, pixelsPerCell * 0.84, pixelsPerCell * 0.12)
      .fill({ color: map.accentColor, alpha: 0.32 })
      .stroke({ color: map.accentColor, alpha: 0.76, width: 2 });
    stage.addChild(wall);
  }

  const landmark = new Graphics();
  const centerX = offsetX + (ARENA_WIDTH_CELLS * pixelsPerCell) / 2;
  const centerY = offsetY + (ARENA_HEIGHT_CELLS * pixelsPerCell) / 2;
  const landmarkRadius = pixelsPerCell * 1.65;
  if (map.landmark === 'gear') {
    landmark.circle(centerX, centerY, landmarkRadius).stroke({ color: map.accentColor, alpha: 0.22, width: 3 });
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const angle = spoke * Math.PI / 4;
      landmark.moveTo(centerX + Math.cos(angle) * landmarkRadius * 1.18, centerY + Math.sin(angle) * landmarkRadius * 1.18)
        .lineTo(centerX + Math.cos(angle) * landmarkRadius * 1.55, centerY + Math.sin(angle) * landmarkRadius * 1.55);
    }
  } else if (map.landmark === 'crossroads') {
    landmark.moveTo(centerX, offsetY).lineTo(centerX, offsetY + ARENA_HEIGHT_CELLS * pixelsPerCell);
    landmark.moveTo(offsetX, centerY).lineTo(offsetX + ARENA_WIDTH_CELLS * pixelsPerCell, centerY);
    landmark.circle(centerX, centerY, landmarkRadius * 0.62).stroke({ color: map.accentColor, alpha: 0.24, width: 3 });
  } else {
    landmark.circle(centerX, centerY, landmarkRadius * 2.15).stroke({ color: map.accentColor, alpha: 0.25, width: 3 });
    landmark.circle(centerX, centerY, landmarkRadius * 0.72).stroke({ color: map.accentColor, alpha: 0.2, width: 2 });
  }
  landmark.stroke({ color: map.accentColor, alpha: 0.22, width: 2 });
  stage.addChild(landmark);

  for (const trap of world.traps) {
    if (trap.owner === 1 && !trap.discoveredBy[0]) continue;
    const x = offsetX + cellToPixels(cellCenterUnits(trap.cellX), pixelsPerCell);
    const y = offsetY + cellToPixels(cellCenterUnits(trap.cellY), pixelsPerCell);
    const color = trapColor(trap.kind);
    const marker = new Graphics();
    const alpha = trap.armingTicks > 0 ? 0.45 : 0.9;
    marker.roundRect(x - pixelsPerCell * 0.28, y - pixelsPerCell * 0.28, pixelsPerCell * 0.56, pixelsPerCell * 0.56, pixelsPerCell * 0.12)
      .fill({ color, alpha })
      .stroke({ color: 0xffffff, alpha: 0.7, width: 1.5 });
    stage.addChild(marker);
    if (trap.kind === 'bomb' && (trap.triggerTicks ?? 0) > 0) {
      const fuse = new Graphics();
      fuse.circle(x, y, pixelsPerCell * 0.38)
        .stroke({ color: 0xff9b54, alpha: 0.95, width: 2 });
      stage.addChild(fuse);
    }
    if (trap.kind === 'moya' && (trap.effectTicks ?? 0) > 0) {
      const gas = new Graphics();
      gas.circle(x, y, cellToPixels(MOYA_RADIUS_UNITS, pixelsPerCell))
        .stroke({ color: 0x9ad7a5, alpha: 0.34, width: 2 });
      stage.addChild(gas);
    }
  }

  const player = world.players[0];
  const dangerCue = hasDangerCue(player, world.traps);
  if (dangerCue) {
    const warning = new Graphics();
    const warningX = offsetX + cellToPixels(player.x, pixelsPerCell);
    const warningY = offsetY + cellToPixels(player.y, pixelsPerCell);
    warning.circle(warningX, warningY, Math.max(18, pixelsPerCell * 0.48))
      .stroke({ color: 0xffdc73, alpha: 0.9, width: 2 });
    stage.addChild(warning);
  }
  const previewCellX = player.placement?.cellX ?? inputController.previewCell?.cellX ?? snapToCell(player.x, ARENA_WIDTH_CELLS);
  const previewCellY = player.placement?.cellY ?? inputController.previewCell?.cellY ?? snapToCell(player.y, ARENA_HEIGHT_CELLS);
  if (inputController.previewTrap || player.placement) {
    const previewDirection = player.placement?.direction ?? inputController.previewDirection;
    const preview = new Graphics();
    const previewX = offsetX + cellToPixels(cellCenterUnits(previewCellX), pixelsPerCell);
    const previewY = offsetY + cellToPixels(cellCenterUnits(previewCellY), pixelsPerCell);
    preview.roundRect(previewX - pixelsPerCell * 0.38, previewY - pixelsPerCell * 0.38, pixelsPerCell * 0.76, pixelsPerCell * 0.76, pixelsPerCell * 0.14)
      .stroke({ color: 0xf2b8ff, alpha: 0.9, width: 2 });
    stage.addChild(preview);
    const directionVectors = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
    const [directionX, directionY] = directionVectors[previewDirection];
    const arrow = new Graphics();
    arrow.moveTo(previewX, previewY)
      .lineTo(previewX + directionX * pixelsPerCell * 0.34, previewY + directionY * pixelsPerCell * 0.34)
      .stroke({ color: 0xffffff, alpha: 0.95, width: 3 });
    stage.addChild(arrow);
  }

  for (const event of world.events) {
    const age = world.tick - event.tick;
    if (age < 0 || age > motion.eventMarkerTicks) continue;
    const eventX = offsetX + cellToPixels(event.x, pixelsPerCell);
    const eventY = offsetY + cellToPixels(event.y, pixelsPerCell);
    const marker = new Graphics();
    const color = trapColor(event.kind);
    const markerRadius = motion.showRays
      ? Math.max(10, pixelsPerCell * (0.2 + age / 180))
      : Math.max(10, pixelsPerCell * 0.28);
    const markerAlpha = motion.showRays
      ? Math.max(0.2, 1 - age / motion.eventMarkerTicks)
      : 0.86;
    marker.circle(eventX, eventY, markerRadius)
      .stroke({ color, alpha: markerAlpha, width: 2 });
    stage.addChild(marker);
    if (motion.showRays && age <= motion.burstTicks) {
      const burst = new Graphics();
      const burstAlpha = Math.max(0.08, 0.7 - age / 18);
      const burstRadius = pixelsPerCell * (0.28 + age / 60);
      burst.circle(eventX, eventY, burstRadius).stroke({ color, alpha: burstAlpha, width: 2 });
      for (let ray = 0; ray < 4; ray += 1) {
        const angle = ray * Math.PI / 2;
        const startRadius = burstRadius * 1.25;
        const endRadius = burstRadius * 1.8;
        burst.moveTo(eventX + Math.cos(angle) * startRadius, eventY + Math.sin(angle) * startRadius)
          .lineTo(eventX + Math.cos(angle) * endRadius, eventY + Math.sin(angle) * endRadius);
      }
      burst.stroke({ color, alpha: burstAlpha, width: 2 });
      stage.addChild(burst);
    }
  }

  for (const player of world.players) {
    const x = offsetX + cellToPixels(player.x, pixelsPerCell);
    const y = offsetY + cellToPixels(player.y, pixelsPerCell);
    const size = Math.max(18, pixelsPerCell * 0.64);
    const color = player.id === 0 ? 0xffd37a : 0xd59aff;
    const token = new Graphics();
    const alpha = player.disabledTicks > 0 ? 0.35 : 1;
    token.roundRect(x - size / 2, y - size / 2, size, size, size * 0.25).fill({ color, alpha });
    token.roundRect(x - size / 2, y - size / 2, size, size, size * 0.25).stroke({ color: 0xffffff, alpha: 0.85, width: 2 });
    stage.addChild(token);
  }

  for (const shot of world.shots) {
    const x = offsetX + cellToPixels(shot.x, pixelsPerCell);
    const y = offsetY + cellToPixels(shot.y, pixelsPerCell);
    const projectile = new Graphics();
    projectile.circle(x, y, Math.max(4, pixelsPerCell * 0.12)).fill({ color: 0xfff2b0 });
    stage.addChild(projectile);
  }

  pixiApp.renderer.render(stage);
}

function updateHud(): void {
  if (!world) return;
  const currentWorld = world;
  timeValue.textContent = Math.max(0, (150 - world.tick / 60)).toFixed(1);
  playerHp.textContent = String(world.players[0].hp);
  cpuHp.textContent = String(world.players[1].hp);
  gearValue.textContent = String(world.players[0].gear);
  tickValue.textContent = String(world.tick);
  const dangerCue = hasDangerCue(world.players[0], world.traps);
  inspectButton.classList.toggle('is-unavailable', !dangerCue);
  inspectButton.setAttribute('aria-disabled', String(!dangerCue));
  if (inputController.previewTrap) {
    trapPreview.textContent = `${trapName(inputController.previewTrap)}を${trapDirectionName(inputController.previewDirection)}へ予告中。離して設置`;
  } else if (world.players[0].placement) {
    trapPreview.textContent = `${trapName(world.players[0].placement.kind)}を${trapDirectionName(world.players[0].placement.direction)}へ設置中…`;
  } else if (world.players[0].investigation) {
    trapPreview.textContent = world.players[0].investigation.mode === 'reveal' ? '調査中…' : '解除中…';
  } else if (dangerCue) {
    trapPreview.textContent = '近くに危険な気配。方向は不明';
  } else {
    const recentEvent = [...currentWorld.events].reverse().find((event) => currentWorld.tick - event.tick <= 18);
    if (recentEvent) {
      trapPreview.textContent = `${trapName(recentEvent.kind)}が発動。連鎖 ${recentEvent.chainLength}`;
    } else {
      trapPreview.textContent = '罠札を押して足元へ予告';
    }
  }
}

function hasDangerCue(
  player: WorldState['players'][number],
  traps: WorldState['traps'],
): boolean {
  const radiusSquared = INVESTIGATE_RADIUS_UNITS * INVESTIGATE_RADIUS_UNITS;
  return traps.some((trap) => {
    if (trap.owner === player.id || trap.armingTicks > 0 || trap.discoveredBy[player.id]) return false;
    const dx = player.x - cellCenterUnits(trap.cellX);
    const dy = player.y - cellCenterUnits(trap.cellY);
    return dx * dx + dy * dy <= radiusSquared;
  });
}

function cellIsOpen(world: WorldState, cellX: number, cellY: number): boolean {
  if (cellX < 0 || cellX >= ARENA_WIDTH_CELLS || cellY < 0 || cellY >= ARENA_HEIGHT_CELLS) return false;
  if (getMapDefinition(world.mapId).obstacleCells.some((obstacle) => obstacle.cellX === cellX && obstacle.cellY === cellY)) return false;
  return !world.traps.some((trap) => trap.cellX === cellX && trap.cellY === cellY);
}

function tutorialTrap(
  id: number,
  owner: 0 | 1,
  kind: TrapKind,
  cellX: number,
  cellY: number,
  discoveredBy: readonly [boolean, boolean],
  direction: 0 | 1 | 2 | 3 = 0,
): TrapState {
  return {
    id,
    owner,
    kind,
    direction,
    cellX,
    cellY,
    armingTicks: 0,
    remainingTicks: TRAP_LIFETIME_TICKS,
    discoveredBy,
    triggerTicks: 0,
    effectTicks: 0,
  };
}

/** Add a visible practice track after the player has completed the preceding step. */
function prepareTutorialStage(nextWorld: WorldState, step: 3 | 4): WorldState {
  if (step === 3 && nextWorld.traps.some((trap) => trap.owner === 1 && trap.kind === 'bounce')) return nextWorld;
  if (step === 4 && nextWorld.traps.some((trap) => trap.owner === 1 && !trap.discoveredBy[0])) return nextWorld;

  const playerCellX = snapToCell(nextWorld.players[0].x, ARENA_WIDTH_CELLS);
  const playerCellY = snapToCell(nextWorld.players[0].y, ARENA_HEIGHT_CELLS);
  if (step === 3) {
    const candidates = [
      { direction: 1 as const, firstX: playerCellX + 1, secondX: playerCellX + 3 },
      { direction: 3 as const, firstX: playerCellX - 1, secondX: playerCellX - 3 },
      { direction: 2 as const, firstX: playerCellY + 1, secondX: playerCellY + 3 },
      { direction: 0 as const, firstX: playerCellY - 1, secondX: playerCellY - 3 },
    ];
    const track = candidates.find((candidate) => {
      const firstX = candidate.direction === 1 || candidate.direction === 3 ? candidate.firstX : playerCellX;
      const firstY = candidate.direction === 2 || candidate.direction === 0 ? candidate.firstX : playerCellY;
      const secondX = candidate.direction === 1 || candidate.direction === 3 ? candidate.secondX : playerCellX;
      const secondY = candidate.direction === 2 || candidate.direction === 0 ? candidate.secondX : playerCellY;
      return cellIsOpen(nextWorld, firstX, firstY) && cellIsOpen(nextWorld, secondX, secondY);
    });
    if (!track) return nextWorld;
    const firstX = track.direction === 1 || track.direction === 3 ? track.firstX : playerCellX;
    const firstY = track.direction === 2 || track.direction === 0 ? track.firstX : playerCellY;
    const secondX = track.direction === 1 || track.direction === 3 ? track.secondX : playerCellX;
    const secondY = track.direction === 2 || track.direction === 0 ? track.secondX : playerCellY;
    const first = tutorialTrap(nextWorld.nextEntityId, 1, 'bounce', firstX, firstY, [true, true], track.direction);
    const second = tutorialTrap(nextWorld.nextEntityId + 1, 1, 'shock', secondX, secondY, [true, true], track.direction);
    const prepared = { ...nextWorld, traps: [...nextWorld.traps, first, second], nextEntityId: nextWorld.nextEntityId + 2, lastHash: '' };
    return { ...prepared, lastHash: hashWorld(prepared) };
  }

  const nearby = [
    [playerCellX + 1, playerCellY],
    [playerCellX - 1, playerCellY],
    [playerCellX, playerCellY + 1],
    [playerCellX, playerCellY - 1],
  ].find(([cellX, cellY]) => cellIsOpen(nextWorld, cellX, cellY));
  if (!nearby) return nextWorld;
  const [cellX, cellY] = nearby;
  const trap = tutorialTrap(nextWorld.nextEntityId, 1, 'hatch', cellX, cellY, [false, true]);
  const prepared = { ...nextWorld, traps: [...nextWorld.traps, trap], nextEntityId: nextWorld.nextEntityId + 1, lastHash: '' };
  return { ...prepared, lastHash: hashWorld(prepared) };
}

function trapColor(kind: TrapKind): number {
  if (kind === 'bounce') return 0x8cbdff;
  if (kind === 'shock') return 0xffdc73;
  if (kind === 'hatch') return 0xff99c8;
  if (kind === 'bomb') return 0xff9b54;
  return 0x9ad7a5;
}

function trapName(kind: TrapKind): string {
  if (kind === 'bounce') return 'ハネ板';
  if (kind === 'shock') return 'ビリビリ盤';
  if (kind === 'hatch') return 'パカット床';
  if (kind === 'bomb') return 'ポン玉';
  return 'モヤびん';
}

function trapDirectionName(direction: 0 | 1 | 2 | 3): string {
  if (direction === 1) return '右';
  if (direction === 2) return '下';
  if (direction === 3) return '左';
  return '上';
}

function resetBlueprintTelemetry(initialWorld: WorldState | null): void {
  movementTrail = initialWorld
    ? [{ tick: initialWorld.tick, x: initialWorld.players[0].x, y: initialWorld.players[0].y }]
    : [];
  trapPlacementSamples = [];
  if (initialWorld) recordBlueprintTelemetry(initialWorld, initialWorld);
}

function recordBlueprintTelemetry(previousWorld: WorldState, currentWorld: WorldState): void {
  if (practiceMode) return;
  const lastSample = movementTrail[movementTrail.length - 1];
  if (!lastSample || lastSample.tick !== currentWorld.tick) {
    movementTrail.push({
      tick: currentWorld.tick,
      x: currentWorld.players[0].x,
      y: currentWorld.players[0].y,
    });
  }
  const oldestTick = Math.max(0, currentWorld.tick - BLUEPRINT_TRAIL_TICKS);
  movementTrail = movementTrail.filter((sample) => sample.tick >= oldestTick);

  const knownIds = new Set(trapPlacementSamples.map((sample) => sample.id));
  for (const trap of currentWorld.traps) {
    if (knownIds.has(trap.id)) continue;
    trapPlacementSamples.push({
      id: trap.id,
      owner: trap.owner,
      kind: trap.kind,
      direction: trap.direction,
      cellX: trap.cellX,
      cellY: trap.cellY,
    });
    knownIds.add(trap.id);
  }
  // A trap can be consumed on the same tick as its first visible state in a
  // resumed or very busy match. Keep a minimal event-based marker in that
  // case so the result still explains where the effect happened.
  for (const event of currentWorld.events) {
    if (knownIds.has(event.trapId)) continue;
    trapPlacementSamples.push({
      id: event.trapId,
      owner: event.owner,
      kind: event.kind,
      direction: 0,
      cellX: snapToCell(event.x, ARENA_WIDTH_CELLS),
      cellY: snapToCell(event.y, ARENA_HEIGHT_CELLS),
    });
    knownIds.add(event.trapId);
  }
  // Keep the argument meaningful for callers that pass the same world at the
  // start of a match and document that no previous state is persisted.
  void previousWorld;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function toHexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function renderBlueprint(): void {
  if (!world) return;
  const map = getMapDefinition(world.mapId);
  const svg = createSvgElement('svg', {
    viewBox: `0 0 ${ARENA_WIDTH_CELLS} ${ARENA_HEIGHT_CELLS}`,
    role: 'img',
    'aria-labelledby': 'blueprint-svg-title blueprint-svg-description',
  });
  svg.append(createSvgElement('title', { id: 'blueprint-svg-title' }));
  svg.querySelector('#blueprint-svg-title')!.textContent = 'ワナワナの試合設計図';
  svg.append(createSvgElement('desc', { id: 'blueprint-svg-description' }));
  svg.querySelector('#blueprint-svg-description')!.textContent = '黄色の線があなたの最後の移動、丸印が罠、数字が発動順です。';
  svg.append(createSvgElement('rect', {
    x: '0', y: '0', width: String(ARENA_WIDTH_CELLS), height: String(ARENA_HEIGHT_CELLS),
    fill: toHexColor(map.backgroundColor),
  }));
  const grid = createSvgElement('g', { stroke: toHexColor(map.gridColor), 'stroke-width': '0.025', opacity: '0.9' });
  for (let column = 0; column <= ARENA_WIDTH_CELLS; column += 1) {
    grid.append(createSvgElement('line', { x1: String(column), y1: '0', x2: String(column), y2: String(ARENA_HEIGHT_CELLS) }));
  }
  for (let row = 0; row <= ARENA_HEIGHT_CELLS; row += 1) {
    grid.append(createSvgElement('line', { x1: '0', y1: String(row), x2: String(ARENA_WIDTH_CELLS), y2: String(row) }));
  }
  svg.append(grid);
  const obstacles = createSvgElement('g', { fill: toHexColor(map.accentColor), opacity: '0.34' });
  for (const obstacle of map.obstacleCells) {
    obstacles.append(createSvgElement('rect', {
      x: String(obstacle.cellX + 0.08), y: String(obstacle.cellY + 0.08), width: '0.84', height: '0.84', rx: '0.08',
    }));
  }
  svg.append(obstacles);

  const trail = movementTrail.slice(-BLUEPRINT_TRAIL_TICKS);
  if (trail.length >= 2) {
    svg.append(createSvgElement('polyline', {
      points: trail.map((sample) => `${sample.x / CELL_UNITS},${sample.y / CELL_UNITS}`).join(' '),
      fill: 'none', stroke: '#ffd37a', 'stroke-width': '0.09', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: '0.88',
    }));
  }

  const placementGroup = createSvgElement('g', {});
  for (const placement of trapPlacementSamples) {
    const marker = createSvgElement('circle', {
      cx: String(placement.cellX + 0.5), cy: String(placement.cellY + 0.5), r: '0.22',
      fill: toHexColor(trapColor(placement.kind)),
      stroke: placement.owner === 0 ? '#ffd37a' : '#d59aff', 'stroke-width': '0.09',
    });
    const title = createSvgElement('title', {});
    title.textContent = `${placement.owner === 0 ? 'あなた' : 'CPU'}の${trapName(placement.kind)}（${trapDirectionName(placement.direction)}）`;
    marker.append(title);
    placementGroup.append(marker);
  }
  svg.append(placementGroup);

  const events = world.events.slice(-36);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const causalLines = createSvgElement('g', { stroke: '#f2b8ff', 'stroke-width': '0.06', opacity: '0.78' });
  for (const event of events) {
    if (event.parentEventId === null) continue;
    const parent = eventById.get(event.parentEventId);
    if (!parent) continue;
    causalLines.append(createSvgElement('line', {
      x1: String(parent.x / CELL_UNITS), y1: String(parent.y / CELL_UNITS),
      x2: String(event.x / CELL_UNITS), y2: String(event.y / CELL_UNITS),
    }));
  }
  svg.append(causalLines);
  const eventGroup = createSvgElement('g', {});
  for (const event of events) {
    const marker = createSvgElement('circle', {
      cx: String(event.x / CELL_UNITS), cy: String(event.y / CELL_UNITS), r: '0.16',
      fill: toHexColor(trapColor(event.kind)), stroke: '#ffffff', 'stroke-width': '0.05',
    });
    const title = createSvgElement('title', {});
    title.textContent = `発動${event.id}・${trapName(event.kind)}・${event.chainLength}段・${event.target === 0 ? 'あなた' : 'CPU'}`;
    marker.append(title);
    eventGroup.append(marker);
    const label = createSvgElement('text', {
      x: String(event.x / CELL_UNITS + 0.2), y: String(event.y / CELL_UNITS - 0.18),
      fill: '#ffffff', 'font-size': '0.32', 'font-family': 'sans-serif', 'font-weight': '700',
    });
    label.textContent = String(event.id);
    eventGroup.append(label);
  }
  svg.append(eventGroup);
  const start = movementTrail[0];
  const end = movementTrail[movementTrail.length - 1];
  if (start) svg.append(createSvgElement('circle', { cx: String(start.x / CELL_UNITS), cy: String(start.y / CELL_UNITS), r: '0.11', fill: '#ffffff' }));
  if (end) svg.append(createSvgElement('circle', { cx: String(end.x / CELL_UNITS), cy: String(end.y / CELL_UNITS), r: '0.12', fill: '#ffd37a', stroke: '#ffffff', 'stroke-width': '0.04' }));

  const legend = document.createElement('p');
  legend.className = 'blueprint-legend';
  legend.textContent = `黄色線: 最後${Math.min(5, world.tick / TICK_RATE).toFixed(1)}秒の移動　白数字: 発動順　紫線: 連鎖の因果`;
  resultBlueprint.replaceChildren(svg, legend);
  blueprintNote.textContent = world.events.length > events.length
    ? `全${trapPlacementSamples.length}個の罠と、直近${events.length}件の発動を表示しています。連鎖の詳細は下の一覧で確認できます。`
    : `全${trapPlacementSamples.length}個の罠と発動順を表示しています。黄色線は最後の5秒の移動です。`;
}

function startLoop(): void {
  cancelAnimationFrame(frameId);
  lastFrameTime = 0;
  accumulator = 0;
  frameId = requestAnimationFrame(loop);
}

function loop(timestamp: number): void {
  if (machine.state !== 'battle' || !world) return;
  if (lastFrameTime === 0) lastFrameTime = timestamp;
  const elapsed = Math.min(250, Math.max(0, timestamp - lastFrameTime));
  lastFrameTime = timestamp;
  accumulator += elapsed;

  if (accumulator > FRAME_MS * MAX_BACKLOG_TICKS) {
    pauseGame('処理が遅れたため安全に停止しました。再開すると時間を合わせ直します。');
    return;
  }

  let processed = 0;
  while (accumulator >= FRAME_MS && processed < MAX_TICKS_PER_FRAME) {
    const playerInput = readInput();
    const cpuDecision = practiceMode ? { command: {} as InputCommand } : chooseCpuDecision(world, cpuDifficulty);
    const previousWorld = world;
    world = advanceWorld(world, playerInput, cpuDecision.command);
    recordBlueprintTelemetry(previousWorld, world);
    if (practiceMode) {
      const tutorialUpdate = advanceTutorial(tutorialState, previousWorld, world);
      tutorialState = tutorialUpdate.state;
      if (tutorialUpdate.advanced && (tutorialState.step === 3 || tutorialState.step === 4)) {
        world = prepareTutorialStage(world, tutorialState.step);
      }
      if (tutorialState.completed) {
        practiceComplete = true;
        persistTutorialCompletion();
        inputController.deactivate();
        soundEngine.suspend();
        updateScreen();
      }
    }
    replayRecorder?.recordTick(playerInput, cpuDecision.command, world);
    soundEngine.syncWorld(previousWorld, world);
    if (world.tick % RESUME_SAVE_INTERVAL_TICKS === 0 && world.phase === 'battle') persistResumeSnapshot();
    accumulator -= FRAME_MS;
    processed += 1;
  }

  updateHud();
  drawWorld();
  updateTutorialCard();
  if (practiceMode && practiceComplete) return;
  if (world.phase === 'result') {
    finishBattle();
    return;
  }
  frameId = requestAnimationFrame(loop);
}

function pauseGame(message = '試合を停止しています。'): void {
  if (machine.state !== 'battle') return;
  cancelAnimationFrame(frameId);
  inputController.deactivate();
  soundEngine.suspend();
  persistResumeSnapshot();
  machine.transition('paused');
  updateScreen();
  status.textContent = message;
}

async function resumeGame(): Promise<void> {
  if (machine.state !== 'paused') return;
  if (!contextRecovery.canResume) {
    status.textContent = '描画の復旧を待っています。';
    return;
  }
  contextRecovery.markResumed();
  const soundReady = await soundEngine.resume();
  if (!contextRecovery.canResume) {
    status.textContent = '描画の復旧を待っています。';
    return;
  }
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  if (!soundReady) status.textContent = '音なしで試合を続けます。';
  startLoop();
}

function appendStat(parent: HTMLElement, label: string, value: string): void {
  const item = document.createElement('p');
  item.className = 'result-stat';
  item.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  item.append(strong);
  parent.append(item);
}

function renderResultDetails(): void {
  if (!world) return;
  const report = buildMatchReport(world);
  resultDetails.replaceChildren();

  const reason = document.createElement('p');
  reason.className = 'result-reason';
  reason.textContent = report.resultReason;
  resultDetails.append(reason);

  const statGrid = document.createElement('div');
  statGrid.className = 'result-stat-grid';
  appendStat(statGrid, 'あなたの体力', String(report.players[0].hp));
  appendStat(statGrid, 'CPUの体力', String(report.players[1].hp));
  appendStat(statGrid, '試合時間', `${(report.durationTicks / TICK_RATE).toFixed(1)}秒`);
  appendStat(statGrid, '最大連鎖', `${report.maxChain}段`);
  appendStat(statGrid, 'あなたの罠 / 解除', `${report.players[0].trapsPlaced} / ${report.players[0].trapsDisarmed}`);
  appendStat(statGrid, 'CPUの罠 / 解除', `${report.players[1].trapsPlaced} / ${report.players[1].trapsDisarmed}`);
  resultDetails.append(statGrid);

  const chainTitle = document.createElement('p');
  chainTitle.className = 'result-reason';
  chainTitle.textContent = `罠の記録（${report.eventCount}発動・${report.chains.length}連鎖）`;
  resultDetails.append(chainTitle);

  if (report.chains.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'result-chain-empty';
    empty.textContent = 'この試合では罠の連鎖はありませんでした。';
    resultDetails.append(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'result-chains';
  const chains = report.chains.slice(-12);
  for (const chain of chains) {
    const item = document.createElement('li');
    const heading = document.createElement('strong');
    heading.className = 'result-chain-heading';
    heading.textContent = chainHeading(chain);
    item.append(heading);
    const description = document.createElement('span');
    description.textContent = `${chain.description}${chain.damage > 0 ? `（合計${chain.damage}ダメージ）` : ''}`;
    item.append(description);
    list.append(item);
  }
  resultDetails.append(list);
}

function finishBattle(): void {
  cancelAnimationFrame(frameId);
  clearContextRecoveryTimer();
  contextRecovery.endMatch();
  if (practiceMode) {
    stopPractice('練習時間が終了しました。もう一度やってみましょう。');
    return;
  }
  clearResumeSnapshot();
  inputController.deactivate();
  if (!world) return;
  if (world.result === 'technical-invalid') {
    // A technical stop is not a playable result. Do not show it as a win,
    // do not update terminal statistics, and return to the title boundary.
    replayRecorder = null;
    completedReplay = null;
    returnToTitle(`処理上限に達したため、この試合を無効にしました（${world.tick}tick）。`);
    return;
  }
  machine.transition('result');
  const report = buildMatchReport(world);
  completedReplay = replayRecorder?.finish(world) ?? null;
  replayRecorder = null;
  recordFinishedMatch(report);
  resultSummary.textContent = `${report.resultLabel}。${world.tick}tickで試合を終えました。`;
  renderResultDetails();
  renderBlueprint();
  resultHash.textContent = world.lastHash;
  copyRecordButton.disabled = completedReplay === null;
  replayCopyStatus.textContent = completedReplay
    ? '同じ記録を使えば、別の端末でも結果を検査できます。'
    : '対戦記録を作れませんでした。';
  updateScreen();
}

async function copyMatchRecord(): Promise<void> {
  if (!completedReplay) {
    replayCopyStatus.textContent = 'コピーできる対戦記録がありません。';
    return;
  }
  try {
    const serialized = serializeReplayRecord(completedReplay);
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(serialized);
    replayCopyStatus.textContent = `対戦記録をコピーしました（${Math.ceil(serialized.length / 1024)}KB）。`;
  } catch {
    replayCopyStatus.textContent = 'コピーできませんでした。安全な接続で再度お試しください。';
  }
}

function verifyPastedReplay(): void {
  const record = readReplayRecord(replayInput.value.trim());
  if (!record) {
    replayVerifyStatus.textContent = '記録を読み込めません。コピーしたJSON全体を貼り付けてください。';
    return;
  }
  const verification = verifyReplayRecord(record);
  if (verification.valid) {
    replayVerifyStatus.textContent = `検査に成功しました。${verification.world.tick}tick分の状態ハッシュが一致しています。`;
    return;
  }
  const mismatch = verification.mismatchTick === null ? '' : `（不一致: ${verification.mismatchTick}tick）`;
  replayVerifyStatus.textContent = `検査に失敗しました${mismatch}。${verification.reason ?? '現在のルールでは再現できません。'}`;
}

async function resumeBattle(): Promise<void> {
  if (!resumeSnapshot) return;
  const snapshot = resumeSnapshot;
  selectedLoadout = normalizeTrapLoadout(snapshot.world.loadouts[0]);
  loadoutSlot2.value = selectedLoadout[1];
  loadoutSlot3.value = selectedLoadout[2];
  selectedMap = snapshot.world.mapId;
  mapSelect.value = selectedMap;
  difficultySelect.value = snapshot.difficulty;
  updateDifficultyLabel();
  updateLoadoutLabel();
  updateMapLabel();
  persistMatchSettings();
  const soundReady = await soundEngine.resume();
  const ready = await ensurePixi();
  if (!ready || resumeSnapshot !== snapshot) return;

  clearResumeSnapshot();
  inputController.setTrapLoadout(selectedLoadout);
  contextRecovery.startMatch();
  world = snapshot.world;
  resetBlueprintTelemetry(world);
  summaryRecordedWorld = null;
  replayRecorder = null;
  completedReplay = null;
  copyRecordButton.disabled = true;
  replayCopyStatus.textContent = '中断から再開した試合は、再現記録を作りません。';
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  updateHud();
  drawWorld();
  if (!soundReady) status.textContent = '音なしで試合を続けます。';
  startLoop();
}

function discardResume(): void {
  clearResumeSnapshot();
  status.textContent = '中断した試合を破棄しました。';
}

async function startPractice(): Promise<void> {
  const ready = await ensurePixi();
  if (!ready) return;
  const soundReady = await soundEngine.resume();
  practiceMode = true;
  practiceComplete = false;
  tutorialState = createTutorialState();
  selectedLoadout = DEFAULT_TRAP_LOADOUT;
  selectedMap = DEFAULT_MAP_ID;
  inputController.setTrapLoadout(selectedLoadout);
  clearResumeSnapshot();
  contextRecovery.startMatch();
  world = createWorld(0x57414e41, selectedLoadout, selectedLoadout, selectedMap);
  summaryRecordedWorld = null;
  replayRecorder = null;
  completedReplay = null;
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  updateHud();
  drawWorld();
  if (!soundReady) status.textContent = '音なしで練習を続けます。';
  startLoop();
}

function stopPractice(message = '練習を終了しました。'): void {
  if (!practiceMode) return;
  cancelAnimationFrame(frameId);
  inputController.deactivate();
  soundEngine.suspend();
  contextRecovery.endMatch();
  practiceMode = false;
  practiceComplete = false;
  tutorialState = createTutorialState();
  world = null;
  resetBlueprintTelemetry(null);
  replayRecorder = null;
  completedReplay = null;
  if (machine.state === 'battle' || machine.state === 'paused') machine.transition('title');
  updateScreen();
  status.textContent = message;
}

async function startMatchFromPractice(): Promise<void> {
  if (!practiceMode || !practiceComplete) return;
  stopPractice('本戦を準備しています。');
  await startBattle();
}

async function startBattle(): Promise<void> {
  practiceMode = false;
  practiceComplete = false;
  tutorialState = createTutorialState();
  updateDifficultyLabel();
  updateLoadoutLabel();
  updateMapLabel();
  persistMatchSettings();
  const soundReady = await soundEngine.resume();
  const ready = await ensurePixi();
  if (!ready) {
    soundEngine.suspend();
    updateSoundButton();
    return;
  }
  inputController.setTrapLoadout(selectedLoadout);
  clearResumeSnapshot();
  contextRecovery.startMatch();
  world = createWorld(Date.now() >>> 0, selectedLoadout, selectedLoadout, selectedMap);
  resetBlueprintTelemetry(world);
  summaryRecordedWorld = null;
  completedReplay = null;
  replayRecorder = new ReplayRecorder(world, { buildCommit: BUILD_COMMIT });
  copyRecordButton.disabled = true;
  replayCopyStatus.textContent = '';
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  updateHud();
  drawWorld();
  if (!soundReady) status.textContent = '音なしで試合を続けます。';
  startLoop();
}

function returnToTitle(message = ''): void {
  cancelAnimationFrame(frameId);
  clearContextRecoveryTimer();
  contextRecovery.endMatch();
  clearResumeSnapshot();
  inputController.deactivate();
  inputController.setTrapLoadout(null);
  soundEngine.suspend();
  world = null;
  resetBlueprintTelemetry(null);
  replayRecorder = null;
  completedReplay = null;
  practiceMode = false;
  practiceComplete = false;
  tutorialState = createTutorialState();
  if (machine.state === 'battle' || machine.state === 'paused' || machine.state === 'result') {
    machine.transition('title');
  }
  updateScreen();
  if (message) status.textContent = message;
}

function bindEvents(): void {
  getElement<HTMLButtonElement>('start-button').addEventListener('click', () => void startBattle());
  practiceButton.addEventListener('click', () => void startPractice());
  getElement<HTMLButtonElement>('retry-button').addEventListener('click', () => {
    machine.transition('title');
    updateScreen();
  });
  getElement<HTMLButtonElement>('pause-button').addEventListener('click', () => pauseGame());
  getElement<HTMLButtonElement>('resume-button').addEventListener('click', () => void resumeGame());
  soundEngine.addStateListener(handleSoundStateChange);
  soundButton.addEventListener('click', () => {
    void soundEngine.toggle().then((enabled) => {
      updateSoundButton();
      if (!enabled && machine.state === 'battle') status.textContent = '音なしで試合を続けます。';
    });
  });
  clearCareerSummaryButton.addEventListener('click', clearMatchSummary);
  resetSettingsButton.addEventListener('click', resetMatchSettings);
  resumeMatchButton.addEventListener('click', () => void resumeBattle());
  discardResumeButton.addEventListener('click', discardResume);
  replayVerifyButton.addEventListener('click', verifyPastedReplay);
  practiceQuitButton.addEventListener('click', () => stopPractice());
  practiceStartMatchButton.addEventListener('click', () => void startMatchFromPractice());
  practiceTitleButton.addEventListener('click', () => stopPractice('練習を完了しました。'));
  difficultySelect.addEventListener('change', () => {
    updateDifficultyLabel();
    persistMatchSettings();
  });
  loadoutSlot2.addEventListener('change', () => {
    updateLoadoutLabel();
    persistMatchSettings();
  });
  loadoutSlot3.addEventListener('change', () => {
    updateLoadoutLabel();
    persistMatchSettings();
  });
  mapSelect.addEventListener('change', () => {
    updateMapLabel();
    persistMatchSettings();
  });
  getElement<HTMLButtonElement>('pause-title-button').addEventListener('click', () => returnToTitle());
  getElement<HTMLButtonElement>('restart-button').addEventListener('click', () => void startBattle());
  getElement<HTMLButtonElement>('result-title-button').addEventListener('click', () => returnToTitle());
  copyRecordButton.addEventListener('click', () => void copyMatchRecord());
  updateButton.addEventListener('click', () => offlineUpdates.acceptUpdate());

  window.addEventListener('blur', () => {
    inputController.reset();
    if (machine.state === 'battle') pauseGame('画面のフォーカスを失ったため停止しました。');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      inputController.reset();
      if (machine.state === 'battle') pauseGame('別の画面へ移ったため停止しました。');
    }
  });
  window.addEventListener('pagehide', () => {
    inputController.reset();
    if (machine.state === 'battle') pauseGame('ページが隠れたため停止しました。');
  });
  window.addEventListener('orientationchange', () => {
    handleViewportResize('画面の向きが変わったため停止しました。縦向きに戻してから再開してください。');
  });
  window.addEventListener('resize', () => handleViewportResize());
  window.visualViewport?.addEventListener('resize', () => handleViewportResize());
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => handleViewportResize());
    observer.observe(arena);
  }
}

bindEvents();
loadMatchSummary();
loadMatchSettings();
loadResumeSnapshot();
loadTutorialCompletion();
updateScreen();
updateSoundButton();
updateDifficultyLabel();
updateLoadoutLabel();
updateMapLabel();
updateCareerSummary();
offlineUpdates.addStateListener(updateOfflineCard);
void offlineUpdates.register(BUILD_COMMIT, import.meta.env.BASE_URL);
status.textContent = webglAvailable() ? '準備完了' : 'WebGLを確認できません';
if (!webglAvailable()) {
  machine.transition('unsupported');
  updateScreen();
}
