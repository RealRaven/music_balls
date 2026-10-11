# 🎱 Ball Arcade (music_balls)

**Six audio-reactive ball games in one zero-dependency web app.**

Your music drives the action. Load a track, use your mic, or share a Chrome tab — the bass controls speed, spawn rate, and intensity. Play yourself with the mouse.

> **AI autoplay is coming soon.** Right now the games are fully playable by you. An AI that can take over and play for you is on the way.

---

## Quick start

No build step. No npm. No CDN.

```bash
# Option A — open the file directly
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux

# Option B — recommended (needed for mic + tab capture)
python3 -m http.server 8000
# then open http://localhost:8000
```

Microphone and tab-audio capture need a secure context. `localhost` counts; `file://` can be unreliable for `getUserMedia`, so a local server is the safer choice.

---

## The games

| Game | Type | What you do |
|------|------|-------------|
| **Ball Blast** | Shooter | Shoot incoming spheres before they reach you. Red elite spheres take more hits and pay more. Weapon upgrades as you score. |
| **Ball Dodge** | Survival | You are a white orb in a storm of coloured spheres. Survive and graze close for bonus points. No shooting. |
| **Ball Rally** | Paddle | Keep the ball alive with your paddle. Every return multiplies the score. The beat makes it faster. |
| **Ball Catch** | Reflex | Catch the cool-coloured spheres in your basket. Avoid the red bombs. Combos multiply points. |
| **Ball Rhythm** | Timing | Spheres fly down three lanes. Fire the moment one crosses the golden ring. Notes can spawn on the beat. |
| **Ball Match** | Colour | A target colour is announced. Shoot only that colour. The wrong one costs you. |

---

## Controls

| Input | Action |
|-------|--------|
| **Mouse move** | Aim / move |
| **Click** | Fire / act |
| **M** | Toggle aim mode (mouse ↔ screen centre) |
| **P** | Pause / resume |
| **R** | Restart current game |
| **Esc** | Back to main menu |

---

## Audio setup

On the main menu, choose a source:

- **Load audio file** — any local `audio/*` file (loops). Works everywhere.
- **Microphone** — live input. Needs a secure context (`localhost`).
- **Share tab audio** — Chrome only. Pick a tab that is playing music and tick **“Share audio”**.
- **Stop** — shut down the current source.
- **Sensitivity** — scales the analysed bass before it reaches the games.

The meter under the slider shows live bass level so you can confirm the analyser is hearing something.

### How audio affects gameplay

Every game reads `audio.drive` (bass × sensitivity) and uses it to modulate:

- movement / note speed
- spawn interval
- camera bob and feel
- beat detection (`audio.beat`) — used by Ball Rhythm

With no audio connected the games simply run at their base speed.

---

## Project layout

```
music_balls/
├── index.html
├── README.md
├── LICENSE
├── css/
│   └── style.css
└── js/
    ├── engine/
    │   ├── util.js       # math, colour helpers, namespace
    │   ├── renderer.js   # tiny pseudo-3D Canvas 2D renderer
    │   ├── audio.js      # Web Audio capture + analysis
    │   ├── input.js      # pointer + keyboard
    │   └── game.js       # Game base class + registry
    ├── games/
    │   ├── blast.js
    │   ├── dodge.js
    │   ├── rally.js
    │   ├── catch.js
    │   ├── rhythm.js
    │   └── match.js
    └── app.js            # menu, loop, pause, shell
```

Classic `<script>` tags (not ES modules) so the app works from `file://` with no server required.

---

## The engine (short version)

- **Renderer** — pure Canvas 2D pseudo-3D (spheres, rings, lines, grid, overlays). Camera looks down −Z.
- **AudioEngine** — analyser for file / mic / tab. Exposes `bass`, `mid`, `treble`, `level`, `beat`, and `drive`.
- **Input** — normalised aim, firing state, keyboard. Ready for a future virtual/AI channel.
- **Game** — base class. Implement `reset`, `update`, `draw`, `getStats` (and later `ai`).

---

## Adding your own game

1. Create `js/games/my-game.js`:

```js
(function () {
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  class MyGame extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#101020', bottom: '#05060a' };
    }
    reset() { /* ... */ }
    update(dt) { /* this.audio.drive is 0..2 */ }
    draw() {
      this.r.grid(-1.5, 90, 5, '#2b3f66', 0.25);
      this.r.sphere({ x: 0, y: 2, z: -8 }, 1, '#4cc9f0', { glow: true });
    }
    getStats() { return [{ k: 'Score', v: this.score }]; }
  }

  Arcade.register({
    id: 'my-game',
    name: 'My Game',
    tag: 'Custom',
    color: '#ff7ab6',
    blurb: 'One-line pitch for the menu card.',
    hint: 'Controls hint shown when the game starts.',
    create: (shell) => new MyGame(shell)
  });
})();
```

2. Add the script tag in `index.html` **before** `js/app.js`.
3. Reload — the card appears automatically.

---

## Notes

- Tab audio capture is **Chrome-only**. File input works in every modern browser.
- `getUserMedia` / `getDisplayMedia` need a secure context — prefer `http://localhost`.
- The app never generates its own sound; it only analyses what you feed it.
- Single `requestAnimationFrame` loop; `dt` is clamped so a backgrounded tab doesn’t explode the simulation.

---

## Roadmap

- [x] Six playable audio-reactive games
- [x] File / mic / tab audio input
- [ ] **AI autoplay** — let the machine play for you (coming soon)
- [ ] More games / polish

---

## Licence

MIT — see [LICENSE](LICENSE).

---

`music_balls` — audio-reactive ball games. Take it, fork it, ship it.