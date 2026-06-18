/**
 * physics-player.js — Matter.js floating-card layer for the player UI.
 *
 * Owns ONLY: the Matter.js world, card transforms (style.transform),
 * opacity during the drop sequence, the reset hint, and forwarding
 * col-card clicks to the existing drawer button handlers.
 *
 * Does not touch innerHTML, audio, HLS, API calls, auth state,
 * dashboard logic, or any existing event listener — those remain
 * owned by js/main.js, js/player.js, js/hls-client.js, js/api.js,
 * and the dashboard/auth modules.
 */

const { Engine, World, Bodies, Body, Mouse, MouseConstraint, Events } = Matter;

const CW = 360, CH = 640;
const CARD_W = 344;
const NP_H   = 162;
const BAR_H  = 72, STEM_W = 110, STEM_H = 90;
const T_H    = BAR_H + STEM_H + 6;
const COL_W  = Math.floor((CARD_W - 12) / 3);
const COL_H  = 50, SA_H = 48;
const PAD = 8, GAP = 6, HDR = 46;

const cx       = CW / 2;
const LIB_CX   = PAD + COL_W / 2;
const QUEUE_CX = PAD + COL_W + GAP + COL_W / 2;
const SA_CY    = CH  - PAD - SA_H  / 2;
const ROW_CY   = SA_CY  - SA_H  / 2 - GAP - COL_H / 2;
const T_CY     = ROW_CY - COL_H / 2 - GAP - T_H   / 2;
const NP_CY    = T_CY   - T_H   / 2 - GAP - NP_H  / 2;

