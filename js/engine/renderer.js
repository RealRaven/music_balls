/* ============================================================
   renderer.js — a tiny pseudo-3D renderer on Canvas 2D.
   No WebGL, no libraries. Cameras look down -Z.
   ============================================================ */
(function (global) {
  'use strict';
  const Arcade = global.BallArcade;
  const U = Arcade.U;
  const TAU = Math.PI * 2;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.camera = { x: 0, y: 1.6, z: 5, yaw: 0, pitch: 0, fov: 60, near: 0.2 };
      this.items = [];
      this.overlay = [];
      this.w = 1; this.h = 1; this.cx = 0; this.cy = 0; this.focal = 400;
      this.resize();
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const w = Math.max(1, r.width || global.innerWidth);
      const h = Math.max(1, r.height || global.innerHeight);
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.w = w; this.h = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.cx = w / 2;
      this.cy = h / 2;
      this.focal = (h / 2) / Math.tan((this.camera.fov * Math.PI / 180) / 2);
    }

    /* ---------------- camera maths ---------------- */

    toCam(p) {
      const c = this.camera;
      const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      const x1 = dx * cy - dz * sy;
      const z1 = dx * sy + dz * cy;
      const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      const y2 = dy * cp + z1 * sp;
      const z2 = -dy * sp + z1 * cp;
      return { x: x1, y: y2, z: z2 };
    }

    toScreen(v) {
      const s = this.focal / (-v.z);
      return { x: this.cx + v.x * s, y: this.cy - v.y * s, s };
    }

    project(p) {
      const v = this.toCam(p);
      if (v.z > -this.camera.near) return null;
      return this.toScreen(v);
    }

    /** Screen pixel -> normalized world-space direction. */
    rayDir(sx, sy) {
      const c = this.camera;
      const x1 = (sx - this.cx) / this.focal;
      const y2 = -(sy - this.cy) / this.focal;
      const z2 = -1;
      const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      const dy = y2 * cp - z2 * sp;
      const z1 = y2 * sp + z2 * cp;
      const cy = Math.cos(c.yaw), sy2 = Math.sin(c.yaw);
      const dx = x1 * cy + z1 * sy2;
      const dz = -x1 * sy2 + z1 * cy;
      const len = Math.hypot(dx, dy, dz) || 1;
      return { x: dx / len, y: dy / len, z: dz / len };
    }

    /* ---------------- frame ---------------- */

    begin(bg) {
      const ctx = this.ctx;
      this.items.length = 0;
      this.overlay.length = 0;
      this.focal = (this.h / 2) / Math.tan((this.camera.fov * Math.PI / 180) / 2);
      if (bg) {
        const g = ctx.createLinearGradient(0, 0, 0, this.h);
        g.addColorStop(0, bg.top || '#07080c');
        g.addColorStop(1, bg.bottom || '#07080c');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = '#07080c';
      }
      ctx.fillRect(0, 0, this.w, this.h);
    }

    end() {
      const ctx = this.ctx;
      const items = this.items;
      items.sort((a, b) => a.z - b.z); // most negative z = farthest -> painted first
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.t === 's') this._sphere(it);
        else if (it.t === 'l') this._line(it);
        else if (it.t === 'o') this._ring(it);
      }
      for (let i = 0; i < this.overlay.length; i++) this._overlay(this.overlay[i]);
      items.length = 0;
      this.overlay.length = 0;
    }

    /* ---------------- 3D primitives ---------------- */

    /** @returns {{x:number,y:number,r:number,s:number}|null} screen info */
    sphere(p, radius, color, opts) {
      const v = this.toCam(p);
      if (v.z > -this.camera.near) return null;
      const s = this.toScreen(v);
      const r = Math.max(0.6, radius * s.s);
      this.items.push({ t: 's', x: s.x, y: s.y, r, z: v.z, color, opts: opts || {} });
      return { x: s.x, y: s.y, r, s: s.s };
    }

    ring(p, radius, color, width, alpha) {
      const v = this.toCam(p);
      if (v.z > -this.camera.near) return null;
      const s = this.toScreen(v);
      const r = Math.max(1, radius * s.s);
      this.items.push({
        t: 'o', x: s.x, y: s.y, r, z: v.z,
        color, width: width || 2, alpha: alpha === undefined ? 1 : alpha
      });
      return { x: s.x, y: s.y, r };
    }

    line(a, b, color, width, alpha) {
      const near = -this.camera.near;
      let va = this.toCam(a);
      let vb = this.toCam(b);
      if (va.z > near && vb.z > near) return;
      if (va.z > near) {
        const t = (near - va.z) / (vb.z - va.z);
        va = { x: va.x + (vb.x - va.x) * t, y: va.y + (vb.y - va.y) * t, z: near };
      } else if (vb.z > near) {
        const t = (near - vb.z) / (va.z - vb.z);
        vb = { x: vb.x + (va.x - vb.x) * t, y: vb.y + (va.y - vb.y) * t, z: near };
      }
      this.items.push({
        t: 'l', a: this.toScreen(va), b: this.toScreen(vb),
        z: Math.min(va.z, vb.z), color, width: width || 1,
        alpha: alpha === undefined ? 1 : alpha
      });
    }

    /** Horizontal grid on the plane y = height. */
    grid(y, half, step, color, alpha) {
      for (let i = -half; i <= half; i += step) {
        this.line({ x: i, y, z: -half }, { x: i, y, z: half }, color, 1, alpha);
        this.line({ x: -half, y, z: i }, { x: half, y, z: i }, color, 1, alpha);
      }
    }

    /* ---------------- 2D overlay ---------------- */

    bar(x, y, w, h, ratio, color, bg) {
      this.overlay.push({ t: 'bar', x, y, w, h, ratio, color, bg: bg || 'rgba(0,0,0,.55)' });
    }
    rect(x, y, w, h, color, radius) {
      this.overlay.push({ t: 'rect', x, y, w, h, color, radius: radius || 0 });
    }
    text(x, y, str, color, px, align, weight) {
      this.overlay.push({
        t: 'text', x, y, str, color: color || '#fff', px: px || 14,
        align: align || 'center', weight: weight || 600
      });
    }
    /** Text anchored to a world position. */
    text3d(p, str, color, px, dy) {
      const s = this.project(p);
      if (!s) return;
      this.text(s.x, s.y + (dy || 0), str, color, px, 'center', 800);
    }

    /* ---------------- painters ---------------- */

    _sphere(it) {
      const ctx = this.ctx;
      const o = it.opts;
      if (it.r < 0.5) return;
      ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;

      if (o.glow) {
        ctx.save();
        ctx.shadowColor = U.rgba(it.color, .85);
        ctx.shadowBlur = Math.min(60, it.r * 0.9);
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, TAU);
        ctx.fillStyle = U.rgba(it.color, .35);
        ctx.fill();
        ctx.restore();
      }

      const g = ctx.createRadialGradient(
        it.x - it.r * 0.36, it.y - it.r * 0.40, it.r * 0.05,
        it.x, it.y, it.r * 1.04
      );
      g.addColorStop(0, U.lighten(it.color, 0.72));
      g.addColorStop(0.45, U.lighten(it.color, 0.12));
      g.addColorStop(1, U.darken(it.color, 0.55));

      ctx.beginPath();
      ctx.arc(it.x, it.y, it.r, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();

      // specular dot
      ctx.beginPath();
      ctx.arc(it.x - it.r * 0.34, it.y - it.r * 0.38, it.r * 0.17, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fill();

      if (o.ring) {
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, TAU);
        ctx.strokeStyle = U.rgba(o.ring, o.ringAlpha === undefined ? .9 : o.ringAlpha);
        ctx.lineWidth = o.ringWidth || 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    _line(it) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(it.a.x, it.a.y);
      ctx.lineTo(it.b.x, it.b.y);
      ctx.strokeStyle = U.rgba(it.color, it.alpha);
      ctx.lineWidth = it.width;
      ctx.stroke();
    }

    _ring(it) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.arc(it.x, it.y, it.r, 0, TAU);
      ctx.strokeStyle = U.rgba(it.color, it.alpha);
      ctx.lineWidth = it.width;
      ctx.stroke();
    }

    _overlay(it) {
      const ctx = this.ctx;
      if (it.t === 'bar') {
        const w = it.w, h = it.h;
        ctx.fillStyle = it.bg;
        ctx.fillRect(it.x, it.y, w, h);
        ctx.fillStyle = U.rgba(it.color, 1);
        ctx.fillRect(it.x + 1, it.y + 1, Math.max(0, (w - 2) * U.clamp(it.ratio, 0, 1)), h - 2);
      } else if (it.t === 'rect') {
        ctx.fillStyle = U.rgba(it.color, 1);
        if (it.radius) {
          const r = Math.min(it.radius, it.w / 2, it.h / 2);
          ctx.beginPath();
          ctx.moveTo(it.x + r, it.y);
          ctx.arcTo(it.x + it.w, it.y, it.x + it.w, it.y + it.h, r);
          ctx.arcTo(it.x + it.w, it.y + it.h, it.x, it.y + it.h, r);
          ctx.arcTo(it.x, it.y + it.h, it.x, it.y, r);
          ctx.arcTo(it.x, it.y, it.x + it.w, it.y, r);
          ctx.fill();
        } else {
          ctx.fillRect(it.x, it.y, it.w, it.h);
        }
      } else if (it.t === 'text') {
        ctx.font = it.weight + ' ' + it.px + 'px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        ctx.textAlign = it.align;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = U.rgba(it.color, 1);
        ctx.fillText(it.str, it.x, it.y);
      }
    }
  }

  Arcade.Renderer = Renderer;
})(window);