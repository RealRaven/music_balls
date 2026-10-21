/* ============================================================
   beat_tap.js — BEAT TAP (osu!standard style)
   Top-down 2D playfield with pseudo-3D glowing spheres.
   Click numbered circles as the approach ring closes.
   Hold and drag along curved slider paths. Follow arrows show flow.
   No music = no notes.
   ============================================================ */
(function () {
  'use strict';
  const U = window.BallArcade.U;
  const Arcade = window.BallArcade;

  const APPROACH_TIME = 1.2;   // seconds for the ring to shrink
  const HIT_WINDOW    = 0.15;  // ± seconds for a valid click
  const CIRCLE_R      = 38;    // Hit circle radius in px
  const CLICK_R       = 70;    // How close the cursor must be to register a click
  const FOLLOW_R      = 55;    // How close the cursor must be to the slider ball

  class BeatTap extends Arcade.Game {
    constructor(shell) {
      super(shell);
      this.bg = { top: '#0a0a0f', bottom: '#050508' };
    }

    reset() {
      this.objects = [];
      this.fx = [];
      this.score = 0;
      this.lives = 5;
      this.combo = 0;
      this.spawnInterval = 1.0;
      this.activeSlider = null;
      this._prevFiring = false;

      this.cursorX = this.r.w / 2;
      this.cursorY = this.r.h / 2;
      this.cursorTrail = [];

      this.bpm = 0;
      this._beatTimes = [];
      this._beatAgo = 99;
      this._fallbackTimer = 0.9;
      this._lastSliderTime = 0;

      // Ensure no camera roll affects the 2D view
      this.r.roll = 0;
    }

    _recordBeat() {
      this._beatTimes.push(this.time);
      if (this._beatTimes.length > 10) this._beatTimes.shift();
      this._beatAgo = 0;
      if (this._beatTimes.length < 4) return;
      const gaps = [];
      for (let i = 1; i < this._beatTimes.length; i++) gaps.push(this._beatTimes[i] - this._beatTimes[i - 1]);
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      if (median < 0.20 || median > 2.0) return;
      const newBpm = 60 / median;
      this.bpm = this.bpm > 0 ? this.bpm * 0.7 + newBpm * 0.3 : newBpm;
      this.spawnInterval = 60 / this.bpm;
    }

    _getNextNum() {
      let num = 1;
      for (let i = this.objects.length - 1; i >= 0; i--) {
        if (this.objects[i].num) {
          num = this.objects[i].num + 1;
          break;
        }
      }
      return num;
    }

    spawnHit(time) {
      const marginX = this.r.w * 0.15;
      const marginY = this.r.h * 0.15;
      this.objects.push({
        type: 'hit',
        x: U.rand(marginX, this.r.w - marginX),
        y: U.rand(marginY, this.r.h - marginY),
        time: time,
        num: this._getNextNum(),
        hit: false
      });
    }

    spawnSlider(time) {
      const marginX = this.r.w * 0.2;
      const marginY = this.r.h * 0.2;
      
      const startX = U.rand(marginX, this.r.w - marginX);
      const startY = U.rand(marginY, this.r.h - marginY);
      
      const angle = U.rand(0, Math.PI * 2);
      const dist = U.rand(200, 400);
      const endX = U.clamp(startX + Math.cos(angle) * dist, marginX, this.r.w - marginX);
      const endY = U.clamp(startY + Math.sin(angle) * dist, marginY, this.r.h - marginY);
      
      // Create a sweeping S-curve using a cubic bezier
      const ctrl1X = startX + Math.cos(angle) * dist * 0.33 + U.rand(-150, 150);
      const ctrl1Y = startY + Math.sin(angle) * dist * 0.33 + U.rand(-150, 150);
      const ctrl2X = startX + Math.cos(angle) * dist * 0.66 + U.rand(-150, 150);
      const ctrl2Y = startY + Math.sin(angle) * dist * 0.66 + U.rand(-150, 150);

      const points = [];
      const segments = 20;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const omt = 1 - t;
        const x = omt*omt*omt * startX + 3*omt*omt*t * ctrl1X + 3*omt*t*t * ctrl2X + t*t*t * endX;
        const y = omt*omt*omt * startY + 3*omt*omt*t * ctrl1Y + 3*omt*t*t * ctrl2Y + t*t*t * endY;
        points.push({ x: U.clamp(x, 10, this.r.w - 10), y: U.clamp(y, 10, this.r.h - 10) });
      }

      this.objects.push({
        type: 'slider',
        x: points[0].x, y: points[0].y,
        points: points,
        time: time,
        // Hold for roughly 2 beats (or at least 1.2 seconds)
        endTime: time + Math.max(1.2, this.spawnInterval * 2),
        num: this._getNextNum(),
        engaged: false,
        followTime: 0
      });
    }

    _samplePath(points, t) {
      const n = points.length - 1;
      const f = U.clamp(t, 0, 1) * n;
      const i = Math.min(Math.floor(f), n - 1);
      const k = f - i;
      const a = points[i], b = points[i + 1];
      return {
        x: U.lerp(a.x, b.x, k),
        y: U.lerp(a.y, b.y, k)
      };
    }

    update(dt) {
      this.time += dt;
      const audio = this.audio;
      const playing = audio.isPlaying;
      const energy = this.energy(dt);

      const beatNow = audio.beat;
      const downbeat = audio.isDownbeat;

      // Map input to 2D screen coordinates
      this.cursorX = (this.input.nx * 0.5 + 0.5) * this.r.w;
      this.cursorY = (-this.input.ny * 0.5 + 0.5) * this.r.h;

      // Update cursor trail
      this.cursorTrail.push({ x: this.cursorX, y: this.cursorY });
      if (this.cursorTrail.length > 15) this.cursorTrail.shift();

      const justDown = this.input.firing && !this._prevFiring;
      const isHolding = this.input.firing;
      this._prevFiring = this.input.firing;

      this._beatAgo += dt;
      if (beatNow) this._recordBeat();

      if (justDown) this._handleClick();

      // ────────── THE GATE ──────────
      if (!playing) return;

      // Spawning: Frequent sliders to match "long sounds"
      if (beatNow) {
        if (downbeat || energy > 0.5 || this.time - this._lastSliderTime > 4) {
          this.spawnSlider(this.time + APPROACH_TIME);
          this._lastSliderTime = this.time;
        } else {
          this.spawnHit(this.time + APPROACH_TIME);
          if (energy > 0.6 && Math.random() < 0.3) {
            this.spawnHit(this.time + APPROACH_TIME + this.spawnInterval * 0.5);
          }
        }
      }

      if (this._beatAgo > 1.2) {
        this._fallbackTimer -= dt;
        if (this._fallbackTimer <= 0) {
          this.spawnHit(this.time + APPROACH_TIME);
          this._fallbackTimer = 0.9;
        }
      } else {
        this._fallbackTimer = 0.9;
      }

      // Update Objects & Misses
      for (let i = this.objects.length - 1; i >= 0; i--) {
        const obj = this.objects[i];

        // Miss
        if (!obj.hit && !obj.engaged && this.time > obj.time + HIT_WINDOW) {
          this.combo = 0;
          this.lives--;
          this.fx.push({ x: obj.x, y: obj.y, text: 'MISS', color: '#ff4d4f', life: 0.6, maxLife: 0.6 });
          this.objects.splice(i, 1);
          this.shell.toast('Miss! ' + this.lives + ' lives left', 700);
          if (this.lives <= 0) { this.die('Missed too many notes.'); return; }
          continue;
        }

        // Slider Tracking
        if (obj.type === 'slider' && obj.engaged) {
          const duration = obj.endTime - obj.time;
          const progress = U.clamp((this.time - obj.time) / duration, 0, 1);
          const pos = this._samplePath(obj.points, progress);
          
          const dist = Math.hypot(this.cursorX - pos.x, this.cursorY - pos.y);
          if (isHolding && dist < FOLLOW_R) {
            obj.followTime += dt;
          }

          if (progress >= 1) {
            const ratio = obj.followTime / duration;
            if (ratio > 0.75) {
              this.score += 300 * (1 + this.combo * 0.05);
              this.fx.push({ x: pos.x, y: pos.y, text: 'PERFECT', color: '#ffd166', life: 0.6, maxLife: 0.6 });
              this.combo++;
            } else if (ratio > 0.35) {
              this.score += 100;
              this.fx.push({ x: pos.x, y: pos.y, text: 'OK', color: '#7bd389', life: 0.6, maxLife: 0.6 });
              this.combo++;
            } else {
              this.combo = 0;
              this.fx.push({ x: pos.x, y: pos.y, text: 'BREAK', color: '#ff4d4f', life: 0.6, maxLife: 0.6 });
            }
            this.objects.splice(i, 1);
            this.activeSlider = null;
            continue;
          }
        }

        if (obj.type === 'hit' && obj.hit && this.time > obj.time + 0.3) {
          this.objects.splice(i, 1);
        }
      }

      for (let i = this.fx.length - 1; i >= 0; i--) {
        this.fx[i].life -= dt;
        if (this.fx[i].life <= 0) this.fx.splice(i, 1);
      }
    }

    _handleClick() {
      let bestObj = null;
      let minDiff = Infinity;

      for (const obj of this.objects) {
        if (obj.hit || obj.engaged) continue;
        
        const dist = Math.hypot(this.cursorX - obj.x, this.cursorY - obj.y);
        if (dist > CLICK_R) continue; 

        const diff = Math.abs(this.time - obj.time);
        if (diff < minDiff && diff < HIT_WINDOW) {
          minDiff = diff;
          bestObj = obj;
        }
      }

      if (bestObj) {
        if (bestObj.type === 'hit') {
          bestObj.hit = true;
          this.combo++;
          this.score += 300 * (1 + this.combo * 0.05);
          this.fx.push({ x: bestObj.x, y: bestObj.y, text: '300', color: '#ffd166', life: 0.5, maxLife: 0.5 });
        } else if (bestObj.type === 'slider') {
          bestObj.engaged = true;
          bestObj.followTime = 0;
          this.activeSlider = bestObj;
          this.fx.push({ x: bestObj.x, y: bestObj.y, text: 'HOLD', color: '#ffd166', life: 0.5, maxLife: 0.5 });
        }
      }
    }

    /* Pseudo-3D sphere renderer matching the engine's native style */
    _drawBall(ctx, x, y, r, color, glow) {
      if (glow) {
        ctx.save();
        ctx.shadowColor = U.rgba(color, .85);
        ctx.shadowBlur = Math.min(60, r * 0.9);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = U.rgba(color, .35);
        ctx.fill();
        ctx.restore();
      }

      const g = ctx.createRadialGradient(
        x - r * 0.36, y - r * 0.40, r * 0.05,
        x, y, r * 1.04
      );
      g.addColorStop(0, U.lighten(color, 0.72));
      g.addColorStop(0.45, U.lighten(color, 0.12));
      g.addColorStop(1, U.darken(color, 0.55));

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // Specular dot
      ctx.beginPath();
      ctx.arc(x - r * 0.34, y - r * 0.38, r * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fill();
    }

    draw() {
      const ctx = this.r.ctx;
      const w = this.r.w;
      const h = this.r.h;

      // Background
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);

      // Follow Arrows (Connecting lines)
      const sorted = [...this.objects].sort((a, b) => a.time - b.time);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const startX = a.type === 'slider' ? a.points[a.points.length - 1].x : a.x;
        const startY = a.type === 'slider' ? a.points[a.points.length - 1].y : a.y;
        
        const dist = Math.hypot(b.x - startX, b.y - startY);
        if (dist > 100) {
          const angle = Math.atan2(b.y - startY, b.x - startX);
          const ax = startX + Math.cos(angle) * 55;
          const ay = startY + Math.sin(angle) * 55;
          
          ctx.save();
          ctx.translate(ax, ay);
          ctx.rotate(angle);

          ctx.beginPath();
          ctx.moveTo(-Math.min(40, dist - 60), 0);
          ctx.lineTo(-15, 0);
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 3;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-15, -8);
          ctx.lineTo(-15, 8);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fill();
          ctx.restore();
        }
      }

      // Game Objects
      for (const obj of this.objects) {
        const timeLeft = obj.time - this.time;
        const progress = U.clamp(1 - timeLeft / APPROACH_TIME, 0, 1);

        if (obj.type === 'hit') {
          if (obj.hit) continue;

          if (progress > 0) {
            const ringR = CIRCLE_R + (1 - progress) * 80;
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.lineWidth = 3;
            ctx.stroke();
          }

          this._drawBall(ctx, obj.x, obj.y, CIRCLE_R, '#ff5d8f', true);
          
          ctx.beginPath();
          ctx.arc(obj.x, obj.y, CIRCLE_R, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 4;
          ctx.stroke();

          ctx.fillStyle = '#fff';
          ctx.font = 'bold 32px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 4;
          ctx.strokeText(obj.num, obj.x, obj.y);
          ctx.fillText(obj.num, obj.x, obj.y);
        } 
        else if (obj.type === 'slider') {
          // Curved Slider Track
          ctx.beginPath();
          ctx.moveTo(obj.points[0].x, obj.points[0].y);
          for (let i = 1; i < obj.points.length; i++) {
            ctx.lineTo(obj.points[i].x, obj.points[i].y);
          }
          
          // Draw glowing background track
          ctx.strokeStyle = obj.engaged ? 'rgba(255, 209, 102, 0.4)' : 'rgba(255, 209, 102, 0.15)';
          ctx.lineWidth = 40;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();

          // Draw white core track
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = 4;
          ctx.stroke();

          // Slider Ticks
          for (let i = 4; i < obj.points.length - 2; i += 4) {
            ctx.beginPath();
            ctx.arc(obj.points[i].x, obj.points[i].y, 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fill();
          }

          // Tail Circle
          const tail = obj.points[obj.points.length - 1];
          this._drawBall(ctx, tail.x, tail.y, 22, '#ffd166', false);
          ctx.beginPath();
          ctx.arc(tail.x, tail.y, 22, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 4;
          ctx.stroke();

          if (!obj.engaged) {
            if (progress > 0) {
              const ringR = CIRCLE_R + (1 - progress) * 80;
              ctx.beginPath();
              ctx.arc(obj.x, obj.y, ringR, 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(255,255,255,0.6)';
              ctx.lineWidth = 3;
              ctx.stroke();
            }

            this._drawBall(ctx, obj.x, obj.y, CIRCLE_R, '#ffd166', true);
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, CIRCLE_R, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 4;
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 4;
            ctx.strokeText(obj.num, obj.x, obj.y);
            ctx.fillText(obj.num, obj.x, obj.y);
          } else {
            // Moving Slider Ball (Follows the curved path)
            const duration = obj.endTime - obj.time;
            const p = U.clamp((this.time - obj.time) / duration, 0, 1);
            
            // Draw Trail
            for (let i = 1; i <= 6; i++) {
              const trailP = Math.max(0, p - i * 0.025);
              const tp = this._samplePath(obj.points, trailP);
              ctx.beginPath();
              ctx.arc(tp.x, tp.y, 18 - i * 2.5, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255, 209, 102, ${0.6 - i * 0.1})`;
              ctx.fill();
            }

            const pos = this._samplePath(obj.points, p);
            this._drawBall(ctx, pos.x, pos.y, 18, '#ffffff', true);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffd166';
            ctx.lineWidth = 4;
            ctx.stroke();
          }
        }
      }

      // Cursor Trail
      for (let i = 0; i < this.cursorTrail.length; i++) {
        const p = this.cursorTrail[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, i * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(i / this.cursorTrail.length) * 0.4})`;
        ctx.fill();
      }

      // Cursor
      ctx.beginPath();
      ctx.arc(this.cursorX, this.cursorY, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      
      if (this.activeSlider) {
        // Locked-on glowing cursor while holding a slider
        ctx.beginPath();
        ctx.arc(this.cursorX, this.cursorY, 16, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.shadowColor = '#ffd166';
        ctx.shadowBlur = 15;
      } else {
        ctx.beginPath();
        ctx.arc(this.cursorX, this.cursorY, 14, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      // FX & HUD
      for (const f of this.fx) {
        const a = f.life / f.maxLife;
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText(f.text, f.x, f.y - (1 - a) * 40);
        ctx.fillText(f.text, f.x, f.y - (1 - a) * 40);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('Score: ' + Math.floor(this.score), 20, 20);
      
      if (this.combo > 1) {
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('Combo: ' + this.combo + 'x', 20, 55);
      }

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Lives: ' + this.lives, w - 20, 25);
    }

    ai() {
      if (!this.audio.isPlaying) return { x: 0, y: 0, fire: false };

      let bestObj = null;
      let minDiff = Infinity;

      for (const obj of this.objects) {
        if (obj.hit) continue;
        
        if (obj.engaged) {
          const duration = obj.endTime - obj.time;
          const p = U.clamp((this.time - obj.time) / duration, 0, 1);
          const pos = this._samplePath(obj.points, p);
          return { x: (pos.x / this.r.w) * 2 - 1, y: -((pos.y / this.r.h) * 2 - 1), fire: true };
        }

        const diff = obj.time - this.time;
        if (Math.abs(diff) < Math.abs(minDiff)) {
          minDiff = diff;
          bestObj = obj;
        }
      }

      if (!bestObj) return { x: 0, y: 0, fire: false };

      const nx = (bestObj.x / this.r.w) * 2 - 1;
      const ny = -((bestObj.y / this.r.h) * 2 - 1);
      
      const shouldClick = Math.abs(minDiff) < 0.04;

      return { x: nx, y: ny, fire: shouldClick };
    }

    getStats() {
      return [
        { k: 'Score', v: Math.floor(this.score) },
        { k: 'Combo', v: 'x' + Math.max(1, this.combo) },
        { k: 'Tempo', v: this.bpm > 0 ? Math.round(this.bpm) + ' BPM' : '…' },
        { k: 'Lives', v: this.lives }
      ];
    }
  }

  Arcade.register({
    id: 'beat-tap',
    name: 'Beat Tap',
    tag: 'Precision',
    color: '#ff5d8f',
    blurb: 'Click numbered circles as the outer ring closes. Hold and drag along sliders. Fast, fluid, and fully beat-synced.',
    hint: 'Click when the ring hits the circle · Hold and follow the slider ball to the end',
    create: (shell) => new BeatTap(shell)
  });
})();