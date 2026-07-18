export const TIMELINE = {
  planeStart: 9.65,
  planeEnd: 18.4,
  bombRelease: 15.15,
  impact: 17.35,
  shockHit: 18.75,
  dustArrival: 18.92,
  smokeArrival: 19.28,
  finale: 21.35,
} as const;

export const EXPERIENCE_CONFIG = {
  duration: TIMELINE.finale,
  quality: {
    desktopPixelRatio: 1.5,
    mobilePixelRatio: 1,
    desktopDustParticles: 1400,
    mobileDustParticles: 480,
  },
  greeting: {
    kicker: 'ОПЕРАЦИЯ «ПРАЗДНИК» ЗАВЕРШЕНА',
    title: 'С ДНЁМ РОЖДЕНИЯ!',
    message: 'Чтобы поздравить тебя, мы даже начали Третью мировую.',
    wish: 'Пусть взрываются только эмоции, а каждый новый год жизни будет мощнее предыдущего.',
  },
  // Укажите локальные пути, когда появятся финальные материалы.
  // Если поле равно null, используется встроенная процедурная версия.
  assets: {
    aircraftGlb: null as string | null,
    buildingGlbs: [] as string[],
    audio: {
      wind: null as string | null,
      aircraft: null as string | null,
      explosion: null as string | null,
      finale: null as string | null,
    },
  },
} as const;

export type ExperienceConfig = typeof EXPERIENCE_CONFIG;
