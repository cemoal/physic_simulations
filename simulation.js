/* =====================================================
   simulation.js — Çarpışma Deneyi Simülasyonu
   ===================================================== */

'use strict';

// ──────────────────────────────────────────────────
// Canvas setup
// ──────────────────────────────────────────────────
const canvas  = document.getElementById('sim-canvas');
const ctx     = canvas.getContext('2d');
const wrapper = document.getElementById('canvas-wrapper');

// Physics scale: 1 meter = PIXELS_PER_METER px
const PIXELS_PER_METER = 60;   // 1 m = 60 px
const TABLE_W_M = 10;          // table width  in metres
const TABLE_H_M = 6;           // table height in metres

function resizeCanvas() {
  const maxW = wrapper.clientWidth  - 28;
  const maxH = wrapper.clientHeight - 28;
  const scale = Math.min(maxW / (TABLE_W_M * PIXELS_PER_METER),
                         maxH / (TABLE_H_M * PIXELS_PER_METER));
  canvas.width  = Math.floor(TABLE_W_M * PIXELS_PER_METER * scale);
  canvas.height = Math.floor(TABLE_H_M * PIXELS_PER_METER * scale);
  state.scale = scale;
}

window.addEventListener('resize', () => { resizeCanvas(); draw(); });

// ──────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────
const state = {
  running:          false,
  lastTime:         null,
  simTime:          0,
  collisionCount:   0,
  scale:            1,
  totalFrictionWork:0,
  initialEnergy:    0,
  collisionLogged:  false,
  ball2Enabled:     true,

  // pre / post collision snapshots
  preSnap:  null,
  postSnap: null,

  balls: buildBalls(),
};

function buildBalls() {
  const s   = 1;           // default scale (will be fixed on first render)
  const cW  = TABLE_W_M * PIXELS_PER_METER;
  const cH  = TABLE_H_M * PIXELS_PER_METER;
  return [
    {
      id: 1,
      x: cW * 0.25,   y: cH / 2,
      vx: 8 * PIXELS_PER_METER,  vy: 0,
      r: 22,           // pixels (at scale=1)
      m: 1,
      color: '#3b82f6',
      glowColor: 'rgba(59,130,246,0.7)',
      label: '1',
      trail: [],
    },
    {
      id: 2,
      x: cW * 0.75,   y: cH / 2,
      vx: 0,           vy: 0,
      r: 22,
      m: 1,
      color: '#ef4444',
      glowColor: 'rgba(239,68,68,0.7)',
      label: '2',
      trail: [],
    },
  ];
}

// ──────────────────────────────────────────────────
// Parameter helpers
// ──────────────────────────────────────────────────
function getNum(id) { return parseFloat(document.getElementById(id).value); }

function getParams() {
  return {
    m1:   getNum('m1'),
    m2:   getNum('m2'),
    v1:   getNum('v1'),
    v2:   getNum('v2'),
    a1:   getNum('a1') * Math.PI / 180,
    a2:   getNum('a2') * Math.PI / 180,
    r1:   getNum('r1'),
    r2:   getNum('r2'),
    e:    getNum('coeff-rest'),
    mu:   getNum('mu'),
    g:    getNum('gravity'),
    friction: document.getElementById('friction-toggle').checked,
    speed:    getNum('sim-speed'),
  };
}

// ──────────────────────────────────────────────────
// Slider sync + live parameter apply
// ──────────────────────────────────────────────────
function bindSlider(id, displayId, fmt) {
  const el = document.getElementById(id);
  const dsp = document.getElementById(displayId);
  const update = () => { dsp.textContent = fmt(parseFloat(el.value)); };
  el.addEventListener('input', update);
  update();
}

bindSlider('m1',         'm1-val',    v => v.toFixed(1));
bindSlider('v1',         'v1-val',    v => v.toFixed(1));
bindSlider('a1',         'a1-val',    v => Math.round(v));
bindSlider('r1',         'r1-val',    v => Math.round(v));
bindSlider('m2',         'm2-val',    v => v.toFixed(1));
bindSlider('v2',         'v2-val',    v => v.toFixed(1));
bindSlider('a2',         'a2-val',    v => Math.round(v));
bindSlider('r2',         'r2-val',    v => Math.round(v));
bindSlider('coeff-rest', 'cr-val',    v => v.toFixed(2));
bindSlider('mu',         'mu-val',    v => v.toFixed(2));
bindSlider('gravity',    'g-val',     v => v.toFixed(2));
bindSlider('sim-speed',  'speed-val', v => v.toFixed(1) + '×');

