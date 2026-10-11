/* ============================================================
   input.js — pointer / keyboard state.
   Supports a "virtual" input channel so the AI can drive the
   exact same signals the human uses.
   ============================================================ */
(function (global) {
  'use strict';
  const Arcade = global.BallArcade;

  class Input {
    constructor(el) {
      this.el = el;
      this.mnx = 0; this.mny = 0;   // mouse, normalized -1..1
      this.nx = 0; this.ny = 0;     // effective aim, normalized -1..1
      this.mouseDown = false;
      this.releaseAt = -1;
      this.time = 0;
      this.virtual = null;          // {x, y, fire} from the AI
      this.centerAim = false;
      this.keys = Object.create(null);
      this._rect = null;

      const rect = () => (this._rect = el.getBoundingClientRect());

      el.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        this.mouseDown = true;
        this._fromClient(e.clientX, e.clientY, rect());
        if (el.setPointerCapture && e.pointerId !== undefined) {
          try { el.setPointerCapture(e.pointerId); } catch (err) {}
        }
      });
      el.addEventListener('pointermove', (e) => {
        this._fromClient(e.clientX, e.clientY, rect());
      });
      global.addEventListener('pointermove', (e) => {
        if (this._rect) this._fromClient(e.clientX, e.clientY, this._rect);
      });
      global.addEventListener('pointerup', () => {
        if (this.mouseDown) {
          this.mouseDown = false;
          this.releaseAt = this.time + 0.09;   // guarantee >=1 frame of "fire"
        }
      });
      global.addEventListener('blur', () => { this.mouseDown = false; });
      global.addEventListener('keydown', (e) => {
        this.keys[e.key.toLowerCase()] = true;
        if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) >= 0) e.preventDefault();
      });
      global.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    }

    _fromClient(cx, cy, r) {
      if (!r || !r.width) return;
      this.mnx = ((cx - r.left) / r.width) * 2 - 1;
      this.mny = -(((cy - r.top) / r.height) * 2 - 1);
    }

    setVirtual(v) { this.virtual = v || null; }

    update(dt) {
      this.time += dt;
      if (this.virtual) {
        this.nx = this.virtual.x;
        this.ny = this.virtual.y;
      } else if (this.centerAim) {
        this.nx = 0; this.ny = 0;
      } else {
        this.nx = this.mnx;
        this.ny = this.mny;
      }
    }

    /** True while the trigger is held (mouse held, click tail, or AI firing). */
    get firing() {
      return this.mouseDown || this.time < this.releaseAt || !!(this.virtual && this.virtual.fire);
    }

    key(k) { return !!this.keys[k]; }
  }

  Arcade.Input = Input;
})(window);