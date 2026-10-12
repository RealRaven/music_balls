/* ============================================================
   dodge.js — BALL DODGE (full musical reactivity)
   Spheres stream in on beats at the tempo of your track.
   Downbeats send clusters, treble drops fast shards, bass
   build-ups spawn slow heavies. On-beat grazes pay double.
   No music = nothing moves.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const REF_BPM  = 120;
  const BASE_SPEED = 24;
  const SPAWN_Z  = -160;

  /* ---------- ball type table ---------- */
  const BALL_TYPES = {
    drift: {
      rMin: 0.45, rMax: 1.10,
      speedMul: 1.00,
      colors: ['#ff6b6b', '#ffd166', '#c77dff', '#4cc9f0'],
      glow: true,
      grazeValue: 25
    },
    shard: {
      rMin: 0.30, rMax: 0.55,
      speedMul: 1.85,
      colors: ['#4cc9f0'],
      glow: true,
      grazeValue: 40
    },
    blob: {
      rMin: 1.30, rMax: 2.00,
      speedMul: 0.65,
      colors: ['#7bd389'],
      glow: true,
      grazeValue: 35
    },
    heavy: {
      rMin: 2.40, rMax: 3.40,
      speedMul: 0.45,
      colors: ['#a78bfa'],
      glow: true,
      grazeValue: 60
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
        speed: 24,
        color: '#fff',
        kind: 'drift',
        glow: true,
        grazed: false,
        grazeValue: 25,
        phase: 0,
        scale: 1,
        cluster: false
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

  class Dodge extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#1a1030', bottom: '#05060a' };
    }

    reset() {
      this.pool = new BallPool();
      this.fx = [];
      this.score = 0;
      this.lives = 3;
      this.survived = 0;
      this.speedMul = 1;
      this.invuln = 0;
      this.px = 0; this.py = 1.6;
      this.vx = 0; this.vy = 0;
      this.grazeCool = 0;
      this.grazeBonus = 0;
      this.multiplier = 1;

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._downbeatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.75;
      this.beatGrazeFlash = 0;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 6; c.yaw = 0; c.pitch = 0;
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

    spawnBall(kind, overrides) {
      const t = BALL_TYPES[kind] || BALL_TYPES.drift;
      const r = U.rand(t.rMin, t.rMax);
      const cfg = {
        x: U.rand(-10, 10),
        y: U.rand(-1.2, 6.5),
        z: SPAWN_Z + U.rand(0, 30),
        r,
        speed: BASE_SPEED * t.speedMul,
        color: U.pick(t.colors),
        kind,
        glow: t.glow,
        grazed: false,
        grazeValue: t.grazeValue,
        phase: U.rand(0, 6.28),
        scale: 1,
        cluster: false
      };
      if (overrides) for (const k in overrides) cfg[k] = overrides[k];
      return this.pool.spawn(cfg);
    }

    /* Pick a ball type from musical signals. */
    pickType(energy, downbeat, trebleHit, bassRising) {
      if (bassRising && energy > 0.55 && Math.random() < 0.35) return 'heavy';
      if (trebleHit && Math.random() < 0.55) return 'shard';
      if (energy > 0.75 && Math.random() < 0.25) return 'blob';
      return 'drift';
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
      this.beatGrazeFlash = Math.max(0, this.beatGrazeFlash - dt * 5);

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
      if (!playing) return;

      const cap = 30;

      // ── spawn on beat ──
      if (beatNow && this.pool.active.length < cap) {
        const kind = this.pickType(energy, downbeat, trebleHit, bassRising);
        this.spawnBall(kind);
        if (drive > 1.0 && this.pool.active.length < cap) this.spawnBall('drift');
        if (drive > 1.6 && this.pool.active.length < cap) this.spawnBall('drift');
      }

      // ── downbeat cluster ──
      if (downbeat && energy > 0.5) {
        const n = 2 + Math.round(energy * 2);
        const cx = U.rand(-8, 8);
        const cy = U.rand(-0.8, 5.8);
        const cz = SPAWN_Z + U.rand(0, 15);
        for (let i = 0; i < n && this.pool.active.length < cap; i++) {
          this.spawnBall('drift', {
            x: cx + U.rand(-2.2, 2.2),
            y: cy + U.rand(-1.2, 1.2),
            z: cz + U.rand(-4, 4),
            cluster: true
          });
        }
      }

      // ── treble shards ──
      if (trebleHit && this.pool.active.length < cap && Math.random() < 0.5) {
        this.spawnBall('shard');
      }

      // ── heavy every 4 bars ──
      if (barStart && bar > 0 && bar % 4 === 0 && this.pool.active.length < cap) {
        this.spawnBall('heavy');
      }

      // ── fallback for beatless tracks ──
      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0 && this.pool.active.length < cap) {
          this.spawnBall('drift');
          this._fallbackTimer = 0.75;
        }
      } else {
        this._fallbackTimer = 0.75;
      }

      // ── player follows pointer with inertia ──
      const tx = this.input.nx * 9;
      const ty = 1.6 + this.input.ny * 3.4;
      this.vx = U.smooth(this.vx, (tx - this.px) * 9, 0.25, dt);
      this.vy = U.smooth(this.vy, (ty - this.py) * 9, 0.25, dt);
      this.px += this.vx * dt;
      this.py += this.vy * dt;

      this.survived += dt;
      this.score = Math.floor(this.survived * 12 * this.multiplier) + this.grazeBonus;

      if (this.invuln > 0) this.invuln -= dt;
      this.grazeCool = Math.max(0, this.grazeCool - dt);

      // ── ball movement ──
      const breathing = 1 + 0.18 * Math.sin(beatPhase * Math.PI * 2);
      const killRamp = 1 + Math.min(0.6, this.survived / 60);
      const balls = this.pool.active;

      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        b.z += b.speed * this.speedMul * killRamp * breathing * dt;

        // beat pop — shove forward on the beat
        if (beatNow) b.z += 0.6;

        // scale pulse between beats
        b.scale = 1 + Math.sin(beatPhase * Math.PI) * 0.08;

        const dx = b.x - this.px, dy = b.y - this.py;
        const d = Math.hypot(dx, dy);

        // collision
        if (d < b.r + 0.75 && this.invuln <= 0) {
          this.lives--;
          this.invuln = 1.6;
          this.fx.push({
            p: { x: b.x, y: b.y, z: b.z }, r: b.r,
            life: 0.4, maxLife: 0.4, grow: 8, color: '#ff5b5b'
          });
          this.pool.release(b);
          if (this.lives <= 0) {
            this.die('Clipped by a sphere after ' + this.survived.toFixed(1) + 's');
            return;
          }
          this.shell.toast('Hit! ' + this.lives + ' lives left', 1000);
          continue;
        }

        // graze — pass close by without touching
        if (!b.grazed && d < b.r + 1.9 && b.z > -8 && this.grazeCool <= 0) {
          b.grazed = true;

          // on-beat grazes pay double
          const phase = this.audio.beatPhase;
          const onBeat = this.bpm > 0 && (phase < 0.06 || phase > 0.94);
          const gain = b.grazeValue * (onBeat ? 2 : 1);

          this.grazeBonus += gain;
          this.grazeCool = 0.25;
          if (onBeat) this.beatGrazeFlash = 1;

          this.fx.push({
            p: { x: b.x, y: b.y, z: b.z }, r: b.r,
            life: 0.25, maxLife: 0.25, grow: 5,
            color: onBeat ? '#fff7d4' : '#7bd389'
          });
        }

        // despawn behind the camera
        if (b.z > this.r.camera.z + 3) this.pool.release(b);
      }
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#463a7a', 0.22);

      // downbeat wash
      if (this._downbeatPulse > 0) {
        const a = (this._downbeatPulse * 0.14).toFixed(3);
        r.rect(0, 0, r.w, r.h, 'rgba(167,139,250,' + a + ')');
      }

      // beat pulse edges
      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.4).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(199,125,255,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(199,125,255,' + a + ')');
      }

      // on-beat graze flash
      if (this.beatGrazeFlash > 0) {
        const a = (this.beatGrazeFlash * 0.12).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(255,240,150,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(255,240,150,' + a + ')');
      }

      // balls — pulse their glow on the beat
      const beatGlow = this._beatPulse > 0.5;
      for (const b of this.pool.active) {
        r.sphere({ x: b.x, y: b.y, z: b.z }, b.r * b.scale, b.color, {
          glow: b.glow || beatGlow,
          ring: b.cluster ? '#ffffff' : null,
          ringAlpha: b.cluster ? 0.35 : 0
        });
      }

      // player — pulses with beat too
      const blink = this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0;
      if (!blink) {
        const playerScale = 1 + this._beatPulse * 0.15;
        r.sphere({ x: this.px, y: this.py, z: 0 }, 0.75 * playerScale, '#ffffff', {
          glow: true,
          ring: '#2f8cff',
          ringWidth: 3 + this._beatPulse * 2
        });
      }
      if (this.invuln > 0) {
        r.ring({ x: this.px, y: this.py, z: 0 }, 1.35, '#9fc6ff', 2, this.invuln / 1.6);
      }

      for (const f of this.fx) {
        r.ring(f.p, f.r, f.color, 3, f.life / f.maxLife);
      }

      // HUD
      r.text(r.w / 2, 34, this.survived.toFixed(1) + 's', '#ffffff', 22, 'center', 800);
      if (this.multiplier > 1) {
        r.text(r.w / 2, 60, '×' + this.multiplier + ' score', '#c77dff', 14, 'center', 700);
      }

      const bpmText = this.bpm > 0
        ? '♪ ' + Math.round(this.bpm) + ' BPM  ×' + this.speedMul.toFixed(2)
        : '♪ listening…';
      r.text(r.w - 20, 90, bpmText, '#c77dff', 13, 'right', 700);
    }

    ai(dt) {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };

      // Project each ball to its closest-approach point, weighted by
      // how soon it arrives and how big it is. Move away from the
      // weighted danger centroid.
      let dangerX = 0, dangerY = 0, danger = 0;
      for (const b of this.pool.active) {
        if (b.z > -3) continue;
        const t = -b.z / Math.max(1, b.speed * this.speedMul);
        if (t > 3.5) continue;
        const w = (1 / (t + 0.35)) * (0.5 + b.r);
        dangerX += b.x * w;
        dangerY += b.y * w;
        danger += w;
      }

      let tx = 0, ty = 1.6;
      if (danger > 0) {
        tx = this.px - (dangerX / danger - this.px) * 1.6;
        ty = this.py - (dangerY / danger - this.py) * 1.6;
      } else {
        tx = this.px * 0.6;
        ty = 1.6 + this.py * 0.3;
      }

      tx = U.clamp(tx, -9, 9);
      ty = U.clamp(ty, -1.8, 5.0);
      return { x: tx / 9, y: (ty - 1.6) / 3.4, fire: false };
    }

    getStats() {
      return [
        { k: 'Score', v: this.score },
        { k: 'Survived', v: this.survived.toFixed(1) + 's' },
        { k: 'Lives', v: this.lives },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Multiplier', v: '×' + this.multiplier },
        { k: 'Graze bonus', v: this.grazeBonus }
      ];
    }
  }

  Arcade.register({
    id: 'dodge',
    name: 'Ball Dodge',
    tag: 'Survival',
    color: '#c77dff',
    blurb: 'Spheres stream in on the beat. Downbeats send clusters, treble drops shards, bass build-ups spawn slow heavies.',
    hint: 'Move with the mouse · graze close for bonus points · on-beat grazes pay double',
    create: (shell) => new Dodge(shell)
  });
})();