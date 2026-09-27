(() => {
  const canvas = document.getElementById('fieldCanvas');
  const ctx = canvas.getContext('2d');
  const els = {
    fx: document.getElementById('fx'),
    fy: document.getElementById('fy'),
    equationError: document.getElementById('equationError'),
    presetGrid: document.getElementById('presetGrid'),
    density: document.getElementById('density'),
    densityOut: document.getElementById('densityOut'),
    arrowScale: document.getElementById('arrowScale'),
    arrowScaleOut: document.getElementById('arrowScaleOut'),
    showArrows: document.getElementById('showArrows'),
    showParticles: document.getElementById('showParticles'),
    normalizeArrows: document.getElementById('normalizeArrows'),
    showGrid: document.getElementById('showGrid'),
    particleCount: document.getElementById('particleCount'),
    particleCountOut: document.getElementById('particleCountOut'),
    particleSpeed: document.getElementById('particleSpeed'),
    particleSpeedOut: document.getElementById('particleSpeedOut'),
    trailLength: document.getElementById('trailLength'),
    trailLengthOut: document.getElementById('trailLengthOut'),
    playPause: document.getElementById('playPause'),
    resetParticles: document.getElementById('resetParticles'),
    homeView: document.getElementById('homeView'),
    hoverCard: document.getElementById('hoverCard')
  };

  const PRESETS = [
    { name: 'Rotation', fx: '-y', fy: 'x' },
    { name: 'Sink', fx: '-x', fy: '-y' },
    { name: 'Source', fx: 'x', fy: 'y' },
    { name: 'Saddle', fx: 'x', fy: '-y' },
    { name: 'Wave', fx: 'sin(y)', fy: 'cos(x)' },
    { name: 'Shear', fx: 'y', fy: '0' }
  ];

  const state = {
    playing: true,
    view: { cx: 0, cy: 0, scale: 55 },
    pointer: { down: false, x: 0, y: 0 },
    particles: [],
    trails: null,
    lastFrame: performance.now(),
    hover: null,
    compiled: { fx: (x, y) => -y, fy: (x, y) => x },
    valid: true
  };

  function sanitizeExpression(expr) {
    const trimmed = expr.trim().toLowerCase();
    if (!trimmed) throw new Error('Expression is empty.');
    if (/[^0-9a-z_+\-*/^().,\s]/.test(trimmed)) throw new Error('Unsupported character in expression.');
    const allowedNames = new Set(['x','y','sin','cos','tan','asin','acos','atan','atan2','sqrt','abs','exp','log','ln','pow','min','max','floor','ceil','round','sign','pi','e']);
    const words = trimmed.match(/[a-z_][a-z0-9_]*/g) || [];
    for (const word of words) {
      if (!allowedNames.has(word)) throw new Error(`Unknown name: ${word}`);
    }
    return trimmed.replace(/\^/g, '**').replace(/\bln\b/g, 'log').replace(/\bpi\b/g, 'PI').replace(/\be\b/g, 'E');
  }

  function compileExpression(expr) {
    const safe = sanitizeExpression(expr);
    const fn = new Function('x', 'y', `const {sin,cos,tan,asin,acos,atan,atan2,sqrt,abs,exp,log,pow,min,max,floor,ceil,round,sign,PI,E}=Math; return (${safe});`);
    return (x, y) => {
      const value = Number(fn(x, y));
      return Number.isFinite(value) ? value : 0;
    };
  }

  function compileField() {
    try {
      state.compiled.fx = compileExpression(els.fx.value);
      state.compiled.fy = compileExpression(els.fy.value);
      els.equationError.textContent = '';
      state.valid = true;
      return true;
    } catch (error) {
      els.equationError.textContent = error.message || 'Could not parse equation.';
      state.valid = false;
      return false;
    }
  }

  function field(x, y) {
    if (!state.valid) return { x: 0, y: 0 };
    try {
      const vx = state.compiled.fx(x, y);
      const vy = state.compiled.fy(x, y);
      return {
        x: Number.isFinite(vx) ? vx : 0,
        y: Number.isFinite(vy) ? vy : 0
      };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function toScreen(x, y) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.width / 2 + (x - state.view.cx) * state.view.scale,
      y: rect.height / 2 - (y - state.view.cy) * state.view.scale
    };
  }

  function toWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: state.view.cx + (sx - rect.width / 2) / state.view.scale,
      y: state.view.cy - (sy - rect.height / 2) / state.view.scale
    };
  }

  function visibleBounds() {
    const rect = canvas.getBoundingClientRect();
    return {
      minX: state.view.cx - rect.width / 2 / state.view.scale,
      maxX: state.view.cx + rect.width / 2 / state.view.scale,
      minY: state.view.cy - rect.height / 2 / state.view.scale,
      maxY: state.view.cy + rect.height / 2 / state.view.scale
    };
  }

  function drawGrid(width, height) {
    if (!els.showGrid.checked) return;
    const bounds = visibleBounds();
    const targetPx = 70;
    const rawStep = targetPx / state.view.scale;
    const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / pow10;
    const step = (norm < 2 ? 1 : norm < 5 ? 2 : 5) * pow10;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.textBaseline = 'top';

    for (let x = Math.floor(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
      const p = toScreen(x, 0);
      ctx.strokeStyle = Math.abs(x) < step * .001 ? 'rgba(190,215,250,.34)' : 'rgba(160,184,220,.10)';
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, height); ctx.stroke();
      if (Math.abs(x) > step * .001) {
        ctx.fillStyle = 'rgba(190,210,235,.45)';
        ctx.fillText(Number(x.toPrecision(4)).toString(), p.x + 4, Math.max(3, toScreen(0, 0).y + 4));
      }
    }

    for (let y = Math.floor(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
      const p = toScreen(0, y);
      ctx.strokeStyle = Math.abs(y) < step * .001 ? 'rgba(190,215,250,.34)' : 'rgba(160,184,220,.10)';
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(width, p.y); ctx.stroke();
      if (Math.abs(y) > step * .001) {
        ctx.fillStyle = 'rgba(190,210,235,.45)';
        ctx.fillText(Number(y.toPrecision(4)).toString(), Math.max(3, toScreen(0, 0).x + 4), p.y + 3);
      }
    }
    ctx.restore();
  }

  function drawArrow(x, y, vx, vy, spacing) {
    const start = toScreen(x, y);
    const mag = Math.hypot(vx, vy);
    if (!Number.isFinite(mag) || mag < 1e-12) {
      ctx.fillStyle = 'rgba(131,182,255,.65)';
      ctx.beginPath(); ctx.arc(start.x, start.y, 1.5, 0, Math.PI * 2); ctx.fill();
      return;
    }

    let dx = vx, dy = vy;
    if (els.normalizeArrows.checked) {
      dx /= mag; dy /= mag;
    } else {
      const compress = 1 / (1 + mag * .22);
      dx *= compress; dy *= compress;
    }
    const lenPx = spacing * .34 * Number(els.arrowScale.value);
    const nx = dx / Math.max(Math.hypot(dx, dy), 1e-9);
    const ny = dy / Math.max(Math.hypot(dx, dy), 1e-9);
    const ex = start.x + nx * lenPx;
    const ey = start.y - ny * lenPx;

    const strength = Math.min(1, Math.log1p(mag) / 2.4);
    ctx.save();
    ctx.strokeStyle = `rgba(131,182,255,${0.35 + strength * .6})`;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1.35;
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(ex, ey); ctx.stroke();
    const angle = Math.atan2(ey - start.y, ex - start.x);
    const head = Math.max(4, Math.min(7, spacing * .11));
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - head * Math.cos(angle - .55), ey - head * Math.sin(angle - .55));
    ctx.lineTo(ex - head * Math.cos(angle + .55), ey - head * Math.sin(angle + .55));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawField(width, height) {
    if (!els.showArrows.checked || !state.valid) return;
    const density = Number(els.density.value);
    const spacing = Math.min(width, height) / density;
    const cols = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const sx = (i + .5) * spacing;
        const sy = (j + .5) * spacing;
        const p = toWorld(sx, sy);
        const v = field(p.x, p.y);
        drawArrow(p.x, p.y, v.x, v.y, spacing);
      }
    }
  }

  function randomParticle() {
    const b = visibleBounds();
    return {
      x: b.minX + Math.random() * (b.maxX - b.minX),
      y: b.minY + Math.random() * (b.maxY - b.minY),
      age: Math.random() * 5,
      life: 4 + Math.random() * 8
    };
  }

  function syncParticleCount() {
    const target = Number(els.particleCount.value);
    while (state.particles.length < target) state.particles.push(randomParticle());
    if (state.particles.length > target) state.particles.length = target;
  }

  function resetParticles() {
    state.particles = [];
    syncParticleCount();
    if (state.trails) {
      const rect = canvas.getBoundingClientRect();
      state.trails.width = Math.max(1, Math.round(rect.width));
      state.trails.height = Math.max(1, Math.round(rect.height));
      state.trails.getContext('2d').clearRect(0, 0, state.trails.width, state.trails.height);
    }
  }

  function ensureTrailCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!state.trails) state.trails = document.createElement('canvas');
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (state.trails.width !== w || state.trails.height !== h) {
      state.trails.width = w;
      state.trails.height = h;
    }
  }

  function updateParticles(dt) {
    if (!state.playing || !els.showParticles.checked || !state.valid) return;
    syncParticleCount();
    ensureTrailCanvas();
    const tctx = state.trails.getContext('2d');
    const persistence = Number(els.trailLength.value);
    tctx.fillStyle = `rgba(5,8,16,${1 - persistence})`;
    tctx.fillRect(0, 0, state.trails.width, state.trails.height);

    const speed = Number(els.particleSpeed.value);
    const bounds = visibleBounds();
    const worldWidth = bounds.maxX - bounds.minX;
    const maxStep = worldWidth * .06;

    for (let i = 0; i < state.particles.length; i++) {
      let p = state.particles[i];
      const before = toScreen(p.x, p.y);
      const v = field(p.x, p.y);
      const mag = Math.hypot(v.x, v.y);
      if (!Number.isFinite(mag) || mag < 1e-12) {
        p.age += dt;
      } else {
        const adaptive = Math.min(maxStep / mag, .08);
        const h = dt * speed * adaptive * 8;
        const mid = field(p.x + v.x * h * .5, p.y + v.y * h * .5);
        p.x += mid.x * h;
        p.y += mid.y * h;
        p.age += dt;
        const after = toScreen(p.x, p.y);
        const alpha = Math.min(.8, .18 + Math.log1p(mag) * .18);
        tctx.strokeStyle = `rgba(157,240,208,${alpha})`;
        tctx.lineWidth = 1.2;
        tctx.beginPath(); tctx.moveTo(before.x, before.y); tctx.lineTo(after.x, after.y); tctx.stroke();
      }
      if (p.age > p.life || p.x < bounds.minX || p.x > bounds.maxX || p.y < bounds.minY || p.y > bounds.maxY || !Number.isFinite(p.x + p.y)) {
        state.particles[i] = randomParticle();
      }
    }
  }

  function drawParticles() {
    if (!els.showParticles.checked) return;
    ensureTrailCanvas();
    ctx.drawImage(state.trails, 0, 0, canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);
    ctx.save();
    ctx.fillStyle = 'rgba(220,255,244,.85)';
    state.particles.forEach((p) => {
      const s = toScreen(p.x, p.y);
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }

  function render() {
    resizeCanvas();
    const rect = canvas.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#070c17'); bg.addColorStop(1, '#04070d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    drawGrid(width, height);
    drawField(width, height);
    drawParticles();
  }

  function updateHover(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const p = toWorld(clientX - rect.left, clientY - rect.top);
    const v = field(p.x, p.y);
    const mag = Math.hypot(v.x, v.y);
    els.hoverCard.innerHTML = `x = <strong>${p.x.toFixed(2)}</strong>, y = <strong>${p.y.toFixed(2)}</strong><br>F = (<strong>${v.x.toFixed(2)}</strong>, <strong>${v.y.toFixed(2)}</strong>)<br>|F| = <strong>${mag.toFixed(2)}</strong>`;
  }

  function homeView() {
    state.view.cx = 0;
    state.view.cy = 0;
    state.view.scale = 55;
    resetParticles();
  }

  function renderPresets() {
    PRESETS.forEach((preset) => {
      const button = document.createElement('button');
      button.textContent = preset.name;
      button.addEventListener('click', () => {
        els.fx.value = preset.fx;
        els.fy.value = preset.fy;
        compileField();
        resetParticles();
      });
      els.presetGrid.appendChild(button);
    });
  }

  function animate(now) {
    const dt = Math.min(.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    updateParticles(dt);
    render();
    requestAnimationFrame(animate);
  }

  let compileTimer;
  [els.fx, els.fy].forEach((input) => input.addEventListener('input', () => {
    clearTimeout(compileTimer);
    compileTimer = setTimeout(() => { if (compileField()) resetParticles(); }, 180);
  }));

  els.density.addEventListener('input', () => { els.densityOut.textContent = els.density.value; });
  els.arrowScale.addEventListener('input', () => { els.arrowScaleOut.textContent = `${Number(els.arrowScale.value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`; });
  els.particleCount.addEventListener('input', () => { els.particleCountOut.textContent = els.particleCount.value; syncParticleCount(); });
  els.particleSpeed.addEventListener('input', () => { els.particleSpeedOut.textContent = `${Number(els.particleSpeed.value).toFixed(1)}×`; });
  els.trailLength.addEventListener('input', () => { els.trailLengthOut.textContent = `${Math.round(Number(els.trailLength.value) * 100)}%`; });
  els.showParticles.addEventListener('change', resetParticles);
  els.playPause.addEventListener('click', () => {
    state.playing = !state.playing;
    els.playPause.textContent = state.playing ? 'Pause' : 'Play';
  });
  els.resetParticles.addEventListener('click', resetParticles);
  els.homeView.addEventListener('click', homeView);

  canvas.addEventListener('pointerdown', (e) => {
    state.pointer.down = true;
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    updateHover(e.clientX, e.clientY);
    if (!state.pointer.down) return;
    const dx = e.clientX - state.pointer.x;
    const dy = e.clientY - state.pointer.y;
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    state.view.cx -= dx / state.view.scale;
    state.view.cy += dy / state.view.scale;
    resetParticles();
  });
  canvas.addEventListener('pointerup', () => { state.pointer.down = false; });
  canvas.addEventListener('pointercancel', () => { state.pointer.down = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const before = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    state.view.scale = Math.max(12, Math.min(260, state.view.scale * Math.exp(-e.deltaY * .0012)));
    const after = toWorld(e.clientX - rect.left, e.clientY - rect.top);
    state.view.cx += before.x - after.x;
    state.view.cy += before.y - after.y;
    resetParticles();
  }, { passive: false });

  window.addEventListener('resize', resetParticles);

  renderPresets();
  compileField();
  resetParticles();
  requestAnimationFrame((t) => { state.lastFrame = t; animate(t); });
})();
