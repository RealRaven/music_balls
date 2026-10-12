/* ============================================================
   rally.js — BALL RALLY (full musical reactivity)
   Ball speed locked to the tempo. Orbs spawn on beats; downbeats
   burst, treble drops fast shards, bass build-ups spawn slow
   goldens worth 150. On-beat returns pay double. No music = no rally.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const PADDLE_Z = 0;
  const WALL_Z   = -62;
  const REF_BPM  = 120;

  /* ---------- orb type table ---------- */
  const ORB_TYPES = {
    bonus: {
      rMin: 0.42, rMax: 0.55,
      speedMul: 1.0,
      points: 75,
      color: '#a78bfa',
      life: 6,
      glow: true
    },
    shard: {
      rMin: 0.28, rMax: 0.40,
      speedMul: 2.2,
      points: 40,
      color: '#4cc9f0',
      life: 4,
      glow: false
    },
    golden: {
      rMin: 0.55, rMax: 0.75,
      speedMul: 0.6,
      points: 150,
      color: '#ffd166',
      life: 8,
      glow: true
    }
  };

  /* ---------- object pool for orbs ---------- */
  class OrbPool {
    constructor() {
      this.free = [];
      this.active = [];
    }
    _make() {
      return {
        x: 0, y: 0, z: 0, r: 0.45,
        vx: 0, vy: 0,
        life: 6,
        color: '#a78bfa',
        kind: 'bonus',
        points: 75,
        glow: true,
        phase: 0,
        scale: 1
      };
    }
    spawn(cfg) {
      const o = this.free.pop() || this._make();
      for (const k in cfg) o[k] = cfg[k];
      this.active.push(o);
      return o;
    }
    release(o) {
      const i = this.active.indexOf(o);
      if (i >= 0) this.active.splice(i, 1);
      if (this.free.length < 128) this.free.push(o);
    }
    clear() {
      for (const o of this.active) this.free.push(o);
      this.active.length = 0;
    }
  }

  class Rally extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#0d2320', bottom: '#05060a' };
    }

    reset() {
      this.pool = new OrbPool();
      this.score = 0;
      this.lives = 3;
      this.rally = 0;
      this.best = 0;
      this.multiplier = 1;
      this.px = 0; this.py = 1.6;
      this.speedMul = 1;
      this.fx = [];
      this.lastPx = 0;
      this.paddleVX = 0;
      this.serveBall();

      // clear any camera roll left over from previous games
      this.r.roll = 0;

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._downbeatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.75;
      this.beatReturnFlash = 0;

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

    serveBall() {
      this.ball = {
        x: U.rand(-3, 3),
        y: U.rand(0.2, 3),
        z: WALL_Z + 2,
        vx: U.rand(-4, 4),
        vy: U.rand(-1, 2),
        vz: 16,
        r: 0.75,
        color: '#4cc9f0',
        trail: []
      };
      this.rally = 0;
    }

    spawnOrb(kind) {
      const t = ORB_TYPES[kind] || ORB_TYPES.bonus;
      const r = U.rand(t.rMin, t.rMax);
      return this.pool.spawn({
        x: U.rand(-8.5, 8.5),
        y: U.rand(-0.8, 5.4),
        z: U.rand(WALL_Z + 6, -12),
        r,
        vx: U.rand(-3, 3) * t.speedMul,
        vy: U.rand(-2, 2) * t.speedMul,
        life: t.life,
        color: t.color,
        kind,
        points: t.points,
        glow: t.glow,
        phase: U.rand(0, 6.28),
        scale: 1
      });
    }

    /* Choose an orb type from the current musical signals. */
    pickOrbType(energy, bassRising, trebleHit) {
      if (bassRising && energy > 0.55 && Math.random() < 0.40) return 'golden';
      if (trebleHit && Math.random() < 0.50) return 'shard';
      return 'bonus';
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
      this.beatReturnFlash = Math.max(0, this.beatReturnFlash - dt * 5);

      // score multiplier cycles 1, 2, 4, 8, 16 with the bar
      this.multiplier = Math.min(16, Math.pow(2, bar % 5));

      // speed from tempo
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

      // ── spawn orbs on beat ──
      const orbCap = 14;
      if (beatNow && this.pool.active.length < orbCap) {
        const kind = this.pickOrbType(energy, bassRising, trebleHit);
        this.spawnOrb(kind);
        if (drive > 1.0 && this.pool.active.length < orbCap) this.spawnOrb('bonus');
        if (drive > 1.5 && this.pool.active.length < orbCap) this.spawnOrb('bonus');
      }

      // ── downbeat burst ──
      if (downbeat && energy > 0.5) {
        const n = 2 + Math.round(energy * 2);
        for (let i = 0; i < n && this.pool.active.length < orbCap; i++) {
          this.spawnOrb('bonus');
        }
      }

      // ── treble shards ──
      if (trebleHit && this.pool.active.length < orbCap && Math.random() < 0.5) {
        this.spawnOrb('shard');
      }

      // ── golden every 4 bars ──
      if (barStart && bar > 0 && bar % 4 === 0 && this.pool.active.length < orbCap) {
        this.spawnOrb('golden');
      }

      // ── fallback for beatless tracks ──
      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0 && this.pool.active.length < orbCap) {
          this.spawnOrb('bonus');
          this._fallbackTimer = 0.75;
        }
      } else {
        this._fallbackTimer = 0.75;
      }

      // ── orb motion + ball collision ──
      const breathingOrb = 1 + 0.16 * Math.sin(beatPhase * Math.PI * 2);
      const orbs = this.pool.active;
      for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i];
        o.life -= dt;
        o.x += o.vx * breathingOrb * dt;
        o.y += o.vy * breathingOrb * dt;
        if (o.x < -9.5 || o.x > 9.5) { o.vx *= -1; o.x = U.clamp(o.x, -9.5, 9.5); }
        if (o.y < -1.2 || o.y > 5.6) { o.vy *= -1; o.y = U.clamp(o.y, -1.2, 5.6); }

        // beat phase scale pulse
        o.scale = 1 + Math.sin(beatPhase * Math.PI) * 0.10;

        const b0 = this.ball;
        const dx = o.x - b0.x, dy = o.y - b0.y, dz = o.z - b0.z;
        const rr = o.r + b0.r + 0.4;
        if (dx * dx + dy * dy + dz * dz < rr * rr) {
          this.score += o.points * this.multiplier;
          this.fx.push({
            x: o.x, y: o.y, z: o.z, r: o.r,
            life: 0.4, maxLife: 0.4, grow: 8,
            color: o.color
          });
          this.pool.release(o);
          continue;
        }
        if (o.life <= 0) this.pool.release(o);
      }

      // ── paddle follows the pointer ──
      this.lastPx = this.px;
      this.px = U.smooth(this.px, this.input.nx * 8.5, 0.32, dt);
      this.py = U.smooth(this.py, 1.6 + this.input.ny * 3.2, 0.32, dt);
      this.paddleVX = (this.px - this.lastPx) / Math.max(dt, 0.0001);

      // ── ball motion (breathing with beat phase) ──
      const b = this.ball;
      const breathingBall = 1 + 0.10 * Math.sin(beatPhase * Math.PI * 2);
      const sp = this.speedMul * (1 + Math.min(1.2, this.rally / 12)) * breathingBall;

      b.trail.push({ x: b.x, y: b.y, z: b.z });
      if (b.trail.length > 14) b.trail.shift();

      b.x += b.vx * sp * dt;
      b.y += b.vy * sp * dt;
      b.z += b.vz * sp * dt;

      if (b.x < -9.5) { b.x = -9.5; b.vx = Math.abs(b.vx); }
      if (b.x > 9.5)  { b.x = 9.5;  b.vx = -Math.abs(b.vx); }
      if (b.y < -1.2) { b.y = -1.2; b.vy = Math.abs(b.vy); }
      if (b.y > 5.6)  { b.y = 5.6;  b.vy = -Math.abs(b.vy); }

      if (b.z <= WALL_Z && b.vz < 0) {
        b.z = WALL_Z;
        b.vz = Math.abs(b.vz) * 1.02;
        this.fx.push({ x: b.x, y: b.y, z: b.z, r: 0.5, life: 0.3, maxLife: 0.3, grow: 6, color: '#7bd389' });
      }

      // ── paddle collision ──
      if (b.z >= PADDLE_Z - 0.6 && b.vz > 0) {
        const dx = b.x - this.px, dy = b.y - this.py;
        if (Math.abs(dx) < 2.0 && Math.abs(dy) < 1.6) {
          b.z = PADDLE_Z - 0.6;
          b.vz = -Math.abs(b.vz) * 1.03;
          b.vx = U.clamp(b.vx * 0.6 + dx * 3.5 + this.paddleVX * 0.35, -13, 13);
          b.vy = U.clamp(b.vy * 0.6 + dy * 3.0, -9, 9);
          this.rally++;
          this.best = Math.max(this.best, this.rally);

          // on-beat returns pay double
          const phase = this.audio.beatPhase;
          const onBeat = this.bpm > 0 && (phase < 0.06 || phase > 0.94);
          const mult = onBeat ? 2 : 1;
          if (onBeat) this.beatReturnFlash = 1;

          const points = 10 * this.rally * this.multiplier * mult;
          this.score += points;

          this.fx.push({
            x: b.x, y: b.y, z: b.z, r: 0.7,
            life: 0.25, maxLife: 0.25, grow: 9,
            color: onBeat ? '#fff7d4' : '#ffd166'
          });
        } else if (b.z > PADDLE_Z + 1.6) {
          this.lives--;
          this.fx.push({ x: b.x, y: b.y, z: b.z, r: 0.9, life: 0.4, maxLife: 0.4, grow: 10, color: '#ff4d4f' });
          if (this.lives <= 0) { this.die('Dropped the ball at a ' + this.best + ' rally.'); return; }
          this.shell.toast('Missed! ' + this.lives + ' lives left', 1000);
          this.serveBall();
        }
      }
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#1d4a44', 0.3);

      // downbeat wash — teal
      if (this._downbeatPulse > 0) {
        const a = (this._downbeatPulse * 0.14).toFixed(3);
        r.rect(0, 0, r.w, r.h, 'rgba(76,201,240,' + a + ')');
      }

      // beat pulse edges
      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.35).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(76,201,240,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(76,201,240,' + a + ')');
      }

      // on-beat return flash
      if (this.beatReturnFlash > 0) {
        const a = (this.beatReturnFlash * 0.12).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(255,240,150,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(255,240,150,' + a + ')');
      }

      // far wall
      for (let x = -9.5; x <= 9.5; x += 2.4) {
        r.line({ x, y: -1.5, z: WALL_Z }, { x, y: 5.8, z: WALL_Z }, '#2f8c6a', 1, 0.45);
      }
      r.line({ x: -9.5, y: -1.5, z: WALL_Z }, { x: 9.5, y: -1.5, z: WALL_Z }, '#2f8c6a', 2, 0.6);
      r.line({ x: -9.5, y: 5.8, z: WALL_Z }, { x: 9.5, y: 5.8, z: WALL_Z }, '#2f8c6a', 2, 0.6);

      r.ring({ x: 0, y: -1.45, z: (WALL_Z + PADDLE_Z) / 2 }, 8, '#2f8c6a', 1, 0.25);

      // orbs — brighten with beat
      const beatGlow = this._beatPulse > 0.5;
      for (const o of this.pool.active) {
        const a = U.clamp(o.life / 1.2, 0, 1);
        r.sphere({ x: o.x, y: o.y, z: o.z }, o.r * o.scale, o.color, {
          glow: o.glow || beatGlow,
          alpha: a
        });
      }

      const b = this.ball;
      for (let i = 0; i < b.trail.length; i++) {
        const t = b.trail[i];
        const a = (i / b.trail.length) * 0.5;
        r.sphere(t, b.r * (0.35 + 0.6 * i / b.trail.length), b.color, { alpha: a });
      }
      r.sphere(b, b.r, b.color, { glow: true });

      // paddle — pulses with the beat
      const paddleScale = 1 + this._beatPulse * 0.06;
      r.sphere({ x: this.px, y: this.py, z: PADDLE_Z }, 1.5 * paddleScale, '#ffd166', { alpha: 0.35, glow: true });
      r.ring({ x: this.px, y: this.py, z: PADDLE_Z }, 1.5 * paddleScale, '#ffd166', 3, 0.95);
      r.ring({ x: this.px, y: this.py, z: PADDLE_Z }, 1.0, '#ffffff', 1, 0.5);

      for (const f of this.fx) {
        r.ring({ x: f.x, y: f.y, z: f.z }, f.r, f.color, 3, f.life / f.maxLife);
      }

      // HUD
      if (this.rally > 0) r.text(r.w / 2, 40, 'x' + this.rally, '#ffd166', 26, 'center', 900);
      if (this.multiplier > 1) {
        r.text(r.w / 2, 66, '×' + this.multiplier + ' score', '#4cc9f0', 13, 'center', 700);
      }
      if (this.pool.active.length) {
        r.text(r.w / 2, r.h - 40,
          this.pool.active.length + ' orb' + (this.pool.active.length === 1 ? '' : 's') + ' in play',
          '#a78bfa', 14, 'center', 700);
      }

      const bpmText = this.bpm > 0
        ? '♪ ' + Math.round(this.bpm) + ' BPM  ×' + this.speedMul.toFixed(2)
        : '♪ listening…';
      r.text(r.w - 20, 90, bpmText, '#4cc9f0', 13, 'right', 700);
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };
      const b = this.ball;
      let tx = b.x, ty = b.y;
      if (b.vz > 0) {
        const t = (PADDLE_Z - b.z) / Math.max(1, b.vz * this.speedMul);
        tx = b.x + b.vx * this.speedMul * t;
        ty = b.y + b.vy * this.speedMul * t;
        const spanX = 19, spanY = 6.8;
        const offX = ((tx + 9.5) % (spanX * 2) + spanX * 2) % (spanX * 2);
        tx = offX < spanX ? -9.5 + offX : 9.5 - (offX - spanX);
        const offY = ((ty + 1.2) % (spanY * 2) + spanY * 2) % (spanY * 2);
        ty = offY < spanY ? -1.2 + offY : 5.6 - (offY - spanY);
      }
      return {
        x: U.clamp(tx / 8.5, -1, 1),
        y: U.clamp((ty - 1.6) / 3.2, -1, 1),
        fire: false
      };
    }

    getStats() {
      return [
        { k: 'Score', v: this.score },
        { k: 'Rally', v: this.rally },
        { k: 'Best rally', v: this.best },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Multiplier', v: '×' + this.multiplier },
        { k: 'Orbs', v: this.pool.active.length },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'rally',
    name: 'Ball Rally',
    tag: 'Paddle',
    color: '#4cc9f0',
    blurb: 'Bounce the orb back into the far wall at the tempo of your track. Downbeats burst orbs, treble drops fast shards, bass builds spawn goldens.',
    hint: 'Move the paddle with the mouse · on-beat returns pay double · goldens = 150 · shards = 40',
    create: (shell) => new Rally(shell)
  });
})();