/**
 * Kaldırma Kuvveti Simülasyonu - simulation.js
 * Arşimet Prensibi interaktif simülasyonu
 */

(function () {
  'use strict';

  /* =========================================
     CONSTANTS & CONFIG
  ========================================= */
  const G = 9.8;           // m/s²
  const SCALE = 60;        // px per litre (cube root basis)
  const MAX_FORCE_N = 250; // for bar normalisation

  const LIQUIDS = {
    gasoline:  { name: 'Benzin',     density: 0.70, colorTop: '#d97706cc', colorBot: '#92400eee', waveColor: '#f59e0b55' },
    water:     { name: 'Su',         density: 1.00, colorTop: '#0369a1cc', colorBot: '#0c4a6eee', waveColor: '#38bdf855' },
    seawater:  { name: 'Deniz Suyu', density: 1.03, colorTop: '#155e75cc', colorBot: '#0e7490ee', waveColor: '#22d3ee55' },
    glycerin:  { name: 'Gliserin',   density: 1.26, colorTop: '#6d28d9cc', colorBot: '#4c1d95ee', waveColor: '#a78bfa55' },
    mercury:   { name: 'Cıva',       density: 13.6, colorTop: '#6b7280cc', colorBot: '#374151ee', waveColor: '#9ca3af55' },
  };

  const FACTS = [
    "Bir cisme etki eden kaldırma kuvveti, cismin yerinden ettiği sıvının ağırlığına eşittir.",
    "Arşimet, 'Eureka!' diyerek banyodan fırladığında bu prensibi keşfetmişti.",
    "Deniz suyunun özkütlesi tatlı sudan fazladır, bu yüzden nesneler denizde daha kolay yüzer.",
    "Balonlar, çevresindeki havanın yarattığı kaldırma kuvvetiyle yükselir.",
    "Dev gemiler çelikten yapılmış olmasına rağmen içleri hava dolu olduğu için yüzerler.",
    "Cıva çok yoğun olduğu için demir toplar bile cıva üzerinde yüzer.",
  ];

  /* =========================================
     STATE
  ========================================= */
  const state = {
    blocks: {
      A: { mass: 5,  volume: 5,  color: '#b45309', labelColor: '#fbbf24', x: 0, y: 0, vx: 0, vy: 0, dragging: false },
      B: { mass: 10, volume: 8,  color: '#1e40af', labelColor: '#93c5fd', x: 0, y: 0, vx: 0, vy: 0, dragging: false },
    },
    activeBlock: 'A',
    liquid: 'water',
    showGravity: true,
    showBuoyancy: true,
    showNet: true,
    showValues: true,
    liquidY: 0,       // canvas y of liquid surface
    waveOffset: 0,
    animFrame: null,
    dragOffX: 0,
    dragOffY: 0,
    factIndex: 0,
  };

  /* =========================================
     DOM REFERENCES
  ========================================= */
  const canvas     = document.getElementById('sim-canvas');
  const ctx        = canvas.getContext('2d');
  const statusBadge = document.getElementById('status-badge');

  // Sliders
  const massSlider   = document.getElementById('mass-slider');
  const volumeSlider = document.getElementById('volume-slider');
  const massVal      = document.getElementById('mass-value');
  const volVal       = document.getElementById('volume-value');
  const densDisp     = document.getElementById('density-display');
  const liqDensDisp  = document.getElementById('liquid-density-display');

  // Readouts
  const weightValEl   = document.getElementById('weight-value');
  const buoyValEl     = document.getElementById('buoyancy-value');
  const netValEl      = document.getElementById('net-value');
  const weightBarEl   = document.getElementById('weight-bar');
  const buoyBarEl     = document.getElementById('buoyancy-bar');
  const netBarEl      = document.getElementById('net-bar');

  const subPctEl   = document.getElementById('submersion-pct');
  const subVolEl   = document.getElementById('submerged-vol');
  const objStatEl  = document.getElementById('object-status');

  const formulaFgEl = document.getElementById('formula-fg');
  const formulaFkEl = document.getElementById('formula-fk');

  const factTextEl  = document.getElementById('fact-text');

  /* =========================================
     HELPERS
  ========================================= */
  function blockSizePx(vol) {
    // side length in px from volume in litres
    return Math.cbrt(vol) * SCALE;
  }

  function getBlock() { return state.blocks[state.activeBlock]; }

  function getSubmergedFraction(block) {
    const s = blockSizePx(block.volume);
    const liquidSurfaceY = state.liquidY;
    const blockTop = block.y - s / 2;
    const blockBot = block.y + s / 2;

    // Canvas coord: Y increases downward. Liquid occupies liquidY → canvas.height.
    // Block is entirely ABOVE the liquid surface (not touching)
    if (blockBot <= liquidSurfaceY) return 0;
    // Block is entirely BELOW the liquid surface (fully submerged)
    if (blockTop >= liquidSurfaceY) return 1;

    // Partially submerged: how much of the block is below the surface
    const subDepth = blockBot - liquidSurfaceY;
    return Math.min(1, Math.max(0, subDepth / s));
  }

  function computeForces(block) {
    const frac = getSubmergedFraction(block);
    const Fg = block.mass * G;                         // N
    const Fk = LIQUIDS[state.liquid].density * 1000 * (block.volume * frac / 1000) * G;
    // ρ kg/m³ * V_sub_m³ * g
    const Fnet = Fg - Fk;
    return { Fg, Fk, Fnet, frac };
  }

  /* =========================================
     CANVAS RESIZE
  ========================================= */
  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = rect.height;
    state.liquidY = canvas.height * 0.55;

    // Initial block positions if not set
    const bA = state.blocks.A;
    const bB = state.blocks.B;
    if (bA.x === 0 && bA.y === 0) {
      bA.x = canvas.width * 0.3;
      bA.y = state.liquidY - blockSizePx(bA.volume) / 2 - 10;
    }
    if (bB.x === 0 && bB.y === 0) {
      bB.x = canvas.width * 0.7;
      bB.y = state.liquidY - blockSizePx(bB.volume) / 2 - 10;
    }
  }

  /* =========================================
     PHYSICS UPDATE
  ========================================= */
  function physicsStep(block, dt) {
    if (block.dragging) return;
    const { Fg, Fk } = computeForces(block);
    const Fnet = Fg - Fk;
    const a = Fnet / block.mass;                 // m/s²

    // Damping in liquid (viscosity approximation)
    const frac = getSubmergedFraction(block);
    const damping = frac > 0 ? 0.92 : 0.99;

    block.vy += a * dt * 1.5;                    // scale for visible movement
    block.vy *= damping;

    const s = blockSizePx(block.volume);
    block.y += block.vy;

    // Floor
    const floorY = canvas.height - s / 2 - 2;
    if (block.y > floorY) {
      block.y = floorY;
      block.vy *= -0.3;
    }

    // Ceiling
    const ceilY = s / 2;
    if (block.y < ceilY) {
      block.y = ceilY;
      block.vy *= -0.3;
    }

    // Horizontal damping
    block.vx *= 0.9;
    block.x += block.vx;

    // Horizontal bounds
    const halfW = s / 2;
    if (block.x < halfW) { block.x = halfW; block.vx *= -0.5; }
    if (block.x > canvas.width - halfW) { block.x = canvas.width - halfW; block.vx *= -0.5; }
  }

  /* =========================================
     DRAWING
  ========================================= */
  function drawBackground() {
    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, state.liquidY);
    sky.addColorStop(0, '#0a0f1e');
    sky.addColorStop(1, '#0f2040');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, state.liquidY);

    // Stars (static, drawn once - small dots)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 137 + 17) % canvas.width);
      const sy = ((i * 89 + 31) % state.liquidY * 0.9);
      const r = i % 3 === 0 ? 1.2 : 0.7;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLiquid() {
    const liq = LIQUIDS[state.liquid];
    const grad = ctx.createLinearGradient(0, state.liquidY, 0, canvas.height);
    grad.addColorStop(0, liq.colorTop);
    grad.addColorStop(1, liq.colorBot);

    // Liquid body
    ctx.fillStyle = grad;
    ctx.fillRect(0, state.liquidY, canvas.width, canvas.height - state.liquidY);

    // Wave on surface
    ctx.beginPath();
    ctx.moveTo(0, state.liquidY);
    const wo = state.waveOffset;
    for (let x = 0; x <= canvas.width; x += 4) {
      const waveY = state.liquidY + Math.sin((x + wo) * 0.04) * 3 + Math.sin((x + wo * 0.7) * 0.07) * 2;
      x === 0 ? ctx.moveTo(x, waveY) : ctx.lineTo(x, waveY);
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fillStyle = liq.waveColor;
    ctx.fill();

    // Surface highlight
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += 4) {
      const waveY = state.liquidY + Math.sin((x + wo) * 0.04) * 3 + Math.sin((x + wo * 0.7) * 0.07) * 2 - 1;
      x === 0 ? ctx.moveTo(x, waveY) : ctx.lineTo(x, waveY);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Liquid label
    ctx.font = '600 12px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'right';
    ctx.fillText(`${liq.name}  ρ = ${liq.density} kg/L`, canvas.width - 16, state.liquidY + 22);
  }

  function drawBlock(block, label) {
    const s = blockSizePx(block.volume);
    const x = block.x - s / 2;
    const y = block.y - s / 2;

    const isActive = label === state.activeBlock;
    const frac = getSubmergedFraction(block);

    ctx.save();

    // Clip the block so we can draw submerged part differently
    ctx.beginPath();
    ctx.rect(x, y, s, s);
    ctx.clip();

    // Above-water portion
    const aboveH = Math.max(0, state.liquidY - y);
    const belowH = s - aboveH;

    if (aboveH > 0) {
      const aboveGrad = ctx.createLinearGradient(x, y, x + s, y + aboveH);
      aboveGrad.addColorStop(0, lighten(block.color, 40));
      aboveGrad.addColorStop(1, block.color);
      ctx.fillStyle = aboveGrad;
      ctx.fillRect(x, y, s, aboveH);
    }

    if (belowH > 0) {
      // Submerged portion — darker + tinted
      const belowGrad = ctx.createLinearGradient(x, state.liquidY, x + s, y + s);
      belowGrad.addColorStop(0, darken(block.color, 30));
      belowGrad.addColorStop(1, darken(block.color, 55));
      ctx.fillStyle = belowGrad;
      ctx.fillRect(x, state.liquidY, s, belowH);

      // Liquid tint overlay
      ctx.fillStyle = 'rgba(14, 165, 233, 0.18)';
      ctx.fillRect(x, state.liquidY, s, belowH);
    }

    ctx.restore();

    // Border / outline
    ctx.strokeStyle = isActive
      ? 'rgba(255,255,255,0.6)'
      : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = isActive ? 2.5 : 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);

    // Inner highlight edge
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 3, y + 3, s - 6, s - 6);

    // Label badge
    const badgeW = 34;
    const badgeH = 20;
    const bx = block.x - badgeW / 2;
    const by = y - badgeH - 6;

    ctx.fillStyle = isActive ? 'rgba(59,130,246,0.85)' : 'rgba(30,40,60,0.85)';
    roundRect(ctx, bx, by, badgeW, badgeH, 6);
    ctx.fill();
    ctx.strokeStyle = isActive ? 'rgba(147,197,253,0.5)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = `700 12px Inter, sans-serif`;
    ctx.fillStyle = block.labelColor;
    ctx.textAlign = 'center';
    ctx.fillText(label, block.x, by + 13.5);

    // Mass label below block
    if (state.showValues) {
      ctx.font = '500 11px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(`${block.mass} kg`, block.x, y + s + 14);
    }
  }

  function drawForceArrows(block) {
    const { Fg, Fk, Fnet } = computeForces(block);
    const ARROW_SCALE = 1.4;  // px per N
    const cx = block.x;
    const cy = block.y;

    if (state.showGravity && Fg > 0.01) {
      drawArrow(ctx, cx - 12, cy, cx - 12, cy + Fg * ARROW_SCALE,
        '#ef4444', state.showValues ? `${Fg.toFixed(1)} N` : '', 'Fg');
    }

    if (state.showBuoyancy && Fk > 0.01) {
      const s = blockSizePx(block.volume);
      const startY = block.y + s / 2;
      drawArrow(ctx, cx + 12, startY, cx + 12, startY - Fk * ARROW_SCALE,
        '#3b82f6', state.showValues ? `${Fk.toFixed(1)} N` : '', 'Fk');
    }

    if (state.showNet && Math.abs(Fnet) > 0.5) {
      const dir = Fnet > 0 ? 1 : -1;
      drawArrow(ctx, cx, cy, cx, cy + dir * Math.abs(Fnet) * ARROW_SCALE * 0.7,
        '#a855f7', state.showValues ? `${Math.abs(Fnet).toFixed(1)} N` : '', 'Fnet');
    }
  }

  function drawArrow(ctx, x1, y1, x2, y2, color, label, shortLabel) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return;

    const angle = Math.atan2(dy, dx);
    const headLen = Math.min(14, len * 0.35);
    const hx = x2 - headLen * Math.cos(angle - Math.PI / 7);
    const hy = y2 - headLen * Math.sin(angle - Math.PI / 7);
    const hx2 = x2 - headLen * Math.cos(angle + Math.PI / 7);
    const hy2 = y2 - headLen * Math.sin(angle + Math.PI / 7);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(hx, hy);
    ctx.lineTo(hx2, hy2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    if (label) {
      ctx.save();
      const midX = (x1 + x2) / 2 + (dy > 0 ? 28 : -28);
      const midY = (y1 + y2) / 2;

      // Value badge
      const pad = 4;
      ctx.font = `600 10px JetBrains Mono, monospace`;
      const tw = ctx.measureText(label).width;
      const bw = tw + pad * 2;
      const bh = 16;

      ctx.fillStyle = 'rgba(10,15,30,0.8)';
      roundRect(ctx, midX - bw / 2, midY - bh / 2, bw, bh, 4);
      ctx.fill();
      ctx.strokeStyle = color + '88';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(label, midX, midY + 3.5);
      ctx.restore();
    }
  }

  function drawDepthLines(block) {
    const s = blockSizePx(block.volume);
    const blockTop = block.y - s / 2;
    const blockBot = block.y + s / 2;

    if (blockTop >= state.liquidY || blockBot <= state.liquidY) return;

    // Dashed depth lines
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;

    // Horizontal line at liquid surface intersection
    ctx.beginPath();
    ctx.moveTo(block.x - s / 2 - 30, state.liquidY);
    ctx.lineTo(block.x + s / 2 + 30, state.liquidY);
    ctx.stroke();

    // Volume annotation: how much of the block is below the liquid surface
    const subDepth = blockBot - state.liquidY;
    const totalDepth = s;
    const subVol = block.volume * Math.min(1, Math.max(0, subDepth / totalDepth));

    if (state.showValues) {
      ctx.restore();
      ctx.font = '500 10px JetBrains Mono, monospace';
      ctx.fillStyle = 'rgba(96,165,250,0.8)';
      ctx.textAlign = 'left';
      ctx.fillText(`${subVol.toFixed(2)} L`, block.x + s / 2 + 6, state.liquidY + 12);
    } else {
      ctx.restore();
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.waveOffset += 0.8;

    drawBackground();
    drawLiquid();

    // Draw depth lines for active block
    const ab = state.blocks[state.activeBlock];
    drawDepthLines(ab);

    // Draw both blocks
    for (const [label, block] of Object.entries(state.blocks)) {
      drawBlock(block, label);
      if (label === state.activeBlock) drawForceArrows(block);
    }

    state.animFrame = requestAnimationFrame(loop);
  }

  let lastTime = 0;
  function loop(ts) {
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;

    for (const block of Object.values(state.blocks)) {
      physicsStep(block, dt);
    }

    render();
    updateUI();
  }

  /* =========================================
     UI UPDATES
  ========================================= */
  function updateUI() {
    const block = getBlock();
    const { Fg, Fk, Fnet, frac } = computeForces(block);

    // Panels
    weightValEl.textContent  = `${Fg.toFixed(2)} N`;
    buoyValEl.textContent    = `${Fk.toFixed(2)} N`;
    netValEl.textContent     = `${Math.abs(Fnet).toFixed(2)} N ${Fnet > 0.1 ? '↓' : Fnet < -0.1 ? '↑' : '≈'}`;

    weightBarEl.style.width  = `${Math.min(100, (Fg / MAX_FORCE_N) * 100)}%`;
    buoyBarEl.style.width    = `${Math.min(100, (Fk / MAX_FORCE_N) * 100)}%`;
    netBarEl.style.width     = `${Math.min(100, (Math.abs(Fnet) / MAX_FORCE_N) * 100)}%`;

    // Submersion
    const subVol = block.volume * frac;
    subPctEl.textContent  = `${(frac * 100).toFixed(0)}%`;
    subVolEl.textContent  = `${subVol.toFixed(2)} L`;

    // Status
    let statusText, statusClass, objStatus;
    if (frac === 0) {
      statusText = '🌫️ Havada'; statusClass = 'in-air'; objStatus = 'Havada';
    } else if (frac < 0.99 && Fnet > 1) {
      statusText = '⬇️ Batıyor'; statusClass = 'sinking'; objStatus = 'Batıyor';
    } else if (frac < 0.99 && Fnet < -1) {
      statusText = '⬆️ Yüzeye Çıkıyor'; statusClass = 'floating'; objStatus = 'Yüzüyor';
    } else if (frac >= 0.99 && Fnet > 1) {
      statusText = '⬇️ Dibe Batıyor'; statusClass = 'sinking'; objStatus = 'Dibe Batıyor';
    } else {
      statusText = '⚖️ Denge'; statusClass = 'equilibrium'; objStatus = 'Dengede';
    }

    statusBadge.textContent = statusText;
    statusBadge.className = `status-badge ${statusClass}`;
    objStatEl.textContent = objStatus;

    // Formula
    formulaFgEl.textContent = `= ${block.mass} × 9.8 = ${Fg.toFixed(1)} N`;
    formulaFkEl.textContent = `= ${LIQUIDS[state.liquid].density} × ${subVol.toFixed(2)} × 9.8 = ${Fk.toFixed(1)} N`;

    // Density
    const blockDensity = block.mass / block.volume;
    densDisp.textContent = `${blockDensity.toFixed(2)} kg/L`;

    // Compare with liquid
    const liqDens = LIQUIDS[state.liquid].density;
    if (blockDensity < liqDens * 0.98) {
      densDisp.style.color = '#22c55e';
    } else if (blockDensity > liqDens * 1.02) {
      densDisp.style.color = '#ef4444';
    } else {
      densDisp.style.color = '#f59e0b';
    }
  }

  /* =========================================
     INPUT EVENT HANDLERS
  ========================================= */

  // Block selector buttons
  document.querySelectorAll('.block-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeBlock = btn.dataset.block;
      document.querySelectorAll('.block-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      syncSliders();
    });
  });

  function syncSliders() {
    const block = getBlock();
    massSlider.value   = block.mass;
    volumeSlider.value = block.volume;
    massVal.textContent   = block.mass.toFixed(2);
    volVal.textContent    = block.volume.toFixed(2);
  }

  massSlider.addEventListener('input', () => {
    getBlock().mass = parseFloat(massSlider.value);
    massVal.textContent = parseFloat(massSlider.value).toFixed(2);
  });

  volumeSlider.addEventListener('input', () => {
    getBlock().volume = parseFloat(volumeSlider.value);
    volVal.textContent = parseFloat(volumeSlider.value).toFixed(2);
  });

  // Liquid buttons
  document.querySelectorAll('.liquid-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.liquid = btn.dataset.liquid;
      document.querySelectorAll('.liquid-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      liqDensDisp.textContent = `${LIQUIDS[state.liquid].density} kg/L`;
    });
  });

  // Toggle checkboxes
  document.getElementById('show-gravity').addEventListener('change', e => state.showGravity = e.target.checked);
  document.getElementById('show-buoyancy').addEventListener('change', e => state.showBuoyancy = e.target.checked);
  document.getElementById('show-net').addEventListener('change', e => state.showNet = e.target.checked);
  document.getElementById('show-values').addEventListener('change', e => state.showValues = e.target.checked);

  // Reset
  document.getElementById('reset-btn').addEventListener('click', () => {
    for (const [label, block] of Object.entries(state.blocks)) {
      block.vx = 0;
      block.vy = 0;
      block.x = label === 'A' ? canvas.width * 0.3 : canvas.width * 0.7;
      block.y = state.liquidY - blockSizePx(block.volume) / 2 - 10;
    }
    state.blocks.A.mass   = 5;  state.blocks.A.volume = 5;
    state.blocks.B.mass   = 10; state.blocks.B.volume = 8;
    massSlider.value = 5; volumeSlider.value = 5;
    massVal.textContent = '5.00'; volVal.textContent = '5.00';
    state.liquid = 'water';
    state.activeBlock = 'A';
    document.querySelectorAll('.liquid-btn').forEach(b => b.classList.toggle('active', b.dataset.liquid === 'water'));
    document.querySelectorAll('.block-btn').forEach(b => b.classList.toggle('active', b.dataset.block === 'A'));
    liqDensDisp.textContent = '1.00 kg/L';
  });

  // Info modal
  const modal = document.getElementById('info-modal');
  document.getElementById('info-btn').addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('close-modal').addEventListener('click', () => modal.classList.add('hidden'));
  document.getElementById('close-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
  document.querySelector('.modal-backdrop').addEventListener('click', () => modal.classList.add('hidden'));

  /* =========================================
     DRAG & DROP
  ========================================= */
  function getBlockUnder(px, py) {
    for (const [label, block] of Object.entries(state.blocks)) {
      const s = blockSizePx(block.volume);
      if (px >= block.x - s / 2 && px <= block.x + s / 2 &&
          py >= block.y - s / 2 && py <= block.y + s / 2) {
        return label;
      }
    }
    return null;
  }

  function startDrag(px, py) {
    const hitLabel = getBlockUnder(px, py);
    if (hitLabel) {
      state.activeBlock = hitLabel;
      document.querySelectorAll('.block-btn').forEach(b => b.classList.toggle('active', b.dataset.block === hitLabel));
      syncSliders();

      const block = state.blocks[hitLabel];
      block.dragging = true;
      block.vx = 0;
      block.vy = 0;
      state.dragOffX = block.x - px;
      state.dragOffY = block.y - py;
      canvas.style.cursor = 'grabbing';
    }
  }

  function moveDrag(px, py) {
    for (const block of Object.values(state.blocks)) {
      if (block.dragging) {
        block.x = px + state.dragOffX;
        block.y = py + state.dragOffY;
      }
    }
  }

  function endDrag() {
    for (const block of Object.values(state.blocks)) {
      block.dragging = false;
    }
    canvas.style.cursor = 'grab';
  }

  // Mouse
  canvas.addEventListener('mousedown', e => {
    const r = canvas.getBoundingClientRect();
    startDrag(e.clientX - r.left, e.clientY - r.top);
  });
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    moveDrag(e.clientX - r.left, e.clientY - r.top);
  });
  canvas.addEventListener('mouseup', endDrag);
  canvas.addEventListener('mouseleave', endDrag);

  // Touch
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.touches[0];
    const r = canvas.getBoundingClientRect();
    startDrag(t.clientX - r.left, t.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    const r = canvas.getBoundingClientRect();
    moveDrag(t.clientX - r.left, t.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('touchend', endDrag);

  /* =========================================
     UTILITY FUNCTIONS
  ========================================= */
  function lighten(hex, pct) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    const f = 1 + pct / 100;
    return `rgb(${Math.min(255, r*f)|0},${Math.min(255, g*f)|0},${Math.min(255, b*f)|0})`;
  }

  function darken(hex, pct) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    const f = 1 - pct / 100;
    return `rgb(${Math.max(0, r*f)|0},${Math.max(0, g*f)|0},${Math.max(0, b*f)|0})`;
  }

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

  /* =========================================
     ROTATING FACTS
  ========================================= */
  setInterval(() => {
    state.factIndex = (state.factIndex + 1) % FACTS.length;
    factTextEl.style.opacity = 0;
    setTimeout(() => {
      factTextEl.textContent = FACTS[state.factIndex];
      factTextEl.style.opacity = 1;
    }, 400);
  }, 8000);
  factTextEl.style.transition = 'opacity 0.4s ease';

  /* =========================================
     INIT
  ========================================= */
  function init() {
    resizeCanvas();
    syncSliders();
    liqDensDisp.textContent = `${LIQUIDS[state.liquid].density} kg/L`;
    lastTime = performance.now();
    loop(lastTime);
  }

  window.addEventListener('resize', () => {
    resizeCanvas();
  });

  init();
})();
