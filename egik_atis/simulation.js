/* ═══════════════════════════════════════════════
   Eğik Atış Simülasyonu – simulation.js  v2
   ═══════════════════════════════════════════════ */
'use strict';

// ─── Sabitler ────────────────────────────────────
const RHO_AIR = 1.225; // kg/m³

// ─── Simülasyon Durumu ───────────────────────────
const sim = {
  running : false,
  paused  : false,
  launched: false,
  t : 0, x : 0, y : 0, vx: 0, vy: 0,
  maxY    : 0,
  trail   : [],
  animId  : null,
  lastTs  : null,
};

// Görünüm durumu
const view = {
  zoom : 1,
  panX : 60,
  // panY'i kullanmıyoruz, zemin her zaman canvas %82'sinde
};

// ─── DOM Referansları ────────────────────────────
const canvas = document.getElementById('sim-canvas');
const ctx    = canvas.getContext('2d');
const wrap   = document.getElementById('canvas-wrapper');

// Sliderlar
const SL = {
  velocity: document.getElementById('input-velocity'),
  angle   : document.getElementById('input-angle'),
  height  : document.getElementById('input-height'),
  gravity : document.getElementById('input-gravity'),
  mass    : document.getElementById('input-mass'),
  drag    : document.getElementById('input-drag'),
  area    : document.getElementById('input-area'),
};
const DV = {
  velocity: document.getElementById('val-velocity'),
  angle   : document.getElementById('val-angle'),
  height  : document.getElementById('val-height'),
  gravity : document.getElementById('val-gravity'),
  mass    : document.getElementById('val-mass'),
  drag    : document.getElementById('val-drag'),
  area    : document.getElementById('val-area'),
};

const cbDrag     = document.getElementById('cb-drag');
const cbVelVec   = document.getElementById('cb-velocity-vec');
const cbCompVec  = document.getElementById('cb-component-vec');
const cbTrail    = document.getElementById('cb-trail');
const cbCompare  = document.getElementById('cb-compare');
const dragOpts   = document.getElementById('drag-options');
const projSel    = document.getElementById('input-projectile');

const btnLaunch  = document.getElementById('btn-launch');
const btnPause   = document.getElementById('btn-pause');
const btnReset   = document.getElementById('btn-reset');

const statTime   = document.getElementById('stat-time');
const statSpeed  = document.getElementById('stat-speed');
const statX      = document.getElementById('stat-x');
const statY      = document.getElementById('stat-y');

const resBanner  = document.getElementById('results-banner');
const resRange   = document.getElementById('res-range');
const resHeight  = document.getElementById('res-height');
const resTime    = document.getElementById('res-time');
const modeBadge  = document.getElementById('mode-badge');

// Formül canlı değerleri
const FLV = {
  vx    : document.getElementById('live-vx'),
  vy0   : document.getElementById('live-vy0'),
  vy    : document.getElementById('live-vy'),
  x     : document.getElementById('live-x'),
  y     : document.getElementById('live-y'),
  tpeak : document.getElementById('live-t-peak'),
  hmax  : document.getElementById('live-h-max'),
  T     : document.getElementById('live-T'),
  R     : document.getElementById('live-R'),
  fd    : document.getElementById('live-fd'),
};

