(() => {
  const DEG = Math.PI / 180;
  const LAND_POLYGONS = [
    [[-168,71],[-150,60],[-130,55],[-124,47],[-117,33],[-104,22],[-96,18],[-88,20],[-82,28],[-76,36],[-66,45],[-55,52],[-60,63],[-82,72],[-110,78],[-142,76]],
    [[-82,12],[-72,11],[-60,7],[-48,2],[-36,-9],[-39,-23],[-49,-35],[-56,-52],[-68,-55],[-74,-38],[-77,-20],[-81,-3]],
    [[-18,36],[4,37],[24,34],[39,25],[51,11],[43,-12],[34,-27],[18,-35],[4,-31],[-8,-18],[-16,4]],
    [[-11,36],[-5,50],[12,60],[32,70],[65,76],[105,72],[139,64],[170,52],[164,40],[145,31],[126,22],[111,8],[93,9],[80,21],[65,25],[52,34],[39,38],[27,35],[17,43],[6,42]],
    [[112,-11],[129,-10],[145,-14],[154,-26],[151,-39],[135,-44],[119,-38],[112,-26]],
    [[-73,60],[-55,59],[-34,65],[-19,77],[-29,84],[-51,83],[-64,75]],
    [[43,-13],[50,-17],[50,-26],[46,-25],[43,-18]],
    [[130,31],[143,34],[146,43],[139,45],[132,39]]
  ];

  const DESERTS = [
    [[-16,16],[4,28],[29,31],[36,20],[30,12],[4,10]],
    [[36,19],[56,30],[66,25],[55,16],[43,12]],
    [[112,-20],[139,-18],[143,-30],[124,-34],[114,-28]],
    [[67,35],[91,44],[106,39],[95,29],[74,29]]
  ];

  function wrapLon(lon) {
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return lon;
  }

  function pointInPolygon(lon, lat, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const crosses = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-9) + xi);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function isLand(lon, lat) {
    if (lat < -68) return true;
    return LAND_POLYGONS.some((poly) => pointInPolygon(lon, lat, poly));
  }

  function isDesert(lon, lat) {
    return DESERTS.some((poly) => pointInPolygon(lon, lat, poly));
  }

  function normalize(v) {
    const m = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / m, y: v.y / m, z: v.z / m };
  }

  function inverseCamera(cam, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const y1 = cp * cam.y + sp * cam.z;
    const z = -sp * cam.y + cp * cam.z;
    return {
      x: cy * cam.x + sy * y1,
      y: -sy * cam.x + cy * y1,
      z
    };
  }

  function mix(a, b, t) { return a + (b - a) * t; }
  function mixColor(a, b, t) {
    return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  }

  function clampByte(x) { return Math.max(0, Math.min(255, Math.round(x))); }

  window.createEarthGlobeRenderer = function createEarthGlobeRenderer() {
    const texture = document.createElement('canvas');
    const tctx = texture.getContext('2d', { alpha: true });
    const SIZE = 224;
    texture.width = SIZE;
    texture.height = SIZE;
    let cacheKey = '';

    function build(yaw, pitch, earthRotation) {
      const key = `${yaw.toFixed(3)}|${pitch.toFixed(3)}|${earthRotation.toFixed(3)}`;
      if (key === cacheKey) return;
      cacheKey = key;

      const image = tctx.createImageData(SIZE, SIZE);
      const data = image.data;
      const half = SIZE / 2;
      const light = normalize({ x: -0.48, y: 0.38, z: 0.79 });
      const cr = Math.cos(earthRotation), sr = Math.sin(earthRotation);

      for (let py = 0; py < SIZE; py++) {
        const sy = ((py + .5) - half) / half;
        for (let px = 0; px < SIZE; px++) {
          const sx = ((px + .5) - half) / half;
          const rr = sx * sx + sy * sy;
          const idx = (py * SIZE + px) * 4;
          if (rr > 1) {
            data[idx + 3] = 0;
            continue;
          }

          const cam = { x: sx, y: -sy, z: Math.sqrt(Math.max(0, 1 - rr)) };
          const world = inverseCamera(cam, yaw, pitch);
          const bx = cr * world.x + sr * world.y;
          const by = -sr * world.x + cr * world.y;
          const bz = world.z;
          const lon = wrapLon(Math.atan2(by, bx) / DEG);
          const lat = Math.asin(Math.max(-1, Math.min(1, bz))) / DEG;

          const land = isLand(lon, lat);
          const desert = land && isDesert(lon, lat);
          const polar = Math.abs(lat) > 70;

          let base;
          if (polar) base = [226, 240, 244];
          else if (desert) base = [177, 154, 86];
          else if (land) {
            const lush = .5 + .5 * Math.sin((lon * .10 + lat * .17) * DEG * 10);
            base = mixColor([52, 103, 49], [92, 133, 62], lush * .55);
          } else {
            const deep = .45 + .55 * Math.max(0, -lat / 90);
            base = mixColor([10, 70, 122], [13, 92, 154], deep);
          }

          const diffuse = Math.max(0, cam.x * light.x + cam.y * light.y + cam.z * light.z);
          const ambient = .27;
          let illumination = ambient + .80 * diffuse;
          const limb = Math.pow(Math.max(0, cam.z), .38);
          illumination *= .78 + .22 * limb;

          if (!land && !polar) {
            const spec = Math.pow(Math.max(0, diffuse), 18) * Math.pow(cam.z, 3);
            base = mixColor(base, [175, 222, 241], spec * .55);
          }

          const cloudNoise =
            Math.sin((lon * .16 + lat * .09 + earthRotation / DEG * .22) * DEG * 8) +
            .65 * Math.sin((lon * .07 - lat * .21) * DEG * 11) +
            .35 * Math.sin((lon + lat * 1.7) * DEG * 17);
          const tropicalBand = Math.exp(-Math.pow(lat / 34, 2));
          const cloud = cloudNoise > 1.05 ? Math.min(.58, (cloudNoise - 1.05) * .48 + tropicalBand * .08) : 0;
          if (cloud > 0) base = mixColor(base, [236, 245, 248], cloud);

          const night = diffuse <= 0 ? Math.min(.22, -diffuse * .12) : 0;
          const city = land && !polar && diffuse < .06 &&
            (Math.sin(lon * 2.7 * DEG + lat * 4.1 * DEG) * Math.sin(lon * 5.3 * DEG - lat * 1.9 * DEG) > .72);

          data[idx] = clampByte(base[0] * illumination + (city ? 46 : 0));
          data[idx + 1] = clampByte(base[1] * illumination + (city ? 34 : 0));
          data[idx + 2] = clampByte(base[2] * illumination + (city ? 10 : 0));
          const edgeAlpha = rr > .965 ? Math.max(0, (1 - rr) / .035) : 1;
          data[idx + 3] = clampByte(255 * edgeAlpha * (1 - night * .1));
        }
      }
      tctx.putImageData(image, 0, 0);
    }

    return function drawEarthGlobe(ctx, options) {
      const { x, y, radius, yaw, pitch, rotation } = options;
      if (!Number.isFinite(radius) || radius <= 0) return;
      build(yaw, pitch, rotation);

      ctx.save();
      ctx.shadowColor = 'rgba(74, 169, 255, .72)';
      ctx.shadowBlur = Math.max(12, radius * .16);
      ctx.drawImage(texture, x - radius, y - radius, radius * 2, radius * 2);
      ctx.restore();

      const atmosphere = ctx.createRadialGradient(x, y, radius * .91, x, y, radius * 1.09);
      atmosphere.addColorStop(0, 'rgba(83,177,255,0)');
      atmosphere.addColorStop(.66, 'rgba(87,185,255,.05)');
      atmosphere.addColorStop(.82, 'rgba(95,194,255,.30)');
      atmosphere.addColorStop(1, 'rgba(95,194,255,0)');
      ctx.fillStyle = atmosphere;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.09, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(151, 216, 255, .55)';
      ctx.lineWidth = Math.max(1.2, radius * .009);
      ctx.beginPath();
      ctx.arc(x, y, radius + ctx.lineWidth * .3, 0, Math.PI * 2);
      ctx.stroke();
    };
  };
})();
