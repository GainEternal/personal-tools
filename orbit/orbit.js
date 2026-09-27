(() => {
  const canvas = document.getElementById('orbitCanvas');
  const ctx = canvas.getContext('2d');

  const els = {
    mode: document.getElementById('mode'),
    altitude: document.getElementById('altitude'),
    initialSpeed: document.getElementById('initialSpeed'),
    direction: document.getElementById('direction'),
    inclination: document.getElementById('inclination'),
    gravity: document.getElementById('gravity'),
    gravityOut: document.getElementById('gravityOut'),
    simSpeed: document.getElementById('simSpeed'),
    simSpeedOut: document.getElementById('simSpeedOut'),
    playPause: document.getElementById('playPause'),
    restart: document.getElementById('restart'),
    homeCamera: document.getElementById('homeCamera'),
    cameraPreset: document.getElementById('cameraPreset'),
    showPrediction: document.getElementById('showPrediction'),
    showTrail: document.getElementById('showTrail'),
    showVelocity: document.getElementById('showVelocity'),
    showGravity: document.getElementById('showGravity'),
    presetGrid: document.getElementById('presetGrid'),
    status: document.getElementById('status'),
    distanceLabel: document.getElementById('distanceLabel'),
    distanceValue: document.getElementById('distanceValue'),
    speedValue: document.getElementById('speedValue'),
    elapsedValue: document.getElementById('elapsedValue'),
    radiusInputLabel: document.getElementById('radiusInputLabel')
  };

  const BODIES = {
    earth: {
      radius: 6371,
      mu: 398600.4418,
      name: 'Earth',
      atmosphere: 100,
      defaultAltitude: 400,
      defaultSpeed: 7.67,
      baseStep: 4,
      bodyColor: '#4fa3ff',
      glowColor: 'rgba(79,163,255,.28)',
      scaleLabel: 'Altitude'
    },
    sun: {
      radius: 696340,
      mu: 132712440018,
      name: 'Sun',
      atmosphere: 0,
      defaultAltitude: 148901530,
      defaultSpeed: 29.78,
      baseStep: 9000,
      bodyColor: '#ffc55c',
      glowColor: 'rgba(255,197,92,.28)',
      scaleLabel: 'Distance from surface'
    }
  };

  const PRESETS = {
    earth: [
      { name: 'Low circular', altitude: 400, speed: 7.67, direction: 0, inclination: 0 },
      { name: 'High ellipse', altitude: 400, speed: 9.2, direction: 0, inclination: 0 },
      { name: 'Escape', altitude: 400, speed: 11.2, direction: 0, inclination: 0 },
      { name: 'Reentry', altitude: 200, speed: 7.2, direction: -8, inclination: 0 }
    ],
    sun: [
      { name: 'Earth-like', altitude: 148901530, speed: 29.78, direction: 0, inclination: 0 },
      { name: 'Inner ellipse', altitude: 148901530, speed: 34.0, direction: 0, inclination: 0 },
      { name: 'Outer ellipse', altitude: 148901530, speed: 24.0, direction: 0, inclination: 0 },
      { name: 'Solar escape', altitude: 148901530, speed: 42.3, direction: 0, inclination: 0 }
    ]
  };

  const state = {
    bodyKey: 'earth',
    pos: { x: 6771, y: 0, z: 0 },
    vel: { x: 0, y: 7.67, z: 0 },
    elapsed: 0,
    playing: true,
    trail: [],
    prediction: [],
    status: 'Circular',
    crashed: false,
    lastFrame: performance.now(),
    camera: { yaw: -0.55, pitch: 0.5, zoom: 1 },
    pointer: { down: false, x: 0, y: 0 },
    followOffset: { x: 0, y: 0, z: 0 }
  };

  const vec = {
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
    mag: (a) => Math.hypot(a.x, a.y, a.z)
  };

  function body() { return BODIES[state.bodyKey]; }
  function gravityMultiplier() { return Number(els.gravity.value); }

  function acceleration(pos) {
    const r = vec.mag(pos);
    const mu = body().mu * gravityMultiplier();
    if (!r || mu === 0) return { x: 0, y: 0, z: 0 };
    const factor = -mu / (r * r * r);
    return vec.scale(pos, factor);
  }

  function rk4Step(pos, vel, dt) {
    const a1 = acceleration(pos);
    const p2 = vec.add(pos, vec.scale(vel, dt / 2));
    const v2 = vec.add(vel, vec.scale(a1, dt / 2));
    const a2 = acceleration(p2);
    const p3 = vec.add(pos, vec.scale(v2, dt / 2));
    const v3 = vec.add(vel, vec.scale(a2, dt / 2));
    const a3 = acceleration(p3);
    const p4 = vec.add(pos, vec.scale(v3, dt));
    const v4 = vec.add(vel, vec.scale(a3, dt));
    const a4 = acceleration(p4);

    return {
      pos: {
        x: pos.x + (dt / 6) * (vel.x + 2 * v2.x + 2 * v3.x + v4.x),
        y: pos.y + (dt / 6) * (vel.y + 2 * v2.y + 2 * v3.y + v4.y),
        z: pos.z + (dt / 6) * (vel.z + 2 * v2.z + 2 * v3.z + v4.z)
      },
      vel: {
        x: vel.x + (dt / 6) * (a1.x + 2 * a2.x + 2 * a3.x + a4.x),
        y: vel.y + (dt / 6) * (a1.y + 2 * a2.y + 2 * a3.y + a4.y),
        z: vel.z + (dt / 6) * (a1.z + 2 * a2.z + 2 * a3.z + a4.z)
      }
    };
  }

  function initialStateFromControls() {
    const b = body();
    const altitude = Math.max(0, Number(els.altitude.value) || 0);
    const speed = Math.max(0, Number(els.initialSpeed.value) || 0);
    const direction = (Number(els.direction.value) || 0) * Math.PI / 180;
    const inclination = (Number(els.inclination.value) || 0) * Math.PI / 180;
    const r = b.radius + altitude;
    const radial = speed * Math.sin(direction);
    const tangent = speed * Math.cos(direction);
    return {
      pos: { x: r, y: 0, z: 0 },
      vel: {
        x: radial,
        y: tangent * Math.cos(inclination),
        z: tangent * Math.sin(inclination)
      }
    };
  }

  function resetSimulation() {
    const initial = initialStateFromControls();
    state.pos = initial.pos;
    state.vel = initial.vel;
    state.elapsed = 0;
    state.trail = [{ ...state.pos }];
    state.crashed = false;
    state.playing = true;
    els.playPause.textContent = 'Pause';
    updatePrediction();
    updateStatus();
    updateTelemetry();
  }

  function updatePrediction() {
    let pos = { ...state.pos };
    let vel = { ...state.vel };
    const b = body();
    const orbitalPeriodGuess = 2 * Math.PI * Math.sqrt(Math.pow(Math.max(vec.mag(pos), b.radius + 1), 3) / Math.max(1, b.mu * Math.max(gravityMultiplier(), .001)));
    const total = Math.min(orbitalPeriodGuess * 1.25, state.bodyKey === 'earth' ? 120000 : 50000000);
    const steps = 700;
    const dt = Math.max(b.baseStep, total / steps);
    const points = [];
    for (let i = 0; i < steps; i++) {
      if (vec.mag(pos) <= b.radius) break;
      if (i % 2 === 0) points.push({ ...pos });
      const next = rk4Step(pos, vel, dt);
      pos = next.pos;
      vel = next.vel;
      if (vec.mag(pos) > vec.mag(state.pos) * 12) break;
    }
    state.prediction = points;
  }

  function classifyOrbit() {
    const b = body();
    const r = vec.mag(state.pos);
    const v = vec.mag(state.vel);
    const altitude = r - b.radius;
    if (r <= b.radius) return 'Impact';
    if (state.bodyKey === 'earth' && altitude < b.atmosphere) return 'Reentering';
    const mu = b.mu * gravityMultiplier();
    if (mu <= 0) return 'Coasting';
    const energy = (v * v) / 2 - mu / r;
    const h = {
      x: state.pos.y * state.vel.z - state.pos.z * state.vel.y,
      y: state.pos.z * state.vel.x - state.pos.x * state.vel.z,
      z: state.pos.x * state.vel.y - state.pos.y * state.vel.x
    };
    const h2 = Math.pow(vec.mag(h), 2);
    const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h2) / (mu * mu)));
    if (energy >= 0) return 'Escaping';
    const periapsis = h2 / (mu * (1 + e));
    if (state.bodyKey === 'earth' && periapsis - b.radius < b.atmosphere) return 'Reentering';
    if (e < 0.03) return 'Circular';
    if (Math.abs(state.vel.x) > Math.abs(state.vel.y) * 2 && v < Math.sqrt(mu / r) * .65) return 'Falling';
    return 'Elliptical';
  }

  function updateStatus() {
    state.status = classifyOrbit();
    state.crashed = state.status === 'Impact';
  }

  function formatDistance(km) {
    if (Math.abs(km) >= 1e8) return `${(km / 1e6).toFixed(1)} million km`;
    if (Math.abs(km) >= 1e6) return `${(km / 1e6).toFixed(2)} million km`;
    if (Math.abs(km) >= 10000) return `${Math.round(km).toLocaleString()} km`;
    return `${Math.round(km)} km`;
  }

  function formatTime(seconds) {
    if (seconds < 120) return `${Math.round(seconds)} s`;
    if (seconds < 7200) return `${(seconds / 60).toFixed(1)} min`;
    if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} h`;
    return `${(seconds / 86400).toFixed(1)} d`;
  }

  function updateTelemetry() {
    const b = body();
    const altitude = vec.mag(state.pos) - b.radius;
    els.status.textContent = state.status;
    els.distanceLabel.textContent = b.scaleLabel;
    els.distanceValue.textContent = formatDistance(Math.max(0, altitude));
    els.speedValue.textContent = `${vec.mag(state.vel).toFixed(state.bodyKey === 'earth' ? 2 : 1)} km/s`;
    els.elapsedValue.textContent = formatTime(state.elapsed);
  }

  function renderPresets() {
    els.presetGrid.innerHTML = '';
    PRESETS[state.bodyKey].forEach((preset) => {
      const button = document.createElement('button');
      button.textContent = preset.name;
      button.addEventListener('click', () => {
        els.altitude.value = preset.altitude;
        els.initialSpeed.value = preset.speed;
        els.direction.value = preset.direction;
        els.inclination.value = preset.inclination;
        resetSimulation();
      });
      els.presetGrid.appendChild(button);
    });
  }

  function configureMode(key, useDefaults = true) {
    state.bodyKey = key;
    const b = body();
    els.radiusInputLabel.textContent = key === 'earth' ? 'Starting altitude (km)' : 'Starting distance from Sun surface (km)';
    els.altitude.step = key === 'earth' ? '10' : '1000000';
    els.initialSpeed.step = key === 'earth' ? '.01' : '.1';
    if (useDefaults) {
      els.altitude.value = b.defaultAltitude;
      els.initialSpeed.value = b.defaultSpeed;
      els.direction.value = 0;
      els.inclination.value = 0;
      els.gravity.value = 1;
      els.gravityOut.textContent = '1.00×';
    }
    renderPresets();
    homeCamera();
    resetSimulation();
  }

  function homeCamera() {
    state.camera.yaw = -0.55;
    state.camera.pitch = 0.5;
    state.camera.zoom = 1;
    els.cameraPreset.value = 'free';
  }

  function cameraForPreset() {
    const preset = els.cameraPreset.value;
    if (preset === 'top') {
      state.camera.yaw = 0;
      state.camera.pitch = Math.PI / 2 - .01;
    } else if (preset === 'side') {
      state.camera.yaw = 0;
      state.camera.pitch = .02;
    } else if (preset === 'follow') {
      const a = Math.atan2(state.pos.y, state.pos.x);
      state.camera.yaw = -a - .7;
      state.camera.pitch = .38;
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

  function rotatePoint(p) {
    const cy = Math.cos(state.camera.yaw), sy = Math.sin(state.camera.yaw);
    const cp = Math.cos(state.camera.pitch), sp = Math.sin(state.camera.pitch);
    const x1 = cy * p.x - sy * p.y;
    const y1 = sy * p.x + cy * p.y;
    const z1 = p.z;
    return {
      x: x1,
      y: cp * y1 - sp * z1,
      z: sp * y1 + cp * z1
    };
  }

  function visibleExtent() {
    const samples = [state.pos, ...state.prediction.slice(0, 220)];
    let max = body().radius * 1.35;
    samples.forEach((p) => { max = Math.max(max, vec.mag(p)); });
    return max;
  }

  function project(p, width, height) {
    const r = rotatePoint(p);
    const extent = visibleExtent();
    const scale = Math.min(width, height) * .40 / extent * state.camera.zoom;
    return { x: width / 2 + r.x * scale, y: height / 2 - r.y * scale, depth: r.z, scale };
  }

  function drawStars(width, height) {
    ctx.save();
    for (let i = 0; i < 90; i++) {
      const x = (i * 97.31) % width;
      const y = (i * i * 19.17 + 37) % height;
      const alpha = .18 + ((i * 13) % 50) / 100;
      ctx.fillStyle = `rgba(230,238,255,${alpha})`;
      ctx.fillRect(x, y, i % 9 === 0 ? 1.5 : 1, i % 9 === 0 ? 1.5 : 1);
    }
    ctx.restore();
  }

  function drawPath(points, width, height, style, lineWidth, dash = []) {
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let started = false;
    points.forEach((p) => {
      const q = project(p, width, height);
      if (!started) { ctx.moveTo(q.x, q.y); started = true; }
      else ctx.lineTo(q.x, q.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawArrow(from, vector, width, height, color, maxPixels = 78) {
    const start = project(from, width, height);
    const vmag = Math.max(vec.mag(vector), 1e-9);
    const unit = vec.scale(vector, 1 / vmag);
    const extent = visibleExtent();
    const worldLen = extent * .16;
    const end = project(vec.add(from, vec.scale(unit, worldLen)), width, height);
    let dx = end.x - start.x, dy = end.y - start.y;
    const plen = Math.hypot(dx, dy) || 1;
    const factor = Math.min(1, maxPixels / plen);
    dx *= factor; dy *= factor;
    const ex = start.x + dx, ey = start.y + dy;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(ex, ey); ctx.stroke();
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 10 * Math.cos(angle - .45), ey - 10 * Math.sin(angle - .45));
    ctx.lineTo(ex - 10 * Math.cos(angle + .45), ey - 10 * Math.sin(angle + .45));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawBody(width, height) {
    const b = body();
    const origin = project({ x: 0, y: 0, z: 0 }, width, height);
    const edge = project({ x: b.radius, y: 0, z: 0 }, width, height);
    const radiusPx = Math.max(state.bodyKey === 'earth' ? 28 : 34, Math.min(80, Math.hypot(edge.x - origin.x, edge.y - origin.y)));
    const g = ctx.createRadialGradient(origin.x - radiusPx * .32, origin.y - radiusPx * .35, radiusPx * .08, origin.x, origin.y, radiusPx * 1.2);
    if (state.bodyKey === 'earth') {
      g.addColorStop(0, '#d9f2ff'); g.addColorStop(.25, '#5fb8ff'); g.addColorStop(.7, '#1d5fb4'); g.addColorStop(1, '#09274f');
    } else {
      g.addColorStop(0, '#fffbd0'); g.addColorStop(.28, '#ffd36a'); g.addColorStop(.72, '#ef8e29'); g.addColorStop(1, '#8f4318');
    }
    ctx.save();
    ctx.shadowColor = b.glowColor;
    ctx.shadowBlur = radiusPx * .9;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(origin.x, origin.y, radiusPx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawObject(width, height) {
    const p = project(state.pos, width, height);
    ctx.save();
    ctx.shadowColor = 'rgba(157,240,208,.75)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#d9fff1';
    ctx.beginPath(); ctx.arc(p.x, p.y, state.bodyKey === 'earth' ? 5 : 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function render() {
    resizeCanvas();
    const rect = canvas.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#050914'); bg.addColorStop(1, '#03050a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    drawStars(width, height);
    cameraForPreset();

    if (els.showPrediction.checked) drawPath(state.prediction, width, height, 'rgba(131,182,255,.48)', 1.5, [7, 7]);
    if (els.showTrail.checked) drawPath(state.trail, width, height, 'rgba(157,240,208,.72)', 2);
    drawBody(width, height);
    drawObject(width, height);
    if (els.showVelocity.checked) drawArrow(state.pos, state.vel, width, height, '#9df0d0');
    if (els.showGravity.checked) drawArrow(state.pos, acceleration(state.pos), width, height, '#ffae7c');
  }

  function simulationStep(realDt) {
    if (!state.playing || state.crashed) return;
    const speedFactor = Number(els.simSpeed.value);
    const b = body();
    const simulated = realDt * speedFactor * b.baseStep * 10;
    const maxChunk = b.baseStep * 8;
    let remaining = simulated;
    while (remaining > 0) {
      const dt = Math.min(remaining, maxChunk);
      const next = rk4Step(state.pos, state.vel, dt);
      state.pos = next.pos;
      state.vel = next.vel;
      state.elapsed += dt;
      remaining -= dt;
      if (vec.mag(state.pos) <= b.radius) {
        state.crashed = true;
        state.playing = false;
        break;
      }
    }
    if (state.trail.length === 0 || state.elapsed % (b.baseStep * 18) < simulated) {
      state.trail.push({ ...state.pos });
      if (state.trail.length > 1200) state.trail.shift();
    }
    updateStatus();
    updateTelemetry();
  }

  function animate(now) {
    const dt = Math.min(.05, Math.max(0, (now - state.lastFrame) / 1000));
    state.lastFrame = now;
    simulationStep(dt);
    render();
    requestAnimationFrame(animate);
  }

  let predictionTimer;
  function scheduleReset() {
    clearTimeout(predictionTimer);
    predictionTimer = setTimeout(resetSimulation, 180);
  }

  els.mode.addEventListener('change', () => configureMode(els.mode.value));
  [els.altitude, els.initialSpeed, els.direction, els.inclination].forEach((input) => input.addEventListener('input', scheduleReset));
  els.gravity.addEventListener('input', () => {
    els.gravityOut.textContent = `${Number(els.gravity.value).toFixed(2)}×`;
    scheduleReset();
  });
  els.simSpeed.addEventListener('input', () => { els.simSpeedOut.textContent = `${Number(els.simSpeed.value).toFixed(2).replace(/\.00$/, '')}×`; });
  els.playPause.addEventListener('click', () => {
    state.playing = !state.playing;
    els.playPause.textContent = state.playing ? 'Pause' : 'Play';
  });
  els.restart.addEventListener('click', resetSimulation);
  els.homeCamera.addEventListener('click', homeCamera);

  canvas.addEventListener('pointerdown', (e) => {
    state.pointer.down = true;
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    els.cameraPreset.value = 'free';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.pointer.down) return;
    const dx = e.clientX - state.pointer.x;
    const dy = e.clientY - state.pointer.y;
    state.pointer.x = e.clientX; state.pointer.y = e.clientY;
    state.camera.yaw += dx * .008;
    state.camera.pitch = Math.max(-1.45, Math.min(1.45, state.camera.pitch - dy * .008));
  });
  canvas.addEventListener('pointerup', () => { state.pointer.down = false; });
  canvas.addEventListener('pointercancel', () => { state.pointer.down = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.camera.zoom = Math.max(.35, Math.min(4, state.camera.zoom * Math.exp(-e.deltaY * .0012)));
  }, { passive: false });

  window.addEventListener('resize', render);

  configureMode('earth');
  requestAnimationFrame((t) => { state.lastFrame = t; animate(t); });
})();
