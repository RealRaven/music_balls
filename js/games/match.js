/* ============================================================
   match.js — BALL MATCH (full musical reactivity)
   Spheres fly in on beats at the tempo of your track. Shoot
   only the announced colour. Target changes every bar;
   downbeats drop a bonus target ball; treble adds fast shards;
   bass build-ups send slow heavies. On-beat shots pay double.
   The whole 3D view banks and sways with the music — applied by
   wrapping the renderer's toScreen() locally, so no renderer
   changes are needed. HUD stays flat. No music = no balls.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const PALETTE = [
    { name: 'RED',    hex: '#ff4d4f' },
    { name: 'BLUE',   hex: '#4cc9f0' },
    { name: 'GREEN',  hex: '#7bd389' },
    { name: 'VIOLET', hex: '#a78bfa' },
    { name: 'AMBER',  hex: '#ffd166' }
  ];
  const REF_BPM     = 120;
  const BASE_SPEED  = 15;
  const TARGET_BARS = 1;

  /* ---------- ball type table ---------- */
  const BALL_TYPES = {
    normal: {
      rMin: 0.60, rMax: 1.25,
      speedMul: 1.00,
      points: 25,
      glow: false
    },
    heavy: {
      rMin: 1.50, rMax: 2.10,
      speedMul: 0.55,
      points: 60,
      glow: true
    },
    shard: {
      rMin: 0.35, rMax: 0.55,
      speedMul: 1.80,
      points: 15,
      glow: false
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
        x: 0, y: 0, z: 0, r: 0.9,
        speedMul: 1,
        color: '#fff',
        index: 0,
        kind: 'normal',
        points: 25,
        glow: false,
        flash: 0,
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

  class Match extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#101a2c', bottom: '#05060a' };
    }

    reset() {
      // Install the roll-aware toScreen wrapper exactly once per renderer.
      // From now on, every projected world point is rotated around the
      // screen centre by renderer.roll before drawing.
      const r = this.r;
      if (!r.__rollPatched) {
        const orig = r.toScreen.bind(r);
        r.toScreen = function (v) {
          const s = orig(v);
          if (this.roll) {
            const c  = Math.cos(this.roll);
            const sn = Math.sin(this.roll);
            const dx = s.x - this.cx;
            const dy = s.y - this.cy;
            s.x = this.cx + dx * c - dy * sn;
            s.y = this.cy + dx * sn + dy * c;
          }
          return s;
        };
        r.__rollPatched = true;
      }
      r.roll = 0;

      this.pool = new BallPool();
      this.fx = [];
      this.score = 0;
      this.lives = 3;
      this.combo = 0;
      this.bestCombo = 0;
      this.hits = 0;
      this.speedMul = 1;
      this.multiplier = 1;
      this.lastShot = -10;
      this.beatShotFlash = 0;

      this.targetIndex = U.randInt(0, PALETTE.length - 1);
      this._targetBar = 0;

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._downbeatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.75;
      this._targetFallbackTimer = 6;

      this.rollPhase = 0;
      this.roll = 0;
      this.rollAmp = 0;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 5; c.yaw = 0; c.pitch = 0;
    }

    /* Clear the roll when we leave the game, so other games don't inherit it. */
    stop()    { this.r.roll = 0; this.roll = 0; this.rollAmp = 0; }
    destroy() { this.stop(); }

    get target() { return PALETTE[this.targetIndex]; }

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

    spawnBall(kind, forceTarget) {
      const t = BALL_TYPES[kind] || BALL_TYPES.normal;
      const idx = forceTarget ? this.targetIndex : U.randInt(0, PALETTE.length - 1);
      const c = PALETTE[idx];
      const r = U.rand(t.rMin, t.rMax);
      return this.pool.spawn({
        x: U.rand(-9, 9),
        y: U.rand(-0.6, 5.0),
        z: U.rand(-175, -140),
        r,
        speedMul: t.speedMul,
        color: c.hex,
        index: idx,
        kind,
        points: t.points,
        glow: t.glow,
        flash: 0,
        phase: U.rand(0, 6.28),
        scale: 1
      });
    }

    pickType(energy, bassRising, trebleHit) {
      if (bassRising && energy > 0.5 && Math.random() < 0.30) return 'heavy';
      if (trebleHit && Math.random() < 0.45) return 'shard';
      return 'normal';
    }

    pickNewTarget() {
      let idx = this.targetIndex;
      while (idx === this.targetIndex) idx = U.randInt(0, PALETTE.length - 1);
      this.targetIndex = idx;
      this._targetBar = 0;
      this._targetFallbackTimer = 6;
      this.shell.toast('New target: ' + this.target.name, 1200);
    }

    /* Un-rotate the mouse position around screen centre so that
       aimRay() still points at the visually-hovered ball while the
       view is banked. */
    aimScreen() {
      const s = super.aimScreen();
      if (!this.roll) return s;
      const r = this.r;
      const c  = Math.cos(this.roll);
      const sn = Math.sin(this.roll);
      const dx = s.x - r.cx;
      const dy = s.y - r.cy;
      return {
        x:  r.cx + dx * c + dy * sn,
        y:  r.cy - dx * sn + dy * c
      };
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

      this._beatAgo += dt;
      if (beatNow) this._recordBeat();
      this._beatPulse = Math.max(0, this._beatPulse - dt * 2.5);
      if (downbeat) this._downbeatPulse = 1;
      this._downbeatPulse = Math.max(0, this._downbeatPulse - dt * 1.8);
      this.beatShotFlash = Math.max(0, this.beatShotFlash - dt * 6);

      this.multiplier = Math.min(16, Math.pow(2, bar % 5));

      const targetSpeed = this.bpm > 0
        ? U.clamp(this.bpm / REF_BPM, 0.45, 2.6)
        : (0.6 + drive * 1.4);
      this.speedMul = U.smooth(this.speedMul, targetSpeed, 0.35, dt);

      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt; f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }

      // ────────── THE GATE ──────────
      if (!playing) {
        // ease the bank back to level while silent
        this.rollAmp = U.smooth(this.rollAmp, 0, 0.15, dt);
        this.roll = Math.sin(this.rollPhase) * this.rollAmp;
        this.r.roll = this.roll;
        return;
      }

      const cap = 24;

      // ── spawn on beat ──
      if (beatNow && this.pool.active.length < cap) {
        const kind = this.pickType(energy, bassRising, trebleHit);
        this.spawnBall(kind, false);
        if (drive > 1.0 && this.pool.active.length < cap) this.spawnBall('normal', false);
        if (drive > 1.5 && this.pool.active.length < cap) this.spawnBall('normal', false);
      }

      // ── downbeat: one guaranteed target ball ──
      if (downbeat && this.pool.active.length < cap) {
        this.spawnBall('normal', true);
      }

      // ── bar start: burst of 3 target balls ──
      if (barStart && bar > 0 && this.pool.active.length + 3 <= cap) {
        for (let i = 0; i < 3; i++) this.spawnBall('normal', true);
      }

      // ── treble shards ──
      if (trebleHit && this.pool.active.length < cap && Math.random() < 0.35) {
        this.spawnBall('shard', false);
      }

      // ── fallback for beatless tracks ──
      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0 && this.pool.active.length < cap) {
          this.spawnBall('normal', false);
          this._fallbackTimer = 0.75;
        }
      } else {
        this._fallbackTimer = 0.75;
      }

      // ── target change on bar start ──
      if (barStart) {
        this._targetBar++;
        if (this._targetBar >= TARGET_BARS) this.pickNewTarget();
      } else if (this._beatAgo > 1.2) {
        this._targetFallbackTimer -= dt;
        if (this._targetFallbackTimer <= 0) this.pickNewTarget();
      }

      // ── camera roll — the view banks and sways with the music ──
      const spinRate = 0.45 + energy * 1.5 + this.speedMul * 0.20;
      this.rollPhase += spinRate * dt;

      const targetAmp = 0.06 + energy * 0.24 + this._beatPulse * 0.05;
      this.rollAmp = U.smooth(this.rollAmp, targetAmp, 0.20, dt);
      this.roll = Math.sin(this.rollPhase) * this.rollAmp;

      // publish to renderer — the toScreen wrapper reads this each frame
      this.r.roll = this.roll;

      // ── ball movement ──
      const breathing = 1 + 0.16 * Math.sin(beatPhase * Math.PI * 2);
      const mul = this.speedMul * (1 + Math.min(1.2, this.hits / 25)) * breathing;
      const balls = this.pool.active;

      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        b.z += BASE_SPEED * b.speedMul * mul * dt;

        if (beatNow) b.z += 0.5;

        b.scale = 1 + Math.sin(beatPhase * Math.PI) * 0.08;

        b.flash = Math.max(0, b.flash - dt * 4);

        if (b.z > this.r.camera.z - 1.2) {
          this.pool.release(b);
          if (b.index === this.targetIndex) {
            this.combo = 0;
            this.loseLife();
            this.shell.toast('A ' + PALETTE[b.index].name + ' ball got through!', 1100);
            if (this.over) return;
          }
        }
      }

      if (this.input.firing) this.shoot();
    }

    shoot() {
      if (this.time - this.lastShot < 0.22) return;
      this.lastShot = this.time;

      const ray = this.aimRay();
      let best = null, bestT = Infinity;
      for (const b of this.pool.active) {
        const t = U.raySphere(ray.origin, ray.dir, b, b.r);
        if (t !== null && t < bestT) { bestT = t; best = b; }
      }
      if (!best) return;

      this.pool.release(best);

      if (best.index === this.targetIndex) {
        const phase = this.audio.beatPhase;
        const onBeat = this.bpm > 0 && (phase < 0.06 || phase > 0.94);
        const beatMul = onBeat ? 2 : 1;
        if (onBeat) this.beatShotFlash = 1;

        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.hits++;
        const comboMul = Math.max(1, this.combo);
        this.score += best.points * comboMul * this.multiplier * beatMul;

        this.fx.push({
          p: { x: best.x, y: best.y, z: best.z }, r: best.r,
          life: 0.3, maxLife: 0.3, grow: 8,
          color: onBeat ? '#fff7d4' : best.color
        });
      } else {
        this.combo = 0;
        this.score = Math.max(0, this.score - 20);
        this.fx.push({
          p: { x: best.x, y: best.y, z: best.z }, r: best.r,
          life: 0.3, maxLife: 0.3, grow: 8, color: '#ff4d4f'
        });
        this.shell.toast('Wrong colour — that was ' + PALETTE[best.index].name, 900);
      }
    }

    draw() {
      const r = this.r;

      // Rotated by the toScreen wrapper — nothing special to do here.
      r.grid(-1.5, 90, 5, '#2b3f66', 0.22);

      const beatGlow = this._beatPulse > 0.5;
      for (const b of this.pool.active) {
        const isTarget = b.index === this.targetIndex;
        r.sphere({ x: b.x, y: b.y, z: b.z }, b.r * b.scale, b.color, {
          glow: isTarget || b.glow || beatGlow,
          ring: isTarget ? '#ffffff' : null,
          ringAlpha: 0.45 + this._beatPulse * 0.35,
          ringWidth: 2
        });
      }

      for (const f of this.fx) {
        r.ring(f.p, f.r, f.color, 3, f.life / f.maxLife);
      }

      // ── HUD / overlays (un-rotated — drawn via raw screen coords) ──

      if (this._downbeatPulse > 0) {
        const a = (this._downbeatPulse * 0.14).toFixed(3);
        r.rect(0, 0, r.w, r.h, 'rgba(167,139,250,' + a + ')');
      }

      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.35).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(167,139,250,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(167,139,250,' + a + ')');
      }

      if (this.beatShotFlash > 0) {
        const a = (this.beatShotFlash * 0.12).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(255,240,150,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(255,240,150,' + a + ')');
      }

      const cx = r.w / 2;
      r.rect(cx - 118, 20, 236, 46, 'rgba(0,0,0,.5)', 12);
      r.text(cx, 43, 'TARGET: ' + this.target.name, this.target.hex, 22, 'center', 900);

      const pw = 236 * (1 - this._targetBar / TARGET_BARS);
      r.rect(cx - 118 + 4, 60, Math.max(0, pw - 8), 3, this.target.hex, 2);

      if (this.combo > 1) {
        r.text(cx, 92, 'COMBO x' + this.combo, '#ffffff', 16, 'center', 800);
      }
      if (this.multiplier > 1) {
        r.text(cx, 112, '×' + this.multiplier + ' score', '#a78bfa', 13, 'center', 700);
      }

      const bpmText = this.bpm > 0
        ? '♪ ' + Math.round(this.bpm) + ' BPM  ×' + this.speedMul.toFixed(2)
        : '♪ listening…';
      r.text(r.w - 20, 130, bpmText, '#a78bfa', 13, 'right', 700);

      const deg = (this.roll * 180 / Math.PI).toFixed(1);
      r.text(r.w - 20, 150, '↻ bank ' + deg + '°', '#a78bfa', 12, 'right', 700);
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };

      let target = null, best = Infinity;
      for (const b of this.pool.active) {
        if (b.index !== this.targetIndex) continue;
        if (b.z > best) continue;
        best = b.z;
        target = b;
      }
      if (!target) return { x: 0, y: 0, fire: false };
      return this.aimAt({ x: target.x, y: target.y, z: target.z }, true);
    }

    getStats() {
      return [
        { k: 'Score', v: this.score },
        { k: 'Target', v: this.target.name },
        { k: 'Matches', v: this.hits },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Multiplier', v: '×' + this.multiplier },
        { k: 'Bank', v: (this.roll * 180 / Math.PI).toFixed(0) + '°' },
        { k: 'Combo', v: 'x' + Math.max(1, this.combo) },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'match',
    name: 'Ball Match',
    tag: 'Colour',
    color: '#a78bfa',
    blurb: 'Spheres fly in on the beat at the tempo of your track. Shoot only the announced colour. Target changes every bar.',
    hint: 'Aim and click · target balls glow white · on-beat shots pay double · the view banks with the beat',
    create: (shell) => new Match(shell)
  });
})();