// Live-apply: push slider values → ball state immediately (works paused OR running)
function applyParamsToBalls() {
  const p  = getParams();
  const b  = state.balls;

  b[0].m  = p.m1;
  b[0].r  = p.r1;
  b[0].vx = p.v1 * Math.cos(p.a1) * PIXELS_PER_METER;
  b[0].vy = -p.v1 * Math.sin(p.a1) * PIXELS_PER_METER;

  if (state.ball2Enabled) {
    b[1].m  = p.m2;
    b[1].r  = p.r2;
    b[1].vx = p.v2 * Math.cos(p.a2) * PIXELS_PER_METER;
    b[1].vy = -p.v2 * Math.sin(p.a2) * PIXELS_PER_METER;
  }

  // Recompute initial energy reference so bars don't distort
  state.initialEnergy = kineticEnergy(b[0]) + (state.ball2Enabled ? kineticEnergy(b[1]) : 0);

  updateHUD();
  updateEnergyBars();
  updateRealTime();
  updateCollisionTypeBadge(p.e);
  if (!state.running) draw();  // redraw arrow when paused
}

// Wire every physics-relevant slider to applyParamsToBalls
['v1','a1','m1','r1','v2','a2','m2','r2','coeff-rest'].forEach(id => {
  document.getElementById(id).addEventListener('input', applyParamsToBalls);
});

// Friction toggle
document.getElementById('friction-toggle').addEventListener('change', function() {
  const fc = document.getElementById('friction-controls');
  fc.className = this.checked ? 'friction-visible' : 'friction-hidden';
});

// Ball 2 toggle
document.getElementById('ball2-toggle').addEventListener('change', function() {
  const bc = document.getElementById('ball2-controls');
  bc.style.display = this.checked ? '' : 'none';
  state.ball2Enabled = this.checked;
  // grey out the dot in the section title
  const dot = document.querySelector('#control-panel .section-title .ball-dot[style*="ball2"]');
  if (dot) dot.style.opacity = this.checked ? '1' : '0.25';
  resetSim();
});

// ──────────────────────────────────────────────────
// Run / Reset / Step buttons
// ──────────────────────────────────────────────────
document.getElementById('btn-run').addEventListener('click', () => {
  if (state.running) {
    pause();
  } else {
    startSim();
  }
});

document.getElementById('btn-reset').addEventListener('click', resetSim);
document.getElementById('btn-step').addEventListener('click', stepSim);

function startSim() {
  if (state.running) return;
  state.running = true;
  state.lastTime = null;
  document.getElementById('canvas-hint').classList.add('hidden');
  const btn = document.getElementById('btn-run');
  btn.classList.add('running');
  document.getElementById('run-icon').textContent = '⏸';
  document.getElementById('run-label').textContent = 'Durdur';
  requestAnimationFrame(loop);
}

function pause() {
  state.running = false;
  const btn = document.getElementById('btn-run');
  btn.classList.remove('running');
  document.getElementById('run-icon').textContent = '▶';
  document.getElementById('run-label').textContent = 'Devam';
}

function resetSim() {
  state.running  = false;
  const btn = document.getElementById('btn-run');
  btn.classList.remove('running');
  document.getElementById('run-icon').textContent = '▶';
  document.getElementById('run-label').textContent = 'Başlat';

  const p = getParams();
  const b = state.balls;

  const cW = TABLE_W_M * PIXELS_PER_METER;
  const cH = TABLE_H_M * PIXELS_PER_METER;

  b[0].x  = cW * 0.25;  b[0].y  = cH / 2;
  b[0].vx = p.v1 * Math.cos(p.a1) * PIXELS_PER_METER;
  b[0].vy = -p.v1 * Math.sin(p.a1) * PIXELS_PER_METER;
  b[0].m  = p.m1;
  b[0].r  = p.r1;
  b[0].trail = [];

  b[1].x  = cW * 0.75;  b[1].y  = cH / 2;
  b[1].vx = p.v2 * Math.cos(p.a2) * PIXELS_PER_METER;
  b[1].vy = -p.v2 * Math.sin(p.a2) * PIXELS_PER_METER;
  b[1].m  = p.m2;
  b[1].r  = p.r2;
  b[1].trail = [];

  state.simTime           = 0;
  state.collisionCount    = 0;
  state.totalFrictionWork = 0;
  state.collisionLogged   = false;
  state.preSnap  = null;
  state.postSnap = null;

  state.initialEnergy = kineticEnergy(b[0]) + kineticEnergy(b[1]);

  document.getElementById('canvas-hint').classList.remove('hidden');
  clearPostUI();
  updateHUD();
  updateEnergyBars();
  updateRealTime();
  updateCollisionTypeBadge(p.e);
  draw();
}

