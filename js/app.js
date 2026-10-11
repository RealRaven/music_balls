/* ============================================================
   app.js — the arcade shell: menu, HUD, loop, pause, AI toggle.
   ============================================================ */
(function (global) {
  'use strict';
  const Arcade = global.BallArcade;
  const U = Arcade.U;
  const $ = (s) => document.querySelector(s);

  /* ---------------- DOM ---------------- */
  const app = $('#app');
  const canvas = $('#stage');
  const menuEl = $('#menu');
  const gridEl = $('#gameGrid');
  const hudEl = $('#hudStats');
  const toastEl = $('#toast');
  const crossEl = $('#crosshair');
  const pauseEl = $('#pauseOverlay');
  const pauseTitle = $('#pauseTitle');
  const pauseText = $('#pauseText');
  const resumeBtn = $('#resumeBtn');
  const restartBtn = $('#restartBtn');
  const quitBtn = $('#quitBtn');
  const btnPause = $('#btnPause');
  const btnMenu = $('#btnMenu');
  const btnAI = $('#btnAI');
  const btnAim = $('#btnAim');
  const fileInput = $('#fileInput');
  const btnMic = $('#btnMic');
  const btnTab = $('#btnTab');
  const btnStopAudio = $('#btnStopAudio');
  const sensEl = $('#sensitivity');
  const meterFill = $('#meterFill');

  /* ---------------- engine instances ---------------- */
  const renderer = new Arcade.Renderer(canvas);
  const audio = new Arcade.AudioEngine();
  const input = new Arcade.Input(canvas);

  let current = null;
  let currentDef = null;
  let paused = false;
  let over = false;
  let aiEnabled = false;
  let menuOpen = true;
  let toastTimer = null;
  let hudKey = '';

  audio.onMeter = (v) => { meterFill.style.width = (U.clamp(v, 0, 1) * 100).toFixed(1) + '%'; };

  /* ---------------- shell API handed to games ---------------- */
  const shell = {
    renderer, audio, input,
    get aiEnabled() { return aiEnabled; },
    toast(msg, ms) { showToast(msg, ms); },
    gameOver(msg) { triggerGameOver(msg); }
  };

  /* ---------------- menu ---------------- */
  function buildMenu() {
    gridEl.innerHTML = '';
    Arcade.games.forEach((g) => {
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.innerHTML =
        '<div class="glow" style="background:' + g.color + '"></div>' +
        '<div class="head">' +
          '<span class="dot" style="background:radial-gradient(circle at 32% 30%,#fff,' + g.color + ' 62%,rgba(0,0,0,.6))"></span>' +
          '<span><h3>' + g.name + '</h3><span class="tag">' + g.tag + '</span></span>' +
        '</div>' +
        '<p>' + g.blurb + '</p>' +
        '<div class="hint">' + g.hint + '</div>' +
        '<span class="play">Play ▸</span>';
      card.addEventListener('click', () => startGame(g));
      gridEl.appendChild(card);
    });
  }

  function openMenu() {
    menuOpen = true;
    menuEl.classList.remove('hidden');
    app.classList.remove('playing');
    paused = true;
    pauseEl.classList.remove('show');
    if (current && current.stop) current.stop();
  }

  function closeMenu() {
    menuOpen = false;
    menuEl.classList.add('hidden');
    app.classList.add('playing');
  }

  /* ---------------- game lifecycle ---------------- */
  function startGame(def) {
    if (current && current.destroy) current.destroy();
    currentDef = def;
    current = def.create(shell);
    paused = false;
    over = false;
    hudKey = '';
    input.setVirtual(null);
    closeMenu();
    hidePause();
    current.start();
    last = performance.now() / 1000;
    showToast(def.name + ' — ' + def.hint, 3600);
  }

  function restartGame() {
    if (!current) return;
    over = false;
    paused = false;
    hidePause();
    current.start();
    last = performance.now() / 1000;
    showToast('Restarted', 1000);
  }

  function triggerGameOver(msg) {
    if (over) return;
    over = true;
    paused = true;
    showPause('Game Over', msg || 'You ran out of lives.', false);
  }

  function togglePause() {
    if (!current || over || menuOpen) return;
    paused = !paused;
    if (paused) showPause('Paused', 'Take a breath. Press P to resume.', true);
    else hidePause();
  }

  function showPause(title, text, canResume) {
    pauseTitle.textContent = title;
    pauseText.textContent = text;
    resumeBtn.style.display = canResume ? '' : 'none';
    pauseEl.classList.add('show');
    app.classList.remove('playing');
  }

  function hidePause() {
    pauseEl.classList.remove('show');
    if (!menuOpen) app.classList.add('playing');
  }

  function showToast(msg, ms) {
    if (!msg) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 1800);
  }

  /* ---------------- AI toggle ---------------- */
  function setAI(on) {
    aiEnabled = on;
    btnAI.textContent = 'AI: ' + (on ? 'On' : 'Off');
    app.classList.toggle('ai', on);
    if (!on) input.setVirtual(null);
    if (current) showToast(on ? 'AI is playing' : 'Back to manual control', 1200);
  }

  /* ---------------- crosshair ---------------- */
  function updateCrosshair() {
    const x = (input.nx * 0.5 + 0.5) * renderer.w;
    const y = (-input.ny * 0.5 + 0.5) * renderer.h;
    crossEl.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    if (!current) { if (hudKey !== '') { hudEl.innerHTML = ''; hudKey = ''; } return; }
    const stats = current.getStats ? current.getStats() : [];
    const key = JSON.stringify(stats);
    if (key === hudKey) return;
    hudKey = key;
    let html = '';
    for (let i = 0; i < stats.length; i++) {
      html += '<div class="stat"><span class="k">' + stats[i].k + '</span><span class="v">' + stats[i].v + '</span></div>';
    }
    hudEl.innerHTML = html;
  }

  /* ---------------- main loop ---------------- */
  let last = performance.now() / 1000;

  function frame() {
    requestAnimationFrame(frame);

    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0.0001, now - last));
    last = now;

    audio.update(dt);

    if (current && !paused) {
      // AI writes into the same virtual input channel the mouse uses
      if (aiEnabled && current.ai) {
        input.setVirtual(current.ai(dt) || { x: 0, y: 0, fire: false });
      } else if (aiEnabled) {
        input.setVirtual({ x: 0, y: 0, fire: false });
      } else {
        input.setVirtual(null);
      }
      input.update(dt);
      current.update(dt);
    } else {
      input.update(dt);
    }

    updateCrosshair();

    renderer.begin(current ? current.bg : { top: '#0b0e18', bottom: '#05060a' });
    if (current) current.draw();
    renderer.end();

    updateHud();
  }

  /* ---------------- audio UI ---------------- */
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      await audio.useFile(f);
      showToast('Playing: ' + f.name, 1600);
    } catch (err) {
      showToast('Could not play that file.', 2000);
    }
    e.target.value = '';
  });

  btnMic.addEventListener('click', async () => {
    try {
      await audio.useMic();
      showToast('Microphone live — make some noise.', 1800);
    } catch (err) {
      showToast('Microphone unavailable. Try a local server (http://localhost).', 2800);
    }
  });

  btnTab.addEventListener('click', async () => {
    try {
      await audio.useTab();
      showToast('Tab audio captured. Music now drives the game.', 2000);
    } catch (err) {
      if (err && err.message === 'NO_AUDIO') {
        showToast('No audio track. Pick a tab that plays sound and tick "Share audio".', 3000);
      } else {
        showToast('Tab audio share cancelled or unsupported (Chrome only).', 2600);
      }
    }
  });

  btnStopAudio.addEventListener('click', () => {
    audio.stop();
    showToast('Audio stopped.', 1200);
  });

  sensEl.addEventListener('input', () => {
    audio.setSensitivity(parseFloat(sensEl.value) || 1);
  });
  audio.setSensitivity(parseFloat(sensEl.value) || 1);

  /* ---------------- buttons ---------------- */
  btnPause.addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
  btnMenu.addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
  btnAI.addEventListener('click', (e) => { e.stopPropagation(); setAI(!aiEnabled); });
  btnAim.addEventListener('click', (e) => {
    e.stopPropagation();
    input.centerAim = !input.centerAim;
    btnAim.textContent = 'Aim: ' + (input.centerAim ? 'Center' : 'Mouse');
  });
  resumeBtn.addEventListener('click', (e) => { e.stopPropagation(); if (!over) togglePause(); });
  restartBtn.addEventListener('click', (e) => { e.stopPropagation(); restartGame(); });
  quitBtn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });

  /* ---------------- keyboard ---------------- */
  global.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (menuOpen) { /* already open */ } else openMenu(); return; }
    if (menuOpen) return;
    if (k === 'p') togglePause();
    else if (k === 'r') restartGame();
    else if (k === 'm') {
      input.centerAim = !input.centerAim;
      btnAim.textContent = 'Aim: ' + (input.centerAim ? 'Center' : 'Mouse');
      showToast(input.centerAim ? 'Center aim' : 'Mouse aim', 900);
    } else if (k === 'a') {
      setAI(!aiEnabled);
    }
  });

  /* ---------------- resize ---------------- */
  function onResize() { renderer.resize(); }
  global.addEventListener('resize', onResize);
  global.addEventListener('orientationchange', () => setTimeout(onResize, 120));

  /* ---------------- boot ---------------- */
  buildMenu();
  openMenu();
  requestAnimationFrame(frame);

  // expose for debugging / future games
  Arcade.shell = shell;
  Arcade.app = { startGame, openMenu, setAI };
})(window);