// ─── Parametre okuma ─────────────────────────────
function P() {
  const deg = clamp(+SL.angle.value, 1, 89);
  const th  = deg * Math.PI / 180;
  return {
    v0  : +SL.velocity.value,
    deg, th,
    h0  : +SL.height.value,
    g   : +SL.gravity.value,
    mass: +SL.mass.value,
    cd  : +SL.drag.value,
    area: +SL.area.value,
    drag: cbDrag.checked,
  };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Slider güncelleme ───────────────────────────
function syncDisplays() {
  const p = P();
  DV.velocity.textContent = `${p.v0} m/s`;
  DV.angle.textContent    = `${p.deg}°`;
  DV.height.textContent   = `${p.h0} m`;
  DV.gravity.textContent  = `${p.g.toFixed(2)} m/s²`;
  DV.mass.textContent     = `${p.mass.toFixed(1)} kg`;
  DV.drag.textContent     = `${p.cd.toFixed(2)}`;
  DV.area.textContent     = `${p.area.toFixed(3)} m²`;

  // Formül statik değerler (başlangıç)
  const vx0  = p.v0 * Math.cos(p.th);
  const vy0  = p.v0 * Math.sin(p.th);
  const disc = vy0 * vy0 + 2 * p.g * p.h0;
  const T    = disc >= 0 ? (vy0 + Math.sqrt(disc)) / p.g : 0;
  FLV.vx.textContent    = `= ${vx0.toFixed(2)} m/s`;
  FLV.vy0.textContent   = `= ${vy0.toFixed(2)} m/s`;
  FLV.tpeak.textContent = `= ${(vy0 / p.g).toFixed(2)} s`;
  FLV.hmax.textContent  = `= ${(p.h0 + vy0 * vy0 / (2 * p.g)).toFixed(2)} m`;
  FLV.T.textContent     = `= ${T.toFixed(2)} s`;
  FLV.R.textContent     = `= ${(vx0 * T).toFixed(2)} m`;
}

// ─── Koordinat dönüşümleri ───────────────────────
function groundPx() {
  return canvas.height * 0.82;
}

function w2c(wx, wy) {
  // Dünya (m) → Ekran (px)
  return [
    view.panX + wx * view.zoom,
    groundPx() - wy * view.zoom,
  ];
}

function c2w(cx, cy) {
  // Ekran (px) → Dünya (m)
  return [
    (cx - view.panX) / view.zoom,
    (groundPx() - cy) / view.zoom,
  ];
}

// ─── Ön-hesaplama (yörünge) ──────────────────────
function precomputeTraj(withDrag) {
  const p = P();
  const pts = [];
  let x = 0, y = p.h0;
  let vx = p.v0 * Math.cos(p.th);
  let vy = p.v0 * Math.sin(p.th);
  let t  = 0;
  const dt = 0.005;
  for (let i = 0; i < 40000; i++) {
    pts.push({ x, y });
    const v = Math.hypot(vx, vy);
    let ax = 0, ay = -p.g;
    if (withDrag && v > 0) {
      const k = 0.5 * RHO_AIR * p.cd * p.area * v / p.mass;
      ax -= k * vx;
      ay -= k * vy;
    }
    vx += ax * dt; vy += ay * dt;
    x  += vx * dt; y  += vy * dt;
    t  += dt;
    if (t > 0.1 && y <= 0) break;
  }
  return pts;
}

// ─── Otomatik yakınlaştırma ──────────────────────
function autoFit() {
  canvas.width  = wrap.clientWidth  || 800;
  canvas.height = wrap.clientHeight || 600;

  const p    = P();
  const traj = precomputeTraj(p.drag);
  const comp = cbCompare.checked ? precomputeTraj(!p.drag) : [];
  const all  = [...traj, ...comp];
  if (all.length < 2) { view.zoom = 5; view.panX = 60; return; }

  const maxX = Math.max(1, ...all.map(pt => pt.x));
  const maxY = Math.max(1, ...all.map(pt => pt.y)) + p.h0;

  const usableW = canvas.width  * 0.82;
  const usableH = canvas.height * 0.72;

  const zx = usableW / maxX;
  const zy = usableH / (maxY + 2);
  view.zoom = clamp(Math.min(zx, zy), 0.1, 300);
  view.panX = canvas.width * 0.07;
}

// ─── Fizik adımı (Euler, sub-stepped) ────────────
function physicsStep(dt) {
  const p = P();
  const v = Math.hypot(sim.vx, sim.vy);
  let ax = 0, ay = -p.g;
  if (p.drag && v > 0) {
    const k  = 0.5 * RHO_AIR * p.cd * p.area * v / p.mass;
    ax -= k * sim.vx;
    ay -= k * sim.vy;
    FLV.fd.innerHTML = `F<sub>d</sub> = ${(0.5 * RHO_AIR * p.cd * p.area * v * v).toFixed(3)} N`;
  }
  sim.vx += ax * dt;
  sim.vy += ay * dt;
  sim.x  += sim.vx * dt;
  sim.y  += sim.vy * dt;
  sim.t  += dt;
  if (sim.y > sim.maxY) sim.maxY = sim.y;
}

// ─── Ana döngü ───────────────────────────────────
function loop(ts) {
  if (!sim.running) return;
  if (sim.paused)   { sim.lastTs = ts; sim.animId = requestAnimationFrame(loop); return; }
  if (sim.lastTs === null) sim.lastTs = ts;
  const rawDt = Math.min((ts - sim.lastTs) / 1000, 0.05);
  sim.lastTs = ts;

  // 8 alt-adım
  const sub = rawDt / 8;
  for (let i = 0; i < 8; i++) {
    physicsStep(sub);
    if (cbTrail.checked) sim.trail.push({ x: sim.x, y: sim.y });
    if (sim.t > 0.12 && sim.y <= 0) { finishSim(); return; }
  }

  // Canlı formüller
  FLV.vy.textContent = `= ${sim.vy.toFixed(2)} m/s`;
  FLV.x.textContent  = `= ${sim.x.toFixed(2)} m`;
  FLV.y.textContent  = `= ${sim.y.toFixed(2)} m`;

  // Stat overlay
  statTime.textContent  = `${sim.t.toFixed(2)} s`;
  statSpeed.textContent = `${Math.hypot(sim.vx, sim.vy).toFixed(2)} m/s`;
  statX.textContent     = `${sim.x.toFixed(1)} m`;
  statY.textContent     = `${Math.max(0, sim.y).toFixed(1)} m`;

  render();
  sim.animId = requestAnimationFrame(loop);
}

function finishSim() {
  sim.running = false;
  cancelAnimationFrame(sim.animId);

  resBanner.classList.remove('hidden');
  resRange.textContent  = `${sim.x.toFixed(2)} m`;
  resHeight.textContent = `${sim.maxY.toFixed(2)} m`;
  resTime.textContent   = `${sim.t.toFixed(2)} s`;

  btnLaunch.disabled = false;
  btnPause.disabled  = true;
  btnPause.textContent = '⏸ Duraklat';
  render();
}

// ─── Fırlat ──────────────────────────────────────
function launch() {
  if (sim.running) return;
  const p = P();
  cancelAnimationFrame(sim.animId);
  Object.assign(sim, {
    running: true, paused: false, launched: true,
    t: 0, x: 0, y: p.h0, vx: p.v0 * Math.cos(p.th), vy: p.v0 * Math.sin(p.th),
    maxY: p.h0, trail: [{ x: 0, y: p.h0 }], lastTs: null,
  });
  resBanner.classList.add('hidden');
  btnLaunch.disabled = true;
  btnPause.disabled  = false;
  btnPause.textContent = '⏸ Duraklat';
  FLV.vy.textContent = `= ${sim.vy.toFixed(2)} m/s`;
  FLV.x.textContent  = '= 0.00 m';
  FLV.y.textContent  = `= ${p.h0.toFixed(2)} m`;
  autoFit();
  sim.animId = requestAnimationFrame(loop);
}

// ─── Sıfırla ─────────────────────────────────────
function reset() {
  cancelAnimationFrame(sim.animId);
  Object.assign(sim, {
    running: false, paused: false, launched: false,
    t: 0, x: 0, y: 0, vx: 0, vy: 0, maxY: 0,
    trail: [], animId: null, lastTs: null,
  });
  resBanner.classList.add('hidden');
  btnLaunch.disabled = false;
  btnPause.disabled  = true;
  btnPause.textContent = '⏸ Duraklat';
  FLV.fd.innerHTML   = 'F<sub>d</sub> = — N';
  FLV.vy.textContent = '= — m/s';
  FLV.x.textContent  = '= — m';
  FLV.y.textContent  = '= — m';
  statTime.textContent  = '0.00 s';
  statSpeed.textContent = '— m/s';
  statX.textContent     = '0.0 m';
  statY.textContent     = '0.0 m';
  autoFit();
  render();
}

// ──────────────────────────────────────────────────
//  RENDER
// ──────────────────────────────────────────────────
const PROJ_COL = { ball:'#60a5fa', cannon:'#94a3b8', arrow:'#fbbf24', rocket:'#f97316' };

function render() {
  const W = canvas.width  = wrap.clientWidth  || 800;
  const H = canvas.height = wrap.clientHeight || 600;
  ctx.clearRect(0, 0, W, H);

  const p  = P();
  const gY = groundPx();

  /* --- Gökyüzü --- */
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0,   '#060d1a');
  sky.addColorStop(0.6, '#0d2137');
  sky.addColorStop(1,   '#0b0f1a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  /* Yıldızlar (seeded) */
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 90; i++) {
    const sx = pseudoRand(i * 2)     * W;
    const sy = pseudoRand(i * 2 + 1) * gY * 0.95;
    const sr = pseudoRand(i + 500)   * 1.3;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
  }

  /* --- Zemin --- */
  const gnd = ctx.createLinearGradient(0, gY, 0, H);
  gnd.addColorStop(0, '#1b3d1b');
  gnd.addColorStop(0.5, '#0f2a0f');
  gnd.addColorStop(1, '#060d06');
  ctx.fillStyle = gnd;
  ctx.fillRect(0, gY, W, H - gY);

  ctx.save();
  ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 12;
  ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, gY); ctx.lineTo(W, gY); ctx.stroke();
  ctx.restore();

  /* --- Grid --- */
  const gs = view.zoom * 10;
  if (gs > 6) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let gx = view.panX % gs; gx < W; gx += gs) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, gY); ctx.stroke();
    }
    const gy0 = gY % gs;
    for (let gy = gy0; gy > 0; gy -= gs) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }
  }

  /* --- Eksen etiketleri --- */
  ctx.fillStyle = 'rgba(148,163,184,0.65)';
  ctx.font = "10px 'JetBrains Mono'";
  const lstep = labelStep();
  for (let m = 0; m <= 100000; m += lstep) {
    const [px] = w2c(m, 0);
    if (px > W + 50) break;
    if (px < 0) continue;
    ctx.fillText(`${m}m`, px - 8, gY + 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, gY); ctx.lineTo(px, gY + 4); ctx.stroke();
  }
  // y-eksen
  for (let m = lstep; m <= 100000; m += lstep) {
    const [, py] = w2c(0, m);
    if (py < 0) break;
    ctx.fillText(`${m}m`, view.panX - 32, py + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(view.panX - 4, py); ctx.lineTo(view.panX, py); ctx.stroke();
  }

  /* --- Karşılaştırma yörüngesi (kesikli) --- */
  if (cbCompare.checked) {
    const cTraj = precomputeTraj(!p.drag);
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = p.drag ? 'rgba(59,130,246,0.55)' : 'rgba(239,68,68,0.55)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    let first = true;
    for (const pt of cTraj) {
      const [cx, cy] = w2c(pt.x, pt.y);
      first ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
      first = false;
    }
    ctx.stroke();
    ctx.restore();
    const lbl = cTraj[cTraj.length - 1];
    if (lbl) {
      const [lx, ly] = w2c(lbl.x, lbl.y);
      ctx.fillStyle = p.drag ? 'rgba(59,130,246,0.9)' : 'rgba(239,68,68,0.9)';
      ctx.font = '11px Inter';
      ctx.fillText(p.drag ? '⟵ Sürtünmesiz' : '⟵ Sürtünmeli', lx + 5, Math.max(14, ly));
    }
  }

  /* --- İz --- */
  if (cbTrail.checked && sim.trail.length > 1) {
    const col = PROJ_COL[projSel.value] || '#60a5fa';
    ctx.save();
    for (let i = 1; i < sim.trail.length; i++) {
      const r = i / sim.trail.length;
      ctx.strokeStyle = hexAlpha(col, r * 0.75);
      ctx.lineWidth   = 1.5 + r * 1.5;
      const [x1, y1] = w2c(sim.trail[i-1].x, sim.trail[i-1].y);
      const [x2, y2] = w2c(sim.trail[i].x,   sim.trail[i].y);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  }

  /* --- Fırlatıcı (top + namlu) --- */
  drawLauncher(p);

  /* --- Top (uçuşta) --- */
  if (sim.launched) {
    const [bx, by] = w2c(sim.x, sim.y);
    drawBall(bx, by);

    // Zemin gölgesi
    const [, sgY] = w2c(sim.x, 0);
    const distY = Math.max(0, sim.y);
    const shadowR = Math.max(2, 12 - distY * view.zoom * 0.03);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(bx, sgY, shadowR, shadowR * 0.35, 0, 0, Math.PI * 2); ctx.fill();

    // Hız vektörü
    if (cbVelVec.checked && sim.running) {
      const sc = clamp(view.zoom * 0.35, 0.5, 8);
      arrow(bx, by, bx + sim.vx * sc, by - sim.vy * sc, '#f59e0b', 2.5);
      ctx.fillStyle = '#f59e0b'; ctx.font = 'bold 12px Inter';
      ctx.fillText('v', bx + sim.vx * sc + 6, by - sim.vy * sc - 6);
    }
    // Bileşen vektörler
    if (cbCompVec.checked && sim.running) {
      const sc = clamp(view.zoom * 0.35, 0.5, 8);
      arrow(bx, by, bx + sim.vx * sc, by, '#3b82f6', 2);
      arrow(bx, by, bx, by - sim.vy * sc, '#10b981', 2);
      ctx.font = '10px Inter';
      ctx.fillStyle = '#3b82f6'; ctx.fillText('vₓ', bx + sim.vx * sc + 4, by + 4);
      ctx.fillStyle = '#10b981'; ctx.fillText('vᵧ', bx + 4, by - sim.vy * sc - 5);
    }
  }

  /* --- İnteraktif ipucu (fırlatılmamışsa) --- */
  if (!sim.launched && !sim.running) {
    const [cx0, cy0] = w2c(0, p.h0);
    ctx.save();
    ctx.fillStyle = 'rgba(251,191,36,0.25)';
    ctx.strokeStyle = 'rgba(251,191,36,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(cx0, cy0, 55, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(251,191,36,0.7)';
    ctx.font = '11px Inter';
    ctx.fillText('← Sürükle: Açıyı Ayarla', cx0 + 60, cy0 - 14);
  }
}

function drawLauncher(p) {
  const [cx0, cy0] = w2c(0, p.h0);
  const [,    cgY] = w2c(0, 0);

  // Direk (yükseklik > 0 ise)
  if (p.h0 > 0) {
    const grad = ctx.createLinearGradient(cx0 - 6, 0, cx0 + 6, 0);
    grad.addColorStop(0, '#374151'); grad.addColorStop(0.5, '#6b7280'); grad.addColorStop(1, '#374151');
    ctx.fillStyle = grad;
    ctx.fillRect(cx0 - 5, cy0, 10, cgY - cy0);

    // yükseklik ok + etiket
    ctx.save();
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx0 + 18, cy0); ctx.lineTo(cx0 + 18, cgY); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#94a3b8'; ctx.font = 'bold 11px JetBrains Mono';
    ctx.fillText(`${p.h0}m`, cx0 + 22, (cy0 + cgY) / 2 + 4);
  }

  // Namlu
  ctx.save();
  ctx.translate(cx0, cy0);
  ctx.rotate(-p.th);
  // Namlu gövdesi
  const bGrad = ctx.createLinearGradient(0, -9, 0, 9);
  bGrad.addColorStop(0,   '#fca5a5');
  bGrad.addColorStop(0.4, '#ef4444');
  bGrad.addColorStop(1,   '#7f1d1d');
  ctx.fillStyle = bGrad;
  ctx.shadowColor = '#ef444466'; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.roundRect(-8, -9, 52, 18, 5); ctx.fill();
  // Namlu ağzı (açık uç)
  ctx.fillStyle = '#991b1b';
  ctx.beginPath(); ctx.roundRect(40, -9, 12, 18, [0, 5, 5, 0]); ctx.fill();
  ctx.restore();

  // Merkez top (pivot)
  ctx.save();
  ctx.shadowColor = '#60a5fa44'; ctx.shadowBlur = 10;
  const cGrad = ctx.createRadialGradient(cx0 - 4, cy0 - 4, 1, cx0, cy0, 13);
  cGrad.addColorStop(0, '#93c5fd'); cGrad.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = cGrad;
  ctx.beginPath(); ctx.arc(cx0, cy0, 13, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Açı yayı
  ctx.save();
  ctx.strokeStyle = 'rgba(251,191,36,0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(cx0, cy0, 40, -p.th, 0, false); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 13px JetBrains Mono';
  ctx.fillText(`${p.deg}°`, cx0 + 44, cy0 + 5);
}

function drawBall(bx, by) {
  const col = PROJ_COL[projSel.value] || '#60a5fa';
  const r   = projSel.value === 'cannon' ? 11 : 8;
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = 22;
  const g = ctx.createRadialGradient(bx - r * 0.3, by - r * 0.3, 1, bx, by, r);
  g.addColorStop(0,   '#ffffff');
  g.addColorStop(0.35, col);
  g.addColorStop(1,   '#00000060');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ─── Ok çizimi ───────────────────────────────────
function arrow(x1, y1, x2, y2, col, lw) {
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.hypot(dx, dy) < 3) return;
  const ang = Math.atan2(dy, dx);
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = col;
  ctx.lineWidth = lw;
  ctx.shadowColor = col + '88'; ctx.shadowBlur = 6;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ─── Yardımcılar ─────────────────────────────────
function pseudoRand(n) { const x = Math.sin(n * 9301 + 49297) % 1; return x - Math.floor(x); }
function hexAlpha(h, a) {
  const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function labelStep() {
  const raw = 60 / view.zoom;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const s of [1,2,5,10,20,50,100,200,500]) if (mag * s >= raw) return mag * s;
  return mag * 1000;
}

// ──────────────────────────────────────────────────
//  İNTERAKTİF SÜRÜKLEME (Canvas Mouse / Touch)
// ──────────────────────────────────────────────────
let drag = null;  // { mode: 'aim'|'pan', startX, startY, startPanX }

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  const cl = e.touches ? e.touches[0] : e;
  return [cl.clientX - r.left, cl.clientY - r.top];
}

function launcherHitTest(cx, cy) {
  const p = P();
  const [lx, ly] = w2c(0, p.h0);
  return Math.hypot(cx - lx, cy - ly) < 55;
}

function onPointerDown(e) {
  if (sim.running) return;
  const [cx, cy] = canvasPos(e);
  if (launcherHitTest(cx, cy)) {
    drag = { mode: 'aim', ox: cx, oy: cy };
    canvas.style.cursor = 'crosshair';
  } else {
    drag = { mode: 'pan', startX: cx, startPanX: view.panX };
    canvas.style.cursor = 'grabbing';
  }
  e.preventDefault();
}

function onPointerMove(e) {
  if (!drag) {
    // Hover ipucu
    if (!sim.running) {
      const [cx, cy] = canvasPos(e);
      canvas.style.cursor = launcherHitTest(cx, cy) ? 'crosshair' : 'grab';
    }
    return;
  }
  const [cx, cy] = canvasPos(e);
  const p = P();

  if (drag.mode === 'aim') {
    const [lx, ly] = w2c(0, p.h0);
    // Açı: fare konumu → namlu pivot açısı
    let angle = Math.atan2(-(cy - ly), cx - lx) * 180 / Math.PI;
    angle = clamp(angle, 1, 89);
    SL.angle.value = Math.round(angle);
    syncDisplays();
  } else {
    // Pan
    view.panX = drag.startPanX + cx - drag.startX;
    view.panX = clamp(view.panX, -canvas.width * 2, canvas.width);
  }
  render();
  e.preventDefault();
}

function onPointerUp() {
  drag = null;
  canvas.style.cursor = sim.running ? 'default' : 'grab';
}

// Tekerlekle zoom
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const [cx] = canvasPos(e);
  const wx = (cx - view.panX) / view.zoom;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  view.zoom = clamp(view.zoom * factor, 0.1, 300);
  view.panX = cx - wx * view.zoom;
  render();
}, { passive: false });