function stepSim() {
  if (state.running) return;
  updatePhysics(1 / 60);
  updateHUD();
  updateEnergyBars();
  updateRealTime();
  draw();
}

// ──────────────────────────────────────────────────
// Main loop
// ──────────────────────────────────────────────────
function loop(timestamp) {
  if (!state.running) return;
  if (!state.lastTime) state.lastTime = timestamp;

  let dt = (timestamp - state.lastTime) / 1000;
  state.lastTime = timestamp;
  dt = Math.min(dt, 0.05);     // cap at 50ms

  const p = getParams();
  const steps = 8;
  const subDt = dt * p.speed / steps;

  for (let i = 0; i < steps; i++) {
    updatePhysics(subDt);
  }

  state.simTime += dt * p.speed;
  updateHUD();
  updateEnergyBars();
  updateRealTime();
  draw();

  requestAnimationFrame(loop);
}

// ──────────────────────────────────────────────────
// Physics
// ──────────────────────────────────────────────────
function updatePhysics(dt) {
  const p = getParams();
  const b = state.balls;

  // Apply friction
  if (p.friction) {
    for (const ball of b) {
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      if (speed > 0.01) {
        const fric = p.mu * ball.m * p.g * PIXELS_PER_METER; // px/s²
        const ax   = -(fric / ball.m) * (ball.vx / speed);
        const ay   = -(fric / ball.m) * (ball.vy / speed);

        const newVx = ball.vx + ax * dt;
        const newVy = ball.vy + ay * dt;

        // Don't reverse direction
        if (Math.sign(newVx) !== Math.sign(ball.vx)) ball.vx = 0; else ball.vx = newVx;
        if (Math.sign(newVy) !== Math.sign(ball.vy)) ball.vy = 0; else ball.vy = newVy;

        // Friction work (energy dissipated)
        const dist = speed * dt; // pixels
        const distM = dist / PIXELS_PER_METER;
        state.totalFrictionWork += p.mu * ball.m * p.g * distM;
      }
    }
  }

  // Move
  for (const ball of b) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // Trail
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 60) ball.trail.shift();
  }

  // Wall collisions
  const cW = TABLE_W_M * PIXELS_PER_METER;
  const cH = TABLE_H_M * PIXELS_PER_METER;

  for (const ball of b) {
    const eff = ball.r * state.scale; // not used here; r is already in base px
    if (ball.x - ball.r < 0) {
      ball.x  = ball.r;
      ball.vx = -ball.vx * p.e;
    }
    if (ball.x + ball.r > cW) {
      ball.x  = cW - ball.r;
      ball.vx = -ball.vx * p.e;
    }
    if (ball.y - ball.r < 0) {
      ball.y  = ball.r;
      ball.vy = -ball.vy * p.e;
    }
    if (ball.y + ball.r > cH) {
      ball.y  = cH - ball.r;
      ball.vy = -ball.vy * p.e;
    }
  }

  // Ball–ball collision (only when ball 2 is active)
  if (state.ball2Enabled) {
    checkBallCollision(p);
  }
}

let collisionCooldown = 0;

