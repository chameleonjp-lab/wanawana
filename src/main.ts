import { Application, Container, Graphics, RendererType } from 'pixi.js';
import './styles.css';
import { AsyncOperationGate } from './app/async-operation-gate.ts';
import { ContextRecovery } from './app/context-recovery.ts';
import { getMotionProfile } from './app/motion.ts';
import { drawActor, facingFromDelta, type ActorAction } from './app/actor-render.ts';
import { drawTrap, drawTrapEvent, drawTrapPreview } from './app/trap-render.ts';
import { MatchPerformanceMonitor, type MatchPerformanceReport } from './app/performance.ts';
import { rendererPreferences, type RendererPreference } from './app/renderer-support.ts';
import { createViewportSize, viewportSizeChanged, type ViewportSize } from './app/viewport.ts';
import { battleOrientationMessage, isPortraitBattleOrientation } from './app/orientation.ts';
import {
  canStartBattleAfterResume,
  remainingResumeSeconds,
  RESUME_COUNTDOWN_STEP_MS,
} from './app/resume-gate.ts';
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
import { InputController, inputInterruptionMessage } from './input/controller.ts';

const FRAME_MS = 1_000 / 60;
const MAX_TICKS_PER_FRAME = 5;
const MAX_BACKLOG_TICKS = 8;
const CONTEXT_RECOVERY_TIMEOUT_MS = 5_000;
const SUPABASE_URL = 'https://mlpnjgezrnhdxsxolyzj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM';
const GAME_SLUG = 'wanawana';
const CLIENT_VERSION = 'wanawana-2026-08-31';
const LAB_URL = 'https://chameleonjp-lab.github.io/chameleonjp_lab/';
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
const pauseStatus = getElement<HTMLElement>('pause-status');
const resultView = getElement<HTMLElement>('result-view');
const arena = getElement<HTMLElement>('arena');
const timeValue = getElement<HTMLElement>('time-value');
const playerHp = getElement<HTMLElement>('player-hp');
const cpuHp = getElement<HTMLElement>('cpu-hp');
const gearValue = getElement<HTMLElement>('gear-value');
const tickValue = getElement<HTMLElement>('tick-value');
const resultSummary = getElement<HTMLElement>('result-summary');
const resultPlayer = getElement<HTMLElement>('result-player');
const resultShareText = getElement<HTMLTextAreaElement>('result-share-text');
const resultShareButton = getElement<HTMLButtonElement>('result-share-button');
const resultShareStatus = getElement<HTMLElement>('result-share-status');
const onlineRankingList = getElement<HTMLOListElement>('online-ranking-list');
const onlineRankingStatus = getElement<HTMLElement>('online-ranking-status');
const resultDetails = getElement<HTMLElement>('result-details');
const blueprintNote = getElement<HTMLElement>('blueprint-note');
const resultBlueprint = getElement<HTMLElement>('result-blueprint');
const resultHistory = getElement<HTMLElement>('result-history');
const resultHash = getElement<HTMLElement>('result-hash');
const copyRecordButton = getElement<HTMLButtonElement>('copy-record-button');
const replayCopyStatus = getElement<HTMLElement>('replay-copy-status');
const resultPerformance = getElement<HTMLElement>('result-performance');
const copyPerformanceButton = getElement<HTMLButtonElement>('copy-performance-button');
const performanceCopyStatus = getElement<HTMLElement>('performance-copy-status');
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
const lightweightToggle = getElement<HTMLInputElement>('lightweight-toggle');
const resetSettingsButton = getElement<HTMLButtonElement>('reset-settings');
const practiceEntryNote = getElement<HTMLElement>('practice-entry-note');
const practiceButton = getElement<HTMLButtonElement>('practice-button');
const startButton = getElement<HTMLButtonElement>('start-button');
const playerNameInput = getElement<HTMLInputElement>('player-name');
const playerNameNote = getElement<HTMLElement>('player-name-note');
const homeShareButton = getElement<HTMLButtonElement>('home-share-button');
const homeShareStatus = getElement<HTMLElement>('home-share-status');
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
const resumeButton = getElement<HTMLButtonElement>('resume-button');

const SUMMARY_STORAGE_KEY = 'wanawana:v1:summary';
const BUILD_COMMIT = import.meta.env.VITE_BUILD_COMMIT ?? 'local';
document.querySelectorAll<HTMLAnchorElement>('.platform-link').forEach((link) => {
  link.href = LAB_URL;
});
let pixiApp: Application | null = null;
let rendererBackend: RendererPreference | null = null;

interface ArenaRenderState {
  readonly mapId: MapId;
  readonly width: number;
  readonly height: number;
  readonly pixelsPerCell: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly staticLayer: Container;
  readonly dynamicLayer: Container;
  readonly dynamicGraphics: Graphics[];
}

let arenaRenderState: ArenaRenderState | null = null;
let world: WorldState | null = null;
let frameId = 0;
let resizeFrameId: number | null = null;
let viewportBaseline: ViewportSize | null = null;
let viewportStable = true;
let resumeCountdownTimer: number | null = null;
let resumeCountdownToken = 0;
let resumeCountdownStartedAt = 0;
let pauseMessage = '入力と試合時間は止まっています。表示が安定したら再開してください。';
let lastFrameTime = 0;
let accumulator = 0;
let cpuDifficulty: CpuDifficulty = 'normal';
let selectedLoadout: TrapLoadout = DEFAULT_TRAP_LOADOUT;
let selectedMap: MapId = DEFAULT_MAP_ID;
let lightweightDisplay = false;
let matchSummary: MatchSummary = emptyMatchSummary();
let summaryStorageAvailable = true;
let settingsStorageAvailable = true;
let resumeSnapshot: MatchResume | null = null;
let resumeStorageAvailable = true;
let summaryRecordedWorld: WorldState | null = null;
let replayRecorder: ReplayRecorder | null = null;
let completedReplay: MatchReplay | null = null;
let completedPerformanceReport: MatchPerformanceReport | null = null;
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

