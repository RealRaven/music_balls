/* ============================================================
   dodge.js — BALL DODGE
   You are a little orb drifting in a corridor of incoming
   spheres. Survive, graze for bonus points. No shooting.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const COLORS = ['#ff6b6b', '#ffd166', '#c77dff', '#4cc9f0'];

  class Dodge extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#1a1030', bottom: '#05060a' };
    }

    reset() {
      this.balls = [];
      this.fx = [];
      this.score = 0;
      this.lives = 3;
      this.survived = 0;
      this.spawnTimer = 0.5;
      this.interval = 0.9;
      this.speedMul = 1;
      this.invuln = 0;
      this.px = 0; this.py = 1.6;
      this.vx = 0; this.vy = 0;
      this.grazeCool = 0;
      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 6; c.yaw = 0; c.pitch = 0;
    }

    spawn() {
      const r = U.rand(0.45, 1.25);
      this.balls.push({
        x: U.rand(-10, 10),
        y: U.rand(-1.2, 6.5),
        z: U.rand(-170, -110),
        r,
        color: U.pick(COLORS),
        speed: U.rand(9, 15),
        grazed: false
      });
    }

    update(dt) {
      this.time += dt;
      const drive = this.audio.drive;

      this.speedMul = U.smooth(this.speedMul, 1 + drive * 1.8, 0.07, dt);
      this.interval = U.smooth(this.interval, 0.9 / (1 + drive * 1.4), 0.06, dt);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        this.spawnTimer = this.interval * U.rand(0.7, 1.2);
      }

      // player follows the pointer with a bit of inertia
      const tx = this.input.nx * 9;
      const ty = 1.6 + this.input.ny * 3.4;
      this.vx = U.smooth(this.vx, (tx - this.px) * 9, 0.25, dt);
      this.vy = U.smooth(this.vy, (ty - this.py) * 9, 0.25, dt);
      this.px += this.vx * dt;
      this.py += this.vy * dt;

      this.survived += dt;
      this.score = Math.floor(this.survived * 12) + this.grazeBonus;

      if (this.invuln > 0) this.invuln -= dt;
      this.grazeCool = Math.max(0, this.grazeCool - dt);

      for (let i = this.balls.length - 1; i >= 0; i--) {
        const b = this.balls[i];
        b.z += b.speed * this.speedMul * dt;

        const dx = b.x - this.px, dy = b.y - this.py;
        const d = Math.hypot(dx, dy);

        if (d < b.r + 0.75 && this.invuln <= 0) {
          this.lives--;
          this.invuln = 1.6;
          this.fx.push({ p: { x: b.x, y: b.y, z: b.z }, r: b.r, life: 0.4, maxLife: 0.4, grow: 8, color: '#ff5b5b' });
          this.balls.splice(i, 1);
          if (this.lives <= 0) { this.die('Clipped by a sphere after ' + this.survived.toFixed(1) + 's'); return; }
          this.shell.toast('Hit! ' + this.lives + ' lives left', 1000);
          continue;
        }

        // grazing: pass close by without touching
        if (!b.grazed && d < b.r + 1.9 && b.z > -8 && this.grazeCool <= 0) {
          b.grazed = true;
          this.grazeBonus += 25;
          this.grazeCool = 0.25;
          this.fx.push({ p: { x: b.x, y: b.y, z: b.z }, r: b.r, life: 0.25, maxLife: 0.25, grow: 5, color: '#7bd389' });
        }

        if (b.z > this.r.camera.z + 3) this.balls.splice(i, 1);
      }

      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt; f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#463a7a', 0.22);

      for (const b of this.balls) {
        r.sphere({ x: b.x, y: b.y, z: b.z }, b.r, b.color, { glow: true });
      }

      const blink = this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0;
      if (!blink) {
        r.sphere({ x: this.px, y: this.py, z: 0 }, 0.75, '#ffffff', { glow: true, ring: '#2f8cff', ringWidth: 3 });
      }
      // shield halo while invulnerable
      if (this.invuln > 0) r.ring({ x: this.px, y: this.py, z: 0 }, 1.35, '#9fc6ff', 2, this.invuln / 1.6);

      for (const f of this.fx) {
        r.ring(f.p, f.r, f.color, 3, f.life / f.maxLife);
      }

      r.text(r.w / 2, 34, this.survived.toFixed(1) + 's', '#ffffff', 22, 'center', 800);
    }

    constructor2() {}

    ai(dt) {
      // Move away from the projected impact point of the most dangerous ball,
      // and towards open space.
      let dangerX = 0, dangerY = 0, danger = 0;
      for (const b of this.balls) {
        if (b.z > -3) continue;
        const t = -b.z / Math.max(1, b.speed * this.speedMul);
        if (t > 3.5) continue;
        const w = 1 / (t + 0.35);
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
        { k: 'Graze bonus', v: this.grazeBonus || 0 }
      ];
    }
  }

  Dodge.prototype.grazeBonus = 0;

  Arcade.register({
    id: 'dodge',
    name: 'Ball Dodge',
    tag: 'Survival',
    color: '#c77dff',
    blurb: 'A white orb, a storm of coloured spheres and nowhere to hide. Slide through the gaps and graze for bonus points.',
    hint: 'Move with the mouse · no shooting · graze close for +25',
    create: (shell) => new Dodge(shell)
  });
})();