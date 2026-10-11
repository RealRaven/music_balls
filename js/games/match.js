/* ============================================================
   match.js — BALL MATCH
   A target colour is announced. Shoot only the spheres wearing
   that colour. No music = no balls.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const PALETTE = [
    { name: 'RED', hex: '#ff4d4f' },
    { name: 'BLUE', hex: '#4cc9f0' },
    { name: 'GREEN', hex: '#7bd389' },
    { name: 'VIOLET', hex: '#a78bfa' },
    { name: 'AMBER', hex: '#ffd166' }
  ];

  class Match extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#101a2c', bottom: '#05060a' };
    }

    reset() {
      this.balls = [];
      this.fx = [];
      this.score = 0;
      this.lives = 3;
      this.combo = 0;
      this.bestCombo = 0;
      this.hits = 0;
      this.spawnTimer = 0.4;
      this.interval = 1.15;
      this.speedMul = 1;
      this.lastShot = -10;
      this.targetIndex = U.randInt(0, PALETTE.length - 1);
      this.targetTimer = 9;
      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 5; c.yaw = 0; c.pitch = 0;
    }

    get target() { return PALETTE[this.targetIndex]; }

    spawn(spread) {
      const idx = U.randInt(0, PALETTE.length - 1);
      const c = PALETTE[idx];
      const r = U.rand(0.6, 1.25);
      this.balls.push({
        x: U.rand(-9, 9),
        y: U.rand(-0.6, 5.0),
        z: spread ? U.rand(-160, -50) : U.rand(-175, -115),
        r,
        color: c.hex,
        index: idx,
        hp: 1,
        flash: 0
      });
    }

    pickNewTarget() {
      let idx = this.targetIndex;
      while (idx === this.targetIndex) idx = U.randInt(0, PALETTE.length - 1);
      this.targetIndex = idx;
      this.targetTimer = 9;
      this.shell.toast('New target: ' + this.target.name, 1200);
    }

    update(dt) {
      this.time += dt;
      const drive = this.audio.drive;
      const playing = this.audio.isPlaying;

      this.speedMul = U.smooth(this.speedMul, 1 + drive * 2.4, 0.18, dt);
      this.interval = U.smooth(this.interval, 1.15 / (1 + drive * 2.2), 0.20, dt);

      // Effects always fade
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt; f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }

      // ────────── THE GATE ──────────
      // No music, no balls and the target timer pauses too.
      if (!playing) return;

      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn(false);
        this.spawnTimer = this.interval;
      }

      this.targetTimer -= dt;
      if (this.targetTimer <= 0) this.pickNewTarget();

      const mul = this.speedMul * (1 + Math.min(1.2, this.hits / 25));
      for (let i = this.balls.length - 1; i >= 0; i--) {
        const b = this.balls[i];
        b.z += 4.4 * mul * dt;
        b.flash = Math.max(0, b.flash - dt * 4);
        if (b.z > this.r.camera.z - 1.2) {
          this.balls.splice(i, 1);
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
      for (const b of this.balls) {
        const t = U.raySphere(ray.origin, ray.dir, b, b.r);
        if (t !== null && t < bestT) { bestT = t; best = b; }
      }
      if (!best) return;

      const idx = this.balls.indexOf(best);
      if (idx >= 0) this.balls.splice(idx, 1);

      if (best.index === this.targetIndex) {
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.hits++;
        this.score += 25 * Math.max(1, this.combo);
        this.fx.push({ p: { x: best.x, y: best.y, z: best.z }, r: best.r, life: 0.3, maxLife: 0.3, grow: 8, color: best.color });
      } else {
        this.combo = 0;
        this.score = Math.max(0, this.score - 20);
        this.fx.push({ p: { x: best.x, y: best.y, z: best.z }, r: best.r, life: 0.3, maxLife: 0.3, grow: 8, color: '#ff4d4f' });
        this.shell.toast('Wrong colour — that was ' + PALETTE[best.index].name, 900);
      }
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#2b3f66', 0.22);

      for (const b of this.balls) {
        const isTarget = b.index === this.targetIndex;
        r.sphere({ x: b.x, y: b.y, z: b.z }, b.r, b.color, {
          glow: isTarget,
          ring: isTarget ? '#ffffff' : null,
          ringAlpha: 0.45,
          ringWidth: 2
        });
      }

      for (const f of this.fx) {
        r.ring(f.p, f.r, f.color, 3, f.life / f.maxLife);
      }

      // target banner
      const cx = r.w / 2;
      r.rect(cx - 118, 20, 236, 46, 'rgba(0,0,0,.5)', 12);
      r.text(cx, 43, 'TARGET: ' + this.target.name, this.target.hex, 22, 'center', 900);
      const pw = 236 * (this.targetTimer / 9);
      r.rect(cx - 118 + 4, 60, Math.max(0, pw - 8), 3, this.target.hex, 2);

      if (this.combo > 1) {
        r.text(cx, 92, 'COMBO x' + this.combo, '#ffffff', 16, 'center', 800);
      }
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };

      // Nearest ball of the target colour.
      let target = null, best = Infinity;
      for (const b of this.balls) {
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
    blurb: 'Coloured spheres inbound and a target colour on the banner. Shoot only the right one — the wrong one costs you.',
    hint: 'Aim and click · target ball outlines glow white',
    create: (shell) => new Match(shell)
  });
})();