interface ActorPositionSample {
  readonly x: number;
  readonly y: number;
}

let previousActorPositions: readonly [ActorPositionSample, ActorPositionSample] | null = null;
let practiceMode = false;
let practiceComplete = false;
let tutorialState: TutorialState = createTutorialState();
let tutorialStorageAvailable = true;
let tutorialCompleted = false;
const performanceMonitor = new MatchPerformanceMonitor();
const inputController = new InputController(
  controls,
  (reason) => {
    if (machine.state === 'battle') pauseGame(inputInterruptionMessage(reason));
  },
  () => performanceMonitor.markInput(performance.now()),
);
const soundEngine = new SoundEngine();
const contextRecovery = new ContextRecovery();
const battlePreparationGate = new AsyncOperationGate();

interface RankingRow {
  readonly rank_no?: number;
  readonly display_name?: string;
  readonly player_name?: string;
  readonly score?: number;
  readonly best_score?: number;
}

function loadPlayerName(): string {
  try {
    return (window.localStorage.getItem('wanawana-player-name') ?? '').trim().slice(0, 20);
  } catch {
    return '';
  }
}

function savePlayerName(value: string): void {
  try {
    window.localStorage.setItem('wanawana-player-name', value);
  } catch {
    // Private browsing may disable storage; the current session still works.
  }
}

let playerName = loadPlayerName();

function currentGameUrl(): string {
  return window.location.href.split('#')[0] ?? window.location.href;
}

function homeShareMessage(): string {
  return `ワナワナ｜見えない罠を仕掛けて連鎖させる1対1ゲーム\n${currentGameUrl()}\n#カメレオンJP #ワナワナ`;
}

function scoreForRanking(report: MatchReport): number {
  const player = report.players[0];
  const resultBonus = report.result === 'player-win' ? 50 : report.result === 'draw' || report.result === 'time-draw' ? 25 : 0;
  return Math.max(0, player.hp) + player.trapsDisarmed * 20 + report.maxChain * 10 + resultBonus;
}

function resultShareMessage(report: MatchReport, score: number): string {
  const player = report.players[0];
  return `ワナワナの結果：${report.resultLabel}\n仕掛けスコア ${score}点／残り体力 ${player.hp}\n最大連鎖 ${report.maxChain}段・解除 ${player.trapsDisarmed}回\n${currentGameUrl()}\n#カメレオンJP #ワナワナ`;
}

async function shareOrCopy(message: string): Promise<'shared' | 'copied' | 'manual'> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: 'ワナワナ', text: message });
      return 'shared';
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'manual';
  }
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(message);
    return 'copied';
  } catch {
    return 'manual';
  }
}

async function callRankingRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error('ranking request failed');
  return data as T;
}

async function submitAndLoadRanking(report: MatchReport): Promise<void> {
  const score = scoreForRanking(report);
  onlineRankingStatus.textContent = 'ランキング送信中…';
  try {
    await callRankingRpc('submit_score', {
      p_display_name: playerName,
      p_game_slug: GAME_SLUG,
      p_score: score,
      p_client_version: CLIENT_VERSION,
    });
    const rows = await callRankingRpc<RankingRow[]>('get_best_score_ranking', {
      p_game_slug: GAME_SLUG,
      p_limit: 10,
    });
    onlineRankingList.replaceChildren();
    const safeRows = Array.isArray(rows) ? rows.slice(0, 10) : [];
    if (safeRows.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'まだ記録がありません。';
      onlineRankingList.append(item);
    } else {
      safeRows.forEach((row, index) => {
        const item = document.createElement('li');
        item.textContent = `${row.rank_no ?? index + 1}位　${row.display_name ?? row.player_name ?? 'ななし'}　${Number(row.score ?? row.best_score ?? 0)}点`;
        onlineRankingList.append(item);
      });
    }
    onlineRankingStatus.textContent = 'ランキングを更新しました。';
  } catch {
    onlineRankingStatus.textContent = 'ランキングを取得できませんでした。ゲーム結果は保存されています。';
  }
}
let contextRecoveryTimer: number | null = null;

function isCurrentBattlePreparation(token: number): boolean {
  return battlePreparationGate.isCurrent(token) && machine.state === 'battle';
}

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
    : state === 'paused' ? pauseMessage : '';
  if (state === 'paused') pauseStatus.textContent = pauseMessage;
  updateTrapButtons();
  updateTutorialCard();
  playerNameInput.value = playerName;
  playerNameNote.textContent = playerName.length > 0
    ? `${playerName}さんの名前でランキングに参加します。`
    : '名前を入力するとゲームを開始できます。';
  const canStartNamedGame = playerName.length > 0;
  practiceButton.disabled = state !== 'title' || !canStartNamedGame;
  startButton.disabled = state !== 'title' || !canStartNamedGame;
  resumeMatchButton.disabled = !canStartNamedGame;
  pauseButton.disabled = practiceMode && practiceComplete;
  updateResumePanel();
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
    ? '難度・舞台・罠ロードアウト・軽量表示は、この端末に保存されます。'
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

