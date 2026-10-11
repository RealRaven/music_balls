/* ============================================================
   game.js — the base class every game extends + registry.
   ============================================================ */
(function (global) {
  'use strict';
  const Arcade = global.BallArcade;
  const U = Arcade.U;

  Arcade.games = Arcade.games || [];
  Arcade.register = function (def) { Arcade.games.push(def); };

  class Game {
    constructor(shell) {
      this.shell = shell;
      this.r = shell.renderer;
      this.audio = shell.audio;
      this.input = shell.input;
      this.time = 0;
      this.score = 0;
      this.lives = 3;
      this.over = false;
      this.bg = { top: '#0b0e18', bottom: '#05060a' };
      this.interval = 1;
    }

    /* lifecycle */
    start() { this.time = 0; this.over = false; this.reset(); }
    reset() {}
    update(dt) {}
    draw() {}

    /** @returns {{x:number,y:number,fire:boolean}|null} normalized aim + trigger */
    ai(dt) { return null; }

    /** @returns {Array<{k:string,v:string|number}>} */
    getStats() { return [{ k: 'Score', v: this.score }]; }

    /* helpers */

    aimScreen() {
      const r = this.r;
      return {
        x: (this.input.nx * 0.5 + 0.5) * r.w,
        y: (-this.input.ny * 0.5 + 0.5) * r.h
      };
    }

    aimRay() {
      const s = this.aimScreen();
      const c = this.r.camera;
      return {
        origin: { x: c.x, y: c.y, z: c.z },
        dir: this.r.rayDir(s.x, s.y)
      };
    }

    /** World position -> normalized device coords (-1..1), or null if behind. */
    worldToNdc(p) {
      const s = this.r.project(p);
      if (!s) return null;
      return { x: (s.x / this.r.w) * 2 - 1, y: -((s.y / this.r.h) * 2 - 1) };
    }

    /** Pick the closest visible target and return normalized aim at it. */
    aimAt(p, fire) {
      const n = this.worldToNdc(p);
      if (!n) return null;
      return { x: U.clamp(n.x, -1, 1), y: U.clamp(n.y, -1, 1), fire: fire !== false };
    }

    loseLife(n) {
      if (this.over) return;
      this.lives -= (n || 1);
      if (this.lives <= 0) this.die();
    }

    die(msg) {
      if (this.over) return;
      this.over = true;
      this.shell.gameOver(msg || 'Out of lives.');
    }
  }

  Arcade.Game = Game;
})(window);