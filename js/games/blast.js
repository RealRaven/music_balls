/* ============================================================
   blast.js — BALL BLAST
   Shoot the spheres before they reach you. Elite (red) spheres
   take a beating and pay out big. Weapon upgrades every N points.
   ============================================================ */
(function () {
  'use strict';
  const U = window.U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const C_NORMAL = '#7bd389';
  const C_ELITE = '#ff4d4f';

  class Blast extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#121a2e', bottom: '#05060a' };
    }

    reset() {
      this.balls = [];
      this.fx = [];
      this.kills = 0;
      this.score = 0;
      this.lives = 3;
      this.level = 1;
      this.damage = 10;
      this.nextUpgrade = 50;
      this.interval = 1.2;
      this.spawnTimer = 0.4;
      this.speedMul = 1;
      this.bob = 0;
      this.lastShot = -10;
      this.recoil = 0;
      this.hitFlash = 0;
      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 5; c.yaw = 0; c.pitch = 0;
      for (let i = 0; i < 4; i++) this.spawn(true);
    }

    spawn(spread) {
      const elite = Math.random() < 0.16;
      const radius = elite ? U.rand(1.1, 1.9) : U.rand(0.55, 1.15);
      const hp = elite ? Math.round(U.rand(34, 72)) : Math.round(U.rand(9, 18));
      this.balls.push({
        x: U.rand(-9, 9),
        y: U.rand(-0.8, 5.2),
        z: spread ? U.rand(-165, -45) : U.rand(-175, -120),
        r: radius,
        hp, maxHp: hp, elite,
        color: elite ? C_ELITE : C_NORMAL,
        points: elite ? Math.round(U.rand(20, 55)) : Math.round(U.rand(5, 12)),
        phase: U.rand(0, 6.28),
        flash: 0
      });
    }

    update(dt) {
      this.time += dt;
      const drive = this.audio.drive;

      // --- audio drives speed, spawn rate and camera bob ---
      this.speedMul = U.smooth(this.speedMul, 1 + drive * 2.2, 0.08, dt);
      this.interval = U.smooth(this.interval, 1.2 / (1 + drive * 1.6), 0.06, dt);
      this.bob = U.smooth(this.bob, U.clamp((drive - 0.35) * 2, -0.6, 0.6), 0.12, dt);
      this.r.camera.z = 5 + this.bob;

      // --- spawning ---
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn(false);
        this.spawnTimer = this.interval;
      }

      // --- movement ---
      const globalMul = this.speedMul * (1 + Math.min(1.5, this.kills / 30));
      for (let i = this.balls.length - 1; i >= 0; i--) {
        const b = this.balls[i];
        b.z += (b.elite ? 7 : 4) * globalMul * dt;
        b.flash = Math.max(0, b.flash - dt * 4);
        if (b.z > this.r.camera.z - 1.2) {
          this.balls.splice(i, 1);
          this.hitFlash = 1;
          this.loseLife();
          this.shell.toast('Ouch! ' + this.lives + ' lives left', 1100);
        }
      }

      // --- shooting ---
      if (this.input.firing) this.shoot();
      this.recoil = Math.max(0, this.recoil - dt * 6);

      // --- effects ---
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt;
        f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
    }

    shoot() {
      const rate = Math.max(0.08, 0.35 - (this.level - 1) * 0.05);
      if (this.time - this.lastShot < rate) return;
      this.lastShot = this.time;
      this.recoil = 1;

      const ray = this.aimRay();
      let best = null, bestT = Infinity;
      for (const b of this.balls) {
        const t = U.raySphere(ray.origin, ray.dir, b, b.r);
        if (t !== null && t < bestT) { bestT = t; best = b; }
      }

      if (best) {
        this.damageBall(best, this.damage);
        this.fx.push({
          p: { x: best.x, y: best.y, z: best.z }, r: best.r,
          life: 0.18, maxLife: 0.18, grow: 6, color: '#fff3c4'
        });
      } else {
        const o = ray.origin;
        this.fx.push({
          p: { x: o.x + ray.dir.x * 40, y: o.y + ray.dir.y * 40, z: o.z + ray.dir.z * 40 },
          r: 0.4, life: 0.12, maxLife: 0.12, grow: 0, color: '#8fb8ff'
        });
      }
    }

    damageBall(b, dmg) {
      b.hp -= dmg;
      b.flash = 1;
      if (b.hp > 0) return;

      this.kills++;
      this.score += b.points;
      this.fx.push({
        p: { x: b.x, y: b.y, z: b.z }, r: b.r,
        life: 0.32, maxLife: 0.32, grow: b.r * 6, color: b.color
      });
      const i = this.balls.indexOf(b);
      if (i >= 0) this.balls.splice(i, 1);

      // weapon upgrades
      if (this.score >= this.nextUpgrade) {
        this.level++;
        this.damage = Math.round(this.damage * 1.6);
        this.nextUpgrade = Math.round(this.nextUpgrade * 2 + 30);
        this.shell.toast('Weapon upgraded! Level ' + this.level + ' — damage ' + this.damage, 1800);
      }
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#2b3f66', 0.28);

      if (this.hitFlash > 0) {
        r.rect(0, 0, r.w, r.h, 'rgba(255,60,60,' + (this.hitFlash * 0.28).toFixed(3) + ')');
      }

      for (const b of this.balls) {
        const info = r.sphere({ x: b.x, y: b.y, z: b.z }, b.r, b.color, {
          glow: b.elite,
          ring: b.flash > 0 ? '#ffffff' : null,
          ringAlpha: b.flash
        });
        if (info && b.hp < b.maxHp && info.r > 4) {
          const ratio = b.hp / b.maxHp;
          const w = Math.max(24, info.r * 1.7);
          const col = ratio > 0.5 ? '#4ade80' : (ratio > 0.25 ? '#ffcf33' : '#ff4d4f');
          r.bar(info.x - w / 2, info.y - info.r - 12, w, 5, ratio, col);
        }
      }

      for (const f of this.fx) {
        const a = f.life / f.maxLife;
        r.ring(f.p, f.r, f.color, 3, a);
      }

      // subtle crosshair halo so the player can see where the shot goes
      const s = this.aimScreen();
      const pulse = 16 + this.recoil * 10;
      r.ring({ x: this.r.camera.x, y: this.r.camera.y, z: this.r.camera.z - 2 }, 1, '#9fc6ff', 1, 0);
      r.rect(s.x - pulse / 2, s.y - 1, pulse, 2, 'rgba(159,198,255,.30)');
      r.rect(s.x - 1, s.y - pulse / 2, 2, pulse, 'rgba(159,198,255,.30)');
    }

    ai() {
      let target = null, bestScore = Infinity;
      for (const b of this.balls) {
        // prioritize things that are about to hit us
        const tta = (this.r.camera.z - 1.2 - b.z) / 6;
        const score = tta - b.points * 0.02;
        if (score < bestScore) { bestScore = score; target = b; }
      }
      if (!target) return { x: 0, y: 0, fire: false };
      return this.aimAt({ x: target.x, y: target.y, z: target.z }, true);
    }

    getStats() {
      return [
        { k: 'Score', v: this.score },
        { k: 'Kills', v: this.kills },
        { k: 'Lives', v: this.lives },
        { k: 'Weapon', v: 'Lv ' + this.level + ' · ' + this.damage + ' dmg' },
        { k: 'Next upg.', v: this.nextUpgrade + ' pts' }
      ];
    }
  }

  Arcade.register({
    id: 'blast',
    name: 'Ball Blast',
    tag: 'Shooter',
    color: '#2f8cff',
    blurb: 'Spheres rush the camera. Click to fire, chain kills for weapon upgrades, and don\'t let anything touch you.',
    hint: 'Click to shoot · aim with the mouse · red spheres are elite',
    create: (shell) => new Blast(shell)
  });
})();