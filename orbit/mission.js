(() => {
  const canvas = document.getElementById('orbitCanvas');
  const ctx = canvas.getContext('2d');
  const earthGlobe = window.createEarthGlobeRenderer ? window.createEarthGlobeRenderer() : null;
  const rocket3D = window.createRocketRenderer3D ? window.createRocketRenderer3D() : null;
  const $ = id => document.getElementById(id);

  const els = {
    playPause:$('playPause'), restart:$('restart'), homeCamera:$('homeCamera'),
    targetAltitude:$('targetAltitude'), orbitCount:$('orbitCount'), cameraPreset:$('cameraPreset'),
    simSpeed:$('simSpeed'), simSpeedOut:$('simSpeedOut'), showTrail:$('showTrail'),
    showVelocity:$('showVelocity'), showGravity:$('showGravity'), showThrust:$('showThrust'),
    status:$('status'), altitudeValue:$('altitudeValue'), speedValue:$('speedValue'),
    elapsedValue:$('elapsedValue'), thrustValue:$('thrustValue'), orbitValue:$('orbitValue'),
    verticalValue:$('verticalValue'), missionProgress:$('missionProgress')
  };

  const R = 6371;
  const MU = 398600.4418;
  const EARTH_ROTATION_SPEED = 0.4651;
  const REFERENCE_MASS_KG = 250000;
  const G0 = 9.80665;

  const vec = {
    add:(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:(a.z||0)+(b.z||0)}),
    sub:(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:(a.z||0)-(b.z||0)}),
    scale:(a,s)=>({x:a.x*s,y:a.y*s,z:(a.z||0)*s}),
    mag:a=>Math.hypot(a.x,a.y,a.z||0),
    dot:(a,b)=>a.x*b.x+a.y*b.y+(a.z||0)*(b.z||0),
    unit:a=>{const m=Math.hypot(a.x,a.y,a.z||0);return m>1e-12?{x:a.x/m,y:a.y/m,z:(a.z||0)/m}:{x:1,y:0,z:0};}
  };
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const smoothstep = t => {t=clamp(t,0,1); return t*t*(3-2*t);};

  const state = {
    pos:{x:R+.001,y:0,z:0},
    vel:{x:0,y:EARTH_ROTATION_SPEED,z:0},
    elapsed:0,
    playing:false,
    phase:'prelaunch',
    trail:[],
    thrust:{x:0,y:0,z:0},
    thrustMN:0,
    orbitAccum:0,
    lastTheta:0,
    completedOrbits:0,
    landed:false,
    lastFrame:performance.now(),
    lastRocketAngle:-Math.PI/2,
    camera:{yaw:-.55,pitch:.5,zoom:1},
    pointer:{down:false,x:0,y:0}
  };

  function targetAltitude(){ return clamp(Number(els.targetAltitude.value)||400,150,2000); }
  function targetOrbits(){ return clamp(Math.round(Number(els.orbitCount.value)||2),1,5); }
  function circularSpeed(alt){ return Math.sqrt(MU/(R+alt)); }
  function gravity(p){ const r=vec.mag(p); return vec.scale(p,-MU/(r*r*r)); }
  function localBasis(p){
    const rhat=vec.unit(p);
    const that={x:-rhat.y,y:rhat.x,z:0};
    return {rhat,that};
  }
  function localVelocity(p=state.pos,v=state.vel){
    const {rhat,that}=localBasis(p);
    return {vr:vec.dot(v,rhat),vt:vec.dot(v,that),rhat,that};
  }

  function totalAcceleration(p, thrust){ return vec.add(gravity(p),thrust); }

  function rk4ConstantThrust(p,v,dt,thrust){
    const a1=totalAcceleration(p,thrust);
    const p2=vec.add(p,vec.scale(v,dt/2));
    const v2=vec.add(v,vec.scale(a1,dt/2));
    const a2=totalAcceleration(p2,thrust);
    const p3=vec.add(p,vec.scale(v2,dt/2));
    const v3=vec.add(v,vec.scale(a2,dt/2));
    const a3=totalAcceleration(p3,thrust);
    const p4=vec.add(p,vec.scale(v3,dt));
    const v4=vec.add(v,vec.scale(a3,dt));
    const a4=totalAcceleration(p4,thrust);
    return {
      pos:{
        x:p.x+dt*(v.x+2*v2.x+2*v3.x+v4.x)/6,
        y:p.y+dt*(v.y+2*v2.y+2*v3.y+v4.y)/6,
        z:0
      },
      vel:{
        x:v.x+dt*(a1.x+2*a2.x+2*a3.x+a4.x)/6,
        y:v.y+dt*(a1.y+2*a2.y+2*a3.y+a4.y)/6,
        z:0
      }
    };
  }

  function ascentGuidance(){
    const alt=vec.mag(state.pos)-R;
    const target=targetAltitude();
    const vc=circularSpeed(target);
    const {vr,vt,rhat,that}=localVelocity();
    const err=target-alt;
    let vrDesired=clamp(err*.006,-.4,.75);
    if(alt<3) vrDesired=Math.max(vrDesired,.25);
    const fraction=smoothstep((alt-5)/(target*.85-5));
    const vtDesired=EARTH_ROTATION_SPEED+(vc-EARTH_ROTATION_SPEED)*fraction;
    const r=R+alt;
    const effectiveGravity=MU/(r*r)-vt*vt/r;
    const radial=effectiveGravity+.04*(vrDesired-vr);
    const tangential=.014*(vtDesired-vt);
    let thrust=vec.add(vec.scale(rhat,radial),vec.scale(that,tangential));
    const max=.032;
    const mag=vec.mag(thrust);
    if(mag>max) thrust=vec.scale(thrust,max/mag);
    return thrust;
  }

  function returnGuidance(){
    const alt=Math.max(0,vec.mag(state.pos)-R);
    const target=targetAltitude();
    const vc=circularSpeed(target);
    const {vr,vt,rhat,that}=localVelocity();
    const vrDesired=-clamp(alt*.002,.003,.65);
    let frac=clamp(alt/target,0,1);
    let vtDesired=vc*Math.pow(frac,.8)*.88;
    if(alt<50) vtDesired*=alt/50;
    const r=R+alt;
    const effectiveGravity=MU/(r*r)-vt*vt/r;
    const radial=effectiveGravity+.05*(vrDesired-vr);
    const tangential=.02*(vtDesired-vt);
    let thrust=vec.add(vec.scale(rhat,radial),vec.scale(that,tangential));
    const max=.045;
    const mag=vec.mag(thrust);
    if(mag>max) thrust=vec.scale(thrust,max/mag);
    return thrust;
  }

  function setThrust(v){
    state.thrust=v;
    state.thrustMN=vec.mag(v)*REFERENCE_MASS_KG/1000;
  }

  function enterOrbit(){
    state.phase='orbit';
    state.orbitAccum=0;
    state.completedOrbits=0;
    state.lastTheta=Math.atan2(state.pos.y,state.pos.x);
    setThrust({x:0,y:0,z:0});
  }

  function updateOrbitProgress(){
    const theta=Math.atan2(state.pos.y,state.pos.x);
    let d=theta-state.lastTheta;
    while(d>Math.PI)d-=Math.PI*2;
    while(d<-Math.PI)d+=Math.PI*2;
    if(d>0) state.orbitAccum+=d;
    state.lastTheta=theta;
    state.completedOrbits=Math.min(targetOrbits(),Math.floor(state.orbitAccum/(Math.PI*2)));
    if(state.orbitAccum>=targetOrbits()*Math.PI*2){
      state.phase='deorbit';
      setThrust(returnGuidance());
    }
  }

  function land(){
    const rhat=vec.unit(state.pos);
    state.pos=vec.scale(rhat,R+.001);
    state.vel={x:0,y:0,z:0};
    state.phase='landed';
    state.playing=false;
    state.landed=true;
    setThrust({x:0,y:0,z:0});
    els.playPause.textContent='Landed';
  }

  function phaseRate(){
    if(state.phase==='ascent')return 40;
    if(state.phase==='orbit')return 600;
    if(state.phase==='deorbit'||state.phase==='descent')return 150;
    if(state.phase==='landing')return 50;
    return 1;
  }
  function phaseStepLimit(){
    if(state.phase==='ascent')return .5;
    if(state.phase==='orbit')return 10;
    if(state.phase==='deorbit'||state.phase==='descent')return 1;
    if(state.phase==='landing')return .35;
    return .5;
  }

  function physicsStep(dt){
    if(state.phase==='ascent'){
      const thrust=ascentGuidance();
      setThrust(thrust);
      const next=rk4ConstantThrust(state.pos,state.vel,dt,thrust);
      state.pos=next.pos; state.vel=next.vel;
      const alt=vec.mag(state.pos)-R;
      const {vr,vt}=localVelocity();
      const vc=circularSpeed(targetAltitude());
      if(alt>targetAltitude()-3 && alt<targetAltitude()+18 && Math.abs(vr)<.03 && Math.abs(vt-vc)<.035) enterOrbit();
    } else if(state.phase==='orbit'){
      setThrust({x:0,y:0,z:0});
      const next=rk4ConstantThrust(state.pos,state.vel,dt,state.thrust);
      state.pos=next.pos; state.vel=next.vel;
      updateOrbitProgress();
    } else if(state.phase==='deorbit'||state.phase==='descent'||state.phase==='landing'){
      const thrust=returnGuidance();
      setThrust(thrust);
      const next=rk4ConstantThrust(state.pos,state.vel,dt,thrust);
      state.pos=next.pos; state.vel=next.vel;
      const alt=vec.mag(state.pos)-R;
      if(alt<25 && state.phase!=='landing') state.phase='landing';
      else if(alt<250 && state.phase==='deorbit') state.phase='descent';
      if(alt<=.02 && vec.mag(state.vel)<.06){ land(); return; }
      if(vec.mag(state.pos)<R){ land(); return; }
    }
    state.elapsed+=dt;
  }

  function resetMission(){
    state.pos={x:R+.001,y:0,z:0};
    state.vel={x:0,y:EARTH_ROTATION_SPEED,z:0};
    state.elapsed=0;
    state.playing=false;
    state.phase='prelaunch';
    state.trail=[{...state.pos,_t:0}];
    state.orbitAccum=0;
    state.completedOrbits=0;
    state.landed=false;
    state.lastRocketAngle=-Math.PI/2;
    setThrust({x:0,y:0,z:0});
    els.playPause.textContent='Launch';
    updateTelemetry();
  }

  function formatTime(s){
    if(s<120)return `${Math.round(s)} s`;
    if(s<7200)return `${(s/60).toFixed(1)} min`;
    return `${(s/3600).toFixed(2)} h`;
  }
  function phaseLabel(){
    if(state.phase==='prelaunch')return 'Prelaunch';
    if(state.phase==='ascent')return 'Powered ascent';
    if(state.phase==='orbit')return `Orbit ${Math.min(targetOrbits(),state.completedOrbits+1)} of ${targetOrbits()}`;
    if(state.phase==='deorbit')return 'Deorbit burn';
    if(state.phase==='descent')return 'Powered return';
    if(state.phase==='landing')return 'Landing burn';
    return 'Landed';
  }
  function updateProgressBar(){
    let active='launch';
    let done=[];
    if(state.phase==='ascent'){active='ascent';done=['launch'];}
    else if(state.phase==='orbit'){
      active=state.completedOrbits>=1?'orbit2':'orbit1';
      done=['launch','ascent'];
      if(state.completedOrbits>=1)done.push('orbit1');
    } else if(state.phase==='deorbit'||state.phase==='descent'){
      active='return';done=['launch','ascent','orbit1','orbit2'];
    } else if(state.phase==='landing'){
      active='landing';done=['launch','ascent','orbit1','orbit2','return'];
    } else if(state.phase==='landed'){
      active='landing';done=['launch','ascent','orbit1','orbit2','return','landing'];
    }
    els.missionProgress.querySelectorAll('.mission-step').forEach(el=>{
      el.classList.toggle('active',el.dataset.step===active && state.phase!=='landed');
      el.classList.toggle('done',done.includes(el.dataset.step));
    });
  }
  function updateTelemetry(){
    const alt=Math.max(0,vec.mag(state.pos)-R);
    const {vr}=localVelocity();
    els.status.textContent=phaseLabel();
    els.altitudeValue.textContent=alt<10?`${alt.toFixed(1)} km`:`${Math.round(alt).toLocaleString()} km`;
    els.speedValue.textContent=`${vec.mag(state.vel).toFixed(2)} km/s`;
    els.elapsedValue.textContent=formatTime(state.elapsed);
    els.thrustValue.textContent=`${state.thrustMN.toFixed(1)} MN`;
    const progress=state.phase==='orbit'?state.orbitAccum/(Math.PI*2):state.completedOrbits;
    els.orbitValue.textContent=`${Math.min(targetOrbits(),progress).toFixed(2)} / ${targetOrbits()}`;
    els.verticalValue.textContent=`${Math.round(vr*1000).toLocaleString()} m/s`;
    updateProgressBar();
  }

  function homeCamera(){ state.camera={yaw:-.55,pitch:.5,zoom:1}; els.cameraPreset.value='overview'; }
  function setFollowStartingAngle(){
    const a=Math.atan2(state.pos.y,state.pos.x);
    state.camera.yaw=-a-.7; state.camera.pitch=.38;
  }
  function applyCameraPreset(){
    const mode=els.cameraPreset.value;
    if(mode==='top'){state.camera.yaw=0;state.camera.pitch=Math.PI/2-.01;}
    else if(mode==='side'){state.camera.yaw=0;state.camera.pitch=.02;}
    else if(mode==='overview'){state.camera.yaw=-.55;state.camera.pitch=.5;}
    else if(mode==='track'){
      const a=Math.atan2(state.pos.y,state.pos.x);
      state.camera.yaw=-a-.7;state.camera.pitch=.38;
    }
  }
  function cameraCenter(){ return els.cameraPreset.value==='follow'?state.pos:{x:0,y:0,z:0}; }
  function rotatePoint(p){
    const cy=Math.cos(state.camera.yaw),sy=Math.sin(state.camera.yaw),cp=Math.cos(state.camera.pitch),sp=Math.sin(state.camera.pitch);
    const x1=cy*p.x-sy*p.y,y1=sy*p.x+cy*p.y;
    return {x:x1,y:cp*y1-sp*(p.z||0),z:sp*y1+cp*(p.z||0)};
  }
  function resizeCanvas(){
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function makeFrame(w,h){
    const targetRadius=R+targetAltitude();
    const extent=Math.max(targetRadius*1.16,vec.mag(state.pos)*1.08);
    const scale=Math.min(w,h)*.40/extent*state.camera.zoom;
    return {width:w,height:h,extent,scale,center:cameraCenter()};
  }
  function project(p,frame){
    const q=rotatePoint(vec.sub(p,frame.center));
    return {x:frame.width/2+q.x*frame.scale,y:frame.height/2-q.y*frame.scale,depth:q.z};
  }

  function drawStars(frame){
    for(let i=0;i<95;i++){
      const x=(i*97.31)%frame.width,y=(i*i*19.17+37)%frame.height,a=.15+((i*13)%55)/100;
      ctx.fillStyle=`rgba(230,238,255,${a})`; const s=i%11===0?1.6:1; ctx.fillRect(x,y,s,s);
    }
  }
  function drawPath(points,frame,style,width,dash=[]){
    if(points.length<2)return;
    ctx.save();ctx.strokeStyle=style;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();
    points.forEach((point,i)=>{const p=project(point,frame);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});ctx.stroke();ctx.restore();
  }
  function drawTargetOrbit(frame){
    const rr=R+targetAltitude();
    ctx.save();ctx.strokeStyle='rgba(131,182,255,.34)';ctx.lineWidth=1.4;ctx.setLineDash([6,7]);ctx.beginPath();
    for(let i=0;i<=120;i++){
      const a=Math.PI*2*i/120,p=project({x:rr*Math.cos(a),y:rr*Math.sin(a),z:0},frame);
      if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();ctx.restore();
  }
  function drawEarth(frame){
    const o=project({x:0,y:0,z:0},frame),r=R*frame.scale;
    const rotation=(state.elapsed/86164.0905)*Math.PI*2;
    if(earthGlobe)earthGlobe(ctx,{x:o.x,y:o.y,radius:r,yaw:state.camera.yaw,pitch:state.camera.pitch,rotation});
    else{const g=ctx.createRadialGradient(o.x-r*.35,o.y-r*.4,r*.06,o.x,o.y,r);g.addColorStop(0,'#9de2ff');g.addColorStop(.3,'#2696d1');g.addColorStop(1,'#05294f');ctx.fillStyle=g;ctx.beginPath();ctx.arc(o.x,o.y,r,0,Math.PI*2);ctx.fill();}
  }
  function drawArrow(from,vector,frame,color,maxPixels=74){
    const m=vec.mag(vector);if(m<1e-9)return;
    const start=project(from,frame),u=vec.scale(vector,1/m),end=project(vec.add(from,vec.scale(u,frame.extent*.15)),frame);
    let dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy)||1,f=Math.min(1,maxPixels/len);dx*=f;dy*=f;
    const ex=start.x+dx,ey=start.y+dy,a=Math.atan2(dy,dx);
    ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(ex,ey);ctx.stroke();ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-9*Math.cos(a-.5),ey-9*Math.sin(a-.5));ctx.lineTo(ex-9*Math.cos(a+.5),ey-9*Math.sin(a+.5));ctx.closePath();ctx.fill();ctx.restore();
  }
  function drawRocket(frame){
    const p=project(state.pos,frame);
    const headingVector=state.thrustMN>.05?state.thrust:state.vel;
    let tilt=0;
    if(vec.mag(headingVector)>1e-8){
      const ahead=project(vec.add(state.pos,vec.scale(vec.unit(headingVector),frame.extent*.06)),frame);
      const dx=ahead.x-p.x,dy=ahead.y-p.y;
      const a=Math.atan2(dy,dx);if(Number.isFinite(a))state.lastRocketAngle=a;
      const dz=((ahead.depth||0)-(p.depth||0))*frame.scale;
      tilt=Math.atan2(dz,Math.max(1e-6,Math.hypot(dx,dy)));
    }

    if(state.thrustMN>.05){
      const intensity=clamp(state.thrustMN/8,0.35,1.25),flick=1+.1*Math.sin(state.elapsed*7);
      const foreshorten=Math.max(.28,Math.cos(tilt));
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(state.lastRocketAngle);
      const flame=ctx.createLinearGradient(-27*intensity*foreshorten,0,-9,0);
      flame.addColorStop(0,'rgba(255,70,20,.08)');flame.addColorStop(.45,'#ff7930');flame.addColorStop(1,'#ffe66c');
      ctx.fillStyle=flame;ctx.beginPath();ctx.moveTo(-10,-3.2);ctx.lineTo(-25*intensity*flick*foreshorten,0);ctx.lineTo(-10,3.2);ctx.closePath();ctx.fill();ctx.restore();
    }

    if(rocket3D){
      rocket3D(ctx,{x:p.x,y:p.y,size:46,angle:-state.lastRocketAngle,tilt,roll:.34});
      return;
    }

    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(state.lastRocketAngle);ctx.shadowColor='rgba(120,195,255,.6)';ctx.shadowBlur=8;
    ctx.fillStyle='#dc3f46';ctx.beginPath();ctx.moveTo(-8,-5);ctx.lineTo(-13,-10);ctx.lineTo(-12,-3);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(-8,5);ctx.lineTo(-13,10);ctx.lineTo(-12,3);ctx.closePath();ctx.fill();
    ctx.fillStyle='#f1f5f8';ctx.strokeStyle='#a7bbca';ctx.lineWidth=1.1;ctx.beginPath();ctx.moveTo(12,0);ctx.quadraticCurveTo(7,-5.2,-6,-5.2);ctx.lineTo(-10,-3.6);ctx.lineTo(-10,3.6);ctx.lineTo(-6,5.2);ctx.quadraticCurveTo(7,5.2,12,0);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#e44b50';ctx.beginPath();ctx.moveTo(12,0);ctx.quadraticCurveTo(9,-3.4,6.8,-4.3);ctx.lineTo(6.8,4.3);ctx.quadraticCurveTo(9,3.4,12,0);ctx.closePath();ctx.fill();
    ctx.fillStyle='#56b9e9';ctx.strokeStyle='#d7f4ff';ctx.beginPath();ctx.arc(1.8,0,2.35,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
  }

  function render(){
    resizeCanvas();
    if(els.cameraPreset.value!=='follow'&&els.cameraPreset.value!=='free')applyCameraPreset();
    const rect=canvas.getBoundingClientRect(),frame=makeFrame(rect.width,rect.height);
    ctx.clearRect(0,0,frame.width,frame.height);
    const bg=ctx.createLinearGradient(0,0,0,frame.height);bg.addColorStop(0,'#050914');bg.addColorStop(1,'#020409');ctx.fillStyle=bg;ctx.fillRect(0,0,frame.width,frame.height);
    drawStars(frame);drawTargetOrbit(frame);
    if(els.showTrail.checked)drawPath(state.trail,frame,'rgba(157,240,208,.74)',2);
    drawEarth(frame);drawRocket(frame);
    if(els.showVelocity.checked)drawArrow(state.pos,state.vel,frame,'#9df0d0');
    if(els.showGravity.checked)drawArrow(state.pos,gravity(state.pos),frame,'#ffae7c');
    if(els.showThrust.checked&&state.thrustMN>.05)drawArrow(state.pos,state.thrust,frame,'#ffd86b');
  }

  function simulationStep(realDt){
    if(!state.playing||state.phase==='prelaunch'||state.phase==='landed')return;
    let remaining=realDt*Number(els.simSpeed.value)*phaseRate();
    const cap=phaseStepLimit();
    while(remaining>0&&state.playing){
      const dt=Math.min(cap,remaining);
      physicsStep(dt);
      remaining-=dt;
      if(state.phase==='landed')break;
    }
    const interval=state.phase==='orbit'?45:state.phase==='ascent'?8:12;
    const last=state.trail[state.trail.length-1];
    if(!last||state.elapsed-(last._t||0)>=interval){state.trail.push({...state.pos,_t:state.elapsed});if(state.trail.length>1200)state.trail.shift();}
    updateTelemetry();
  }
  function animate(now){
    const dt=Math.min(.05,Math.max(0,(now-state.lastFrame)/1000));state.lastFrame=now;simulationStep(dt);render();requestAnimationFrame(animate);
  }

  els.playPause.addEventListener('click',()=>{
    if(state.phase==='landed')return;
    if(state.phase==='prelaunch'){
      state.phase='ascent';state.playing=true;els.playPause.textContent='Pause';
    } else {
      state.playing=!state.playing;els.playPause.textContent=state.playing?'Pause':'Resume';
    }
    updateTelemetry();
  });
  els.restart.addEventListener('click',resetMission);
  els.homeCamera.addEventListener('click',homeCamera);
  [els.targetAltitude,els.orbitCount].forEach(input=>input.addEventListener('change',()=>{if(state.phase==='prelaunch'||state.phase==='landed')resetMission();}));
  els.simSpeed.addEventListener('input',()=>{els.simSpeedOut.textContent=`${Number(els.simSpeed.value).toFixed(2).replace(/\.00$/,'')}×`;});
  els.cameraPreset.addEventListener('change',()=>{
    if(els.cameraPreset.value==='follow')setFollowStartingAngle();
    else if(els.cameraPreset.value!=='free')applyCameraPreset();
  });

  canvas.addEventListener('pointerdown',e=>{
    const keepFollow=els.cameraPreset.value==='follow';
    state.pointer.down=true;state.pointer.x=e.clientX;state.pointer.y=e.clientY;canvas.setPointerCapture(e.pointerId);
    if(!keepFollow)els.cameraPreset.value='free';
  });
  canvas.addEventListener('pointermove',e=>{
    if(!state.pointer.down)return;
    const dx=e.clientX-state.pointer.x,dy=e.clientY-state.pointer.y;state.pointer.x=e.clientX;state.pointer.y=e.clientY;
    state.camera.yaw+=dx*.008;state.camera.pitch=clamp(state.camera.pitch-dy*.008,-1.45,1.45);
  });
  canvas.addEventListener('pointerup',()=>state.pointer.down=false);
  canvas.addEventListener('pointercancel',()=>state.pointer.down=false);
  canvas.addEventListener('wheel',e=>{e.preventDefault();state.camera.zoom=clamp(state.camera.zoom*Math.exp(-e.deltaY*.0012),.35,4);},{passive:false});
  window.addEventListener('resize',render);

  resetMission();
  requestAnimationFrame(t=>{state.lastFrame=t;animate(t);});
})();
