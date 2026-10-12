/* ============================================================
   rhythm.js — BALL RHYTHM (full musical reactivity)
   Notes spawn strictly on the beat and stream down three lanes
   at the tempo of the music. Downbeats drop gold centre notes,
   bar starts drop 3-lane chords, treble drops fast shards and
   bass build-ups send slow heavies. Bar multiplier and PERFECT
   streak bonus on top. No music = no notes.
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

  const LANE_COLORS = ['#ff6b6b', '#4cc9f0', '#ffd166'];

  /* ---------- note type table ---------- */
  const NOTE_TYPES = {
    normal: {
      rMin: 0.80, rMax: 0.92,
      speedMul: 1.00,
      kindMul: 1.0,
      glow: true
    },
    gold: {
      rMin: 0.95, rMax: 1.05,
      speedMul: 0.90,
      kindMul: 2.0,
      color: '#ffd166',
      glow: true
    },
    shard: {
      rMin: 0.50, rMax: 0.65,
      speedMul: 1.60,
      kindMul: 1.5,
      color: '#4cc9f0',
      glow: true
    },
    heavy: {
      rMin: 1.20, rMax: 1.45,
      speedMul: 0.70,
      kindMul: 2.0,
      color: '#a78bfa',
      glow: true
    }
  };

  /* ---------- object pool ---------- */
  class NotePool {
    constructor() {
      this.free = [];
      this.active = [];
    }
    _make() {
      return {
        x: 0, y: 1.6, z: 0, r: 0.85,
        speedMul: 1,
        lane: 1,
        color: '#fff',
        kind: 'normal',
        kindMul: 1,
        glow: true,
        hit: false,
        phase: 0,
        scale: 1
      };
    }
    spawn(cfg) {
      const n = this.free.pop() || this._make();
      for (const k in cfg) n[k] = cfg[k];
      n.hit = false;
      this.active.push(n);
      return n;
    }
    release(n) {
      const i = this.active.indexOf(n);
      if (i >= 0) this.active.splice(i, 1);
      if (this.free.length < 128) this.free.push(n);
    }
    clear() {
      for (const n of this.active) this.free.push(n);
      this.active.length = 0;
    }
  }

  class Rhythm extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#241436', bottom: '#05060a' };
    }

    reset() {
      this.pool = new NotePool();
      this.fx = [];
      this.score = 0;
      this.lives = 5;
      this.combo = 0;
      this.bestCombo = 0;
      this.perfect = 0;
      this.good = 0;
      this.missed = 0;
      this.hits = 0;
      this.perfectStreak = 0;
      this.bestPerfectStreak = 0;
      this.multiplier = 1;
      this.speedMul = 1;
      this.lastShot = -10;
      this.lastJudgement = '';
      this.judgeLife = 0;
      this._lastLane = -1;

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._downbeatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.75;

      // clear any camera roll left over from previous games
      this.r.roll = 0;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 7; c.yaw = 0; c.pitch = 0;
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

    /* Pick a lane that isn't the same as the last one. */
    pickLane(forceLane) {
      if (forceLane !== undefined && forceLane !== null) {
        this._lastLane = forceLane;
        return forceLane;
      }
      let lane = U.randInt(0, 2);
      if (lane === this._lastLane) lane = (lane + 1 + U.randInt(0, 1)) % 3;
      this._lastLane = lane;
      return lane;
    }

    /* Choose a note type from musical signals (non-downbeat case). */
    pickNoteType(energy, bassRising, trebleHit) {
      if (bassRising && energy > 0.55 && Math.random() < 0.30) return 'heavy';
      if (trebleHit && Math.random() < 0.45) return 'shard';
      return 'normal';
    }

    spawnNote(kind, lane) {
      const t = NOTE_TYPES[kind] || NOTE_TYPES.normal;
      const r = U.rand(t.rMin, t.rMax);
      const color = t.color || LANE_COLORS[lane] || '#ffffff';
      return this.pool.spawn({
        x: LANES[lane],
        y: 1.6,
        z: SPAWN_Z,
        r,
        speedMul: t.speedMul,
        lane,
        color,
        kind,
        kindMul: t.kindMul,
        glow: t.glow,
        phase: U.rand(0, 6.28),
        scale: 1
      });
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
      this.judgeLife = Math.max(0, this.judgeLife - dt);

      // bar multiplier cycles 1, 2, 4, 8, 16
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

      const cap = 26;

      // ── spawn on beat ──
      if (beatNow && this.pool.active.length < cap) {
        if (downbeat) {
          if (barStart && energy > 0.35 && this.pool.active.length + 3 <= cap) {
            // bar-start chord: all three lanes
            this.spawnNote('gold', 0);
            this.spawnNote('gold', 1);
            this.spawnNote('gold', 2);
          } else {
            // regular downbeat: gold centre
            this.spawnNote('gold', this.pickLane(1));
          }
        } else {
          // regular beat: type from musical signals, side lane
          const kind = this.pickNoteType(energy, bassRising, trebleHit);
          const lane = this.pickLane();
          this.spawnNote(kind, lane);
        }

        // extra notes on high drive
        if (drive > 1.2 && this.pool.active.length < cap) {
          const kind = this.pickNoteType(energy, bassRising, trebleHit);
          const lane = this.pickLane();
          this.spawnNote(kind, lane);
        }
      }

      // ── treble shards on their own (in addition to any spawned) ──
      if (trebleHit && this.pool.active.length < cap && Math.random() < 0.35) {
        const lane = this.pickLane();
        this.spawnNote('shard', lane);
      }

      // ── fallback for beatless tracks ──
      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0 && this.pool.active.length < cap) {
          this.spawnNote('normal', this.pickLane());
          this._fallbackTimer = 0.75;
        }
      } else {
        this._fallbackTimer = 0.75;
      }

      // ── note motion ──
      const breathing = 1 + 0.10 * Math.sin(beatPhase * Math.PI * 2);
      const notes = this.pool.active;

      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        const spd = BASE_SPEED * n.speedMul * this.speedMul * breathing;
        n.z += spd * dt;

        // beat pop
        if (beatNow) n.z += 0.8;

        // scale pulse between beats
        n.scale = 1 + Math.sin(beatPhase * Math.PI) * 0.08;

        if (!n.hit && n.z > HIT_Z + 6) {
          this.pool.release(n);
          this.missed++;
          this.combo = 0;
          this.perfectStreak = 0;
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

      // closest un-hit note to the ring
      let target = null, best = Infinity;
      for (const n of this.pool.active) {
        if (n.hit) continue;
        const d = Math.abs(n.z - HIT_Z);
        if (d < best) { best = d; target = n; }
      }
      if (!target) return;

      target.hit = true;
      this.pool.release(target);

      let label, color, base;
      if (best < 2.2)      { label = 'PERFECT'; color = '#ffd166'; base = 300; this.perfect++; this.perfectStreak++; }
      else if (best < 6)   { label = 'GOOD';    color = '#7bd389'; base = 150; this.good++;    this.perfectStreak = 0; }
      else if (best < 12)  { label = 'OK';      color = '#8fb8ff'; base = 50;  this.perfectStreak = 0; }
      else                 { label = 'EARLY';   color = '#93a4b8'; base = 10;  this.perfectStreak = 0; }

      // PERFECT streak bonus: +10% per consecutive perfect, capped at +100%
      const streakMul = 1 + Math.min(1.0, this.perfectStreak * 0.10);
      this.bestPerfectStreak = Math.max(this.bestPerfectStreak, this.perfectStreak);

      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);

      const comboMul = 1 + Math.floor(this.combo / 5);
      const gained = Math.round(base * target.kindMul * this.multiplier * comboMul * streakMul);
      this.score += gained;
      this.hits++;

      this.judge(label, color);
      this.fx.push({
        p: { x: target.x, y: target.y, z: target.z }, r: target.r,
        life: 0.3, maxLife: 0.3, grow: 8, color
      });
    }

    judge(text, color) {
      this.lastJudgement = text;
      this.judgeColor = color;
      this.judgeLife = 0.8;
    }

    draw() {
      const r = this.r;
      r.grid(-1.5, 90, 5, '#4a2f6b', 0.2);

      // downbeat wash
      if (this._downbeatPulse > 0) {
        const a = (this._downbeatPulse * 0.14).toFixed(3);
        r.rect(0, 0, r.w, r.h, 'rgba(255,209,102,' + a + ')');
      }

      // beat pulse edges
      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.35).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(255,209,102,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(255,209,102,' + a + ')');
      }

      // lane guides
      for (const x of LANES) {
        r.line({ x, y: -1.5, z: SPAWN_Z }, { x, y: -1.5, z: 8 }, '#6b4f96', 1, 0.4);
      }

      // timing ring
      const ringR = 3.2;
      r.ring({ x: 0, y: 1.6, z: HIT_Z }, ringR, '#ffd166', 3, 0.75);
      r.ring({ x: 0, y: 1.6, z: HIT_Z }, ringR * 0.62, '#ffd166', 1, 0.35);

      // beat pulse on the ring
      if (this._beatPulse > 0) {
        const a = this._beatPulse;
        r.ring({ x: 0, y: 1.6, z: HIT_Z }, ringR * (1 + 0.25 * (1 - a)), '#ffffff', 2, a * 0.8);
      }

      // downbeat ring — bigger, warmer
      if (this._downbeatPulse > 0) {
        const a = this._downbeatPulse;
        r.ring({ x: 0, y: 1.6, z: HIT_Z }, ringR * (1 + 0.55 * (1 - a)), '#ffd166', 3, a * 0.9);
        r.ring({ x: 0, y: 1.6, z: HIT_Z }, ringR * (1 + 0.90 * (1 - a)), '#fff7d4', 1, a * 0.6);
      }

      // notes
      const beatGlow = this._beatPulse > 0.5;
      for (const n of this.pool.active) {
        r.sphere({ x: n.x, y: n.y, z: n.z }, n.r * n.scale, n.color, {
          glow: n.glow || beatGlow,
          ring: n.kind === 'gold' || n.kind === 'heavy' ? '#ffffff' : null,
          ringAlpha: 0.35 + this._beatPulse * 0.35,
          ringWidth: n.kind === 'heavy' ? 3 : 2
        });
      }

      for (const f of this.fx) {
        r.ring(f.p, f.r, f.color, 3, f.life / f.maxLife);
      }

      // judgement text
      if (this.judgeLife > 0) {
        r.text(r.w / 2, r.h * 0.30, this.lastJudgement, this.judgeColor, 40, 'center', 900);
      }
      if (this.combo > 1) {
        r.text(r.w / 2, r.h * 0.30 + 40, 'COMBO x' + this.combo, '#ffffff', 16, 'center', 700);
      }
      if (this.perfectStreak >= 3) {
        r.text(r.w / 2, r.h * 0.30 + 64,
          'PERFECT STREAK ' + this.perfectStreak +
          '  (+' + Math.min(100, this.perfectStreak * 10) + '%)',
          '#ffd166', 14, 'center', 800);
      }

      // HUD
      if (this.multiplier > 1) {
        r.text(20, 20, '×' + this.multiplier + ' score', '#ffd166', 13, 'left', 700);
      }
      const bpmText = this.bpm > 0
        ? '♪ ' + Math.round(this.bpm) + ' BPM  ×' + this.speedMul.toFixed(2)
        : '♪ listening…';
      r.text(r.w - 20, 20, bpmText, '#ffd166', 13, 'right', 700);
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };
      let target = null, best = Infinity;
      for (const n of this.pool.active) {
        if (n.hit) continue;
        const d = Math.abs(n.z - HIT_Z);
        if (d < best) { best = d; target = n; }
      }
      if (!target) return { x: 0, y: 0, fire: false };
      const aim = this.worldToNdc({ x: target.x, y: target.y, z: target.z }) || { x: 0, y: 0 };
      return { x: aim.x, y: aim.y, fire: best < 1.6 };
    }

    getStats() {
      const total = this.hits + this.missed;
      const acc = total > 0 ? Math.round((this.hits / total) * 100) : 100;
      return [
        { k: 'Score', v: this.score },
        { k: 'Perfect', v: this.perfect },
        { k: 'Good', v: this.good },
        { k: 'Missed', v: this.missed },
        { k: 'Accuracy', v: acc + '%' },
        { k: 'Best streak', v: this.bestPerfectStreak },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Multiplier', v: '×' + this.multiplier },
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
    blurb: 'Notes stream down three lanes at the tempo of the track. Downbeats drop gold centre notes, bar starts drop chords. Fire when they cross the golden ring.',
    hint: 'Click when a ball hits the ring · PERFECT = 300 × kind × bar × combo · streak bonuses stack',
    create: (shell) => new Rhythm(shell)
  });
})();