function loadMatchSettings(): void {
  try {
    const settings = readMatchSettings(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
    difficultySelect.value = settings.difficulty;
    mapSelect.value = settings.mapId;
    loadoutSlot2.value = settings.loadout[1];
    loadoutSlot3.value = settings.loadout[2];
    lightweightDisplay = settings.lightweight;
    lightweightToggle.checked = lightweightDisplay;
  } catch {
    settingsStorageAvailable = false;
  }
  updateSettingsNote();
}

function persistMatchSettings(): void {
  if (!settingsStorageAvailable) return;
  try {
    const settings = createMatchSettings(cpuDifficulty, selectedMap, selectedLoadout, lightweightDisplay);
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, serializeMatchSettings(settings));
  } catch {
    settingsStorageAvailable = false;
    updateSettingsNote();
  }
}

function resetMatchSettings(): void {
  if (!window.confirm('ワナワナの難度・舞台・罠ロードアウト・軽量表示を初期値へ戻しますか？')) return;
  const defaults = defaultMatchSettings();
  difficultySelect.value = defaults.difficulty;
  mapSelect.value = defaults.mapId;
  loadoutSlot2.value = defaults.loadout[1];
  loadoutSlot3.value = defaults.loadout[2];
  lightweightDisplay = defaults.lightweight;
  lightweightToggle.checked = lightweightDisplay;
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
  applyRendererSettings();
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

function canvas2dAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('2d'));
  } catch {
    return false;
  }
}

function transitionToUnsupported(): void {
  if (machine.state === 'unsupported') return;
  if (machine.state !== 'title') returnToTitle();
  machine.transition('unsupported');
  updateScreen();
}

function reducedMotionPreferred(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function desiredRendererResolution(): number {
  return Math.min(window.devicePixelRatio || 1, lightweightDisplay ? 1.25 : 2);
}

function applyRendererSettings(): void {
  if (!pixiApp) return;
  const width = arena.clientWidth;
  const height = arena.clientHeight;
  if (width <= 0 || height <= 0) return;
  pixiApp.renderer.resize(width, height, desiredRendererResolution());
}

function clearContextRecoveryTimer(): void {
  if (contextRecoveryTimer === null) return;
  window.clearTimeout(contextRecoveryTimer);
  contextRecoveryTimer = null;
}

function readViewportSize(): ViewportSize {
  const rect = arena.getBoundingClientRect();
  return createViewportSize(rect.width, rect.height);
}

function readBattleViewportSize(): ViewportSize {
  const visualViewport = window.visualViewport;
  const width = visualViewport?.width || window.innerWidth;
  const height = visualViewport?.height || window.innerHeight;
  return createViewportSize(width, height);
}

function battleViewportIsPortrait(): boolean {
  return isPortraitBattleOrientation(readBattleViewportSize());
}

function currentBattleOrientationMessage(): string {
  return battleOrientationMessage(readBattleViewportSize());
}

function setPauseMessage(message: string): void {
  pauseMessage = message;
  pauseStatus.textContent = message;
  status.textContent = message;
}

function captureViewportBaseline(): void {
  viewportBaseline = readViewportSize();
}

function clearViewportBaseline(): void {
  viewportBaseline = null;
}

function scheduleViewportRedraw(): void {
  if (resizeFrameId !== null) window.cancelAnimationFrame(resizeFrameId);
  resizeFrameId = window.requestAnimationFrame(() => {
    resizeFrameId = null;
    if (!world || !pixiApp || machine.state === 'title' || machine.state === 'unsupported') return;
    if (machine.state === 'paused') {
      viewportStable = true;
      return;
    }
    updateHud();
    drawWorld();
    captureViewportBaseline();
    viewportStable = true;
  });
}

function handleViewportResize(message = '画面サイズが変わったため停止しました。表示が落ち着いてから再開してください。'): void {
  const currentSize = readViewportSize();
  const changed = machine.state === 'battle' && viewportSizeChanged(viewportBaseline, currentSize);
  const portrait = battleViewportIsPortrait();
  inputController.reset();
  viewportStable = false;
  cancelResumeCountdown();
  if (machine.state === 'battle' && (changed || !portrait)) {
    if (currentSize.width > 0 && currentSize.height > 0) viewportBaseline = currentSize;
    pauseGame(portrait ? message : currentBattleOrientationMessage());
  } else if (machine.state === 'paused') {
    setPauseMessage(portrait
      ? '表示領域が変わったため停止しています。表示が落ち着いてから再開してください。'
      : currentBattleOrientationMessage());
  }
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
  cancelResumeCountdown();
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
    setPauseMessage('描画領域を失ったため、復旧を確認しています');
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
    setPauseMessage('描画を復旧しました。再開するボタンを押してください。');
  });
}

