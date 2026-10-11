/* ============================================================
   audio.js — Web Audio input + analysis.
   Exposes:
     • drive       — bass × sensitivity, 0..2, drives gameplay
     • isPlaying   — true while the source is actually producing sound
     • beat/beatPhase/beatInBar/bar/isDownbeat/isBarStart
     • bassTrend   — -1..1, rising or falling low-end
     • trebleBeat  — separate onset detector on the hi-band
   ============================================================ */
(function (global) {
  'use strict';
  const Arcade = global.BallArcade;
  const U = Arcade.U;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.outputGain = null;
      this.data = null;
      this.source = null;
      this.el = null;
      this.stream = null;

      this.enabled = false;
      this.mode = 'none';
      this.sensitivity = 1;

      this.bass = 0;
      this.rawBass = 0;
      this.mid = 0;
      this.treble = 0;
      this.level = 0;
      this.beat = false;

      this.onMeter = null;
      this._bassAvg = 0;
      this._sinceBeat = 1;
      this._signalTime = 99;   // seconds since last meaningful signal

      /* ----- musical structure signals ----- */
      this.time        = 0;      // engine-local clock
      this.beatCount   = 0;      // total beats seen
      this.beatPhase   = 0;      // 0..1, position between last and next beat
      this.beatInBar   = 0;      // 0..3 (assumes 4/4)
      this.bar         = 0;      // total bars seen
      this.isDownbeat  = false;  // true for one frame on beat 0 of a bar
      this.isBarStart  = false;  // true for one frame when a new bar begins
      this.bassTrend   = 0;      // -1..1, rising (positive) or falling
      this.trebleBeat  = false;  // separate transient detector on the hi-band

      this._lastBeatTime = null;
      this._beatGap      = 0.5;  // seconds per beat (derived from beats)
      this._trebleAvg    = 0;
      this._sinceTreble  = 99;
    }

    _ensureCtx() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) throw new Error('Web Audio API unavailable');
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }

    _makeAnalyser() {
      const ctx = this._ensureCtx();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.55;
      this.data = new Uint8Array(this.analyser.frequencyBinCount);

      this.outputGain = ctx.createGain();
      this.outputGain.gain.value = 0;
      this.analyser.connect(this.outputGain);
      this.outputGain.connect(ctx.destination);
    }

    _disconnectSource() {
      if (this.source) {
        try { this.source.disconnect(); } catch (e) {}
        this.source = null;
      }
    }

    async useFile(file) {
      this._ensureCtx();
      this.stop();

      const ctx = this._ensureCtx();
      const el = new Audio();
      el.src = URL.createObjectURL(file);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      this.el = el;
      await el.play().catch(() => {});

      this._makeAnalyser();
      this._disconnectSource();
      this.source = ctx.createMediaElementSource(el);
      this.source.connect(this.analyser);
      this.outputGain.gain.value = 1;

      this.enabled = true;
      this.mode = 'file';
      return true;
    }

    async useMic() {
      this._ensureCtx();
      this.stop();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      this._makeAnalyser();
      this._disconnectSource();
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.stream = stream;
      this.enabled = true;
      this.mode = 'mic';
      return true;
    }

    async useTab() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen/tab capture is not supported in this browser.');
      }
      this._ensureCtx();
      this.stop();

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('NO_AUDIO');
      }

      // Only disable — never removeTrack / stop. Stopping kills the whole capture.
      stream.getVideoTracks().forEach(track => {
        try { track.enabled = false; } catch (e) {}
      });

      this._makeAnalyser();
      this._disconnectSource();
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.stream = stream;
      this.enabled = true;
      this.mode = 'tab';

      stream.getAudioTracks()[0].addEventListener('ended', () => this.stop());
      return true;
    }

    stop() {
      this.enabled = false;
      this.mode = 'none';
      if (this.el) {
        try { this.el.pause(); this.el.src = ''; } catch (e) {}
        this.el = null;
      }
      this._disconnectSource();
      if (this.analyser) {
        try { this.analyser.disconnect(); } catch (e) {}
        this.analyser = null;
        this.data = null;
      }
      if (this.outputGain) {
        try { this.outputGain.disconnect(); } catch (e) {}
        this.outputGain = null;
      }
      if (this.stream) {
        this.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        this.stream = null;
      }
      this.bass = this.rawBass = this.mid = this.treble = this.level = 0;
      this.beat = false;

      // reset derived signals
      this.beatCount = 0;
      this.beatInBar = 0;
      this.bar = 0;
      this.isDownbeat = false;
      this.isBarStart = false;
      this.bassTrend = 0;
      this.trebleBeat = false;
      this.beatPhase = 0;
      this._lastBeatTime = null;
      this._beatGap = 0.5;
      this._trebleAvg = 0;
      this._sinceTreble = 99;

      this._signalTime = 99;
      if (this.onMeter) this.onMeter(0);
    }

    setSensitivity(v) { this.sensitivity = v; }

    _band(a, b) {
      if (!this.data) return 0;
      let sum = 0, n = 0;
      for (let i = a; i < b; i++) { sum += this.data[i]; n++; }
      return n ? (sum / n) / 255 : 0;
    }

    update(dt) {
      this.time += dt;
      this.beat = false;

      if (!this.enabled || !this.analyser || !this.data) {
        this.rawBass = U.smooth(this.rawBass, 0, 0.25, dt);
        this.bass    = U.smooth(this.bass,    0, 0.12, dt);
        this.mid     = U.smooth(this.mid,     0, 0.12, dt);
        this.treble  = U.smooth(this.treble,  0, 0.12, dt);
        this.level   = this.bass;
        this._signalTime += dt;

        this.isDownbeat = false;
        this.isBarStart = false;
        this.trebleBeat = false;
        this.bassTrend = 0;
        this.beatPhase = 0;

        if (this.onMeter) this.onMeter(this.level);
        return;
      }

      this.analyser.getByteFrequencyData(this.data);
      const n = this.data.length;

      const b = this._band(1, Math.max(4, Math.floor(n * 0.06)));
      const m = this._band(Math.floor(n * 0.06), Math.floor(n * 0.25));
      const t = this._band(Math.floor(n * 0.25), Math.floor(n * 0.60));

      this.rawBass = U.smooth(this.rawBass, b, 0.90, dt);
      this.bass    = U.smooth(this.bass,    b, 0.35, dt);
      this.mid     = U.smooth(this.mid,    m, 0.45, dt);
      this.treble  = U.smooth(this.treble, t, 0.45, dt);
      this.level   = this.bass;

      // Track how long it's been since we last saw actual signal.
      // 0.015 ≈ −36 dBFS — comfortably above background noise.
      if (b > 0.015) {
        this._signalTime = 0;
      } else {
        this._signalTime += dt;
      }

      // ── beat detection ─────────────────────────────────────────
      this._bassAvg = this._bassAvg * 0.92 + b * 0.08;
      this._sinceBeat += dt;
      if (b > this._bassAvg * 1.35 + 0.03 && this._sinceBeat > 0.22) {
        this.beat = true;
        this._sinceBeat = 0;
      }

      // ── musical structure signals ──────────────────────────────
      if (this.beat) {
        if (this._lastBeatTime !== null) {
          const gap = this.time - this._lastBeatTime;
          if (gap > 0.20 && gap < 2.0) {
            this._beatGap = this._beatGap * 0.7 + gap * 0.3;
          }
        }
        this._lastBeatTime = this.time;

        this.beatCount++;
        this.beatInBar = (this.beatInBar + 1) % 4;
        this.isDownbeat = this.beatInBar === 0;
        if (this.isDownbeat && this.beatCount > 0) {
          this.bar++;
          this.isBarStart = true;
        } else {
          this.isBarStart = false;
        }
      } else {
        this.isDownbeat = false;
        this.isBarStart = false;
      }

      // 0 right on the beat, →1 just before the next one
      this.beatPhase = this._lastBeatTime === null
        ? 0
        : U.clamp((this.time - this._lastBeatTime) / this._beatGap, 0, 1);

      // bass trend: is the low-end rising or falling right now?
      this.bassTrend = U.clamp((this.rawBass - this.bass) * 6, -1, 1);

      // treble onset detector
      this._sinceTreble += dt;
      const tNow = this.treble;
      const tAvg = this._trebleAvg;
      this.trebleBeat = tNow > tAvg * 1.4 + 0.02 && this._sinceTreble > 0.12;
      if (this.trebleBeat) this._sinceTreble = 0;
      this._trebleAvg = tAvg * 0.92 + tNow * 0.08;

      if (this.onMeter) this.onMeter(this.level);
    }

    /** True while a source is connected AND producing sound.
     *  A brief quiet passage (<2.5 s) keeps it true so the game
     *  doesn't hiccup on every drum gap. */
    get isPlaying() {
      return this.enabled && this._signalTime < 2.5;
    }

    /** Sensitivity-scaled bass for gameplay. Zero when no signal. */
    get drive() {
      if (!this.enabled) return 0;
      return U.clamp(this.rawBass * this.sensitivity, 0, 2);
    }
  }

  Arcade.AudioEngine = AudioEngine;
})(window);