canvas.addEventListener('mousedown',  onPointerDown);
canvas.addEventListener('mousemove',  onPointerMove);
canvas.addEventListener('mouseup',    onPointerUp);
canvas.addEventListener('mouseleave', onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('touchmove',  onPointerMove, { passive: false });
canvas.addEventListener('touchend',   onPointerUp);

// ─── Buton olayları ──────────────────────────────
btnLaunch.addEventListener('click', launch);
btnPause.addEventListener('click', () => {
  if (!sim.running) return;
  sim.paused = !sim.paused;
  btnPause.textContent = sim.paused ? '▶ Devam' : '⏸ Duraklat';
});
btnReset.addEventListener('click', reset);

// ─── Slider olayları ─────────────────────────────
Object.values(SL).forEach(s => s.addEventListener('input', () => {
  syncDisplays();
  if (!sim.launched) { autoFit(); render(); }
}));

// ─── Checkbox olayları ───────────────────────────
cbDrag.addEventListener('change', () => {
  dragOpts.classList.toggle('hidden', !cbDrag.checked);
  const on = cbDrag.checked;
  modeBadge.textContent        = on ? 'Sürtünmeli' : 'Sürtünmesiz';
  modeBadge.style.borderColor  = on ? 'var(--accent-drag)' : 'var(--accent-3)';
  modeBadge.style.color        = on ? 'var(--accent-drag)' : 'var(--accent-3)';
  document.getElementById('drag-formula-section').style.opacity = on ? 1 : 0.4;
  if (!sim.launched) { autoFit(); render(); }
});
cbCompare.addEventListener('change', () => { autoFit(); render(); });
[cbVelVec, cbCompVec, cbTrail].forEach(c => c.addEventListener('change', () => render()));
projSel.addEventListener('change', () => render());

// ─── Klavye ──────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space')       { e.preventDefault(); sim.running ? btnPause.click() : launch(); }
  if (e.code === 'KeyR')        { reset(); }
  if (e.code === 'Equal'  || e.code === 'NumpadAdd')      { zoomBy(1.2); }
  if (e.code === 'Minus'  || e.code === 'NumpadSubtract') { zoomBy(1/1.2); }
});

function zoomBy(f) {
  const cx = canvas.width / 2;
  const wx = (cx - view.panX) / view.zoom;
  view.zoom = clamp(view.zoom * f, 0.1, 300);
  view.panX = cx - wx * view.zoom;
  render();
}

// ─── Zoom butonları ──────────────────────────────
document.getElementById('btn-zoom-in').addEventListener('click',  () => zoomBy(1.25));
document.getElementById('btn-zoom-out').addEventListener('click', () => zoomBy(1/1.25));
document.getElementById('btn-zoom-fit').addEventListener('click', () => { autoFit(); render(); });

// ─── Formül paneli toggle ────────────────────────
document.getElementById('btn-formula-toggle').addEventListener('click', () => {
  document.getElementById('formula-panel').classList.toggle('hidden');
  setTimeout(() => { autoFit(); render(); }, 50);
});

// ─── Boyut değişikliği ───────────────────────────
const ro = new ResizeObserver(() => { autoFit(); render(); });
ro.observe(wrap);

// ─── Başlangıç ───────────────────────────────────
syncDisplays();
autoFit();
render();
