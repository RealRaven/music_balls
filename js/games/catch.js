/* ============================================================
   catch.js — BALL CATCH
   Catch the cool-coloured spheres in your basket, dodge the red
   ones. Pure 2D falling-ball reflex game with an audio pace.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const GROUND_Y = -1.5;
  const CATCH_Y = -0.55;

  class Catch extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#16203a', bottom: '#05060a' };
    }

    reset() {
      this.balls = [];
      this.fx = [];
      this.score = 0;
      this.lives = 3;
      this.combo = 0;
      this.bestCombo = 0;
      this.caught = 0;
      this.basketX = 0;
      this.basketW = 2.2;
      this.spawnTimer = 0.5;
      this.interval = 0.85;
      this.fallMul = 1;
      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 6; c.yaw = 0; c.pitch = 0;
    }

    spawn() {
      const bad = Math.random() < 0.3;
      const r = U.rand(0.5, 0.95);
      this.balls.push({
        x: U.rand(-9, 9),
        y: 9 + r,
        z: 0,
        r,
        bad,
        color: bad ? '#ff4d4f' : U.pick(['#4cc9f0', '#7bd389', '#a78bfa']),
        vy: U.rand(5.5, 8.5),
        rot: 0
      });
    }

    update(dt) {
      this.time += dt;
      const drive = this.audio.drive;

      this.fallMul = U.smooth(this.fallMul, 1 + drive * 1.5, 0.07, dt);
      this.interval = U.smooth(this.interval, 0.85 / (1 + drive * 1.3), 0.06, dt);
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        this.spawnTimer = this.interval * U.rand(0.7, 1.25);
      }

      this.basketX = U.smooth(this.basketX, this.input.nx * 8.5, 0.3, dt);

      for (let i = this.balls.length - 1; i >= 0; i--) {
        const b = this.balls[i];
        b.y -= b.vy * this.fallMul * dt;
        b.rot += dt * 2;

        // catch check
        if (b.y <= CATCH_Y + b.r * 0.4 && b.y > CATCH_Y - 1.2) {
          const inBasket = Math.abs(b.x - this.basketX) < this.basketW / 2 + b.r * 0.5;
          if (inBasket) {
            this.balls.splice(i, 1);
            if (b.bad) {
              this.combo = 0;
              this.lives--;
              this.fx.push({ x: b.x, y: b.y, r: b.r, life: 0.4, maxLife: 0.4, grow: 10, color: '#ff4d4f' });
              if (this.lives <= 0) { this.die('Caught a bomb ball.'); return; }
              this.shell.toast('Bomb! ' + this.lives + ' lives left', 900);
            } else {
              this.combo++;
              this.bestCombo = Math.max(this.bestCombo, this.combo);
              this.caught++;
              this.score += 10 * this.combo;
              this.fx.push({ x: b.x, y: b.y, r: b.r, life: 0.28, maxLife: 0.28, grow: 8, color: b.color });
            }
            continue;
          }
        }

        if (b.y < GROUND_Y - 2) {
          this.balls.splice(i, 1);
          if (!b.bad) {
            this.combo = 0;
            this.lives--;
            if (this.lives <= 0) { this.die('Too many dropped balls.'); return; }
            this.shell.toast('Dropped! ' + this.lives + ' lives left', 900);
          }
        }
      }

      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt; f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#2b3f66', 0.22);

      // "danger" line at the catch height
      r.line({ x: -9.5, y: CATCH_Y, z: 0 }, { x: 9.5, y: CATCH_Y, z: 0 }, '#5b7fbf', 1, 0.3);

      for (const b of this.balls) {
        r.sphere({ x: b.x, y: b.y, z: 0 }, b.r, b.color, { glow: b.bad });
      }

      // basket: an arc made of overlapping spheres
      const segs = 7;
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1);
        const off = (t - 0.5) * this.basketW;
        const sag = Math.cos((t - 0.5) * Math.PI) * 0.34;
        r.sphere({ x: this.basketX + off, y: CATCH_Y - 0.35 + sag, z: 0 }, 0.3, '#ffd166', { glow: true });
      }

      for (const f of this.fx) {
        r.ring({ x: f.x, y: f.y, z: 0 }, f.r, f.color, 3, f.life / f.maxLife);
      }

      if (this.combo > 1) r.text(r.w / 2, 40, 'COMBO x' + this.combo, '#7bd389', 24, 'center', 900);
    }

    ai() {
      // Prefer the nearest good ball that is still catchable; bail out if
      // a bomb is closer to the basket.
      let targetX = null, bestT = Infinity;
      let bombX = null, bombT = Infinity;

      for (const b of this.balls) {
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
      return { x: U.clamp(tx / 8.5, -1, 1), y: 0, fire: false };
    }

    getStats() {
      return [
        { k: 'Score', v: this.score },
        { k: 'Caught', v: this.caught },
        { k: 'Combo', v: 'x' + Math.max(1, this.combo) },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'catch',
    name: 'Ball Catch',
    tag: 'Reflex',
    color: '#7bd389',
    blurb: 'Spheres rain from above. Fill your basket with the coloured ones, let the red bombs smash into the floor.',
    hint: 'Move the basket with the mouse · red = avoid · combos multiply',
    create: (shell) => new Catch(shell)
  });
})();