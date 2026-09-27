(() => {
  const canvas = document.getElementById('orbitCanvas');
  const selector = document.getElementById('orbitObject');
  if (!canvas || !selector) return;

  const ctx = canvas.getContext('2d');
  const arc = ctx.arc.bind(ctx);
  const moveTo = ctx.moveTo.bind(ctx);
  const lineTo = ctx.lineTo.bind(ctx);
  const closePath = ctx.closePath.bind(ctx);

  let previous = null;
  let lastAngle = 0;

  function rotatePoint(x, y, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  function pointAt(cx, cy, x, y, angle) {
    const p = rotatePoint(x, y, angle);
    return { x: cx + p.x, y: cy + p.y };
  }

  function rocketAngle(x, y) {
    if (previous) {
      const dx = x - previous.x;
      const dy = y - previous.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.15 && distance < 80) {
        lastAngle = Math.atan2(dy, dx);
        return lastAngle;
      }
    }

    if (!previous) {
      const cx = canvas.clientWidth / 2;
      const cy = canvas.clientHeight / 2;
      lastAngle = Math.atan2(y - cy, x - cx) + Math.PI / 2;
    }
    return lastAngle;
  }

  function buildRocketPath(x, y, angle) {
    const points = [
      [13, 0],
      [5, -4.4],
      [-5, -4.4],
      [-10, -8],
      [-8, -2.7],
      [-12, 0],
      [-8, 2.7],
      [-10, 8],
      [-5, 4.4],
      [5, 4.4]
    ];

    const first = pointAt(x, y, points[0][0], points[0][1], angle);
    moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) {
      const p = pointAt(x, y, points[i][0], points[i][1], angle);
      lineTo(p.x, p.y);
    }
    closePath();
  }

  ctx.arc = function patchedArc(x, y, radius, startAngle, endAngle, anticlockwise) {
    const isOrbitMarker = radius <= 7.1 && Math.abs(endAngle - startAngle) > 6;
    if (selector.value !== 'rocket' || !isOrbitMarker) {
      return arc(x, y, radius, startAngle, endAngle, anticlockwise);
    }

    const angle = rocketAngle(x, y);
    buildRocketPath(x, y, angle);
    previous = { x, y };
  };

  selector.addEventListener('change', () => {
    previous = null;
  });
})();
