import './styles.css';
import { EXPERIENCE_CONFIG, TIMELINE } from './config';
import { CinematicAudio } from './audio';
import { CinematicWorld } from './world';

const getElement = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Не найден обязательный элемент: ${selector}`);
  return element;
};

const canvas = getElement<HTMLCanvasElement>('#scene');
const loader = getElement<HTMLElement>('#loader');
const loaderProgress = getElement<HTMLElement>('#loader-progress');
const loaderLabel = getElement<HTMLElement>('#loader-label');
const intro = getElement<HTMLElement>('#intro');
const startButton = getElement<HTMLButtonElement>('#start');
const eyelids = getElement<HTMLElement>('#eyelids');
const flash = getElement<HTMLElement>('#flash');
const dustHit = getElement<HTMLElement>('#dust-hit');
const soundButton = getElement<HTMLButtonElement>('#sound');
const finale = getElement<HTMLElement>('#finale');
const replayButton = getElement<HTMLButtonElement>('#replay');

getElement<HTMLElement>('#finale-kicker').textContent = EXPERIENCE_CONFIG.greeting.kicker;
getElement<HTMLElement>('#finale-title').textContent = EXPERIENCE_CONFIG.greeting.title;
getElement<HTMLElement>('#finale-message').textContent = EXPERIENCE_CONFIG.greeting.message;
getElement<HTMLElement>('#finale-wish').textContent = EXPERIENCE_CONFIG.greeting.wish;

let world: CinematicWorld;
let audio: CinematicAudio;
let playing = false;
let finalShown = false;
let muted = false;
let sequenceStart = 0;
let previousFrame = performance.now();

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};
const range = (value: number, start: number, end: number) => clamp01((value - start) / (end - start));

function setLoading(progress: number, label = 'Подготавливаем сцену') {
  const percent = Math.round(clamp01(progress) * 100);
  loaderProgress.style.width = `${percent}%`;
  loaderLabel.textContent = `${label} · ${percent}%`;
}

function getLidAmount(time: number) {
  if (time < 0.42) return 50.5;
  if (time < 1.9) return 50.5 * (1 - smooth(range(time, 0.42, 1.9)));

  const blink = (start: number, middle: number, end: number, height: number) => {
    if (time < start || time > end) return 0;
    return time <= middle
      ? height * smooth(range(time, start, middle))
      : height * (1 - smooth(range(time, middle, end)));
  };

  return Math.max(
    blink(2.34, 2.49, 2.72, 48),
    blink(3.03, 3.14, 3.32, 31),
  );
}

function updateOverlays(time: number) {
  document.documentElement.style.setProperty('--lid', `${getLidAmount(time)}%`);

  const flashAge = time - TIMELINE.impact;
  let flashOpacity = 0;
  if (flashAge >= 0 && flashAge < 0.12) flashOpacity = 1;
  else if (flashAge >= 0.12 && flashAge < 1.35) flashOpacity = 1 - smooth(range(flashAge, 0.12, 1.35));
  flash.style.opacity = String(flashOpacity);

  const firstDust = smooth(range(time, TIMELINE.shockHit, TIMELINE.smokeArrival + 0.38)) * 0.36;
  const smokeWall = smooth(range(time, TIMELINE.smokeArrival, TIMELINE.finale - 0.08));
  dustHit.style.opacity = String(Math.max(firstDust, smokeWall));
}

async function startSequence() {
  if (playing) return;
  playing = true;
  finalShown = false;
  world.reset();
  finale.classList.remove('visible');
  finale.setAttribute('aria-hidden', 'true');
  intro.classList.add('leaving');
  eyelids.classList.add('visible');
  soundButton.classList.add('visible');
  document.documentElement.style.setProperty('--lid', '50.5%');
  flash.style.opacity = '0';
  dustHit.style.opacity = '0';
  sequenceStart = performance.now();
  previousFrame = sequenceStart;
  await audio.start();
}

function showFinale() {
  if (finalShown) return;
  finalShown = true;
  playing = false;
  document.documentElement.style.setProperty('--lid', '0%');
  eyelids.classList.remove('visible');
  flash.style.opacity = '0';
  dustHit.style.opacity = '1';
  finale.classList.add('visible');
  finale.setAttribute('aria-hidden', 'false');
}

function animate(now: number) {
  requestAnimationFrame(animate);
  const delta = Math.min(0.05, Math.max(0.001, (now - previousFrame) / 1000));
  previousFrame = now;

  if (playing) {
    const elapsed = (now - sequenceStart) / 1000;
    world.update(elapsed, delta);
    updateOverlays(elapsed);
    if (elapsed >= TIMELINE.finale) showFinale();
  } else if (!finalShown) {
    world.update(0, delta);
  }
  world.render(delta);
}

startButton.addEventListener('click', () => { void startSequence(); });
replayButton.addEventListener('click', () => { void startSequence(); });
soundButton.addEventListener('click', () => {
  muted = !muted;
  audio.setMuted(muted);
  soundButton.classList.toggle('muted', muted);
  soundButton.setAttribute('aria-pressed', String(muted));
  soundButton.setAttribute('aria-label', muted ? 'Включить звук' : 'Выключить звук');
});

async function initialize() {
  try {
    setLoading(0.08, 'Создаем пустыню');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    world = new CinematicWorld(canvas, EXPERIENCE_CONFIG);
    setLoading(0.58, 'Расставляем декорации');
    audio = new CinematicAudio(EXPERIENCE_CONFIG);
    await Promise.all([
      world.loadOptionalAssets((value) => setLoading(0.58 + value * 0.18, 'Загружаем модели')),
      audio.preload((value) => setLoading(0.76 + value * 0.2, 'Настраиваем звук')),
    ]);
    setLoading(1, 'Готово');
    canvas.classList.add('ready');
    window.setTimeout(() => {
      loader.classList.add('hidden');
      startButton.disabled = false;
    }, 420);
    previousFrame = performance.now();
    requestAnimationFrame(animate);
  } catch (error) {
    console.error(error);
    loaderLabel.textContent = 'Не удалось запустить 3D. Обновите браузер или включите аппаратное ускорение.';
    loaderProgress.style.background = '#7c1812';
  }
}

void initialize();
