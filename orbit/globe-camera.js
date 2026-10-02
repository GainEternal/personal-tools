(() => {
  const HOME_YAW = -Math.PI / 2;
  const HOME_PITCH = -Math.PI / 2;
  const MIN_GLOBE_PITCH = -Math.PI;
  const MAX_GLOBE_PITCH = 0;

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  function unit(v) {
    const z = v.z || 0;
    const m = Math.hypot(v.x, v.y, z);
    return m > 1e-12 ? {x:v.x/m, y:v.y/m, z:z/m} : {x:1,y:0,z:0};
  }

  function create({canvas, state, cameraPreset, getObjectPosition, homePreset='free', homeAliases=[]}) {
    function resetPose() {
      state.camera.yaw = HOME_YAW;
      state.camera.pitch = HOME_PITCH;
      state.camera.zoom = 1;
    }

    function home() {
      resetPose();
      if (cameraPreset) cameraPreset.value = homePreset;
    }

    function cameraForSubpoint(direction) {
      const u = unit(direction);
      const lon = Math.atan2(u.y, u.x);
      const lat = Math.asin(clamp(u.z, -1, 1));
      return {yaw:lon - Math.PI/2, pitch:lat - Math.PI/2};
    }

    function setFollowStartingAngle() {
      const p = getObjectPosition();
      const camera = cameraForSubpoint({x:-p.x,y:-p.y,z:-(p.z||0)});
      state.camera.yaw = camera.yaw;
      state.camera.pitch = camera.pitch;
    }

    function applyPreset() {
      const mode = cameraPreset ? cameraPreset.value : 'free';
      if (mode === 'top') {
        state.camera.yaw = HOME_YAW;
        state.camera.pitch = 0;
      } else if (mode === 'side') {
        state.camera.yaw = HOME_YAW;
        state.camera.pitch = HOME_PITCH;
      } else if (homeAliases.includes(mode)) {
        state.camera.yaw = HOME_YAW;
        state.camera.pitch = HOME_PITCH;
      } else if (mode === 'track') {
        const camera = cameraForSubpoint(getObjectPosition());
        state.camera.yaw = camera.yaw;
        state.camera.pitch = camera.pitch;
      }
    }

    function handlePresetChange() {
      const mode = cameraPreset ? cameraPreset.value : 'free';
      if (mode === 'follow') setFollowStartingAngle();
      else if (mode !== 'free') applyPreset();
    }

    function cameraCenter() {
      return cameraPreset && cameraPreset.value === 'follow'
        ? getObjectPosition()
        : {x:0,y:0,z:0};
    }

    function rotatePoint(p) {
      const cy=Math.cos(state.camera.yaw), sy=Math.sin(state.camera.yaw);
      const cp=Math.cos(state.camera.pitch), sp=Math.sin(state.camera.pitch);
      const z=p.z||0;
      const x1=cy*p.x-sy*p.y, y1=sy*p.x+cy*p.y;
      return {x:x1, y:cp*y1-sp*z, z:sp*y1+cp*z};
    }

    function bindInteractions() {
      canvas.addEventListener('pointerdown', e => {
        const keepFollow = cameraPreset && cameraPreset.value === 'follow';
        state.pointer.down = true;
        state.pointer.x = e.clientX;
        state.pointer.y = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        if (!keepFollow && cameraPreset) cameraPreset.value = 'free';
      });

      canvas.addEventListener('pointermove', e => {
        if (!state.pointer.down) return;
        const dx=e.clientX-state.pointer.x, dy=e.clientY-state.pointer.y;
        state.pointer.x=e.clientX;
        state.pointer.y=e.clientY;

        // Canonical globe interaction shared by sandbox and launch mission.
        // Horizontal longitude is unbounded. Vertical latitude stops at the poles.
        state.camera.yaw += dx * .008;
        state.camera.pitch = clamp(state.camera.pitch + dy * .008, MIN_GLOBE_PITCH, MAX_GLOBE_PITCH);
      });

      const endDrag = () => { state.pointer.down = false; };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);

      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        state.camera.zoom = clamp(state.camera.zoom * Math.exp(-e.deltaY * .0012), .35, 4);
      }, {passive:false});
    }

    return {
      home,
      resetPose,
      cameraForSubpoint,
      setFollowStartingAngle,
      applyPreset,
      handlePresetChange,
      cameraCenter,
      rotatePoint,
      bindInteractions
    };
  }

  window.OrbitGlobeCamera = {
    HOME_YAW,
    HOME_PITCH,
    MIN_GLOBE_PITCH,
    MAX_GLOBE_PITCH,
    create
  };
})();