function checkBallCollision(p) {
  const [b1, b2] = state.balls;
  const dx = b2.x - b1.x;
  const dy = b2.y - b1.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = b1.r + b2.r;

  if (collisionCooldown > 0) { collisionCooldown--; return; }
  if (dist >= minDist) return;

  // Overlap resolution
  const overlap = minDist - dist;
  const nx = dx / dist;
  const ny = dy / dist;
  b1.x -= nx * overlap / 2;
  b1.y -= ny * overlap / 2;
  b2.x += nx * overlap / 2;
  b2.y += ny * overlap / 2;

  // Relative velocity along normal
  const dvx = b2.vx - b1.vx;
  const dvy = b2.vy - b1.vy;
  const vRel = dvx * nx + dvy * ny;

  if (vRel >= 0) return;   // moving apart

  // Pre-collision snapshot
  const v1mag = mag(b1.vx, b1.vy) / PIXELS_PER_METER;
  const v2mag = mag(b2.vx, b2.vy) / PIXELS_PER_METER;
  state.preSnap = {
    v1: v1mag, v2: v2mag,
    p1: b1.m * v1mag, p2: b2.m * v2mag,
    ke: kineticEnergy(b1) + kineticEnergy(b2),
  };

  // Impulse using restitution coefficient e
  const e   = p.e;
  const j   = -(1 + e) * vRel / (1 / b1.m + 1 / b2.m);

  b1.vx -= (j / b1.m) * nx;
  b1.vy -= (j / b1.m) * ny;
  b2.vx += (j / b2.m) * nx;
  b2.vy += (j / b2.m) * ny;

  // Post-collision snapshot
  const v1magPost = mag(b1.vx, b1.vy) / PIXELS_PER_METER;
  const v2magPost = mag(b2.vx, b2.vy) / PIXELS_PER_METER;
  const kePost    = kineticEnergy(b1) + kineticEnergy(b2);
  state.postSnap = {
    v1: v1magPost, v2: v2magPost,
    p1: b1.m * v1magPost, p2: b2.m * v2magPost,
    ke: kePost,
    dKE: state.preSnap.ke - kePost,
    impulse: Math.abs(j) / PIXELS_PER_METER,
  };

  state.collisionCount++;
  collisionCooldown = 20;
  updatePrePostUI();
  updateCollisionTypeBadge(e);
}

function mag(vx, vy) { return Math.sqrt(vx * vx + vy * vy); }

function kineticEnergy(ball) {
  const v = mag(ball.vx, ball.vy) / PIXELS_PER_METER;
  return 0.5 * ball.m * v * v;
}

// ──────────────────────────────────────────────────
// Canvas Drawing
// ──────────────────────────────────────────────────
function draw() {
  const s  = state.scale;
  const cW = canvas.width;
  const cH = canvas.height;
  const tW = TABLE_W_M * PIXELS_PER_METER * s;
  const tH = TABLE_H_M * PIXELS_PER_METER * s;

  ctx.clearRect(0, 0, cW, cH);

  // Table felt
  const feltGrad = ctx.createRadialGradient(cW/2,cH/2,0, cW/2,cH/2, Math.max(cW,cH)/1.5);
  feltGrad.addColorStop(0, '#1e6b30');
  feltGrad.addColorStop(1, '#0f4020');
  ctx.fillStyle = feltGrad;
  roundRect(ctx, 0, 0, cW, cH, 10 * s);
  ctx.fill();

  // Felt texture lines (subtle)
  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  for (let x = 0; x < cW; x += 20 * s) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cH); ctx.stroke();
  }
  for (let y = 0; y < cH; y += 20 * s) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cW, y); ctx.stroke();
  }
  ctx.restore();

  // Rail (border)
  ctx.save();
  const railW = 14 * s;
  ctx.strokeStyle = '#5c3a1e';
  ctx.lineWidth   = railW * 2;
  roundRect(ctx, 0, 0, cW, cH, 10 * s);
  ctx.stroke();

  // Rail highlight
  ctx.strokeStyle = 'rgba(255,220,150,0.15)';
  ctx.lineWidth   = 2;
  roundRect(ctx, railW, railW, cW - railW*2, cH - railW*2, 7*s);
  ctx.stroke();
  ctx.restore();

  // Corner pockets
  const pocketR = 14 * s;
  const corners = [
    [0, 0], [cW, 0], [0, cH], [cW, cH],
    [cW/2, 0], [cW/2, cH]
  ];
  ctx.fillStyle = '#0a0a0a';
  corners.forEach(([cx, cy]) => {
    ctx.beginPath();
    ctx.arc(cx, cy, pocketR, 0, Math.PI * 2);
    ctx.fill();
  });

  // Center line
  ctx.save();
  ctx.setLineDash([8*s, 6*s]);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(cW/2, 20*s); ctx.lineTo(cW/2, cH - 20*s);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Center circle
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.arc(cW/2, cH/2, 40*s, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();

  // Draw trails
  const activeBallsTrail = state.ball2Enabled ? state.balls : [state.balls[0]];
  for (const ball of activeBallsTrail) {
    drawTrail(ball, s);
  }

  // Draw balls
  const activeBalls = state.ball2Enabled ? state.balls : [state.balls[0]];
  for (const ball of activeBalls) {
    drawBall(ball, s);
  }

  // Velocity arrows
  for (const ball of activeBalls) {
    drawVelocityArrow(ball, s);
  }
}

