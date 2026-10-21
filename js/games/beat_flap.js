/* ============================================================
   beat_flap.js — BEAT FLAP (Space Crow)
   Tap to flap. Giant planets spawn on the start of every
   measure (4 beats). Scroll speed is locked directly to the
   BPM, keeping the distance between planets perfectly constant.
   No music = no obstacles.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const GRAVITY    = 1600;
  const FLAP_VY    = -480;
  const BALL_R     = 130;  // Radius of the obstacle planets
  const BIRD_X     = 0.25; // 25% from the left edge
  const BIRD_R     = 16;
  const BASE_SPEED = 320;  // px/sec at 120 BPM

  class BeatFlap extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#050510', bottom: '#000000' };
    }

    reset() {
      this.birdY  = this.r.h / 2;
      this.birdVY = 0;
      this.pipes  = [];
      this.fx     = [];
      this.stars  = [];
      this.score  = 0;
      this.lives  = 3;
      this.passed = 0;
      this.survived = 0;
      this.speedMul = 1;
      this.multiplier = 1;

      // Generate a starfield for the background
      for (let i = 0; i < 100; i++) {
        this.stars.push({
          x: Math.random() * this.r.w,
          y: Math.random() * this.r.h,
          r: U.rand(0.5, 2.5),
          speed: U.rand(0.2, 1.0),
          color: Math.random() < 0.8 ? '#ffffff' : '#a78bfa'
        });
      }

      this.bpm = 0;
      this._beatTimes = [];
      this._beatPulse = 0;
      this._downbeatPulse = 0;
      this._beatAgo = 99;
      this._fallbackTimer = 2.0;
      this._prevFiring = false;

      // Ensure no leftover camera roll affects the view
      this.r.roll = 0;
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

    spawnPipe(energy) {
      // If BPM is very fast, widen the gap slightly so it remains playable
      const bpmComp = this.bpm > 0 ? U.clamp(120 / this.bpm, 0.8, 1.4) : 1.0;
      const baseGap = 250 - energy * 80;
      const gapH = U.clamp(baseGap * bpmComp, 160, 320);
      
      const phase = this.audio.beatPhase || 0;
      const sway  = Math.sin(phase * Math.PI * 2) * 60;
      
      let gapCenter = this.r.h / 2 + sway + U.rand(-80, 80);
      // Keep the gap fully visible on screen
      gapCenter = U.clamp(gapCenter, gapH / 2 + BALL_R, this.r.h - gapH / 2 - BALL_R);

      this.pipes.push({
        x: this.r.w + BALL_R,
        gapTop: gapCenter - gapH / 2,
        gapBot: gapCenter + gapH / 2,
        passed: false,
        colorTop: Math.random() < 0.5 ? '#ff6b6b' : '#4cc9f0',
        colorBot: Math.random() < 0.5 ? '#a78bfa' : '#ffd166'
      });
    }

    update(dt) {
      this.time += dt;
      const audio = this.audio;
      const playing = audio.isPlaying;
      const energy = this.energy(dt);

      const beatNow   = audio.beat;
      const downbeat  = audio.isDownbeat;
      const barStart  = audio.isBarStart;
      const bar       = audio.bar;

      const justDown = this.input.firing && !this._prevFiring;
      this._prevFiring = this.input.firing;

      this._beatAgo += dt;
      if (beatNow) this._recordBeat();
      this._beatPulse = Math.max(0, this._beatPulse - dt * 2.5);
      if (downbeat) this._downbeatPulse = 1;
      this._downbeatPulse = Math.max(0, this._downbeatPulse - dt * 1.8);

      this.multiplier = Math.min(16, Math.pow(2, bar % 5));

      // Speed scales directly with BPM (120 BPM = 1.0x)
      const targetSpeed = this.bpm > 0
        ? U.clamp(this.bpm / 120, 0.5, 2.2)
        : (0.8 + energy * 0.8);
      this.speedMul = U.smooth(this.speedMul, targetSpeed, 0.3, dt);

      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        f.life -= dt;
        if (f.life <= 0) this.fx.splice(i, 1);
      }

      // ── Crow Physics ──
      if (justDown) {
        this.birdVY = FLAP_VY;
      }
      this.birdVY += GRAVITY * dt;
      this.birdY += this.birdVY * dt;

      // Ceiling / Floor collisions
      if (this.birdY < BIRD_R) {
        this.birdY = BIRD_R;
        this.birdVY = 0;
      }
      if (this.birdY > this.r.h - BIRD_R) {
        this.birdY = this.r.h - BIRD_R;
        this._die('Lost in the void.');
        return;
      }

      // ────────── THE GATE ──────────
      if (!playing) return;

      this.survived += dt;
      this.score += this.survived * 10 * this.multiplier;

      const pxSpeed = BASE_SPEED * this.speedMul;
      const dx = pxSpeed * dt;

      // Move Stars
      for (const s of this.stars) {
        s.x -= s.speed * pxSpeed * 0.1 * dt;
        if (s.x < -10) {
          s.x = this.r.w + 10;
          s.y = Math.random() * this.r.h;
        }
      }

      // ── Spawn Planets on Bar Start (Every 4 beats) ──
      if (barStart) {
        this.spawnPipe(energy);
      } else if (this._beatAgo > 1.2) {
        // Fallback for beatless tracks (spawn every 2 seconds)
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0) {
          this.spawnPipe(energy);
          this._fallbackTimer = 2.0;
        }
      } else {
        this._fallbackTimer = 2.0;
      }

      // ── Move Planets & Check Collisions ──
      const bx = this.r.w * BIRD_X;

      for (let i = this.pipes.length - 1; i >= 0; i--) {
        const p = this.pipes[i];
        p.x -= dx;

        // Scoring
        if (!p.passed && p.x + BALL_R < bx) {
          p.passed = true;
          this.passed++;
          const onBeat = this.bpm > 0 && this.audio.beatPhase < 0.2;
          this.score += (onBeat ? 200 : 100) * this.multiplier;
          this.fx.push({ x: bx, y: this.birdY, text: onBeat ? 'PERFECT' : '+100', color: onBeat ? '#ffd166' : '#7bd389', life: 0.5, maxLife: 0.5 });
        }

        // Cull offscreen
        if (p.x + BALL_R < 0) {
          this.pipes.splice(i, 1);
          continue;
        }

        // Circle-Circle Collision
        if (Math.abs(bx - p.x) < BIRD_R + BALL_R) {
          const topBallY = p.gapTop - BALL_R;
          const botBallY = p.gapBot + BALL_R;

          const distTop = Math.hypot(bx - p.x, this.birdY - topBallY);
          const distBot = Math.hypot(bx - p.x, this.birdY - botBallY);

          if (distTop < BIRD_R + BALL_R || distBot < BIRD_R + BALL_R) {
            this._hitPipe(p);
            return;
          }
        }
      }
    }

    _hitPipe(p) {
      this.lives--;
      this.fx.push({ x: this.r.w * BIRD_X, y: this.birdY, r: 30, color: '#ff4d4f', life: 0.4, maxLife: 0.4 });
      this.shell.toast('Hit! ' + this.lives + ' lives left', 900);
      
      if (this.lives <= 0) {
        this._die('Crashed into a planet.');
      } else {
        // Reset bird and clear immediate planets to give a breather
        this.birdY = this.r.h / 2;
        this.birdVY = 0;
        this.pipes = this.pipes.filter(pp => pp.x > this.r.w); 
      }
    }

    _die(msg) {
      this.lives = 0;
      this.die(msg);
    }

    /* Reusable pseudo-3D ball renderer for planets */
    _drawPlanet(ctx, x, y, r, color, beatGlow) {
      if (beatGlow) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fill();
        ctx.restore();
      }

      const g = ctx.createRadialGradient(
        x - r * 0.4, y - r * 0.4, r * 0.05,
        x, y, r
      );
      g.addColorStop(0, U.lighten(color, 0.6));
      g.addColorStop(0.5, color);
      g.addColorStop(1, U.darken(color, 0.8));

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    draw() {
      const ctx = this.r.ctx;
      const w = this.r.w;
      const h = this.r.h;

      // 1. Space Background
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, this.bg.top);
      grad.addColorStop(1, this.bg.bottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Draw Stars
      for (const s of this.stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 0.4 + s.speed * 0.6;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const beatGlow = this._beatPulse > 0.5;
      const bx = w * BIRD_X;

      // 2. Planets (Obstacles)
      for (const p of this.pipes) {
        const topY = p.gapTop - BALL_R;
        const botY = p.gapBot + BALL_R;

        this._drawPlanet(ctx, p.x, topY, BALL_R, p.colorTop, beatGlow);
        this._drawPlanet(ctx, p.x, botY, BALL_R, p.colorBot, beatGlow);
      }

      // 3. The Space Crow
      ctx.save();
      ctx.translate(bx, this.birdY);
      const tilt = U.clamp(this.birdVY / 800, -0.5, 1.2);
      ctx.rotate(tilt);

      // Body
      ctx.beginPath();
      ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Animated Wings (Flap faster on high BPM)
      const flapSpeed = 15 + this.speedMul * 10;
      const wingFlap = Math.sin(this.time * flapSpeed) * 8;
      ctx.beginPath();
      ctx.moveTo(-5, -2);
      ctx.quadraticCurveTo(-20, -15 + wingFlap, -15, 5);
      ctx.fillStyle = '#111';
      ctx.fill();

      // Beak
      ctx.beginPath();
      ctx.moveTo(BIRD_R - 3, -2);
      ctx.lineTo(BIRD_R + 14, 2);
      ctx.lineTo(BIRD_R - 3, 6);
      ctx.closePath();
      ctx.fillStyle = '#666';
      ctx.fill();

      // Glowing Red Eye
      ctx.beginPath();
      ctx.arc(7, -4, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3333';
      ctx.shadowColor = '#ff3333';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.restore();

      // 4. FX
      for (const f of this.fx) {
        const a = f.life / f.maxLife;
        if (f.text) {
          ctx.globalAlpha = a;
          ctx.fillStyle = f.color;
          ctx.font = 'bold 24px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(f.text, f.x, f.y - (1 - a) * 40);
        } else {
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.arc(f.x, f.y, (f.r || 10) * (1 + (1 - a) * 2), 0, Math.PI * 2);
          ctx.strokeStyle = f.color;
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // 5. HUD
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(Math.floor(this.score), w / 2, 45);

      if (this.multiplier > 1) {
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#7bd389';
        ctx.fillText('x' + this.multiplier + ' multiplier', w / 2, 70);
      }

      const bpmText = this.bpm > 0 ? '♪ ' + Math.round(this.bpm) + ' BPM' : '♪ listening…';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#a78bfa';
      ctx.fillText(bpmText, w - 20, 20);

      // Screen flash on beat
      if (this._beatPulse > 0) {
        ctx.fillStyle = 'rgba(167,139,250,' + (this._beatPulse * 0.1).toFixed(3) + ')';
        ctx.fillRect(0, 0, w, h);
      }
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };
      
      const bx = this.r.w * BIRD_X;
      let nextPipe = null;
      for (const p of this.pipes) {
        if (p.x + BALL_R > bx) {
          if (!nextPipe || p.x < nextPipe.x) nextPipe = p;
        }
      }

      if (!nextPipe) return { x: 0, y: 0, fire: false };

      const targetY = nextPipe.gapTop + (nextPipe.gapBot - nextPipe.gapTop) / 2;
      const distToPipe = nextPipe.x - bx;
      
      if (this.birdY > targetY + 20 && this.birdVY > -100) {
        return { x: 0, y: 0, fire: true };
      }
      if (this.birdY > targetY + 70 && distToPipe < 200) {
        return { x: 0, y: 0, fire: true };
      }
      
      return { x: 0, y: 0, fire: false };
    }

    getStats() {
      return [
        { k: 'Score', v: Math.floor(this.score) },
        { k: 'Time', v: this.survived.toFixed(1) + 's' },
        { k: 'Planets', v: this.passed },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Multiplier', v: '×' + this.multiplier },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'beat-flap',
    name: 'Beat Flap',
    tag: 'Reflex',
    color: '#a78bfa',
    blurb: 'Pilot a space crow through an asteroid field of giant reactive planets. The speed perfectly matches the music BPM.',
    hint: 'Click to flap · on-beat passes pay double · tighter gaps when the music heats up',
    create: (shell) => new BeatFlap(shell)
  });
})();