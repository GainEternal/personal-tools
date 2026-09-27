(() => {
  const canvas = document.getElementById('orbitCanvas');
  const ctx = canvas.getContext('2d');

  const els = {
    mode: document.getElementById('mode'),
    orbitObject: document.getElementById('orbitObject'),
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

  const EARTH_RADIUS = 6371;
  const HIGH_ORBIT_ALTITUDE = EARTH_RADIUS * 0.2;
  const HIGH_ORBIT_SPEED = Math.sqrt(398600.4418 / (EARTH_RADIUS + HIGH_ORBIT_ALTITUDE));

  const BODIES = {
    earth: {
      radius: EARTH_RADIUS,
      mu: 398600.4418,
      atmosphere: 100,
      defaultAltitude: HIGH_ORBIT_ALTITUDE,
      defaultSpeed: HIGH_ORBIT_SPEED,
      baseStep: 4,
      glowColor: 'rgba(86,176,255,.38)',
      scaleLabel: 'Altitude'
    },
    sun: {
      radius: 696340,
      mu: 132712440018,
      atmosphere: 0,
      defaultAltitude: 148901530,
      defaultSpeed: 29.78,
      baseStep: 9000,
      glowColor: 'rgba(255,197,92,.34)',
      scaleLabel: 'Distance from surface'
    }
  };

  const PRESETS = {
    earth: [
      { name: 'High circular', altitude: HIGH_ORBIT_ALTITUDE, speed: HIGH_ORBIT_SPEED, direction: 0, inclination: 0 },
      { name: 'Low circular', altitude: 400, speed: 7.67, direction: 0, inclination: 0 },
      { name: 'High ellipse', altitude: 400, speed: 9.2, direction: 0, inclination: 0 },
      { name: 'Reentry', altitude: 200, speed: 7.2, direction: -8, inclination: 0 },
      { name: 'Escape', altitude: 400, speed: 11.2, direction: 0, inclination: 0 }
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
    pos: { x: EARTH_RADIUS + HIGH_ORBIT_ALTITUDE, y: 0, z: 0 },
    vel: { x: 0, y: HIGH_ORBIT_SPEED, z: 0 },
    elapsed: 0,
    playing: true,
    trail: [],
    prediction: [],
    status: 'Circular',
    crashed: false,
    explosion: null,
    lastFrame: performance.now(),
    lastRocketAngle: -Math.PI / 2,
    camera: { yaw: -0.55, pitch: 0.5, zoom: 1 },
    pointer: { down: false, x: 0, y: 0 }
  };

  const vec = {
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
    mag: (a) => Math.hypot(a.x, a.y, a.z),
    unit: (a) => {
      const m = Math.hypot(a.x, a.y, a.z);
      return m > 1e-12 ? { x: a.x / m, y: a.y / m, z: a.z / m } : { x: 1, y: 0, z: 0 };
    }
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
    state.explosion = null;
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
    const orbitalPeriodGuess = 2 * Math.PI * Math.sqrt(
      Math.pow(Math.max(vec.mag(pos), b.radius + 1), 3) /
      Math.max(1, b.mu * Math.max(gravityMultiplier(), .001))
    );
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
    return 'Elliptical';
  }

  function updateStatus() {
    state.status = classifyOrbit();
  }

  function formatDistance(km) {
    if (Math.abs(km) >= 1e8) return `${(km / 1e6).toFixed(1)} million km`;
    if (Math.abs(km) >= 1e6) return `${(km / 1e6).toFixed(2)} million km`;
    if (Math.abs(km) >= 10000) return `${Math.round(km).toLocaleString()} km`;
    return `${Math.round(km).toLocaleString()} km`;
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
        els.altitude.value = Number(preset.altitude.toFixed(2));
        els.initialSpeed.value = Number(preset.speed.toFixed(3));
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
      els.altitude.value = Number(b.defaultAltitude.toFixed(2));
      els.initialSpeed.value = Number(b.defaultSpeed.toFixed(3));
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
    return {
      x: x1,
      y: cp * y1 - sp * p.z,
      z: sp * y1 + cp * p.z
    };
  }

  function visibleExtent() {
    const current = Math.max(vec.mag(state.pos), body().radius * 1.2);
    let predictedMax = current;
    state.prediction.slice(0, 250).forEach((p) => { predictedMax = Math.max(predictedMax, vec.mag(p)); });
    return Math.max(body().radius * 1.25, Math.min(predictedMax, current * 3.2));
  }

  function worldScale(width, height) {
    return Math.min(width, height) * .40 / visibleExtent() * state.camera.zoom;
  }

  function project(p, width, height) {
    const r = rotatePoint(p);
    const scale = worldScale(width, height);
    return { x: width / 2 + r.x * scale, y: height / 2 - r.y * scale, depth: r.z, scale };
  }

  function drawStars(width, height) {
    ctx.save();
    for (let i = 0; i < 120; i++) {
      const x = (i * 97.31) % width;
      const y = (i * i * 19.17 + 37) % height;
      const alpha = .16 + ((i * 13) % 54) / 100;
      ctx.fillStyle = `rgba(230,238,255,${alpha})`;
      const size = i % 11 === 0 ? 1.6 : 1;
      ctx.fillRect(x, y, size, size);
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
    points.forEach((point, index) => {
      const p = project(point, width, height);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function drawArrow(from, vector, width, height, color, maxPixels = 78) {
    const start = project(from, width, height);
    const vmag = Math.max(vec.mag(vector), 1e-9);
    const unit = vec.scale(vector, 1 / vmag);
    const end = project(vec.add(from, vec.scale(unit, visibleExtent() * .16)), width, height);
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    const plen = Math.hypot(dx, dy) || 1;
    const factor = Math.min(1, maxPixels / plen);
    dx *= factor;
    dy *= factor;
    const ex = start.x + dx;
    const ey = start.y + dy;
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 10 * Math.cos(angle - .45), ey - 10 * Math.sin(angle - .45));
    ctx.lineTo(ex - 10 * Math.cos(angle + .45), ey - 10 * Math.sin(angle + .45));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function earthRadiusPx(width, height) {
    return body().radius * worldScale(width, height);
  }

  function clipCircle(x, y, radius, fn) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    fn();
    ctx.restore();
  }

  function drawEarth(width, height) {
    const origin = project({ x: 0, y: 0, z: 0 }, width, height);
    const radius = earthRadiusPx(width, height);

    ctx.save();
    ctx.shadowColor = 'rgba(72,166,255,.55)';
    ctx.shadowBlur = Math.max(10, radius * .13);
    const ocean = ctx.createRadialGradient(
      origin.x - radius * .34, origin.y - radius * .38, radius * .08,
      origin.x + radius * .06, origin.y + radius * .08, radius * 1.05
    );
    ocean.addColorStop(0, '#8ed7ff');
    ocean.addColorStop(.17, '#258bd0');
    ocean.addColorStop(.56, '#0b5798');
    ocean.addColorStop(.88, '#063663');
    ocean.addColorStop(1, '#021b35');
    ctx.fillStyle = ocean;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    clipCircle(origin.x, origin.y, radius, () => {
      const daylight = ctx.createRadialGradient(
        origin.x - radius * .42, origin.y - radius * .42, 0,
        origin.x - radius * .15, origin.y - radius * .12, radius * 1.35
      );
      daylight.addColorStop(0, 'rgba(255,255,230,.22)');
      daylight.addColorStop(.55, 'rgba(255,255,255,.02)');
      daylight.addColorStop(1, 'rgba(0,5,20,.40)');
      ctx.fillStyle = daylight;
      ctx.fillRect(origin.x - radius, origin.y - radius, radius * 2, radius * 2);

      ctx.fillStyle = '#66a84f';
      const land = (pts) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          const px = origin.x + x * radius;
          const py = origin.y + y * radius;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
      };
      land([[-.70,-.34],[-.56,-.55],[-.30,-.59],[-.12,-.42],[-.20,-.24],[-.38,-.18],[-.49,.02],[-.65,-.06],[-.76,-.20]]);
      land([[-.35,.06],[-.18,.13],[-.12,.32],[-.22,.57],[-.34,.76],[-.45,.55],[-.50,.30]]);
      land([[.03,-.43],[.27,-.48],[.43,-.33],[.34,-.17],[.17,-.08],[.27,.07],[.22,.37],[.08,.61],[-.06,.37],[-.08,.10],[-.19,-.02],[-.10,-.22]]);
      land([[.31,-.50],[.58,-.52],[.79,-.33],[.71,-.12],[.51,-.06],[.39,-.16],[.23,-.22]]);
      land([[.54,.35],[.73,.31],[.82,.46],[.69,.59],[.50,.53]]);
      land([[-.30,-.71],[-.14,-.83],[.00,-.72],[-.08,-.58],[-.24,-.58]]);

      ctx.fillStyle = 'rgba(211,188,99,.58)';
      land([[.02,-.06],[.30,-.09],[.38,.03],[.23,.16],[-.02,.10],[-.10,.02]]);
      land([[.45,-.18],[.65,-.18],[.61,-.06],[.45,-.04]]);

      ctx.fillStyle = 'rgba(235,248,255,.88)';
      ctx.beginPath();
      ctx.ellipse(origin.x, origin.y - radius * .78, radius * .52, radius * .17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(origin.x, origin.y + radius * .88, radius * .48, radius * .10, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(245,252,255,.45)';
      ctx.lineWidth = Math.max(1, radius * .018);
      ctx.lineCap = 'round';
      [[-.48,-.20,.38],[-.05,.27,.46],[.36,-.31,.32],[.46,.15,.27],[-.45,.48,.24]].forEach(([x,y,len]) => {
        ctx.beginPath();
        ctx.arc(origin.x + x * radius, origin.y + y * radius, len * radius, .12, 1.15);
        ctx.stroke();
      });
    });

    ctx.save();
    ctx.strokeStyle = 'rgba(143,211,255,.72)';
    ctx.lineWidth = Math.max(1.5, radius * .018);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radius + ctx.lineWidth * .5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawSun(width, height) {
    const origin = project({ x: 0, y: 0, z: 0 }, width, height);
    const radius = body().radius * worldScale(width, height);
    const g = ctx.createRadialGradient(origin.x - radius * .25, origin.y - radius * .3, radius * .04, origin.x, origin.y, radius);
    g.addColorStop(0, '#fffbd0');
    g.addColorStop(.28, '#ffd86f');
    g.addColorStop(.72, '#f39a2f');
    g.addColorStop(1, '#a64b18');
    ctx.save();
    ctx.shadowColor = body().glowColor;
    ctx.shadowBlur = Math.max(18, radius * .25);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBody(width, height) {
    if (state.bodyKey === 'earth') drawEarth(width, height);
    else drawSun(width, height);
  }

  function drawMarker(p) {
    ctx.save();
    ctx.shadowColor = 'rgba(157,240,208,.75)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#d9fff1';
    ctx.beginPath();
    ctx.arc(p.x, p.y, state.bodyKey === 'earth' ? 5 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRocket(width, height, p) {
    const speed = vec.mag(state.vel);
    if (speed > 1e-5) {
      const unit = vec.scale(state.vel, 1 / speed);
      const ahead = project(vec.add(state.pos, vec.scale(unit, visibleExtent() * .06)), width, height);
      const angle = Math.atan2(ahead.y - p.y, ahead.x - p.x);
      if (Number.isFinite(angle) && Math.hypot(ahead.x - p.x, ahead.y - p.y) > .2) state.lastRocketAngle = angle;
    }

    const angle = state.lastRocketAngle;
    const scale = state.bodyKey === 'earth' ? 1.05 : 1.15;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(120,195,255,.55)';
    ctx.shadowBlur = 9;

    if (state.playing && !state.crashed) {
      const flicker = 1 + .14 * Math.sin(state.elapsed * 4.7);
      const flame = ctx.createLinearGradient(-24, 0, -9, 0);
      flame.addColorStop(0, 'rgba(255,88,33,.15)');
      flame.addColorStop(.45, '#ff7d31');
      flame.addColorStop(1, '#ffe26b');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(-10, -3.2);
      ctx.lineTo(-24 * flicker, 0);
      ctx.lineTo(-10, 3.2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#dc3f46';
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.lineTo(-13, -10);
    ctx.lineTo(-12, -3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-8, 5);
    ctx.lineTo(-13, 10);
    ctx.lineTo(-12, 3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f1f5f8';
    ctx.strokeStyle = '#a7bbca';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.quadraticCurveTo(7, -5.2, -6, -5.2);
    ctx.lineTo(-10, -3.6);
    ctx.lineTo(-10, 3.6);
    ctx.lineTo(-6, 5.2);
    ctx.quadraticCurveTo(7, 5.2, 12, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e44b50';
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.quadraticCurveTo(9.2, -3.4, 6.8, -4.3);
    ctx.lineTo(6.8, 4.3);
    ctx.quadraticCurveTo(9.2, 3.4, 12, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#56b9e9';
    ctx.strokeStyle = '#d7f4ff';
    ctx.lineWidth = .9;
    ctx.beginPath();
    ctx.arc(1.8, 0, 2.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawObject(width, height) {
    if (state.crashed) return;
    const p = project(state.pos, width, height);
    if (els.orbitObject && els.orbitObject.value === 'rocket') drawRocket(width, height, p);
    else drawMarker(p);
  }

  function triggerImpact() {
    if (state.crashed) return;
    const b = body();
    const hitDirection = vec.unit(state.pos);
    const impactPos = vec.scale(hitDirection, b.radius);
    state.pos = impactPos;
    state.crashed = true;
    state.playing = false;
    state.status = 'Impact';
    els.playPause.textContent = 'Play';
    const particles = [];
    for (let i = 0; i < 30; i++) {
      const angle = (Math.PI * 2 * i / 30) + (Math.random() - .5) * .28;
      const speed = 30 + Math.random() * 85;
      particles.push({ angle, speed, size: 1.4 + Math.random() * 3.6, phase: Math.random() * 5 });
    }
    state.explosion = { pos: impactPos, age: 0, duration: 2.1, particles };
    updateTelemetry();
  }

  function drawExplosion(width, height) {
    const ex = state.explosion;
    if (!ex || ex.age >= ex.duration) return;
    const p = project(ex.pos, width, height);
    const t = ex.age / ex.duration;
    const fade = Math.max(0, 1 - t);
    const flashRadius = 12 + 56 * Math.sin(Math.min(1, t * 2.3) * Math.PI / 2) * fade;

    ctx.save();
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, flashRadius);
    glow.addColorStop(0, `rgba(255,255,220,${.95 * fade})`);
    glow.addColorStop(.28, `rgba(255,208,62,${.9 * fade})`);
    glow.addColorStop(.58, `rgba(255,91,25,${.72 * fade})`);
    glow.addColorStop(1, 'rgba(120,20,5,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, flashRadius, 0, Math.PI * 2);
    ctx.fill();

    ex.particles.forEach((particle, i) => {
      const travel = particle.speed * ex.age * (1 - .30 * t);
      const x = p.x + Math.cos(particle.angle) * travel;
      const y = p.y + Math.sin(particle.angle) * travel;
      const alpha = fade * (0.55 + 0.45 * Math.sin(particle.phase + i));
      ctx.fillStyle = i % 3 === 0 ? `rgba(255,224,96,${alpha})` : `rgba(255,105,35,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, particle.size * fade, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function render() {
    resizeCanvas();
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#050914');
    bg.addColorStop(1, '#020409');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    drawStars(width, height);
    cameraForPreset();

    if (els.showPrediction.checked && !state.crashed) drawPath(state.prediction, width, height, 'rgba(131,182,255,.48)', 1.5, [7, 7]);
    if (els.showTrail.checked) drawPath(state.trail, width, height, 'rgba(157,240,208,.72)', 2);
    drawBody(width, height);
    drawObject(width, height);
    if (!state.crashed && els.showVelocity.checked) drawArrow(state.pos, state.vel, width, height, '#9df0d0');
    if (!state.crashed && els.showGravity.checked) drawArrow(state.pos, acceleration(state.pos), width, height, '#ffae7c');
    drawExplosion(width, height);
  }

  function simulationStep(realDt) {
    if (state.explosion) state.explosion.age += realDt;
    if (!state.playing || state.crashed) return;

    const speedFactor = Number(els.simSpeed.value);
    const b = body();
    const simulated = realDt * speedFactor * b.baseStep * 10;
    const maxChunk = b.baseStep * 8;
    let remaining = simulated;

    while (remaining > 0) {
      const dt = Math.min(remaining, maxChunk);
      const previousPos = { ...state.pos };
      const next = rk4Step(state.pos, state.vel, dt);
      state.pos = next.pos;
      state.vel = next.vel;
      state.elapsed += dt;
      remaining -= dt;

      if (vec.mag(state.pos) <= b.radius) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 14; i++) {
          const mid = (lo + hi) / 2;
          const test = {
            x: previousPos.x + (state.pos.x - previousPos.x) * mid,
            y: previousPos.y + (state.pos.y - previousPos.y) * mid,
            z: previousPos.z + (state.pos.z - previousPos.z) * mid
          };
          if (vec.mag(test) > b.radius) lo = mid; else hi = mid;
        }
        state.pos = {
          x: previousPos.x + (state.pos.x - previousPos.x) * hi,
          y: previousPos.y + (state.pos.y - previousPos.y) * hi,
          z: previousPos.z + (state.pos.z - previousPos.z) * hi
        };
        triggerImpact();
        break;
      }
    }

    if (!state.crashed && (state.trail.length === 0 || state.elapsed % (b.baseStep * 18) < simulated)) {
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
  els.simSpeed.addEventListener('input', () => {
    els.simSpeedOut.textContent = `${Number(els.simSpeed.value).toFixed(2).replace(/\.00$/, '')}×`;
  });
  els.playPause.addEventListener('click', () => {
    if (state.crashed) {
      resetSimulation();
      return;
    }
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
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
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
  requestAnimationFrame((t) => {
    state.lastFrame = t;
    animate(t);
  });
})();