function drawTrail(ball, s) {
  if (ball.trail.length < 2) return;
  ctx.save();
  for (let i = 1; i < ball.trail.length; i++) {
    const alpha = i / ball.trail.length;
    ctx.beginPath();
    ctx.strokeStyle = ball.color + Math.round(alpha * 80).toString(16).padStart(2,'0');
    ctx.lineWidth   = ball.r * s * 1.5 * alpha;
    ctx.lineCap     = 'round';
    ctx.moveTo(ball.trail[i-1].x * s, ball.trail[i-1].y * s);
    ctx.lineTo(ball.trail[i].x   * s, ball.trail[i].y   * s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(ball, s) {
  const x = ball.x * s;
  const y = ball.y * s;
  const r = ball.r * s;

  // Glow
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8);
  glow.addColorStop(0, ball.glowColor);
  glow.addColorStop(1, 'transparent');
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle   = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.8, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Shadow
  ctx.save();
  ctx.shadowColor = ball.color;
  ctx.shadowBlur  = 16 * s;

  // Ball gradient
  const grad = ctx.createRadialGradient(x - r*0.3, y - r*0.3, r*0.05, x, y, r);
  grad.addColorStop(0, lighten(ball.color, 60));
  grad.addColorStop(0.5, ball.color);
  grad.addColorStop(1, darken(ball.color, 40));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Highlight
  ctx.save();
  const hiGrad = ctx.createRadialGradient(x - r*0.3, y - r*0.35, 0, x - r*0.3, y - r*0.35, r*0.55);
  hiGrad.addColorStop(0, 'rgba(255,255,255,0.7)');
  hiGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hiGrad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Number label
  ctx.save();
  ctx.fillStyle   = '#fff';
  ctx.font        = `bold ${Math.round(r * 0.65)}px Inter, sans-serif`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur   = 4;
  ctx.fillText(ball.label, x, y + 1);
  ctx.restore();
}

function drawVelocityArrow(ball, s) {
  const speed = mag(ball.vx, ball.vy) / PIXELS_PER_METER;
  if (speed < 0.2) return;

  const x = ball.x * s;
  const y = ball.y * s;
  const arrowLen = Math.min(speed * 12 * s, 90 * s);
  const angle    = Math.atan2(ball.vy, ball.vx);

  const ex = x + Math.cos(angle) * (ball.r * s + arrowLen);
  const ey = y + Math.sin(angle) * (ball.r * s + arrowLen);

  ctx.save();
  ctx.strokeStyle = ball.color;
  ctx.lineWidth   = 2.5 * s;
  ctx.globalAlpha = 0.85;
  ctx.lineCap     = 'round';
  ctx.shadowColor = ball.glowColor;
  ctx.shadowBlur  = 8;

  ctx.beginPath();
  ctx.moveTo(x + Math.cos(angle) * ball.r * s, y + Math.sin(angle) * ball.r * s);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  // Arrowhead
  const hw = 7 * s;
  ctx.fillStyle = ball.color;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(angle - 0.35) * hw, ey - Math.sin(angle - 0.35) * hw);
  ctx.lineTo(ex - Math.cos(angle + 0.35) * hw, ey - Math.sin(angle + 0.35) * hw);
  ctx.closePath();
  ctx.fill();

  // Speed label
  ctx.fillStyle   = '#fff';
  ctx.font        = `${Math.round(10 * s)}px Inter, sans-serif`;
  ctx.textAlign   = 'center';
  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 0.9;
  ctx.fillText(speed.toFixed(1) + ' m/s', ex + Math.cos(angle)*14*s, ey + Math.sin(angle)*14*s);

  ctx.restore();
}

// ──────────────────────────────────────────────────
// UI Updates
// ──────────────────────────────────────────────────
function updateHUD() {
  const [b1, b2] = state.balls;
  const p1x = b1.m * b1.vx / PIXELS_PER_METER;
  const p1y = b1.m * b1.vy / PIXELS_PER_METER;
  let pxTot = p1x, pyTot = p1y;
  if (state.ball2Enabled) {
    pxTot += b2.m * b2.vx / PIXELS_PER_METER;
    pyTot += b2.m * b2.vy / PIXELS_PER_METER;
  }
  const pTot = Math.sqrt(pxTot*pxTot + pyTot*pyTot);

  document.getElementById('hud-time').textContent  = state.simTime.toFixed(2) + ' s';
  document.getElementById('hud-coll').textContent  = state.collisionCount;
  document.getElementById('hud-ptot').textContent  = pTot.toFixed(3) + ' kg·m/s';
}

function updateEnergyBars() {
  const [b1, b2] = state.balls;
  const ke1 = kineticEnergy(b1);
  const ke2 = state.ball2Enabled ? kineticEnergy(b2) : 0;
  const wf  = state.totalFrictionWork;
  const tot = state.initialEnergy > 0
    ? Math.max(state.initialEnergy, ke1 + ke2 + wf)
    : (ke1 + ke2 + wf) || 1;

  const pct = (v) => Math.min((v / tot) * 100, 100).toFixed(1) + '%';

  document.getElementById('ebar-ke1').style.width = pct(ke1);
  document.getElementById('ebar-ke2').style.width = pct(ke2);
  document.getElementById('ebar-fr').style.width  = pct(wf);
  document.getElementById('ebar-tot').style.width = pct(ke1 + ke2 + wf);

  document.getElementById('eval-ke1').textContent = ke1.toFixed(3) + ' J';
  document.getElementById('eval-ke2').textContent = state.ball2Enabled ? ke2.toFixed(3) + ' J' : '(devre dışı)';
  document.getElementById('eval-fr').textContent  = wf.toFixed(3) + ' J';
  document.getElementById('eval-tot').textContent = (ke1 + ke2 + wf).toFixed(3) + ' J';

  // Energy equation string
  const eqEl = document.getElementById('energy-eq');
  eqEl.innerHTML =
    `KE₁ (${ke1.toFixed(2)} J) + KE₂ (${ke2.toFixed(2)} J) + W<sub>sürt</sub> (${wf.toFixed(2)} J) = ${(ke1+ke2+wf).toFixed(2)} J`;
}

function updateRealTime() {
  const [b1, b2] = state.balls;
  const v1 = mag(b1.vx, b1.vy) / PIXELS_PER_METER;
  const v2 = state.ball2Enabled ? mag(b2.vx, b2.vy) / PIXELS_PER_METER : 0;
  const ke = kineticEnergy(b1) + (state.ball2Enabled ? kineticEnergy(b2) : 0);

  setText('rt-v1',    v1.toFixed(3) + ' m/s');
  setText('rt-v2',    state.ball2Enabled ? v2.toFixed(3) + ' m/s' : '(devre dışı)');
  setText('rt-ketot', ke.toFixed(3) + ' J');
  setText('rt-wfric', state.totalFrictionWork.toFixed(3) + ' J');
}

function updatePrePostUI() {
  const pre  = state.preSnap;
  const post = state.postSnap;
  if (!pre || !post) return;

  const ptotPre  = pre.p1  + pre.p2;
  const ptotPost = post.p1 + post.p2;

  setText('eq-v1-pre',  pre.v1.toFixed(3)  + ' m/s');
  setText('eq-v2-pre',  pre.v2.toFixed(3)  + ' m/s');
  setText('eq-p1-pre',  pre.p1.toFixed(3)  + ' kg·m/s');
  setText('eq-p2-pre',  pre.p2.toFixed(3)  + ' kg·m/s');
  setText('eq-ptot-pre',ptotPre.toFixed(3) + ' kg·m/s');
  setText('eq-ketot-pre',pre.ke.toFixed(3) + ' J');

  setText('eq-v1-post',   post.v1.toFixed(3)  + ' m/s');
  setText('eq-v2-post',   post.v2.toFixed(3)  + ' m/s');
  setText('eq-p1-post',   post.p1.toFixed(3)  + ' kg·m/s');
  setText('eq-p2-post',   post.p2.toFixed(3)  + ' kg·m/s');
  setText('eq-ptot-post', ptotPost.toFixed(3) + ' kg·m/s');
  setText('eq-ketot-post',post.ke.toFixed(3)  + ' J');
  setText('eq-delta-ke',  '−' + post.dKE.toFixed(3) + ' J');
  setText('eq-impulse',   post.impulse.toFixed(4) + ' N·s');
}

function clearPostUI() {
  const ids = ['eq-v1-pre','eq-v2-pre','eq-p1-pre','eq-p2-pre','eq-ptot-pre','eq-ketot-pre',
                'eq-v1-post','eq-v2-post','eq-p1-post','eq-p2-post','eq-ptot-post','eq-ketot-post',
                'eq-delta-ke','eq-impulse'];
  ids.forEach(id => setText(id, '—'));
}

function updateCollisionTypeBadge(e) {
  const el = document.getElementById('ct-text');
  if (e === 1)       { el.textContent = 'Tam Elastik (e=1)'; }
  else if (e === 0)  { el.textContent = 'Tam Plastik (e=0)'; }
  else               { el.textContent = `Kısmen Elastik (e=${e.toFixed(2)})`; }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ──────────────────────────────────────────────────
// Drag & Drop balls
// ──────────────────────────────────────────────────
let dragging = null;
let dragOffX = 0, dragOffY = 0;

canvas.addEventListener('mousedown', (e) => {
  if (state.running) return;
  const { x, y } = canvasPos(e);
  const draggable = state.ball2Enabled ? state.balls : [state.balls[0]];
  for (const ball of draggable) {
    const dx = x - ball.x;
    const dy = y - ball.y;
    if (Math.sqrt(dx*dx+dy*dy) <= ball.r + 5) {
      dragging  = ball;
      dragOffX  = dx;
      dragOffY  = dy;
      canvas.style.cursor = 'grabbing';
      break;
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const { x, y } = canvasPos(e);
  const cW = TABLE_W_M * PIXELS_PER_METER;
  const cH = TABLE_H_M * PIXELS_PER_METER;
  dragging.x = Math.max(dragging.r, Math.min(cW - dragging.r, x - dragOffX));
  dragging.y = Math.max(dragging.r, Math.min(cH - dragging.r, y - dragOffY));
  draw();
});

canvas.addEventListener('mouseup', () => {
  dragging = null;
  canvas.style.cursor = 'grab';
});

canvas.addEventListener('mouseleave', () => { dragging = null; });

// Touch support
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const touch = e.touches[0];
  const me = { clientX: touch.clientX, clientY: touch.clientY };
  if (state.running) return;
  const { x, y } = canvasPos(me);
  for (const ball of state.balls) {
    const dx = x - ball.x;
    const dy = y - ball.y;
    if (Math.sqrt(dx*dx+dy*dy) <= ball.r + 10) {
      dragging = ball; dragOffX = dx; dragOffY = dy; break;
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!dragging) return;
  const touch = e.touches[0];
  const { x, y } = canvasPos({ clientX: touch.clientX, clientY: touch.clientY });
  const cW = TABLE_W_M * PIXELS_PER_METER;
  const cH = TABLE_H_M * PIXELS_PER_METER;
  dragging.x = Math.max(dragging.r, Math.min(cW - dragging.r, x - dragOffX));
  dragging.y = Math.max(dragging.r, Math.min(cH - dragging.r, y - dragOffY));
  draw();
}, { passive: false });

canvas.addEventListener('touchend', () => { dragging = null; });

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const s    = state.scale;
  return {
    x: (e.clientX - rect.left) / s,
    y: (e.clientY - rect.top)  / s,
  };
}

// ──────────────────────────────────────────────────
// Utility helpers
// ──────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function lighten(hex, amount) {
  return adjustColor(hex, amount);
}
function darken(hex, amount) {
  return adjustColor(hex, -amount);
}
function adjustColor(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ──────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────
resizeCanvas();
resetSim();
draw();
