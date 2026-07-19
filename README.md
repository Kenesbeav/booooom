# Birthday: Zero Hour

Живая версия: [https://kenesbeav.github.io/booooom/](https://kenesbeav.github.io/booooom/)

Полноэкранное 3D-поздравление на Three.js: пробуждение от первого лица, пыльный город, пролет самолета, взрыв, ударная волна и финальный титр.

## Запуск

```powershell
npm.cmd install
npm.cmd run dev
```

Продакшен-сборка:

```powershell
npm.cmd run build
npm.cmd run preview
```

## Настройка

Текст поздравления, длительность, качество и пути к будущим материалам находятся в `src/config.ts`.

- `greeting` — финальные надписи.
- `quality` — плотность частиц и предел разрешения рендера.
- `assets.aircraftGlb` — локальный путь к модели самолета `.glb`.
- `assets.audio` — локальные звуки ветра, самолета, взрыва и финала.

Пока пути равны `null`, используются процедурная модель самолета и синтезированный Web Audio саунд-дизайн.
