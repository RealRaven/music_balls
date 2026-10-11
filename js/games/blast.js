/* ============================================================
   blast.js — BALL BLAST
   Balls spawn on the beat (like notes in a rhythm game) and
   move at the tempo of the music. Reds vs greens follow
   intensity. No music = no balls.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const C_NORMAL   = '#7bd389';
  const C_ELITE    = '#ff4d4f';
  const REF_BPM    = 120;   // 120 BPM = 1.0x speed
  const BASE_SPEED = 35;    // units/sec for a green ball at 1.0x
  const ELITE_MUL  = 1.35;  // reds are a bit faster
  const SPAWN_Z    = -170;

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

      this.speedMul = 1;
      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._beatAgo = 99;        // seconds since last detected beat
      this._fallbackTimer = 0.75;

      this.lastShot = -10;
      this.recoil = 0;
      this.hitFlash = 0;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 5; c.yaw = 0; c.pitch = 0;
    }

    /* Push a beat timestamp and re-estimate BPM from the median gap. */
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
      if (median < 0.20 || median > 2.0) return;  // noise / silence
      const newBpm = 60 / median;
      this.bpm = this.bpm > 0 ? this.bpm * 0.7 + newBpm * 0.3 : newBpm;
    }

    spawn(eliteChance) {
      const elite = Math.random() < eliteChance;
      const radius = elite ? U.rand(1.1, 1.9) : U.rand(0.55, 1.15);
      const hp = elite ? Math.round(U.rand(34, 72)) : Math.round(U.rand(9, 18));
      this.balls.push({
        x: U.rand(-9, 9),
        y: U.rand(-0.8, 5.2),
        z: SPAWN_Z + U.rand(0, 30),
        r: radius,
        hp, maxHp: hp, elite,
        color: elite ? C_ELITE : C_NORMAL,
        points: elite ? Math.round(U.rand(20, 55)) : Math.round(U.rand(5, 12)),
        flash: 0
      });
    }

    update(dt) {
      this.time += dt;
      const drive = this.audio.drive;
      const playing = this.audio.isPlaying;
      const energy = this.energy(dt);
      const beatNow = this.audio.beat;

      // ── beat tracking ──
      this._beatAgo += dt;
      if (beatNow) this._recordBeat();
      this._beatPulse = Math.max(0, this._beatPulse - dt * 2.5);

      // ── speed = tempo ──
      // 120 BPM → 1.0x, 60 → 0.5x, 180 → 1.5x.
      // Until BPM is locked, use bass as a rough guess so it still moves.
      const targetSpeed = this.bpm > 0
        ? U.clamp(this.bpm / REF_BPM, 0.45, 2.6)
        : (0.6 + drive * 1.4);
      this.speedMul = U.smooth(this.speedMul, targetSpeed, 0.35, dt);

      // ── effects fade ──
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt; f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
      this.recoil = Math.max(0, this.recoil - dt * 6);

      // ── THE GATE ──
      if (!playing) return;

      // Safety cap so the screen never completely fills up.
      const cap = 34;

      // ── spawn on the beat: one ball per beat (like a note) ──
      if (beatNow && this.balls.length < cap) {
        const eliteChance = 0.08 + energy * 0.45;
        this.spawn(eliteChance);
        if (drive > 0.9 && this.balls.length < cap) this.spawn(eliteChance);
        if (drive > 1.5 && this.balls.length < cap) this.spawn(eliteChance);
      }

      // Fallback only if the beat detector has been silent for >1.2s
      // (ambient / beatless tracks). Beat-driven tracks never use this.
      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0 && this.balls.length < cap) {
          this.spawn(0.10 + energy * 0.35);
          this._fallbackTimer = 0.75;
        }
      } else {
        this._fallbackTimer = 0.75;
      }

      // ── move balls at the tempo speed ──
      const killRamp = 1 + Math.min(0.5, this.kills / 80);
      for (let i = this.balls.length - 1; i >= 0; i--) {
        const b = this.balls[i];
        const spd = (b.elite ? BASE_SPEED * ELITE_MUL : BASE_SPEED)
                  * this.speedMul * killRamp;
        b.z += spd * dt;
        b.flash = Math.max(0, b.flash - dt * 4);
        if (b.z > this.r.camera.z - 1.2) {
          this.balls.splice(i, 1);
          this.hitFlash = 1;
          this.loseLife();
          this.shell.toast('Ouch! ' + this.lives + ' lives left', 1100);
        }
      }

      if (this.input.firing) this.shoot();
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

      // red damage flash
      if (this.hitFlash > 0) {
        r.rect(0, 0, r.w, r.h, 'rgba(255,60,60,' + (this.hitFlash * 0.28).toFixed(3) + ')');
      }

      // green beat flash on the top and bottom edges
      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.45).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(123,211,137,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(123,211,137,' + a + ')');
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

      const s = this.aimScreen();
      const pulse = 16 + this.recoil * 10;
      r.rect(s.x - pulse / 2, s.y - 1, pulse, 2, 'rgba(159,198,255,.30)');
      r.rect(s.x - 1, s.y - pulse / 2, 2, pulse, 'rgba(159,198,255,.30)');

      // BPM readout so you can watch the lock
      const bpmText = this.bpm > 0
        ? '♪ ' + Math.round(this.bpm) + ' BPM  ×' + this.speedMul.toFixed(2)
        : '♪ listening…';
      r.text(80, 20, bpmText, '#8fb8ff', 13, 'left', 700);
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };
      const spd = BASE_SPEED * this.speedMul;
      let target = null, bestScore = Infinity;
      for (const b of this.balls) {
        const ballSpd = b.elite ? spd * ELITE_MUL : spd;
        const tta = (this.r.camera.z - 1.2 - b.z) / Math.max(1, ballSpd);
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
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
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
    blurb: 'Spheres rush the camera at the tempo of your track. Beat and bass decide how many red elites show up.',
    hint: 'Click to shoot · balls move at the song\'s BPM · red elites get more common as the music heats up',
    create: (shell) => new Blast(shell)
  });
})();