export function initPhysics() {
  const container = document.getElementById('pw-container');
  const cr = container.getBoundingClientRect();
  const OX = cr.left, OY = cr.top;

  document.querySelector('#card-nowplaying .pw-card-inner').style.width = CARD_W + 'px';
  document.getElementById('wt-inner').style.width = CARD_W + 'px';
  const wfCanvas = document.getElementById('waveform-canvas');
  if (wfCanvas) wfCanvas.width = CARD_W - 24;
  document.documentElement.style.setProperty('--stem-w', STEM_W + 'px');
  document.querySelector('#card-library .pw-card-inner').style.width = COL_W + 'px';
  document.querySelector('#card-queue .pw-card-inner').style.width = COL_W + 'px';
  document.querySelector('#card-shareacct .pw-card-inner').style.width = CARD_W + 'px';

  const engine = Engine.create({ gravity: { x: 0, y: 2.4 } });
  const world = engine.world;

  const wallOpts = { isStatic: true, friction: 0.6, restitution: 0.04 };
  World.add(world, [
    Bodies.rectangle(180, 670, 560, 60, wallOpts),
    Bodies.rectangle(-30, 320, 60, 2560, wallOpts),
    Bodies.rectangle(390, 320, 60, 2560, wallOpts),
    Bodies.rectangle(180, HDR, 560, 4, wallOpts),
  ]);

  const bodyOpts = {
    restitution: 0.05, friction: 0.6, frictionAir: 0.055, density: 0.008,
    isStatic: true,
  };

  const saBody  = Bodies.rectangle(cx, -200, CARD_W, SA_H, bodyOpts);
  const libBody = Bodies.rectangle(cx, -200, COL_W, COL_H, bodyOpts);
  const quBody  = Bodies.rectangle(cx, -200, COL_W, COL_H, bodyOpts);
  const npBody  = Bodies.rectangle(cx, -200, CARD_W, NP_H, bodyOpts);

  const barPart  = Bodies.rectangle(0, -(T_H / 2) + BAR_H / 2, CARD_W, BAR_H);
  const stemPart = Bodies.rectangle(0, (T_H / 2) - STEM_H / 2, STEM_W, STEM_H);
  const tBody = Body.create({
    parts: [barPart, stemPart],
    restitution: 0.05, friction: 0.6, frictionAir: 0.055, density: 0.008,
  });
  Body.setStatic(tBody, true);
  Body.setPosition(tBody, { x: cx, y: -200 });

  World.add(world, [saBody, libBody, quBody, npBody, tBody]);

  const cards = [
    { el: document.getElementById('card-shareacct'), body: saBody,  w: CARD_W, h: SA_H,  rx: cx,       ms: 0    },
    { el: document.getElementById('card-library'),   body: libBody, w: COL_W,  h: COL_H, rx: LIB_CX,   ms: 380  },
    { el: document.getElementById('card-queue'),      body: quBody,  w: COL_W,  h: COL_H, rx: QUEUE_CX, ms: 380  },
    { el: document.getElementById('card-wt'),         body: tBody,   w: CARD_W, h: T_H,   rx: cx,       ms: 760  },
    { el: document.getElementById('card-nowplaying'), body: npBody,  w: CARD_W, h: NP_H,  rx: cx,       ms: 1100 },
  ];
  cards.forEach(card => { card.el.style.opacity = '0'; });

  Events.on(engine, 'beforeUpdate', () => {
    cards.forEach(({ body }) => {
      if (body.isStatic) return;
      let a = body.angle % (Math.PI * 2);
      if (a > Math.PI) a -= Math.PI * 2;
      if (a < -Math.PI) a += Math.PI * 2;
      const correction = -a * 0.0007 * body.mass - body.angularVelocity * 0.004 * body.mass;
      const half = Math.max(body.bounds.max.y - body.position.y, 1);
      Body.applyForce(body, { x: body.position.x, y: body.position.y - half }, { x: correction, y: 0 });
      Body.applyForce(body, { x: body.position.x, y: body.position.y + half }, { x: -correction, y: 0 });
    });
  });

  function drop(card) {
    const { body } = card;
    Body.setPosition(body, { x: card.rx, y: HDR + card.h / 2 + 10 });
    Body.setAngle(body, (Math.random() - 0.5) * 0.3);
    Body.setVelocity(body, { x: (Math.random() - 0.5) * 1.5, y: 1 });
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.08);
    Body.setStatic(body, false);
    card.el.style.opacity = '1';
  }

  function runSequence() {
    cards.forEach(card => {
      Body.setStatic(card.body, true);
      Body.setPosition(card.body, { x: card.rx, y: -200 });
      card.el.style.opacity = '0';
    });
    cards.forEach(card => {
      setTimeout(() => drop(card), card.ms);
    });
  }
  window.resetCards = runSequence;

  const mouse = Mouse.create(document.body);
  mouse.offset = { x: -OX, y: -OY };
  World.add(world, MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.22, damping: 0.15, render: { visible: false } },
  }));

  let last = performance.now();
  (function loop(now) {
    Engine.update(engine, Math.min(now - last, 33));
    last = now;
    cards.forEach(c => {
      const px = c.body.position.x - c.w / 2 + OX;
      const py = c.body.position.y - c.h / 2 + OY;
      c.el.style.transform = `translate(${px}px,${py}px) rotate(${c.body.angle}rad)`;
    });
    requestAnimationFrame(loop);
  })(performance.now());

  runSequence();

  document.getElementById('card-library').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('lib-btn').click();
  });
  document.getElementById('card-queue').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('queue-btn').click();
  });

  initWaveformFallback();
}

function initWaveformFallback() {
  const canvas = document.getElementById('waveform-canvas');
  if (!canvas || canvas.dataset.claimed) return;
  canvas.dataset.claimed = '1';
  const ctx = canvas.getContext('2d');
  const bars = 48;
  let phase = 0;
  (function draw() {
    if (!canvas.isConnected) return;
    phase += 0.06;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color').trim() || '#39ff14';
    ctx.fillStyle = accent;
    const w = canvas.width / bars;
    for (let i = 0; i < bars; i++) {
      const h = (Math.sin(phase + i * 0.4) * 0.4 + 0.5) * canvas.height;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(i * w, canvas.height - h, w - 2, h);
    }
    requestAnimationFrame(draw);
  })();
}
