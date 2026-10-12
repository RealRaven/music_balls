/* ============================================================
   util.js — tiny helpers shared by everything
   ============================================================ */
(function (global) {
  'use strict';

  const Arcade = global.BallArcade = global.BallArcade || {};

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

  /** Framerate independent exponential smoothing. */
  function smooth(cur, target, rate, dt) {
    return target + (cur - target) * Math.pow(1 - rate, dt * 60);
  }

  /** Accepts '#rgb', '#rrggbb', 'rgb(...)' or an [r,g,b] array. */
  function toRgb(c) {
    if (Array.isArray(c)) return c;
    const s = String(c).trim();
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h, 16) || 0;
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = s.match(/(\d+(?:\.\d+)?)/g);
    if (m && m.length >= 3) return [+m[0], +m[1], +m[2]];
    return [255, 255, 255];
  }
  function rgba(c, a) {
    const p = toRgb(c);
    return 'rgba(' + (p[0] | 0) + ',' + (p[1] | 0) + ',' + (p[2] | 0) + ',' + (a === undefined ? 1 : a) + ')';
  }
  function mix(c1, c2, t) {
    const a = toRgb(c1), b = toRgb(c2);
    return [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t))
    ];
  }
  function lighten(c, t) { return rgba(mix(c, '#ffffff', t), 1); }
  function darken(c, t) { return rgba(mix(c, '#000000', t), 1); }

  /**
   * Ray / sphere intersection.
   * @returns {number|null} distance along the ray, or null.
   */
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t < 0) t = -b + sq;
    return t < 0 ? null : t;
  }

  Arcade.U = {
    clamp, lerp, rand, randInt, pick, dist2, smooth,
    toRgb, rgba, mix, lighten, darken, raySphere
  };
})(window);