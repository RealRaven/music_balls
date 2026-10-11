/* ============================================================
   blast.js — BALL BLAST (reference: full musical reactivity)
   Balls spawn on beats, bursts on downbeats, shards on treble
   onsets, titans on bass build-ups. Speed locked to BPM.
   Player shots deal double damage on the beat.
   No music = no balls.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const REF_BPM    = 120;   // 120 BPM = 1.0× speed
  const BASE_SPEED = 22;    // units/sec at 1.0×
  const SPAWN_Z    = -170;

  /* ---------- ball type table ---------- */
  const BALL_TYPES = {
    grunt: {
      rMin: 0.55, rMax: 1.15,
      hpMin: 9,   hpMax: 18,
      speedMul: 1.00,
      color: '#7bd389',
      pointsMin: 5, pointsMax: 12,
      glow: false
    },
    elite: {
      rMin: 1.10, rMax: 1.90,
      hpMin: 34,  hpMax: 72,
      speedMul: 1.35,
      color: '#ff4d4f',
      pointsMin: 20, pointsMax: 55,
      glow: true
    },
    shard: {
      rMin: 0.30, rMax: 0.55,
      hpMin: 3,   hpMax: 6,
      speedMul: 2.00,
      color: '#4cc9f0',
      pointsMin: 3, pointsMax: 6,
      glow: false
    },
    titan: {
      rMin: 2.20, rMax: 3.20,
      hpMin: 120, hpMax: 200,
      speedMul: 0.60,
      color: '#a78bfa',
      pointsMin: 80, pointsMax: 150,
      glow: true
    }
  };

  /* ---------- object pool for balls ---------- */
  class BallPool {
    constructor() {
      this.free = [];
      this.active = [];
    }
    _make() {
      return {
        x: 0, y: 0, z: 0, r: 0.6,
        hp: 1, maxHp: 1,
        points: 5,
        flash: 0, phase: 0, scale: 1,
        color: '#fff', kind: 'grunt', alive: false
      };
    }
    spawn(cfg) {
      const b = this.free.pop() || this._make();
      for (const k in cfg) b[k] = cfg[k];
      b.alive = true;
      this.active.push(b);
      return b;
    }
    release(b) {
      if (!b.alive) return;
      b.alive = false;
      const i = this.active.indexOf(b);
      if (i >= 0) this.active.splice(i, 1);
      if (this.free.length < 256) this.free.push(b);
    }
    clear() {
      for (const b of this.active) { b.alive = false; this.free.push(b); }
      this.active.length = 0;
    }
  }

  class Blast extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#121a2e', bottom: '#05060a' };
    }

    reset() {
      this.pool = new BallPool();
      this.fx = [];
      this.kills = 0;
      this.score = 0;
      this.lives = 3;
      this.level = 1;
      this.damage = 10;
      this.nextUpgrade = 50;
      this.multiplier = 1;

      this.speedMul = 1;
      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._downbeatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.75;

      this.lastShot = -10;
      this.recoil = 0;
      this.hitFlash = 0;
      this.beatHitFlash = 0;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 5; c.yaw = 0; c.pitch = 0;
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

    spawnBall(kind) {
      const t = BALL_TYPES[kind] || BALL_TYPES.grunt;
      const r = U.rand(t.rMin, t.rMax);
      const hp = Math.round(U.rand(t.hpMin, t.hpMax));
      return this.pool.spawn({
        x: U.rand(-9, 9),
        y: U.rand(-0.8, 5.2),
        z: SPAWN_Z + U.rand(0, 30),
        r, hp, maxHp: hp,
        color: t.color,
        kind,
        points: Math.round(U.rand(t.pointsMin, t.pointsMax)),
        flash: 0,
        phase: U.rand(0, 6.28),
        scale: 1
      });
    }

    /* Choose a ball type from the current musical signals. */
    pickType(energy, downbeat, trebleHit, bassRising) {
      if (downbeat && energy > 0.75 && Math.random() < 0.18) return 'titan';
      if (downbeat) return 'elite';
      if (trebleHit && Math.random() < 0.40) return 'shard';   // ← blue kept as-is
      if (bassRising && energy > 0.45 && Math.random() < 0.35) return 'titan';
      // reds scale with intensity: ~10% when quiet, ~55% at peak
      if (Math.random() < 0.10 + energy * 0.45) return 'elite';
      return 'grunt';
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
      this.beatHitFlash = Math.max(0, this.beatHitFlash - dt * 6);

      // score multiplier cycles 1, 2, 4, 8, 16 with the bar
      this.multiplier = Math.min(16, Math.pow(2, bar % 5));

      // speed from tempo
      const targetSpeed = this.bpm > 0
        ? U.clamp(this.bpm / REF_BPM, 0.45, 2.6)
        : (0.6 + drive * 1.4);
      this.speedMul = U.smooth(this.speedMul, targetSpeed, 0.35, dt);

      // effect fade
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt; f.r += f.grow * dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);
      this.recoil = Math.max(0, this.recoil - dt * 6);

      // ────────── THE GATE ──────────
      if (!playing) return;

      const cap = 40;

      // ── spawn on beat ──
      if (beatNow && this.pool.active.length < cap) {
        const kind = this.pickType(energy, downbeat, trebleHit, bassRising);
        this.spawnBall(kind);
        // extra balls get redder as the music heats up
        if (drive > 1.0 && this.pool.active.length < cap) {
          this.spawnBall(energy > 0.55 ? 'elite' : 'grunt');
        }
        if (drive > 1.5 && this.pool.active.length < cap) {
          this.spawnBall('elite');
        }
      }

      // ── downbeat burst ──
      if (downbeat && energy > 0.5) {
        const n = 3 + Math.round(energy * 2);
        for (let i = 0; i < n && this.pool.active.length < cap; i++) {
          this.spawnBall('grunt');
        }
      }

      // ── treble shards ──
      if (trebleHit && this.pool.active.length < cap && Math.random() < 0.5) {
        this.spawnBall('shard');
      }

      // ── titan every 4 bars ──
      if (barStart && bar > 0 && bar % 4 === 0 && this.pool.active.length < cap) {
        this.spawnBall('titan');
      }

      // ── fallback for beatless tracks ──
      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0 && this.pool.active.length < cap) {
          this.spawnBall('grunt');
          this._fallbackTimer = 0.75;
        }
      } else {
        this._fallbackTimer = 0.75;
      }

      // ── movement ──
      const breathing = 1 + 0.18 * Math.sin(beatPhase * Math.PI * 2);
      const killRamp = 1 + Math.min(0.5, this.kills / 80);
      const balls = this.pool.active;

      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        const t = BALL_TYPES[b.kind] || BALL_TYPES.grunt;
        const spd = BASE_SPEED * t.speedMul * this.speedMul * killRamp * breathing;
        b.z += spd * dt;

        // beat pop — small extra shove forward on the beat
        if (beatNow) b.z += 0.7;

        // rotation ticks on beat, spins otherwise
        b.phase = beatNow ? b.phase + Math.PI / 2 : b.phase + dt * 1.5;

        // scale pulse between beats
        b.scale = 1 + Math.sin(beatPhase * Math.PI) * 0.10;

        b.flash = Math.max(0, b.flash - dt * 4);

        if (b.z > this.r.camera.z - 1.2) {
          this.pool.release(b);
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

      // on-beat shots deal double damage
      const phase = this.audio.beatPhase;
      const locked = this.bpm > 0;
      const onBeat = locked && (phase < 0.04 || phase > 0.96);
      const shotDmg = onBeat ? this.damage * 2 : this.damage;
      if (onBeat) this.beatHitFlash = 1;

      const ray = this.aimRay();
      let best = null, bestT = Infinity;
      for (const b of this.pool.active) {
        const t = U.raySphere(ray.origin, ray.dir, b, b.r);
        if (t !== null && t < bestT) { bestT = t; best = b; }
      }

      if (best) {
        this.damageBall(best, shotDmg);
        this.fx.push({
          p: { x: best.x, y: best.y, z: best.z }, r: best.r,
          life: 0.18, maxLife: 0.18, grow: 6,
          color: onBeat ? '#fff7d4' : '#fff3c4'
        });
      } else {
        const o = ray.origin;
        this.fx.push({
          p: {
            x: o.x + ray.dir.x * 40,
            y: o.y + ray.dir.y * 40,
            z: o.z + ray.dir.z * 40
          },
          r: 0.4, life: 0.12, maxLife: 0.12, grow: 0, color: '#8fb8ff'
        });
      }
    }

    damageBall(b, dmg) {
      b.hp -= dmg;
      b.flash = 1;
      if (b.hp > 0) return;

      this.kills++;
      this.score += b.points * this.multiplier;
      this.fx.push({
        p: { x: b.x, y: b.y, z: b.z }, r: b.r,
        life: 0.32, maxLife: 0.32, grow: b.r * 6, color: b.color
      });
      this.pool.release(b);

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

      // beat pulse on the edges
      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.40).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(123,211,137,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(123,211,137,' + a + ')');
      }

      // downbeat wash
      if (this._downbeatPulse > 0) {
        const a = (this._downbeatPulse * 0.18).toFixed(3);
        r.rect(0, 0, r.w, r.h, 'rgba(47,140,255,' + a + ')');
      }

      // on-beat shot flash
      if (this.beatHitFlash > 0) {
        const a = (this.beatHitFlash * 0.10).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(255,240,150,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(255,240,150,' + a + ')');
      }

      const beatGlow = this._beatPulse > 0.5;

      for (const b of this.pool.active) {
        const t = BALL_TYPES[b.kind] || BALL_TYPES.grunt;
        const info = r.sphere({ x: b.x, y: b.y, z: b.z }, b.r * b.scale, b.color, {
          glow: beatGlow || t.glow,
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

      // HUD
      const bpmText = this.bpm > 0
        ? '♪ ' + Math.round(this.bpm) + ' BPM  ×' + this.speedMul.toFixed(2)
        : '♪ listening…';
      r.text(80, 20, bpmText, '#8fb8ff', 13, 'left', 700);
      if (this.multiplier > 1) {
        r.text(80, 40, '×' + this.multiplier + ' score', '#7bd389', 13, 'left', 700);
      }
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };
      const spd = BASE_SPEED * this.speedMul;
      let target = null, bestScore = Infinity;
      for (const b of this.pool.active) {
        const t = BALL_TYPES[b.kind] || BALL_TYPES.grunt;
        const ballSpd = spd * t.speedMul;
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
        { k: 'Multiplier', v: '×' + this.multiplier },
        { k: 'Weapon', v: 'Lv ' + this.level + ' · ' + this.damage + ' dmg' }
      ];
    }
  }

  Arcade.register({
    id: 'blast',
    name: 'Ball Blast',
    tag: 'Shooter',
    color: '#2f8cff',
    blurb: 'Spheres rush in at the tempo of your track. Downbeats burst, treble drops shards, bass build-ups spawn titans.',
    hint: 'Click to shoot · on-beat shots do double damage · purple titans are worth a lot',
    create: (shell) => new Blast(shell)
  });
})();