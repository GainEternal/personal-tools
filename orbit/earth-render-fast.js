(() => {
  const DAY_URL = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg';
  const NIGHT_URL = 'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg';

  const VERTEX = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAGMENT = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_day;
    uniform sampler2D u_night;
    uniform float u_hasDay;
    uniform float u_hasNight;
    uniform float u_yaw;
    uniform float u_pitch;
    uniform float u_rotation;

    const float PI = 3.141592653589793;

    vec3 inverseCamera(vec3 cam) {
      float cy = cos(u_yaw), sy = sin(u_yaw);
      float cp = cos(u_pitch), sp = sin(u_pitch);
      float y1 = cp * cam.y + sp * cam.z;
      float z = -sp * cam.y + cp * cam.z;
      return vec3(
        cy * cam.x + sy * y1,
        -sy * cam.x + cy * y1,
        z
      );
    }

    void main() {
      vec2 p = v_uv * 2.0 - 1.0;
      float rr = dot(p, p);

      // A cheap atmospheric shell outside the surface.
      if (rr > 1.0) {
        float radial = sqrt(rr);
        if (radial > 1.085) discard;
        float edge = 1.0 - smoothstep(1.0, 1.085, radial);
        float alpha = edge * edge * 0.34;
        gl_FragColor = vec4(0.22, 0.60, 1.0, alpha);
        return;
      }

      float z = sqrt(max(0.0, 1.0 - rr));
      vec3 normalCam = normalize(vec3(p.x, p.y, z));
      vec3 world = inverseCamera(normalCam);

      float cr = cos(u_rotation), sr = sin(u_rotation);
      vec3 body = vec3(
        cr * world.x + sr * world.y,
        -sr * world.x + cr * world.y,
        world.z
      );

      float lon = atan(body.y, body.x);
      float lat = asin(clamp(body.z, -1.0, 1.0));
      vec2 texUv = vec2(fract(lon / (2.0 * PI) + 0.5), 0.5 - lat / PI);

      vec3 fallback = mix(vec3(0.025, 0.16, 0.34), vec3(0.05, 0.42, 0.72), z);
      vec3 day = u_hasDay > 0.5 ? texture2D(u_day, texUv).rgb : fallback;
      vec3 night = u_hasNight > 0.5 ? texture2D(u_night, texUv).rgb : day * 0.045;

      // Fixed sun direction in camera space gives a stable, readable terminator.
      vec3 sunDir = normalize(vec3(-0.55, 0.33, 0.77));
      float ndl = dot(normalCam, sunDir);
      float daylight = smoothstep(-0.12, 0.16, ndl);
      float diffuse = 0.20 + 0.80 * max(ndl, 0.0);

      // Work approximately in linear space so the terminator is less muddy.
      vec3 dayLinear = pow(max(day, vec3(0.0)), vec3(2.0));
      vec3 litDay = pow(max(dayLinear * diffuse, vec3(0.0)), vec3(0.5));
      vec3 litNight = night * 0.62;
      vec3 color = mix(litNight, litDay, daylight);

      // Detect blue ocean pixels and add a restrained sun glint.
      float ocean = smoothstep(0.02, 0.20, day.b - max(day.r, day.g) * 0.78);
      vec3 halfVector = normalize(sunDir + vec3(0.0, 0.0, 1.0));
      float specular = pow(max(dot(normalCam, halfVector), 0.0), 48.0) * ocean * daylight;
      color += vec3(0.42, 0.62, 0.76) * specular * 0.42;

      // Atmospheric blue at the limb without the old uniform neon outline.
      float limb = pow(1.0 - z, 2.7);
      color += vec3(0.08, 0.34, 0.68) * limb * (0.22 + 0.34 * daylight);

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Unknown shader error';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function makeProgram(gl) {
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'Unknown program link error';
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function loadTexture(gl, url, texture, onReady) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      onReady();
    };
    image.onerror = () => {};
    image.src = url;
  }

  function fallbackRenderer() {
    return function drawFallback(ctx, { x, y, radius }) {
      if (!Number.isFinite(radius) || radius <= 0) return;
      const ocean = ctx.createRadialGradient(
        x - radius * 0.34, y - radius * 0.38, radius * 0.06,
        x, y, radius
      );
      ocean.addColorStop(0, '#8bd9ff');
      ocean.addColorStop(0.28, '#2389c8');
      ocean.addColorStop(0.72, '#074d8a');
      ocean.addColorStop(1, '#03203d');
      ctx.save();
      ctx.shadowColor = 'rgba(80,175,255,.55)';
      ctx.shadowBlur = Math.max(8, radius * .12);
      ctx.fillStyle = ocean;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
  }

  window.createEarthGlobeRenderer = function createEarthGlobeRenderer() {
    const globeCanvas = document.createElement('canvas');
    let gl;
    try {
      gl = globeCanvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'low-power'
      });
    } catch (_) {}

    if (!gl) return fallbackRenderer();

    let program;
    try {
      program = makeProgram(gl);
    } catch (error) {
      console.warn('Earth WebGL renderer unavailable:', error);
      return fallbackRenderer();
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1
    ]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      yaw: gl.getUniformLocation(program, 'u_yaw'),
      pitch: gl.getUniformLocation(program, 'u_pitch'),
      rotation: gl.getUniformLocation(program, 'u_rotation'),
      hasDay: gl.getUniformLocation(program, 'u_hasDay'),
      hasNight: gl.getUniformLocation(program, 'u_hasNight'),
      day: gl.getUniformLocation(program, 'u_day'),
      night: gl.getUniformLocation(program, 'u_night')
    };

    const dayTexture = gl.createTexture();
    const nightTexture = gl.createTexture();
    let dayReady = false;
    let nightReady = false;

    // Initialize 1x1 placeholders so drawing is valid immediately.
    [dayTexture, nightTexture].forEach((texture, index) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const pixel = index === 0 ? new Uint8Array([18, 91, 150]) : new Uint8Array([2, 5, 12]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, pixel);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    });

    loadTexture(gl, DAY_URL, dayTexture, () => { dayReady = true; });
    loadTexture(gl, NIGHT_URL, nightTexture, () => { nightReady = true; });

    let renderSize = 0;
    function ensureSize(radius) {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      // Enough detail for typical on-screen Earth size, capped to keep GPU/copy cost tiny.
      const desired = Math.max(192, Math.min(512, Math.ceil(radius * 2.18 * dpr / 64) * 64));
      if (desired === renderSize) return;
      renderSize = desired;
      globeCanvas.width = desired;
      globeCanvas.height = desired;
      gl.viewport(0, 0, desired, desired);
    }

    return function drawEarthGlobe(ctx, { x, y, radius, yaw, pitch, rotation }) {
      if (!Number.isFinite(radius) || radius <= 0) return;
      ensureSize(radius);

      gl.useProgram(program);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform1f(uniforms.yaw, yaw || 0);
      gl.uniform1f(uniforms.pitch, pitch || 0);
      gl.uniform1f(uniforms.rotation, rotation || 0);
      gl.uniform1f(uniforms.hasDay, dayReady ? 1 : 0);
      gl.uniform1f(uniforms.hasNight, nightReady ? 1 : 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dayTexture);
      gl.uniform1i(uniforms.day, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, nightTexture);
      gl.uniform1i(uniforms.night, 1);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Draw slightly larger than the physical radius to preserve the shader atmosphere shell.
      const outer = radius * 1.085;
      ctx.drawImage(globeCanvas, x - outer, y - outer, outer * 2, outer * 2);
    };
  };
})();