async function ensurePixi(): Promise<boolean> {
  if (pixiApp) {
    applyRendererSettings();
    return true;
  }
  if (!canvas2dAvailable()) {
    transitionToUnsupported();
    return false;
  }

  const preferences = rendererPreferences(webglAvailable());
  const initialize = async (preference: RendererPreference[]): Promise<Application | null> => {
    const app = new Application();
    try {
      await app.init({
        autoStart: false,
        sharedTicker: false,
        preference,
        resizeTo: arena,
        backgroundColor: 0x0f0d1b,
        antialias: true,
        resolution: desiredRendererResolution(),
        preserveDrawingBuffer: false,
      });
      arena.replaceChildren(app.canvas);
      pixiApp = app;
      rendererBackend = app.renderer.type === RendererType.WEBGL ? 'webgl' : 'canvas';
      if (rendererBackend === 'webgl') {
        (app.canvas as HTMLCanvasElement).addEventListener('webglcontextlost', handleWebglContextLost);
        (app.canvas as HTMLCanvasElement).addEventListener('webglcontextrestored', handleWebglContextRestored);
      }
      drawWorld();
      return app;
    } catch {
      if (pixiApp === app) pixiApp = null;
      rendererBackend = null;
      arenaRenderState = null;
      try {
        app.destroy(true, true);
      } catch {
        // The renderer may have failed before it could be destroyed.
      }
      arena.replaceChildren();
      return null;
    }
  };

  const app = await initialize(preferences);
  if (app) return true;

  if (preferences[0] === 'webgl') {
    const canvasApp = await initialize(['canvas']);
    if (canvasApp) return true;
  }

  transitionToUnsupported();
  return false;
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

function buildStaticArena(
  layer: Container,
  map: ReturnType<typeof getMapDefinition>,
  width: number,
  height: number,
  pixelsPerCell: number,
  offsetX: number,
  offsetY: number,
): void {
  const background = new Graphics();
  background.rect(0, 0, width, height).fill({ color: map.backgroundColor });
  layer.addChild(background);

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
  layer.addChild(grid);

  for (const obstacle of map.obstacleCells) {
    const wall = new Graphics();
    const x = offsetX + obstacle.cellX * pixelsPerCell;
    const y = offsetY + obstacle.cellY * pixelsPerCell;
    wall.roundRect(
      x + pixelsPerCell * 0.08,
      y + pixelsPerCell * 0.08,
      pixelsPerCell * 0.84,
      pixelsPerCell * 0.84,
      pixelsPerCell * 0.12,
    )
      .fill({ color: map.accentColor, alpha: 0.32 })
      .stroke({ color: map.accentColor, alpha: 0.76, width: 2 });
    layer.addChild(wall);
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
  layer.addChild(landmark);
}

function createArenaRenderState(
  stage: Container,
  map: ReturnType<typeof getMapDefinition>,
  width: number,
  height: number,
  pixelsPerCell: number,
  offsetX: number,
  offsetY: number,
): ArenaRenderState {
  const previous = arenaRenderState;
  if (previous) {
    stage.removeChild(previous.staticLayer);
    stage.removeChild(previous.dynamicLayer);
    previous.staticLayer.destroy({ children: true });
    previous.dynamicLayer.destroy({ children: true });
  }

  const staticLayer = new Container();
  const dynamicLayer = new Container();
  buildStaticArena(staticLayer, map, width, height, pixelsPerCell, offsetX, offsetY);
  stage.addChild(staticLayer);
  stage.addChild(dynamicLayer);

  const next: ArenaRenderState = {
    mapId: map.id,
    width,
    height,
    pixelsPerCell,
    offsetX,
    offsetY,
    staticLayer,
    dynamicLayer,
    dynamicGraphics: [],
  };
  arenaRenderState = next;
  return next;
}

function ensureArenaRenderState(
  stage: Container,
  map: ReturnType<typeof getMapDefinition>,
  width: number,
  height: number,
  pixelsPerCell: number,
  offsetX: number,
  offsetY: number,
): ArenaRenderState {
  if (
    arenaRenderState
    && arenaRenderState.mapId === map.id
    && arenaRenderState.width === width
    && arenaRenderState.height === height
  ) {
    return arenaRenderState;
  }
  return createArenaRenderState(stage, map, width, height, pixelsPerCell, offsetX, offsetY);
}

function acquireDynamicGraphic(state: ArenaRenderState, index: number): Graphics {
  let graphic = state.dynamicGraphics[index];
  if (!graphic) {
    graphic = new Graphics();
    state.dynamicGraphics.push(graphic);
    state.dynamicLayer.addChild(graphic);
  }
  graphic.clear();
  graphic.visible = true;
  return graphic;
}

function hideUnusedDynamicGraphics(state: ArenaRenderState, usedCount: number): void {
  for (let index = usedCount; index < state.dynamicGraphics.length; index += 1) {
    state.dynamicGraphics[index].visible = false;
  }
}

function drawWorld(): void {
  if (!pixiApp || !world) return;
  const motion = getMotionProfile(reducedMotionPreferred(), lightweightDisplay);
  const map = getMapDefinition(world.mapId);
  const width = Math.max(1, arena.clientWidth);
  const height = Math.max(1, arena.clientHeight);
  const pixelsPerCell = Math.min(width / ARENA_WIDTH_CELLS, height / ARENA_HEIGHT_CELLS);
  const offsetX = (width - pixelsPerCell * ARENA_WIDTH_CELLS) / 2;
  const offsetY = (height - pixelsPerCell * ARENA_HEIGHT_CELLS) / 2;
  const state = ensureArenaRenderState(
    pixiApp.stage,
    map,
    width,
    height,
    pixelsPerCell,
    offsetX,
    offsetY,
  );
  let dynamicIndex = 0;

  const trapMotionScale = reducedMotionPreferred() ? 0 : lightweightDisplay ? 0.5 : 1;
  const trapSize = pixelsPerCell * 0.84;
  for (const trap of world.traps) {
    const discovered = trap.owner === 0 || trap.discoveredBy[0];
    if (!discovered) continue;
    const x = offsetX + cellToPixels(cellCenterUnits(trap.cellX), pixelsPerCell);
    const y = offsetY + cellToPixels(cellCenterUnits(trap.cellY), pixelsPerCell);
    const marker = acquireDynamicGraphic(state, dynamicIndex);
    dynamicIndex += 1;
    drawTrap(marker, {
      x,
      y,
      size: trapSize,
      kind: trap.kind,
      direction: trap.direction,
      owner: trap.owner,
      discovered,
      color: trapColor(trap.kind),
      tick: world.tick,
      armingTicks: trap.armingTicks,
      remainingTicks: trap.remainingTicks,
      triggerTicks: trap.triggerTicks,
      effectTicks: trap.effectTicks,
      effectRadius: cellToPixels(MOYA_RADIUS_UNITS, pixelsPerCell),
      motionScale: trapMotionScale,
      alpha: trap.owner === 0 ? 1 : 0.82,
    });
  }

  const player = world.players[0];
  const dangerCue = hasDangerCue(player, world.traps);
  if (dangerCue) {
    const warning = acquireDynamicGraphic(state, dynamicIndex);
    dynamicIndex += 1;
    const warningX = offsetX + cellToPixels(player.x, pixelsPerCell);
    const warningY = offsetY + cellToPixels(player.y, pixelsPerCell);
    warning.circle(warningX, warningY, Math.max(18, pixelsPerCell * 0.48))
      .stroke({ color: 0xffdc73, alpha: 0.9, width: 2 });
  }
  const previewCellX = player.placement?.cellX ?? inputController.previewCell?.cellX ?? snapToCell(player.x, ARENA_WIDTH_CELLS);
  const previewCellY = player.placement?.cellY ?? inputController.previewCell?.cellY ?? snapToCell(player.y, ARENA_HEIGHT_CELLS);
  if (inputController.previewTrap || player.placement) {
    const previewKind = player.placement?.kind ?? inputController.previewTrap ?? 'bounce';
    const previewDirection = player.placement?.direction ?? inputController.previewDirection;
    const preview = acquireDynamicGraphic(state, dynamicIndex);
    dynamicIndex += 1;
    const previewX = offsetX + cellToPixels(cellCenterUnits(previewCellX), pixelsPerCell);
    const previewY = offsetY + cellToPixels(cellCenterUnits(previewCellY), pixelsPerCell);
    drawTrapPreview(preview, {
      x: previewX,
      y: previewY,
      size: trapSize,
      kind: previewKind,
      direction: previewDirection,
      color: trapColor(previewKind),
      tick: world.tick,
      motionScale: trapMotionScale,
    });
  }

  for (const event of world.events) {
    const age = world.tick - event.tick;
    if (age < 0 || age > motion.eventMarkerTicks) continue;
    const eventX = offsetX + cellToPixels(event.x, pixelsPerCell);
    const eventY = offsetY + cellToPixels(event.y, pixelsPerCell);
    const marker = acquireDynamicGraphic(state, dynamicIndex);
    dynamicIndex += 1;
    drawTrapEvent(marker, {
      x: eventX,
      y: eventY,
      size: pixelsPerCell,
      color: trapColor(event.kind),
      age,
      eventMarkerTicks: motion.eventMarkerTicks,
      burstTicks: motion.burstTicks,
      chainLength: event.chainLength,
      showRays: motion.showRays,
      motionScale: trapMotionScale,
    });
  }

  const previousPositions = previousActorPositions;
  const currentPositions: [ActorPositionSample, ActorPositionSample] = [
    { x: world.players[0].x, y: world.players[0].y },
    { x: world.players[1].x, y: world.players[1].y },
  ];
  const actorMotionScale = reducedMotionPreferred() ? 0 : lightweightDisplay ? 0.5 : 1;

  for (const player of world.players) {
    const x = offsetX + cellToPixels(player.x, pixelsPerCell);
    const y = offsetY + cellToPixels(player.y, pixelsPerCell);
    const size = Math.max(18, pixelsPerCell * 0.64);
    const previous = previousPositions?.[player.id];
    const deltaX = previous ? player.x - previous.x : 0;
    const deltaY = previous ? player.y - previous.y : 0;
    const moving = Boolean(previous && (Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1));
    const action: ActorAction = player.disabledTicks > 0
      ? 'disabled'
      : player.placement
        ? 'placing'
        : player.investigation
          ? 'investigating'
          : player.fireSlowTicks > 0
            ? 'firing'
            : moving ? 'moving' : 'idle';
    const token = acquireDynamicGraphic(state, dynamicIndex);
    dynamicIndex += 1;
    drawActor(token, {
      x,
      y,
      size,
      color: player.id === 0 ? 0xffd37a : 0xd59aff,
      outlineColor: 0xffffff,
      accentColor: player.id === 0 ? 0x8cbdff : 0xff99c8,
      id: player.id,
      tick: world.tick,
      facing: facingFromDelta(deltaX, deltaY, player.id === 0 ? 'up' : 'down'),
      action,
      motionScale: actorMotionScale,
      alpha: player.disabledTicks > 0 ? 0.35 : 1,
    });
  }

  previousActorPositions = currentPositions;

  for (const shot of world.shots) {
    const x = offsetX + cellToPixels(shot.x, pixelsPerCell);
    const y = offsetY + cellToPixels(shot.y, pixelsPerCell);
    const projectile = acquireDynamicGraphic(state, dynamicIndex);
    dynamicIndex += 1;
    projectile.circle(x, y, Math.max(4, pixelsPerCell * 0.12)).fill({ color: 0xfff2b0 });
  }

  hideUnusedDynamicGraphics(state, dynamicIndex);
  pixiApp.renderer.render(pixiApp.stage);
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
  previousActorPositions = null;
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
  performanceMonitor.startFrameSegment();
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
  performanceMonitor.recordFrame(timestamp);
  updateTutorialCard();
  if (practiceMode && practiceComplete) return;
  if (world.phase === 'result') {
    finishBattle();
    return;
  }
  frameId = requestAnimationFrame(loop);
}

function resetResumeCountdownUi(): void {
  resumeCountdownTimer = null;
  resumeCountdownStartedAt = 0;
  resumeButton.disabled = false;
  resumeButton.textContent = '再開する';
}

function cancelResumeCountdown(): void {
  if (resumeCountdownTimer !== null) window.clearTimeout(resumeCountdownTimer);
  resumeCountdownToken += 1;
  resetResumeCountdownUi();
  soundEngine.suspend();
}

async function completeResumeCountdown(token: number, soundPromise: Promise<boolean>): Promise<void> {
  const soundReady = await soundPromise;
  if (token !== resumeCountdownToken || machine.state !== 'paused') return;

  const elapsed = Date.now() - resumeCountdownStartedAt;
  const ready = canStartBattleAfterResume(
    elapsed,
    battleViewportIsPortrait(),
    viewportStable,
  );
  if (!ready || !contextRecovery.canResume) {
    cancelResumeCountdown();
    if (!contextRecovery.canResume) {
      setPauseMessage('描画の復旧を待っています。');
    } else if (!battleViewportIsPortrait()) {
      setPauseMessage(currentBattleOrientationMessage());
    } else {
      setPauseMessage('表示領域が変わったため停止しています。表示が落ち着いてから再開してください。');
    }
    return;
  }

  resumeCountdownToken += 1;
  resetResumeCountdownUi();
  if (!contextRecovery.markResumed()) {
    setPauseMessage('描画の復旧を待っています。');
    soundEngine.suspend();
    return;
  }
  inputController.activate();
  machine.transition('battle');
  updateScreen();
  updateHud();
  applyRendererSettings();
  drawWorld();
  captureViewportBaseline();
  viewportStable = true;
  if (!soundReady) status.textContent = '音なしで試合を続けます。';
  startLoop();
}

function beginResumeCountdown(): void {
  if (machine.state !== 'paused') return;
  if (!contextRecovery.canResume) {
    setPauseMessage('描画の復旧を待っています。');
    return;
  }
  if (!battleViewportIsPortrait()) {
    setPauseMessage(currentBattleOrientationMessage());
    return;
  }
  if (!viewportStable) {
    setPauseMessage('表示領域が安定するまで待ってから、もう一度「再開する」を押してください。');
    return;
  }

  cancelResumeCountdown();
  const token = resumeCountdownToken + 1;
  resumeCountdownToken = token;
  resumeCountdownStartedAt = Date.now();
  resumeButton.disabled = true;
  const soundPromise = soundEngine.resume();

  const updateCountdown = (): void => {
    if (token !== resumeCountdownToken || machine.state !== 'paused') return;
    if (!battleViewportIsPortrait()) {
      cancelResumeCountdown();
      setPauseMessage(currentBattleOrientationMessage());
      return;
    }

    const elapsed = Date.now() - resumeCountdownStartedAt;
    const remaining = remainingResumeSeconds(elapsed);
    if (remaining <= 0) {
      void completeResumeCountdown(token, soundPromise);
      return;
    }

    setPauseMessage(`表示領域が安定しています。${remaining}秒後に再開します。`);
    resumeButton.textContent = `再開準備中…${remaining}`;
    resumeCountdownTimer = window.setTimeout(updateCountdown, RESUME_COUNTDOWN_STEP_MS);
  };

  updateCountdown();
}

function pauseGame(message = '試合を停止しています。'): void {
  if (machine.state !== 'battle') return;
  battlePreparationGate.invalidate();
  if (!world) {
    returnToTitle('試合の準備を中断しました。もう一度開始してください。');
    return;
  }
  cancelAnimationFrame(frameId);
  cancelResumeCountdown();
  inputController.deactivate();
  soundEngine.suspend();
  persistResumeSnapshot();
  pauseMessage = message;
  machine.transition('paused');
  updateScreen();
  setPauseMessage(message);
}

function resumeGame(): void {
  if (machine.state !== 'paused') return;
  beginResumeCountdown();
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

function renderResultSharing(report: MatchReport): void {
  const score = scoreForRanking(report);
  resultPlayer.textContent = `プレイヤー：${playerName || 'ななし'}`;
  resultShareText.value = resultShareMessage(report, score);
  resultShareStatus.textContent = '';
  onlineRankingList.replaceChildren();
  onlineRankingStatus.textContent = 'ランキング送信中…';
  void submitAndLoadRanking(report);
}


function formatPerformanceMs(value: number | null): string {
  return value === null ? '—' : value.toFixed(1) + 'ms';
}

function resetPerformanceResult(): void {
  completedPerformanceReport = null;
  resultPerformance.textContent = '試合終了後に、この端末での簡易計測を表示します。';
  copyPerformanceButton.disabled = true;
  performanceCopyStatus.textContent = '';
}

function renderPerformanceReport(report: MatchPerformanceReport): void {
  const frameSummary = report.frameSamples === 0
    ? 'フレーム間隔は未計測'
    : 'フレーム間隔' + report.frameSamples + '件：P95 ' + formatPerformanceMs(report.frameP95Ms)
      + ' / P99 ' + formatPerformanceMs(report.frameP99Ms)
      + ' / 最大 ' + formatPerformanceMs(report.frameMaxMs)
      + '。20ms超 ' + report.frameOver20Ms + '件、34ms超 ' + report.frameOver34Ms
      + '件、67ms超 ' + report.frameOver67Ms + '件、100ms以上 ' + report.frameOver100Ms
      + '件、150ms以上 ' + report.frameOver150Ms + '件';
  const inputSummary = report.inputSamples === 0
    ? '入力→次回描画は未計測'
    : '入力→次回描画' + report.inputSamples + '件：P95 '
      + formatPerformanceMs(report.inputP95Ms) + ' / 最大 ' + formatPerformanceMs(report.inputMaxMs);
  const rendererSummary = rendererBackend === 'canvas' ? 'Canvas表示' : 'WebGL表示';
  resultPerformance.textContent = `この試合の簡易計測（${rendererSummary}・rAF基準・${lightweightDisplay ? '軽量表示' : '通常表示'}）。` + frameSummary + '。'
    + inputSummary + '。数値は実機確認用の目安です。';
  copyPerformanceButton.disabled = report.frameSamples === 0 && report.inputSamples === 0;
  performanceCopyStatus.textContent = '';
}

async function copyPerformanceReport(): Promise<void> {
  if (!completedPerformanceReport) {
    performanceCopyStatus.textContent = 'コピーできる性能記録がありません。';
    return;
  }
  const record = {
    format: 'wanawana-performance-v1',
    buildCommit: BUILD_COMMIT,
    userAgent: navigator.userAgent,
    viewport: {
      width: arena.clientWidth,
      height: arena.clientHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      renderResolution: desiredRendererResolution(),
      renderer: rendererBackend ?? 'unknown',
    },
    settings: {
      difficulty: cpuDifficulty,
      map: selectedMap,
      loadout: [...selectedLoadout],
      lightweight: lightweightDisplay,
    },
    report: completedPerformanceReport,
  };
  const serialized = JSON.stringify(record);
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(serialized);
    performanceCopyStatus.textContent = '性能記録をコピーしました（' + Math.ceil(serialized.length / 1024) + 'KB）。';
  } catch {
    performanceCopyStatus.textContent = 'コピーできませんでした。安全な接続で再度お試しください。';
  }
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
  const performanceReport = performanceMonitor.finish();
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
  renderResultSharing(report);
  renderResultDetails();
  completedPerformanceReport = performanceReport;
  renderPerformanceReport(performanceReport);
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

function ensurePortraitBattleViewport(): boolean {
  if (battleViewportIsPortrait()) return true;
  status.textContent = currentBattleOrientationMessage();
  return false;
}

async function resumeBattle(): Promise<void> {
  if (!playerName) {
    playerNameNote.textContent = 'プレイヤー名を入力してください。';
    playerNameInput.focus();
    return;
  }
  if (machine.state !== 'title' || !resumeSnapshot || !ensurePortraitBattleViewport()) return;
  const preparationToken = battlePreparationGate.begin();
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
  practiceMode = false;
  practiceComplete = false;
  contextRecovery.startMatch();
  world = snapshot.world;
  resetBlueprintTelemetry(world);
  summaryRecordedWorld = null;
  replayRecorder = null;
  completedReplay = null;
  copyRecordButton.disabled = true;
  replayCopyStatus.textContent = '中断から再開した試合は、再現記録を作りません。';
  performanceMonitor.start();
  resetPerformanceResult();
  machine.transition('battle');
  updateScreen();
  status.textContent = '中断した試合を準備しています…';
  const ready = await ensurePixi();
  if (!ready || resumeSnapshot !== snapshot || !isCurrentBattlePreparation(preparationToken)) return;
  if (!ensurePortraitBattleViewport()) {
    pauseGame(currentBattleOrientationMessage());
    return;
  }

  clearResumeSnapshot();
  inputController.setTrapLoadout(selectedLoadout);
  inputController.reset();
  inputController.deactivate();
  soundEngine.suspend();
  viewportStable = true;
  pauseMessage = '中断した試合を読み込みました。表示が安定したら「再開する」を押してください。';
  machine.transition('paused');
  updateScreen();
  setPauseMessage(pauseMessage);
}

function discardResume(): void {
  clearResumeSnapshot();
  status.textContent = '中断した試合を破棄しました。';
}

async function startPractice(): Promise<void> {
  if (!playerName) {
    playerNameNote.textContent = 'プレイヤー名を入力してください。';
    playerNameInput.focus();
    return;
  }
  if (machine.state !== 'title' || !ensurePortraitBattleViewport()) return;
  const preparationToken = battlePreparationGate.begin();
  practiceMode = true;
  practiceComplete = false;
  performanceMonitor.reset();
  resetPerformanceResult();
  tutorialState = createTutorialState();
  machine.transition('battle');
  updateScreen();
  status.textContent = '練習の舞台を準備しています…';
  const ready = await ensurePixi();
  if (!ready || !isCurrentBattlePreparation(preparationToken)) return;
  const soundReady = await soundEngine.resume();
  if (!isCurrentBattlePreparation(preparationToken)) return;
  if (!ensurePortraitBattleViewport()) {
    returnToTitle(currentBattleOrientationMessage());
    return;
  }
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
  updateScreen();
  updateHud();
  applyRendererSettings();
  drawWorld();
  captureViewportBaseline();
  viewportStable = true;
  if (!soundReady) status.textContent = '音なしで練習を続けます。';
  startLoop();
}

function stopPractice(message = '練習を終了しました。'): void {
  if (!practiceMode) return;
  cancelAnimationFrame(frameId);
  performanceMonitor.reset();
  inputController.deactivate();
  soundEngine.suspend();
  contextRecovery.endMatch();
  practiceMode = false;
  practiceComplete = false;
  performanceMonitor.reset();
  resetPerformanceResult();
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
  if (!playerName) {
    playerNameNote.textContent = 'プレイヤー名を入力してください。';
    playerNameInput.focus();
    return;
  }
  if ((machine.state !== 'title' && machine.state !== 'result') || !ensurePortraitBattleViewport()) return;
  const preparationToken = battlePreparationGate.begin();
  practiceMode = false;
  practiceComplete = false;
  tutorialState = createTutorialState();
  updateDifficultyLabel();
  updateLoadoutLabel();
  updateMapLabel();
  persistMatchSettings();
  machine.transition('battle');
  updateScreen();
  status.textContent = '舞台を準備しています…';
  world = null;
  resetBlueprintTelemetry(null);
  summaryRecordedWorld = null;
  replayRecorder = null;
  completedReplay = null;
  const soundReady = await soundEngine.resume();
  if (!isCurrentBattlePreparation(preparationToken)) return;
  const ready = await ensurePixi();
  if (!isCurrentBattlePreparation(preparationToken)) return;
  if (!ensurePortraitBattleViewport()) {
    returnToTitle(currentBattleOrientationMessage());
    return;
  }
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
  performanceMonitor.start();
  resetPerformanceResult();
  inputController.activate();
  updateScreen();
  updateHud();
  applyRendererSettings();
  drawWorld();
  captureViewportBaseline();
  viewportStable = true;
  if (!soundReady) status.textContent = '音なしで試合を続けます。';
  startLoop();
}

function returnToTitle(message = ''): void {
  battlePreparationGate.invalidate();
  cancelAnimationFrame(frameId);
  performanceMonitor.reset();
  resetPerformanceResult();
  cancelResumeCountdown();
  clearContextRecoveryTimer();
  contextRecovery.endMatch();
  clearViewportBaseline();
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
  playerNameInput.value = playerName;
  playerNameInput.addEventListener('input', () => {
    playerName = playerNameInput.value.trim().slice(0, 20);
    playerNameInput.value = playerName;
    savePlayerName(playerName);
    updateScreen();
  });
  homeShareButton.addEventListener('click', async () => {
    const outcome = await shareOrCopy(homeShareMessage());
    homeShareStatus.textContent = outcome === 'shared'
      ? '共有シートを開きました。'
      : outcome === 'copied'
        ? 'ゲームのリンクをコピーしました。'
        : '自動共有できません。リンクを選択して共有してください。';
  });
  resultShareButton.addEventListener('click', async () => {
    const outcome = await shareOrCopy(resultShareText.value);
    resultShareStatus.textContent = outcome === 'shared'
      ? '共有シートを開きました。'
      : outcome === 'copied'
        ? '結果文をコピーしました。'
        : '自動共有できません。上の文章を選択してコピーしてください。';
  });
  startButton.addEventListener('click', () => void startBattle());
  practiceButton.addEventListener('click', () => void startPractice());
  getElement<HTMLButtonElement>('retry-button').addEventListener('click', () => {
    machine.transition('title');
    updateScreen();
  });
  getElement<HTMLButtonElement>('pause-button').addEventListener('click', () => pauseGame());
  resumeButton.addEventListener('click', () => resumeGame());
  soundEngine.addStateListener(handleSoundStateChange);
  soundButton.addEventListener('click', () => {
    void soundEngine.toggle().then((enabled) => {
      updateSoundButton();
      if (!enabled && machine.state === 'battle') status.textContent = '音なしで試合を続けます。';
    });
  });
  clearCareerSummaryButton.addEventListener('click', clearMatchSummary);
  resetSettingsButton.addEventListener('click', resetMatchSettings);
  lightweightToggle.addEventListener('change', () => {
    lightweightDisplay = lightweightToggle.checked;
    applyRendererSettings();
    persistMatchSettings();
  });
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
  copyPerformanceButton.addEventListener('click', () => void copyPerformanceReport());

  window.addEventListener('blur', () => {
    cancelResumeCountdown();
    inputController.reset();
    if (machine.state === 'battle') pauseGame('画面のフォーカスを失ったため停止しました。');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      cancelResumeCountdown();
      inputController.reset();
      if (machine.state === 'battle') pauseGame('別の画面へ移ったため停止しました。');
    }
  });
  window.addEventListener('pagehide', () => {
    cancelResumeCountdown();
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
if (canvas2dAvailable()) {
  status.textContent = '準備完了';
} else {
  status.textContent = '描画を確認できません';
  transitionToUnsupported();
}
