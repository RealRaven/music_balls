/* ============================================================
   rhythm.js — BALL RHYTHM
   Notes spawn strictly on the beat and stream down three lanes
   at the tempo of the music. Fire when they cross the golden
   ring for a PERFECT. No music = no notes.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const LANES = [-4.2, 0, 4.2];
  const HIT_Z = 0;
  const SPAWN_Z = -95;
  const REF_BPM = 120;
  const BASE_SPEED = 26;

  class Rhythm extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#241436', bottom: '#05060a' };
    }

    reset() {
      this.notes = [];
      this.fx = [];
      this.score = 0;
      this.lives = 5;
      this.combo = 0;
      this.bestCombo = 0;
      this.perfect = 0;
      this.good = 0;
      this.missed = 0;
      this.speedMul = 1;
      this.lastShot = -10;
      this.lastJudgement = '';
      this.judgeLife = 0;

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.75;
      this._lastLane = -1;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 7; c.yaw = 0; c.pitch = 0;
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

    spawn() {
      // avoid spawning in the same lane as the previous note
      let lane = U.randInt(0, 2);
      if (lane === this._lastLane) lane = (lane + 1 + U.randInt(0, 1)) % 3;
      this._lastLane = lane;
      this.notes.push({
        x: LANES[lane],
        y: 1.6,
        z: SPAWN_Z,
        r: 0.85,
        color: ['#ff6b6b', '#4cc9f0', '#ffd166'][lane],
        hit: false
      });
    }

    update(dt) {
      this.time += dt;
      const drive = this.audio.drive;
      const playing = this.audio.isPlaying;
      const beatNow = this.audio.beat;

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
      this.judgeLife = Math.max(0, this.judgeLife - dt);

      // ────────── THE GATE ──────────
      if (!playing) return;

      const cap = 22;

      // spawn strictly on the beat
      if (beatNow && this.notes.length < cap) {
        this.spawn();
        if (drive > 1.2 && this.notes.length < cap) this.spawn();  // double notes at high intensity
      }
      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0 && this.notes.length < cap) {
          this.spawn();
          this._fallbackTimer = 0.75;
        }
      } else {
        this._fallbackTimer = 0.75;
      }

      const speed = BASE_SPEED * this.speedMul;

      for (let i = this.notes.length - 1; i >= 0; i--) {
        const n = this.notes[i];
        n.z += speed * dt;

        if (!n.hit && n.z > HIT_Z + 6) {
          this.notes.splice(i, 1);
          this.missed++;
          this.combo = 0;
          this.loseLife();
          this.judge('MISS', '#ff4d4f');
          if (this.over) return;
        }
      }

      if (this.input.firing) this.fire();
    }

    fire() {
      if (this.time - this.lastShot < 0.11) return;
      this.lastShot = this.time;

      let target = null, best = Infinity;
      for (const n of this.notes) {
        if (n.hit) continue;
        const d = Math.abs(n.z - HIT_Z);
        if (d < best) { best = d; target = n; }
      }
      if (!target) return;

      target.hit = true;
      const idx = this.notes.indexOf(target);
      if (idx >= 0) this.notes.splice(idx, 1);

      let label, color, pts;
      if (best < 2.2) { label = 'PERFECT'; color = '#ffd166'; pts = 300; this.perfect++; }
      else if (best < 6) { label = 'GOOD'; color = '#7bd389'; pts = 150; this.good++; }
      else if (best < 12) { label = 'OK'; color = '#8fb8ff'; pts = 50; }
      else { label = 'EARLY'; color = '#93a4b8'; pts = 10; }

      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += pts * (1 + Math.floor(this.combo / 5));
      this.judge(label, color);
      this.fx.push({ p: { x: target.x, y: target.y, z: target.z }, r: target.r, life: 0.3, maxLife: 0.3, grow: 8, color });
    }

    judge(text, color) {
      this.lastJudgement = text;
      this.judgeColor = color;
      this.judgeLife = 0.8;
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#4a2f6b', 0.2);

      for (const x of LANES) {
        r.line({ x, y: -1.5, z: SPAWN_Z }, { x, y: -1.5, z: 8 }, '#6b4f96', 1, 0.4);
      }

      const ringR = 3.2;
      r.ring({ x: 0, y: 1.6, z: HIT_Z }, ringR, '#ffd166', 3, 0.75);
      r.ring({ x: 0, y: 1.6, z: HIT_Z }, ringR * 0.62, '#ffd166', 1, 0.35);

      // beat pulse around the ring
      if (this._beatPulse > 0) {
        const a = this._beatPulse;
        r.ring({ x: 0, y: 1.6, z: HIT_Z }, ringR * (1 + 0.25 * (1 - a)), '#ffffff', 2, a * 0.8);
      }

      for (const n of this.notes) {
        r.sphere({ x: n.x, y: n.y, z: n.z }, n.r, n.color, { glow: true });
      }

      for (const f of this.fx) {
        r.ring(f.p, f.r, f.color, 3, f.life / f.maxLife);
      }

      if (this.judgeLife > 0) {
        r.text(r.w / 2, r.h * 0.30, this.lastJudgement, this.judgeColor, 40, 'center', 900);
      }
      if (this.combo > 1) {
        r.text(r.w / 2, r.h * 0.30 + 40, 'COMBO x' + this.combo, '#ffffff', 16, 'center', 700);
      }

      const bpmText = this.bpm > 0
        ? '♪ ' + Math.round(this.bpm) + ' BPM  ×' + this.speedMul.toFixed(2)
        : '♪ listening…';
      r.text(r.w - 20, 90, bpmText, '#ffd166', 13, 'right', 700);
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };
      let target = null, best = Infinity;
      for (const n of this.notes) {
        if (n.hit) continue;
        const d = Math.abs(n.z - HIT_Z);
        if (d < best) { best = d; target = n; }
      }
      if (!target) return { x: 0, y: 0, fire: false };
      const aim = this.worldToNdc({ x: target.x, y: target.y, z: target.z }) || { x: 0, y: 0 };
      return { x: aim.x, y: aim.y, fire: best < 1.6 };
    }

    getStats() {
      return [
        { k: 'Score', v: this.score },
        { k: 'Perfect', v: this.perfect },
        { k: 'Good', v: this.good },
        { k: 'Missed', v: this.missed },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Combo', v: 'x' + Math.max(1, this.combo) },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'rhythm',
    name: 'Ball Rhythm',
    tag: 'Timing',
    color: '#ffd166',
    blurb: 'Notes spawn on the beat and stream down three lanes at the tempo of the track. Fire the instant one crosses the golden ring.',
    hint: 'Click when a ball is inside the golden ring · PERFECT = 300 × combo',
    create: (shell) => new Rhythm(shell)
  });
})();