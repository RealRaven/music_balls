/* ============================================================
   audio.js — Web Audio input + analysis.
   Sources: local file, microphone, or a shared browser tab
   (getDisplayMedia — Chrome only, needs "Share audio").
   ============================================================ */
(function (global) {
  'use strict';
  const Arcade = global.BallArcade;
  const U = Arcade.U;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.data = null;
      this.source = null;
      this.el = null;
      this.stream = null;
      this.enabled = false;
      this.mode = 'none';          // 'none' | 'file' | 'mic' | 'tab'
      this.sensitivity = 1;
      this.bass = 0;
      this.mid = 0;
      this.treble = 0;
      this.level = 0;
      this.beat = false;
      this.onMeter = null;
      this._bassAvg = 0;
      this._sinceBeat = 1;
    }

    /* ---------- internals ---------- */

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
      this.analyser.smoothingTimeConstant = 0.72;
      this.data = new Uint8Array(this.analyser.frequencyBinCount);
    }

    _disconnectSource() {
      if (this.source) {
        try { this.source.disconnect(); } catch (e) { /* noop */ }
        this.source = null;
      }
    }

    /* ---------- public API ---------- */

    async useFile(file) {
      this.stop();
      const el = new Audio();
      el.src = URL.createObjectURL(file);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      this.el = el;
      await el.play().catch(() => {});
      this._makeAnalyser();
      this._disconnectSource();
      this.source = this.ctx.createMediaElementSource(el);
      this.source.connect(this.analyser);   // analyser is NOT routed to output
      this.enabled = true;
      this.mode = 'file';
      return true;
    }

    async useMic() {
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
      this.stop();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true, video: true, preferCurrentTab: false
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('NO_AUDIO');
      }
      // discard the video half, we only wanted the audio
      stream.getVideoTracks().forEach(t => { t.enabled = false; try { stream.removeTrack(t); t.stop(); } catch (e) {} });

      this._makeAnalyser();
      this._disconnectSource();
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      this.stream = stream;
      this.enabled = true;
      this.mode = 'tab';

      // user pressed "Stop sharing" in the browser bar
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
      if (this.stream) {
        this.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
        this.stream = null;
      }
      this.bass = this.mid = this.treble = this.level = 0;
      this.beat = false;
      if (this.onMeter) this.onMeter(0);
    }

    setSensitivity(v) { this.sensitivity = v; }

    /* ---------- per-frame analysis ---------- */

    _band(a, b) {
      if (!this.data) return 0;
      let sum = 0, n = 0;
      for (let i = a; i < b; i++) { sum += this.data[i]; n++; }
      return n ? (sum / n) / 255 : 0;
    }

    update(dt) {
      this.beat = false;
      if (!this.enabled || !this.analyser || !this.data) {
        this.bass = U.smooth(this.bass, 0, 0.12, dt);
        this.mid = U.smooth(this.mid, 0, 0.12, dt);
        this.treble = U.smooth(this.treble, 0, 0.12, dt);
        this.level = this.bass;
        return;
      }

      this.analyser.getByteFrequencyData(this.data);
      const n = this.data.length;

      const b = this._band(1, Math.max(4, Math.floor(n * 0.06)));
      const m = this._band(Math.floor(n * 0.06), Math.floor(n * 0.25));
      const t = this._band(Math.floor(n * 0.25), Math.floor(n * 0.60));

      this.bass = U.smooth(this.bass, b, 0.55, dt);
      this.mid = U.smooth(this.mid, m, 0.45, dt);
      this.treble = U.smooth(this.treble, t, 0.45, dt);
      this.level = this.bass;

      this._bassAvg = this._bassAvg * 0.92 + b * 0.08;
      this._sinceBeat += dt;
      if (b > this._bassAvg * 1.35 + 0.03 && this._sinceBeat > 0.22) {
        this.beat = true;
        this._sinceBeat = 0;
      }

      if (this.onMeter) this.onMeter(this.level);
    }

    /** Convenience: bass already scaled by the sensitivity slider. */
    get drive() { return U.clamp(this.bass * this.sensitivity, 0, 2); }
  }

  Arcade.AudioEngine = AudioEngine;
})(window);