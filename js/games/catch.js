/* ============================================================
   catch.js — BALL CATCH (full musical reactivity)
   Balls fall on beats at the tempo of your track. Downbeats fan
   out a shower of fruit, treble onsets drop fast cyan shards,
   bass build-ups spawn slow goldens worth a lot. Catching a ball
   on the beat doubles its value. Red bombs scale with intensity.
   No music = nothing falls.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const GROUND_Y = -1.5;
  const CATCH_Y  = -0.55;
  const REF_BPM  = 120;
  const SPAWN_Y  = 10;
  const BALL_Z   = 0;

  /* ---------- ball type table ---------- */
  const BALL_TYPES = {
    fruit: {
      rMin: 0.50, rMax: 0.95,
      vyMin: 5.5, vyMax: 8.5,
      points: 10,
      colors: ['#4cc9f0', '#7bd389', '#a78bfa'],
      glow: false,
      bad: false
    },
    golden: {
      rMin: 1.00, rMax: 1.40,
      vyMin: 3.5, vyMax: 5.0,
      points: 50,
      colors: ['#ffd166'],
      glow: true,
      bad: false
    },
    shard: {
      rMin: 0.28, rMax: 0.50,
      vyMin: 9.0, vyMax: 13.0,
      points: 25,
      colors: ['#4cc9f0'],
      glow: false,
      bad: false
    },
    bomb: {
      rMin: 0.55, rMax: 0.95,
      vyMin: 5.5, vyMax: 8.5,
      points: 0,
      colors: ['#0e0e12'],
      glow: true,
      bad: true
    }
  };

  /* ---------- object pool ---------- */
  class BallPool {
    constructor() {
      this.free = [];
      this.active = [];
    }
    _make() {
      return {
        x: 0, y: 0, z: 0, r: 0.6,
        vy: 6,
        points: 5,
        color: '#fff',
        kind: 'fruit',
        bad: false,
        glow: false,
        phase: 0,
        scale: 1
      };
    }
    spawn(cfg) {
      const b = this.free.pop() || this._make();
      for (const k in cfg) b[k] = cfg[k];
      this.active.push(b);
      return b;
    }
    release(b) {
      const i = this.active.indexOf(b);
      if (i >= 0) this.active.splice(i, 1);
      if (this.free.length < 256) this.free.push(b);
    }
    clear() {
      for (const b of this.active) this.free.push(b);
      this.active.length = 0;
    }
  }

  class Catch extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#16203a', bottom: '#05060a' };
    }

    reset() {
      this.pool = new BallPool();
      this.fx = [];
      this.score = 0;
      this.lives = 3;
      this.combo = 0;
      this.bestCombo = 0;
      this.caught = 0;
      this.multiplier = 1;
      this.basketX = 0;
      this.basketW = 2.2;
      this.fallMul = 1;

      this.halfW = 6;
      this.spawnHalf = 5.2;

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._downbeatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.75;
      this.beatCatchFlash = 0;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 6; c.yaw = 0; c.pitch = 0;
    }

    /* Visible half-width of the world at the ball plane (z = BALL_Z). */
    _visibleHalfWidth() {
      const r = this.r;
      const dist = this.r.camera.z - BALL_Z;
      if (r.focal <= 0) return 6;
      return (r.w / 2) * dist / r.focal;
    }

    /* Estimate BPM from the median gap between recent beats. */
    _recordBeat() {
      this._beatTimes.push(this.time);
      if (this._beatTimes.length > 10) this._beatTimes.shift();
      this._beatAgo = 0;
      this._beatPulse = 1;
      if (this._beatTimes.length < 4) return;
      const gaps = [];
      for (let i = 1; i < this._beatTimes.length; i++) {
        gaps.push(this._beatTimes[i] - this._beatTimes[i - 1]);
      }
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      if (median < 0.20 || median > 2.0) return;
      const newBpm = 60 / median;
      this.bpm = this.bpm > 0 ? this.bpm * 0.7 + newBpm * 0.3 : newBpm;
    }

    spawnBall(kind) {
      const t = BALL_TYPES[kind] || BALL_TYPES.fruit;
      const r = U.rand(t.rMin, t.rMax);
      const half = this.spawnHalf;
      return this.pool.spawn({
        x: U.rand(-half, half),
        y: SPAWN_Y + r,
        z: BALL_Z,
        r,
        vy: U.rand(t.vyMin, t.vyMax),
        color: U.pick(t.colors),
        kind,
        bad: t.bad,
        glow: t.glow,
        points: t.points,
        phase: U.rand(0, 6.28),
        scale: 1
      });
    }

    /* Choose a catchable type from the current musical signals. */
    pickCatchable(energy, downbeat, trebleHit, bassRising) {
      if (downbeat && energy > 0.70 && Math.random() < 0.25) return 'golden';
      if (trebleHit && Math.random() < 0.50) return 'shard';
      if (bassRising && energy > 0.45 && Math.random() < 0.30) return 'golden';
      return 'fruit';
    }

    update(dt) {
      this.time += dt;
      const audio = this.audio;
      const drive = audio.drive;
      const playing = audio.isPlaying;
      const energy = this.energy(dt);

      const beatNow    = audio.beat;
      const downbeat   = audio.isDownbeat;
      const barStart   = audio.isBarStart;
      const trebleHit  = audio.trebleBeat;
      const bassRising = audio.bassTrend > 0.4;
      const beatPhase  = audio.beatPhase;
      const bar        = audio.bar;

      this.halfW = this._visibleHalfWidth();
      this.spawnHalf = this.halfW * 0.85;

      this._beatAgo += dt;
      if (beatNow) this._recordBeat();
      this._beatPulse = Math.max(0, this._beatPulse - dt * 2.5);
      if (downbeat) this._downbeatPulse = 1;
      this._downbeatPulse = Math.max(0, this._downbeatPulse - dt * 1.8);
      this.beatCatchFlash = Math.max(0, this.beatCatchFlash - dt * 5);

      this.multiplier = Math.min(16, Math.pow(2, bar % 5));

      const targetSpeed = this.bpm > 0
        ? U.clamp(this.bpm / REF_BPM, 0.45, 2.6)
        : (0.6 + drive * 1.4);
      this.fallMul = U.smooth(this.fallMul, targetSpeed, 0.35, dt);

      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt; f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }

      // ────────── THE GATE ──────────
      if (!playing) return;

      const cap = 28;

      // ── spawn on beat ──
      if (beatNow && this.pool.active.length < cap) {
        const bombChance = 0.12 + energy * 0.30;
        if (Math.random() < bombChance) {
          this.spawnBall('bomb');
        } else {
          this.spawnBall(this.pickCatchable(energy, downbeat, trebleHit, bassRising));
        }
        if (drive > 1.0 && this.pool.active.length < cap) {
          this.spawnBall(Math.random() < bombChance ? 'bomb' : 'fruit');
        }
        if (drive > 1.5 && this.pool.active.length < cap) {
          this.spawnBall(Math.random() < bombChance ? 'bomb' : 'fruit');
        }
      }

      // ── downbeat burst — a fan of fruit ──
      if (downbeat && energy > 0.5) {
        const n = 2 + Math.round(energy * 2);
        for (let i = 0; i < n && this.pool.active.length < cap; i++) {
          this.spawnBall('fruit');
        }
      }

      // ── treble shards ──
      if (trebleHit && this.pool.active.length < cap && Math.random() < 0.5) {
        this.spawnBall('shard');
      }

      // ── golden every 4 bars ──
      if (barStart && bar > 0 && bar % 4 === 0 && this.pool.active.length < cap) {
        this.spawnBall('golden');
      }

      // ── fallback for beatless tracks ──
      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0 && this.pool.active.length < cap) {
          if (Math.random() < 0.15 + energy * 0.25) this.spawnBall('bomb');
          else this.spawnBall('fruit');
          this._fallbackTimer = 0.75;
        }
      } else {
        this._fallbackTimer = 0.75;
      }

      // ── basket follows pointer, clamped to visible range ──
      const targetX = this.input.nx * this.spawnHalf;
      this.basketX = U.smooth(this.basketX, targetX, 0.3, dt);

      // ── fall + collision ──
      const breathing = 1 + 0.18 * Math.sin(beatPhase * Math.PI * 2);
      const balls = this.pool.active;

      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        b.y -= b.vy * this.fallMul * breathing * dt;

        if (beatNow) b.y -= 0.25;

        b.scale = 1 + Math.sin(beatPhase * Math.PI) * 0.10;

        if (b.y <= CATCH_Y + b.r * 0.4 && b.y > CATCH_Y - 1.2) {
          const inBasket = Math.abs(b.x - this.basketX) < this.basketW / 2 + b.r * 0.5;
          if (inBasket) {
            this.pool.release(b);

            if (b.bad) {
              this.combo = 0;
              this.lives--;
              this.fx.push({ x: b.x, y: b.y, r: b.r, life: 0.4, maxLife: 0.4, grow: 10, color: '#ff4d4f' });
              if (this.lives <= 0) { this.die('Caught a bomb ball.'); return; }
              this.shell.toast('Bomb! ' + this.lives + ' lives left', 900);
            } else {
              const phase = this.audio.beatPhase;
              const onBeat = this.bpm > 0 && (phase < 0.06 || phase > 0.94);
              const catchMult = onBeat ? 2 : 1;
              if (onBeat) this.beatCatchFlash = 1;

              this.combo++;
              this.bestCombo = Math.max(this.bestCombo, this.combo);
              this.caught++;
              this.score += b.points * this.combo * this.multiplier * catchMult;
              this.fx.push({
                x: b.x, y: b.y, r: b.r,
                life: 0.28, maxLife: 0.28, grow: 8,
                color: onBeat ? '#fff7d4' : b.color
              });
            }
            continue;
          }
        }

        if (b.y < GROUND_Y - 2) {
          this.pool.release(b);
          if (!b.bad) {
            this.combo = 0;
            this.lives--;
            if (this.lives <= 0) { this.die('Too many dropped balls.'); return; }
            this.shell.toast('Dropped! ' + this.lives + ' lives left', 900);
          }
        }
      }
    }

    /* Cartoon bomb: dark body, red rim, kinked fuse, flickering spark.
       Spark grows and brightens as the bomb nears the catch line. */
    _drawBomb(b, beatGlow) {
      const r = this.r;
      const R = b.r * b.scale;
      const t = this.time;

      // proximity 0 → far, 1 → about to reach the catch line
      const proximity = U.clamp(1 - (b.y - CATCH_Y) / 7, 0, 1);

      // red halo behind the body
      const haloA = U.clamp(0.22 + proximity * 0.40 + this._beatPulse * 0.20, 0, 0.85);
      r.sphere({ x: b.x, y: b.y, z: b.z }, R * 1.28, '#ff4d4f', {
        glow: true, alpha: haloA
      });

      // dark body with a red rim that pulses with proximity
      r.sphere({ x: b.x, y: b.y, z: b.z }, R, '#0e0e12', {
        glow: false,
        ring: '#ff4d4f',
        ringWidth: 2,
        ringAlpha: 0.75 + proximity * 0.25
      });

      // fuse — two short segments with a small kink, jittering in time
      const jx = Math.sin(t * 22 + b.phase) * R * 0.10;
      const jy = Math.cos(t * 26 + b.phase) * R * 0.05;
      const base = { x: b.x + R * 0.30, y: b.y + R * 0.92, z: b.z };
      const mid  = { x: b.x + R * 0.55 + jx * 0.5, y: b.y + R * 1.28, z: b.z };
      const tip  = { x: b.x + R * 0.60 + jx,       y: b.y + R * 1.70 + jy, z: b.z };
      r.line(base, mid, '#8a6a3a', 2, 1);
      r.line(mid,  tip, '#8a6a3a', 2, 1);

      // spark at the tip — flickering ember, brighter as it nears the basket
      const sparkR = R * (0.15 + 0.04 * Math.sin(t * 34 + b.phase) + proximity * 0.08);
      const sparkA = U.clamp(0.7 + 0.3 * Math.sin(t * 40 + b.phase) + proximity * 0.2, 0, 1);
      r.sphere(tip, sparkR * 1.6, '#ff9a3a', { glow: true, alpha: sparkA * 0.7 });
      r.sphere(tip, sparkR,       '#fff3a0', { glow: true, alpha: sparkA });
      r.sphere(tip, sparkR * 0.5, '#ffffff', { glow: true, alpha: sparkA });

      // white flash on the beat so bombs punch visually
      if (beatGlow) {
        r.sphere({ x: b.x, y: b.y, z: b.z }, R * 1.02, '#ffffff', {
          glow: true, alpha: 0.16
        });
      }
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#2b3f66', 0.22);

      if (this._downbeatPulse > 0) {
        const a = (this._downbeatPulse * 0.16).toFixed(3);
        r.rect(0, 0, r.w, r.h, 'rgba(47,140,255,' + a + ')');
      }

      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.40).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(123,211,137,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(123,211,137,' + a + ')');
      }

      if (this.beatCatchFlash > 0) {
        const a = (this.beatCatchFlash * 0.12).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(255,240,150,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(255,240,150,' + a + ')');
      }

      const lineAlpha = 0.3 + this._beatPulse * 0.5;
      const lineHalf = this.spawnHalf;
      r.line({ x: -lineHalf, y: CATCH_Y, z: BALL_Z }, { x: lineHalf, y: CATCH_Y, z: BALL_Z },
        '#5b7fbf', 1 + this._beatPulse * 1.5, lineAlpha);

      const beatGlow = this._beatPulse > 0.5;

      // balls — bombs get the cartoon treatment
      for (const b of this.pool.active) {
        if (b.bad) {
          this._drawBomb(b, beatGlow);
        } else {
          r.sphere({ x: b.x, y: b.y, z: b.z }, b.r * b.scale, b.color, {
            glow: b.glow || beatGlow
          });
        }
      }

      const segs = 7;
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1);
        const off = (t - 0.5) * this.basketW;
        const sag = Math.cos((t - 0.5) * Math.PI) * 0.34;
        r.sphere({ x: this.basketX + off, y: CATCH_Y - 0.35 + sag, z: BALL_Z }, 0.3, '#ffd166', { glow: true });
      }

      for (const f of this.fx) {
        r.ring({ x: f.x, y: f.y, z: BALL_Z }, f.r, f.color, 3, f.life / f.maxLife);
      }

      if (this.combo > 1) r.text(r.w / 2, 40, 'COMBO x' + this.combo, '#7bd389', 24, 'center', 900);

      const bpmText = this.bpm > 0
        ? '♪ ' + Math.round(this.bpm) + ' BPM  ×' + this.fallMul.toFixed(2)
        : '♪ listening…';
      r.text(r.w - 20, 90, bpmText, '#7bd389', 13, 'right', 700);
      if (this.multiplier > 1) {
        r.text(r.w - 20, 110, '×' + this.multiplier + ' score', '#7bd389', 13, 'right', 700);
      }
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };

      let targetX = null, bestT = Infinity;
      let bombX = null, bombT = Infinity;

      for (const b of this.pool.active) {
        const t = (b.y - CATCH_Y) / Math.max(0.5, b.vy * this.fallMul);
        if (b.bad) {
          if (t < bombT) { bombT = t; bombX = b.x; }
        } else if (t < bestT) {
          bestT = t; targetX = b.x;
        }
      }

      let tx = targetX === null ? this.basketX * 0.7 : targetX;
      if (bombX !== null && bombT < 0.55 && Math.abs(bombX - tx) < 2.2) {
        tx = bombX > 0 ? bombX - 4.5 : bombX + 4.5;
      }
      return { x: U.clamp(tx / this.spawnHalf, -1, 1), y: 0, fire: false };
    }

    getStats() {
      return [
        { k: 'Score', v: this.score },
        { k: 'Caught', v: this.caught },
        { k: 'Combo', v: 'x' + Math.max(1, this.combo) },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Multiplier', v: '×' + this.multiplier },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'catch',
    name: 'Ball Catch',
    tag: 'Reflex',
    color: '#7bd389',
    blurb: 'Balls fall on the beat at the tempo of your track. Downbeats shower fruit, treble drops fast shards, bass builds spawn goldens.',
    hint: 'Move the basket with the mouse · dodge the lit bombs · catch on the beat for double points',
    create: (shell) => new Catch(shell)
  });
})();