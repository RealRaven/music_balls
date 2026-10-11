/* ============================================================
   rally.js — BALL RALLY
   Keep the ball alive with your paddle. Every return scores.
   The music makes it faster. No music = frozen court.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const PADDLE_Z = 0;
  const WALL_Z = -62;

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
      this.lastPx = 0;
      this.paddleVX = 0;
      this.serveBall();
      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 6; c.yaw = 0; c.pitch = 0;
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

      this.speedMul = U.smooth(this.speedMul, 1 + drive * 2.2, 0.18, dt);

      // Effects always fade
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt; f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }

      // ────────── THE GATE ──────────
      // No music, nothing moves. Paddle and ball stay frozen.
      if (!playing) return;

      // paddle follows the pointer (x and y)
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

      // side walls
      if (b.x < -9.5) { b.x = -9.5; b.vx = Math.abs(b.vx); }
      if (b.x > 9.5) { b.x = 9.5; b.vx = -Math.abs(b.vx); }
      if (b.y < -1.2) { b.y = -1.2; b.vy = Math.abs(b.vy); }
      if (b.y > 5.6) { b.y = 5.6; b.vy = -Math.abs(b.vy); }

      // far wall bounce
      if (b.z <= WALL_Z && b.vz < 0) {
        b.z = WALL_Z;
        b.vz = Math.abs(b.vz) * 1.02;
        this.fx.push({ x: b.x, y: b.y, z: b.z, r: 0.5, life: 0.3, maxLife: 0.3, grow: 6, color: '#7bd389' });
      }

      // paddle intercept
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

      // far wall
      for (let x = -9.5; x <= 9.5; x += 2.4) {
        r.line({ x, y: -1.5, z: WALL_Z }, { x, y: 5.8, z: WALL_Z }, '#2f8c6a', 1, 0.45);
      }
      r.line({ x: -9.5, y: -1.5, z: WALL_Z }, { x: 9.5, y: -1.5, z: WALL_Z }, '#2f8c6a', 2, 0.6);
      r.line({ x: -9.5, y: 5.8, z: WALL_Z }, { x: 9.5, y: 5.8, z: WALL_Z }, '#2f8c6a', 2, 0.6);

      // rally ring on the floor
      r.ring({ x: 0, y: -1.45, z: (WALL_Z + PADDLE_Z) / 2 }, 8, '#2f8c6a', 1, 0.25);

      const b = this.ball;
      for (let i = 0; i < b.trail.length; i++) {
        const t = b.trail[i];
        const a = (i / b.trail.length) * 0.5;
        r.sphere(t, b.r * (0.35 + 0.6 * i / b.trail.length), b.color, { alpha: a });
      }
      r.sphere(b, b.r, b.color, { glow: true });

      // paddle
      r.sphere({ x: this.px, y: this.py, z: PADDLE_Z }, 1.5, '#ffd166', { alpha: 0.35, glow: true });
      r.ring({ x: this.px, y: this.py, z: PADDLE_Z }, 1.5, '#ffd166', 3, 0.95);
      r.ring({ x: this.px, y: this.py, z: PADDLE_Z }, 1.0, '#ffffff', 1, 0.5);

      for (const f of this.fx) {
        r.ring({ x: f.x, y: f.y, z: f.z }, f.r, f.color, 3, f.life / f.maxLife);
      }

      if (this.rally > 0) {
        r.text(r.w / 2, 40, 'x' + this.rally, '#ffd166', 26, 'center', 900);
      }
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };

      const b = this.ball;
      // Predict where the ball will be when it reaches the paddle plane.
      let tx = b.x, ty = b.y;
      if (b.vz > 0) {
        const t = (PADDLE_Z - b.z) / Math.max(1, b.vz * this.speedMul);
        tx = b.x + b.vx * this.speedMul * t;
        ty = b.y + b.vy * this.speedMul * t;
        // reflect the predictions off the side walls
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
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'rally',
    name: 'Ball Rally',
    tag: 'Paddle',
    color: '#4cc9f0',
    blurb: 'Bounce the orb back into the far wall again and again. Every return multiplies the score — the beat multiplies the speed.',
    hint: 'Move the paddle with the mouse · keep the rally alive',
    create: (shell) => new Rally(shell)
  });
})();