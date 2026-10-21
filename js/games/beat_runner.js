/* ============================================================
   beat_runner.js — BEAT RUNNER (auto-runner / jump)
   Obstacles spawn on beats and fly at the player along a
   forward-scrolling ground. Tap to jump. Land before the next
   one. On-beat jumps clear obstacles for double points. Orbs
   drop on treble onsets. No music = no obstacles.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const SPAWN_Z   = -100;
  const PLAYER_Z  = 0;
  const GROUND_Y  = -1.3;
  const PLAYER_R  = 0.55;
  const JUMP_V    = 7.5;
  const GRAVITY   = 22;
  const BASE_SPEED = 22;

  class BeatRunner extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#0d1a2e', bottom: '#05060a' };
    }

    reset() {
      this.py = GROUND_Y + PLAYER_R;
      this.pvy = 0;
      this.onGround = true;
      this.obstacles = [];
      this.orbs = [];
      this.fx = [];
      this.score = 0;
      this.lives = 3;
      this.survived = 0;
      this.jumps = 0;
      this.onBeatJumps = 0;
      this.cleared = 0;
      this.speedMul = 1;
      this.multiplier = 1;

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._downbeatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 0.8;
      this._prevFiring = false;
      this._jumpBeatFlash = 0;

      const c = this.r.camera;
      c.x = 0; c.y = 1.6; c.z = 5; c.yaw = 0; c.pitch = 0;
    }

    _recordBeat() {
      this._beatTimes.push(this.time);
      if (this._beatTimes.length > 10) this._beatTimes.shift();
      this._beatAgo = 0;
      this._beatPulse = 1;
      if (this._beatTimes.length < 4) return;
      const gaps = [];
      for (let i = 1; i < this._beatTimes.length; i++) gaps.push(this._beatTimes[i] - this._beatTimes[i - 1]);
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      if (median < 0.20 || median > 2.0) return;
      const newBpm = 60 / median;
      this.bpm = this.bpm > 0 ? this.bpm * 0.7 + newBpm * 0.3 : newBpm;
    }

    spawnObstacle(kind) {
      let r = 0.7, color = '#4cc9f0', height = 0.7;
      if (kind === 'tall')      { r = 0.55; color = '#a78bfa'; height = 1.5; }
      else if (kind === 'wide') { r = 0.9;  color = '#ff6b6b'; height = 0.55; }
      this.obstacles.push({
        x: 0, z: SPAWN_Z + U.rand(0, 25),
        r, height, color, kind, passed: false
      });
    }

    spawnOrb() {
      this.orbs.push({
        x: U.rand(-4, 4),
        y: GROUND_Y + U.rand(1.5, 3.2),
        z: SPAWN_Z + U.rand(20, 60),
        r: 0.35,
        color: '#ffd166'
      });
    }

    update(dt) {
      this.time += dt;
      const audio = this.audio;
      const playing = audio.isPlaying;
      const energy = this.energy(dt);

      const beatNow   = audio.beat;
      const downbeat  = audio.isDownbeat;
      const trebleHit = audio.trebleBeat;
      const bar       = audio.bar;

      const justDown = this.input.firing && !this._prevFiring;
      this._prevFiring = this.input.firing;

      this._beatAgo += dt;
      if (beatNow) this._recordBeat();
      this._beatPulse = Math.max(0, this._beatPulse - dt * 2.5);
      if (downbeat) this._downbeatPulse = 1;
      this._downbeatPulse = Math.max(0, this._downbeatPulse - dt * 1.8);
      this._jumpBeatFlash = Math.max(0, this._jumpBeatFlash - dt * 3);

      this.multiplier = Math.min(16, Math.pow(2, bar % 5));

      const targetSpeed = this.bpm > 0
        ? U.clamp(this.bpm / 120, 0.55, 2.4)
        : (0.7 + energy * 1.2);
      this.speedMul = U.smooth(this.speedMul, targetSpeed, 0.3, dt);

      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }

      // ── Jump physics ──
      if (justDown && this.onGround) {
        this.pvy = -JUMP_V;
        this.onGround = false;
        this.jumps++;
        if (this.bpm > 0 && audio.beatPhase < 0.08) {
          this.onBeatJumps++;
          this._jumpBeatFlash = 1;
        }
      }
      this.pvy += GRAVITY * dt;
      this.py += this.pvy * dt;
      if (this.py >= GROUND_Y + PLAYER_R) {
        this.py = GROUND_Y + PLAYER_R;
        this.pvy = 0;
        this.onGround = true;
      }

      // ────────── THE GATE ──────────
      if (!playing) return;

      this.survived += dt;
      this.score += this.survived * 8 * this.multiplier;

      if (beatNow) {
        let kind = 'normal';
        if (downbeat && energy > 0.5) kind = 'tall';
        else if (trebleHit && Math.random() < 0.4) kind = 'wide';
        this.spawnObstacle(kind);
      }
      if (trebleHit && Math.random() < 0.6) this.spawnOrb();

      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0) {
          this.spawnObstacle('normal');
          this._fallbackTimer = 0.8;
        }
      } else {
        this._fallbackTimer = 0.8;
      }

      const worldSpeed = BASE_SPEED * this.speedMul * (1 + this.survived * 0.01);
      const dx = worldSpeed * dt;
      for (const o of this.obstacles) o.z += dx;
      for (const o of this.orbs) o.z += dx;

      // ── Obstacle resolution ──
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        if (o.z > 3) { this.obstacles.splice(i, 1); continue; }
        if (!o.passed && o.z >= PLAYER_Z) {
          o.passed = true;
          const gapTop = GROUND_Y + o.height;
          const playerBottom = this.py - PLAYER_R;
          if (playerBottom < gapTop) {
            this.lives--;
            this.fx.push({ x: 0, y: this.py, z: PLAYER_Z, r: 0.8, color: '#ff4d4f', life: 0.4, maxLife: 0.4 });
            this.shell.toast('Hit! ' + this.lives + ' lives left', 900);
            if (this.lives <= 0) { this.die('Ran into an obstacle.'); return; }
          } else {
            this.cleared++;
            const onBeatJump = this._jumpBeatFlash > 0;
            this.score += (onBeatJump ? 100 : 50) * this.multiplier;
            this._jumpBeatFlash = 0;
            this.fx.push({ x: 0, y: this.py + 0.6, z: PLAYER_Z, r: 0.6,
                           color: onBeatJump ? '#fff7d4' : '#7bd389', life: 0.3, maxLife: 0.3 });
          }
          this.obstacles.splice(i, 1);
        }
      }

      // ── Orb pickup ──
      for (let i = this.orbs.length - 1; i >= 0; i--) {
        const o = this.orbs[i];
        if (o.z > 3) { this.orbs.splice(i, 1); continue; }
        if (Math.abs(o.z - PLAYER_Z) < 1.0) {
          const d = Math.hypot(o.x - 0, o.y - this.py);
          if (d < PLAYER_R + o.r + 0.2) {
            this.score += 25 * this.multiplier;
            this.fx.push({ x: o.x, y: o.y, z: o.z, r: 0.4, color: '#ffd166', life: 0.3, maxLife: 0.3 });
            this.orbs.splice(i, 1);
          }
        }
      }
    }

    draw() {
      const r = this.r;

      const step = 5, span = 90;
      const phase = (this.time * this.speedMul * 8) % step;
      for (let z = -span; z <= span; z += step) {
        r.line({ x: -span, y: GROUND_Y, z: z + phase }, { x: span, y: GROUND_Y, z: z + phase }, '#2b3f66', 1, 0.4);
      }
      for (let x = -span; x <= span; x += step) {
        r.line({ x, y: GROUND_Y, z: -span }, { x, y: GROUND_Y, z: span }, '#2b3f66', 1, 0.4);
      }

      if (this._beatPulse > 0) {
        const a = (this._beatPulse * 0.35).toFixed(3);
        r.rect(0, 0, r.w, 5, 'rgba(76,201,240,' + a + ')');
        r.rect(0, r.h - 5, r.w, 5, 'rgba(76,201,240,' + a + ')');
      }
      if (this._downbeatPulse > 0) {
        const a = (this._downbeatPulse * 0.12).toFixed(3);
        r.rect(0, 0, r.w, r.h, 'rgba(167,139,250,' + a + ')');
      }

      for (const o of this.obstacles) {
        if (o.z > 8) continue;
        r.sphere({ x: o.x, y: GROUND_Y + o.height / 2, z: o.z }, o.r, o.color,
          { glow: true, ring: '#ffffff', ringAlpha: 0.4, ringWidth: 2 });
      }

      for (const o of this.orbs) {
        if (o.z > 8) continue;
        r.sphere({ x: o.x, y: o.y, z: o.z }, o.r, o.color, { glow: true });
      }

      const jumping = this._jumpBeatFlash > 0.1;
      r.sphere({ x: 0, y: this.py, z: PLAYER_Z }, PLAYER_R, '#ffffff', {
        glow: true,
        ring: jumping ? '#fff7d4' : '#4cc9f0',
        ringWidth: 3
      });

      for (const f of this.fx) {
        const a = f.life / f.maxLife;
        r.ring({ x: f.x, y: f.y, z: f.z }, f.r * (1 + (1 - a) * 2.2), f.color, 3, a);
      }

      r.text(r.w / 2, 32, this.survived.toFixed(1) + 's', '#ffffff', 22, 'center', 800);
      if (this.multiplier > 1) r.text(20, 20, '×' + this.multiplier + ' score', '#7bd389', 13, 'left', 700);
      const bpm = this.bpm > 0 ? '♪ ' + Math.round(this.bpm) + ' BPM' : '♪ listening…';
      r.text(r.w - 20, 20, bpm, '#4cc9f0', 13, 'right', 700);
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };
      if (!this.onGround) return { x: 0, y: 0, fire: false };
      for (const o of this.obstacles) {
        if (o.passed) continue;
        const d = -o.z;
        if (d > 0 && d < 15) return { x: 0, y: 0, fire: true };
      }
      return { x: 0, y: 0, fire: false };
    }

    getStats() {
      return [
        { k: 'Score', v: Math.round(this.score) },
        { k: 'Time', v: this.survived.toFixed(1) + 's' },
        { k: 'Cleared', v: this.cleared },
        { k: 'Jumps', v: this.jumps },
        { k: 'On-beat jumps', v: this.onBeatJumps },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Multiplier', v: '×' + this.multiplier },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'beat-runner',
    name: 'Beat Runner',
    tag: 'Jump',
    color: '#4cc9f0',
    blurb: 'Sprint forward as obstacles spawn on every beat. Jump over them — land before the next one, or on-beat for double points.',
    hint: 'Click or hold to jump · on-beat jumps clear obstacles for 2× · treble onsets drop pickups',
    create: (shell) => new BeatRunner(shell)
  });
})();