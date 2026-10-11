/* ============================================================
   rally.js — BALL RALLY
   Ball speed locked to the tempo. Every beat drops a bonus orb
   into the far court — smack it with the ball for +75.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const PADDLE_Z = 0;
  const WALL_Z = -62;
  const REF_BPM = 120;

  class Rally extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#0d2320', bottom: '#05060a' };
    }

    reset() {
      this.score = 0;
      this.lives = 3;
      this.rally = 0;
      this.best = 0;
      this.px = 0; this.py = 1.6;
      this.speedMul = 1;
      this.fx = [];
      this.orbs = [];
      this.lastPx = 0;
      this.paddleVX = 0;
      this.serveBall();

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.75;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 6; c.yaw = 0; c.pitch = 0;
    }

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

    update(dt) {
      this.time += dt;
      const drive = this.audio.drive;
      const playing = this.audio.isPlaying;
      const beatNow = this.audio.beat;
      const energy = this.energy(dt);

      this._beatAgo += dt;
      if (beatNow) this._recordBeat();
      this._beatPulse = Math.max(0, this._beatPulse - dt * 2.5);

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

      // ── beat orbs ──
      const orbCap = Math.round(2 + energy * 8);
      if (beatNow && this.orbs.length < orbCap) {
        this.orbs.push({
          x: U.rand(-8.5, 8.5),
          y: U.rand(-0.8, 5.4),
          z: U.rand(WALL_Z + 6, -12),
          r: 0.45,
          vx: U.rand(-3, 3) * (1 + energy),
          vy: U.rand(-2, 2) * (1 + energy),
          life: 6,
          color: '#a78bfa'
        });
      }
      for (let i = this.orbs.length - 1; i >= 0; i--) {
        const o = this.orbs[i];
        o.life -= dt;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        if (o.x < -9.5 || o.x > 9.5) { o.vx *= -1; o.x = U.clamp(o.x, -9.5, 9.5); }
        if (o.y < -1.2 || o.y > 5.6) { o.vy *= -1; o.y = U.clamp(o.y, -1.2, 5.6); }

        const b0 = this.ball;
        const dx = o.x - b0.x, dy = o.y - b0.y, dz = o.z - b0.z;
        const rr = o.r + b0.r + 0.4;
        if (dx * dx + dy * dy + dz * dz < rr * rr) {
          this.score += 75;
          this.fx.push({ x: o.x, y: o.y, z: o.z, r: o.r, life: 0.4, maxLife: 0.4, grow: 8, color: o.color });
          this.orbs.splice(i, 1);
          continue;
        }
        if (o.life <= 0) this.orbs.splice(i, 1);
      }

      // paddle follows the pointer
      this.lastPx = this.px;
      this.px = U.smooth(this.px, this.input.nx * 8.5, 0.32, dt);
      this.py = U.smooth(this.py, 1.6 + this.input.ny * 3.2, 0.32, dt);
      this.paddleVX = (this.px - this.lastPx) / Math.max(dt, 0.0001);

      const b = this.ball;
      const sp = this.speedMul * (1 + Math.min(1.2, this.rally / 12));
      b.trail.push({ x: b.x, y: b.y, z: b.z });
      if (b.trail.length > 14) b.trail.shift();

      b.x += b.vx * sp * dt;
      b.y += b.vy * sp * dt;
      b.z += b.vz * sp * dt;

      if (b.x < -9.5) { b.x = -9.5; b.vx = Math.abs(b.vx); }
      if (b.x > 9.5) { b.x = 9.5; b.vx = -Math.abs(b.vx); }
      if (b.y < -1.2) { b.y = -1.2; b.vy = Math.abs(b.vy); }
      if (b.y > 5.6) { b.y = 5.6; b.vy = -Math.abs(b.vy); }

      if (b.z <= WALL_Z && b.vz < 0) {
        b.z = WALL_Z;
        b.vz = Math.abs(b.vz) * 1.02;
        this.fx.push({ x: b.x, y: b.y, z: b.z, r: 0.5, life: 0.3, maxLife: 0.3, grow: 6, color: '#7bd389' });
      }

      if (b.z >= PADDLE_Z - 0.6 && b.vz > 0) {
        const dx = b.x - this.px, dy = b.y - this.py;
        if (Math.abs(dx) < 2.0 && Math.abs(dy) < 1.6) {
          b.z = PADDLE_Z - 0.6;
          b.vz = -Math.abs(b.vz) * 1.03;
          b.vx = U.clamp(b.vx * 0.6 + dx * 3.5 + this.paddleVX * 0.35, -13, 13);
          b.vy = U.clamp(b.vy * 0.6 + dy * 3.0, -9, 9);
          this.rally++;
          this.best = Math.max(this.best, this.rally);
          this.score += 10 * this.rally;
          this.fx.push({ x: b.x, y: b.y, z: b.z, r: 0.7, life: 0.25, maxLife: 0.25, grow: 9, color: '#ffd166' });
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

      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.35).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(76,201,240,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(76,201,240,' + a + ')');
      }

      for (let x = -9.5; x <= 9.5; x += 2.4) {
        r.line({ x, y: -1.5, z: WALL_Z }, { x, y: 5.8, z: WALL_Z }, '#2f8c6a', 1, 0.45);
      }
      r.line({ x: -9.5, y: -1.5, z: WALL_Z }, { x: 9.5, y: -1.5, z: WALL_Z }, '#2f8c6a', 2, 0.6);
      r.line({ x: -9.5, y: 5.8, z: WALL_Z }, { x: 9.5, y: 5.8, z: WALL_Z }, '#2f8c6a', 2, 0.6);

      r.ring({ x: 0, y: -1.45, z: (WALL_Z + PADDLE_Z) / 2 }, 8, '#2f8c6a', 1, 0.25);

      for (const o of this.orbs) {
        const a = U.clamp(o.life / 1.2, 0, 1);
        r.sphere({ x: o.x, y: o.y, z: o.z }, o.r, o.color, { glow: true, alpha: a });
      }

      const b = this.ball;
      for (let i = 0; i < b.trail.length; i++) {
        const t = b.trail[i];
        const a = (i / b.trail.length) * 0.5;
        r.sphere(t, b.r * (0.35 + 0.6 * i / b.trail.length), b.color, { alpha: a });
      }
      r.sphere(b, b.r, b.color, { glow: true });

      r.sphere({ x: this.px, y: this.py, z: PADDLE_Z }, 1.5, '#ffd166', { alpha: 0.35, glow: true });
      r.ring({ x: this.px, y: this.py, z: PADDLE_Z }, 1.5, '#ffd166', 3, 0.95);
      r.ring({ x: this.px, y: this.py, z: PADDLE_Z }, 1.0, '#ffffff', 1, 0.5);

      for (const f of this.fx) {
        r.ring({ x: f.x, y: f.y, z: f.z }, f.r, f.color, 3, f.life / f.maxLife);
      }

      if (this.rally > 0) r.text(r.w / 2, 40, 'x' + this.rally, '#ffd166', 26, 'center', 900);
      if (this.orbs.length) {
        r.text(r.w / 2, r.h - 40,
          '+75 · ' + this.orbs.length + ' orb' + (this.orbs.length === 1 ? '' : 's'),
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
        { k: 'Orbs', v: this.orbs.length },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'rally',
    name: 'Ball Rally',
    tag: 'Paddle',
    color: '#4cc9f0',
    blurb: 'Bounce the orb back into the far wall at the tempo of your track. Every beat drops a bonus orb — smack it for +75.',
    hint: 'Move the paddle with the mouse · keep the rally alive · purple orbs = +75',
    create: (shell) => new Rally(shell)
  });
})();