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

    function orientationBasis(forwardWorld, upReferenceWorld) {
      const forward=unit(forwardWorld);
      const ref=unit(upReferenceWorld);

      const dot=(a,b)=>a.x*b.x+a.y*b.y+(a.z||0)*(b.z||0);
      const mag=a=>Math.hypot(a.x,a.y,a.z||0);
      const scale=(a,s)=>({x:a.x*s,y:a.y*s,z:(a.z||0)*s});
      const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:(a.z||0)-(b.z||0)});
      const cross=(a,b)=>({
        x:a.y*(b.z||0)-(a.z||0)*b.y,
        y:(a.z||0)*b.x-a.x*(b.z||0),
        z:a.x*b.y-a.y*b.x
      });

      // Use the local radial direction as the rocket's roll reference.  When
      // thrust is nearly radial (launch/landing), fall back to geographic north
      // so the basis remains well-defined and stable.
      let upRaw=sub(ref,scale(forward,dot(ref,forward)));
      if(mag(upRaw)<0.08){
        const north={x:0,y:0,z:1};
        upRaw=sub(north,scale(forward,dot(north,forward)));
      }
      if(mag(upRaw)<0.08){
        const fallback={x:0,y:1,z:0};
        upRaw=sub(fallback,scale(forward,dot(fallback,forward)));
      }

      const up=unit(upRaw);
      const side=unit(cross(up,forward));
      const fCam=rotatePoint(forward);
      const sCam=rotatePoint(side);
      const uCam=rotatePoint(up);

      // Column-major mat3: local +X=forward, +Y=side, +Z=up.
      return new Float32Array([
        fCam.x,fCam.y,fCam.z,
        sCam.x,sCam.y,sCam.z,
        uCam.x,uCam.y,uCam.z
      ]);
    }

    function isOccludedBySphere(point, sphereCenter, radius) {
      const relative={
        x:point.x-sphereCenter.x,
        y:point.y-sphereCenter.y,
        z:(point.z||0)-(sphereCenter.z||0)
      };
      const q=rotatePoint(relative);
      const rho2=q.x*q.x+q.y*q.y;
      const r2=radius*radius;

      // Outside the projected globe: there is no Earth surface on this view ray.
      if(rho2>=r2)return false;

      // Positive camera-space z is the hemisphere facing the viewer. If the
      // object lies behind the front surface on this ray, the globe blocks it.
      const frontSurfaceZ=Math.sqrt(Math.max(0,r2-rho2));
      return q.z<frontSurfaceZ;
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
      orientationBasis,
      isOccludedBySphere,
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
