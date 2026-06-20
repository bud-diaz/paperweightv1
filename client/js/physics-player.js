/**
 * physics-player.js — Falling-card physics shell for the PLAY view.
 *
 * Builds five rigid bodies (Now Playing, Waveform+Play "T", Library, Queue,
 * Share/Acct) with Matter.js, spawns them in a fixed, evenly-spaced floating
 * column, then releases them bottom-up so they drop and stack exactly into
 * that same layout — Share/Acct settles on the shell floor first, Library
 * and Queue land beside the waveform card's stem, the waveform bar rests on
 * top of those, and Now Playing lands last on top of the whole stack.
 *
 * This is a visual shell only — cards are placeholders. Tap/expand
 * behavior and live data wiring land in a follow-up pass.
 */
(function () {
  'use strict';

  if (typeof Matter === 'undefined') return;

  var Engine = Matter.Engine;
  var World = Matter.World;
  var Bodies = Matter.Bodies;
  var Body = Matter.Body;

  var PAD = 4;
  var GAP_X = 10;
  var FLOAT_GAP = 18;
  var RELEASE_START = 400;
  var RELEASE_STEP = 260;

  var stageEl = document.getElementById('physics-stage');
  if (!stageEl) return;

  var els = {
    nowPlaying: document.getElementById('card-now-playing'),
    wfBar: document.getElementById('phys-wf-bar'),
    wfStem: document.getElementById('phys-wf-stem'),
    lib: document.getElementById('card-lib'),
    queue: document.getElementById('card-queue'),
    share: document.getElementById('card-share'),
  };
  if (!els.nowPlaying || !els.wfBar || !els.wfStem || !els.lib || !els.queue || !els.share) return;

  var engine = null;
  var world = null;
  var rafId = null;
  var timers = [];
  var renderables = [];
  var lastTime = null;

  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t); });
    timers = [];
  }

  function computeLayout() {
    var rect = stageEl.getBoundingClientRect();
    var fullW = rect.width;
    var fullH = rect.height;
    var w = fullW - PAD * 2;
    var h = fullH - PAD * 2;

    var hNP = h * 0.34;
    var hBar = h * 0.15;
    var hMid = h * 0.22;
    var hShr = h * 0.14;

    var stemW = Math.max(70, Math.min(120, w * 0.24));
    var libW = (w - stemW - GAP_X * 2) / 2;
    var queueW = libW;

    var centerX = PAD + w / 2;

    var finalShrY = PAD + h - hShr / 2;
    var finalMidY = finalShrY - hShr / 2 - hMid / 2;
    var finalBarY = finalMidY - hMid / 2 - hBar / 2;
    var finalNpY = finalBarY - hBar / 2 - hNP / 2;

    return {
      fullW: fullW, fullH: fullH,
      now: { x: centerX, y: finalNpY - FLOAT_GAP, w: w, h: hNP },
      bar: { x: centerX, y: finalBarY - FLOAT_GAP, w: w, h: hBar },
      stem: { x: centerX, y: finalMidY - FLOAT_GAP, w: stemW, h: hMid },
      lib: { x: centerX - (stemW / 2 + GAP_X + libW / 2), y: finalMidY - FLOAT_GAP, w: libW, h: hMid },
      queue: { x: centerX + (stemW / 2 + GAP_X + queueW / 2), y: finalMidY - FLOAT_GAP, w: queueW, h: hMid },
      share: { x: centerX, y: finalShrY - FLOAT_GAP, w: w, h: hShr },
    };
  }

  function sizeEl(el, w, h) {
    el.style.width = w + 'px';
    el.style.height = h + 'px';
  }

  function placeholderRect(opts) {
    var body = Bodies.rectangle(opts.x, opts.y, opts.w, opts.h, {
      isStatic: true,
      friction: 0.6,
      frictionAir: 0.02,
      restitution: 0.12,
      chamfer: { radius: 10 },
    });
    Body.setInertia(body, Infinity);
    return body;
  }

  function init() {
    if (rafId) cancelAnimationFrame(rafId);
    clearTimers();
    if (engine) Engine.clear(engine);

    var layout = computeLayout();
    if (layout.fullW < 40 || layout.fullH < 40) {
      timers.push(setTimeout(init, 150));
      return;
    }

    engine = Engine.create();
    engine.gravity.y = 1;
    world = engine.world;

    var wallThickness = 60;
    var floor = Bodies.rectangle(layout.fullW / 2, layout.fullH + wallThickness / 2, layout.fullW + wallThickness * 2, wallThickness, { isStatic: true });
    var leftWall = Bodies.rectangle(-wallThickness / 2, layout.fullH / 2, wallThickness, layout.fullH * 2, { isStatic: true });
    var rightWall = Bodies.rectangle(layout.fullW + wallThickness / 2, layout.fullH / 2, wallThickness, layout.fullH * 2, { isStatic: true });

    var nowBody = placeholderRect(layout.now);
    sizeEl(els.nowPlaying, layout.now.w, layout.now.h);

    var libBody = placeholderRect(layout.lib);
    sizeEl(els.lib, layout.lib.w, layout.lib.h);

    var queueBody = placeholderRect(layout.queue);
    sizeEl(els.queue, layout.queue.w, layout.queue.h);

    var shareBody = placeholderRect(layout.share);
    sizeEl(els.share, layout.share.w, layout.share.h);

    var barPart = Bodies.rectangle(layout.bar.x, layout.bar.y, layout.bar.w, layout.bar.h, { chamfer: { radius: 10 } });
    var stemPart = Bodies.rectangle(layout.stem.x, layout.stem.y, layout.stem.w, layout.stem.h, { chamfer: { radius: 10 } });
    var wfBody = Body.create({
      parts: [barPart, stemPart],
      isStatic: true,
      friction: 0.6,
      frictionAir: 0.02,
      restitution: 0.12,
    });
    Body.setInertia(wfBody, Infinity);
    var barOffset = { x: layout.bar.x - wfBody.position.x, y: layout.bar.y - wfBody.position.y };
    var stemOffset = { x: layout.stem.x - wfBody.position.x, y: layout.stem.y - wfBody.position.y };
    sizeEl(els.wfBar, layout.bar.w, layout.bar.h);
    sizeEl(els.wfStem, layout.stem.w, layout.stem.h);

    World.add(world, [floor, leftWall, rightWall, nowBody, libBody, queueBody, shareBody, wfBody]);

    renderables = [
      { el: els.nowPlaying, body: nowBody, w: layout.now.w, h: layout.now.h, offX: 0, offY: 0 },
      { el: els.lib, body: libBody, w: layout.lib.w, h: layout.lib.h, offX: 0, offY: 0 },
      { el: els.queue, body: queueBody, w: layout.queue.w, h: layout.queue.h, offX: 0, offY: 0 },
      { el: els.share, body: shareBody, w: layout.share.w, h: layout.share.h, offX: 0, offY: 0 },
      { el: els.wfBar, body: wfBody, w: layout.bar.w, h: layout.bar.h, offX: barOffset.x, offY: barOffset.y },
      { el: els.wfStem, body: wfBody, w: layout.stem.w, h: layout.stem.h, offX: stemOffset.x, offY: stemOffset.y },
    ];

    renderables.forEach(renderOne);

    lastTime = null;
    rafId = requestAnimationFrame(tick);

    timers.push(setTimeout(function () { Body.setStatic(shareBody, false); }, RELEASE_START));
    timers.push(setTimeout(function () {
      Body.setStatic(libBody, false);
      Body.setStatic(queueBody, false);
    }, RELEASE_START + RELEASE_STEP));
    timers.push(setTimeout(function () { Body.setStatic(wfBody, false); }, RELEASE_START + RELEASE_STEP * 2));
    timers.push(setTimeout(function () { Body.setStatic(nowBody, false); }, RELEASE_START + RELEASE_STEP * 3));
  }

  function renderOne(r) {
    var x = r.body.position.x + r.offX - r.w / 2;
    var y = r.body.position.y + r.offY - r.h / 2;
    r.el.style.transform = 'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,0)';
  }

  function tick(now) {
    if (lastTime == null) lastTime = now;
    var delta = Math.min(now - lastTime, 1000 / 30);
    lastTime = now;
    Engine.update(engine, delta);
    renderables.forEach(renderOne);
    rafId = requestAnimationFrame(tick);
  }

  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(init, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('resize', onResize);
})();
