(() => {
  const canvas = document.getElementById('orbitCanvas');
  const ctx = canvas.getContext('2d');
  const earthGlobe = window.createEarthGlobeRenderer ? window.createEarthGlobeRenderer() : null;

  const $ = id => document.getElementById(id);
  const els = {
    mode:$('mode'), orbitObject:$('orbitObject'), altitude:$('altitude'),
    initialSpeed:$('initialSpeed'), direction:$('direction'), inclination:$('inclination'),
    gravity:$('gravity'), gravityOut:$('gravityOut'), simSpeed:$('simSpeed'),
    simSpeedOut:$('simSpeedOut'), playPause:$('playPause'), restart:$('restart'),
    homeCamera:$('homeCamera'), cameraPreset:$('cameraPreset'),
    showPrediction:$('showPrediction'), showTrail:$('showTrail'),
    showVelocity:$('showVelocity'), showGravity:$('showGravity'),
    presetGrid:$('presetGrid'), status:$('status'), distanceLabel:$('distanceLabel'),
    distanceValue:$('distanceValue'), speedValue:$('speedValue'),
    elapsedValue:$('elapsedValue'), radiusInputLabel:$('radiusInputLabel')
  };

  const EARTH_RADIUS=6371, EARTH_MU=398600.4418;
  const HIGH_ORBIT_ALTITUDE=EARTH_RADIUS*.2;
  const HIGH_ORBIT_SPEED=Math.sqrt(EARTH_MU/(EARTH_RADIUS+HIGH_ORBIT_ALTITUDE));
  const BODIES={
    earth:{radius:EARTH_RADIUS,mu:EARTH_MU,atmosphere:100,defaultAltitude:HIGH_ORBIT_ALTITUDE,defaultSpeed:HIGH_ORBIT_SPEED,playbackRate:40,scaleLabel:'Altitude'},
    sun:{radius:696340,mu:132712440018,atmosphere:0,defaultAltitude:148901530,defaultSpeed:29.78,playbackRate:90000,scaleLabel:'Distance from surface'}
  };
  const PRESETS={
    earth:[
      {name:'High circular',altitude:HIGH_ORBIT_ALTITUDE,speed:HIGH_ORBIT_SPEED,direction:0,inclination:0},
      {name:'Low circular',altitude:400,speed:Math.sqrt(EARTH_MU/(EARTH_RADIUS+400)),direction:0,inclination:0},
      {name:'High ellipse',altitude:400,speed:9.2,direction:0,inclination:0},
      {name:'Reentry',altitude:200,speed:7.2,direction:-8,inclination:0},
      {name:'Escape',altitude:400,speed:11.2,direction:0,inclination:0}
    ],
    sun:[
      {name:'Earth-like',altitude:148901530,speed:29.78,direction:0,inclination:0},
      {name:'Inner ellipse',altitude:148901530,speed:34,direction:0,inclination:0},
      {name:'Outer ellipse',altitude:148901530,speed:24,direction:0,inclination:0},
      {name:'Solar escape',altitude:148901530,speed:42.3,direction:0,inclination:0}
    ]
  };

  const state={
    bodyKey:'earth',
    pos:{x:EARTH_RADIUS+HIGH_ORBIT_ALTITUDE,y:0,z:0},
    vel:{x:0,y:HIGH_ORBIT_SPEED,z:0},
    elapsed:0,playing:true,crashed:false,trail:[],prediction:[],predictionExtent:EARTH_RADIUS*1.2,
    explosion:null,status:'Circular',lastFrame:performance.now(),lastRocketAngle:-Math.PI/2,
    camera:{yaw:-.55,pitch:.5,zoom:1},pointer:{down:false,x:0,y:0}
  };
  const vec={
    add:(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z}),
    sub:(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z}),
    scale:(a,s)=>({x:a.x*s,y:a.y*s,z:a.z*s}),
    mag:a=>Math.hypot(a.x,a.y,a.z),
    cross:(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x}),
    unit:a=>{const m=Math.hypot(a.x,a.y,a.z);return m>1e-12?{x:a.x/m,y:a.y/m,z:a.z/m}:{x:1,y:0,z:0};}
  };
  const body=()=>BODIES[state.bodyKey];
  const mu=()=>body().mu*Number(els.gravity.value);

  function acceleration(p){
    const r=vec.mag(p),m=mu();
    return r>0&&m>0?vec.scale(p,-m/(r*r*r)):{x:0,y:0,z:0};
  }
  function rk4Step(p,v,dt){
    const a1=acceleration(p);
    const p2=vec.add(p,vec.scale(v,dt/2)),v2=vec.add(v,vec.scale(a1,dt/2)),a2=acceleration(p2);
    const p3=vec.add(p,vec.scale(v2,dt/2)),v3=vec.add(v,vec.scale(a2,dt/2)),a3=acceleration(p3);
    const p4=vec.add(p,vec.scale(v3,dt)),v4=vec.add(v,vec.scale(a3,dt)),a4=acceleration(p4);
    return {
      pos:{
        x:p.x+dt*(v.x+2*v2.x+2*v3.x+v4.x)/6,
        y:p.y+dt*(v.y+2*v2.y+2*v3.y+v4.y)/6,
        z:p.z+dt*(v.z+2*v2.z+2*v3.z+v4.z)/6
      },
      vel:{
        x:v.x+dt*(a1.x+2*a2.x+2*a3.x+a4.x)/6,
        y:v.y+dt*(a1.y+2*a2.y+2*a3.y+a4.y)/6,
        z:v.z+dt*(a1.z+2*a2.z+2*a3.z+a4.z)/6
      }
    };
  }
  function orbitalElements(p=state.pos,v=state.vel){
    const m=mu(),r=vec.mag(p),speed=vec.mag(v);
    if(m<=0||r<=0)return null;
    const h=vec.cross(p,v),hmag=vec.mag(h);
    const energy=speed*speed/2-m/r;
    const eVec=vec.sub(vec.scale(vec.cross(v,h),1/m),vec.scale(p,1/r));
    const e=vec.mag(eVec),pSemi=hmag*hmag/m;
    const periapsis=pSemi/Math.max(1e-12,1+e);
    const a=energy<0?-m/(2*energy):Infinity;
    const period=Number.isFinite(a)?2*Math.PI*Math.sqrt(a*a*a/m):Infinity;
    return {energy,e,periapsis,a,period};
  }
  function classifyOrbit(){
    const b=body(),r=vec.mag(state.pos),alt=r-b.radius;
    if(r<=b.radius)return 'Impact';
    if(mu()<=0)return 'Coasting';
    const o=orbitalElements();
    if(!o)return 'Coasting';
    if(o.energy>=0)return 'Escaping';
    if(o.periapsis<=b.radius)return 'Impact course';
    if(state.bodyKey==='earth'&&(alt<b.atmosphere||o.periapsis-b.radius<b.atmosphere))return 'Reentering';
    return o.e<.01?'Circular':'Elliptical';
  }

  function initialState(){
    const b=body(),alt=Math.max(0,Number(els.altitude.value)||0),speed=Math.max(0,Number(els.initialSpeed.value)||0);
    const dir=(Number(els.direction.value)||0)*Math.PI/180,inc=(Number(els.inclination.value)||0)*Math.PI/180;
    const r=b.radius+alt,radial=speed*Math.sin(dir),tangent=speed*Math.cos(dir);
    return {pos:{x:r,y:0,z:0},vel:{x:radial,y:tangent*Math.cos(inc),z:tangent*Math.sin(inc)}};
  }
  function integrationStepLimit(p=state.pos){
    const m=mu();
    if(m<=0)return 10;
    const r=Math.max(body().radius,vec.mag(p));
    const localPeriod=2*Math.PI*Math.sqrt(r*r*r/m);
    return Math.max(.05,Math.min(state.bodyKey==='earth'?12:21600,localPeriod/1400));
  }

  function updatePrediction(){
    let p={...state.pos},v={...state.vel};
    const b=body(),o=orbitalElements(p,v),points=[];
    let total=o&&Number.isFinite(o.period)?o.period*1.03:
      Math.min(state.bodyKey==='earth'?160000:90000000,Math.max(4000,vec.mag(p)/Math.max(.05,vec.mag(v))*10));
    const samples=300;
    let remaining=total,maxR=Math.max(vec.mag(p),b.radius*1.2);
    for(let i=0;i<samples&&remaining>0;i++){
      if(vec.mag(p)<=b.radius)break;
      points.push({...p});
      maxR=Math.max(maxR,vec.mag(p));
      const dt=Math.min(remaining,total/samples,integrationStepLimit(p)*5);
      const next=rk4Step(p,v,dt);p=next.pos;v=next.vel;remaining-=dt;
      if(vec.mag(p)>Math.max(vec.mag(state.pos)*14,b.radius*20))break;
    }
    state.prediction=points;
    state.predictionExtent=maxR;
  }
  function resetSimulation(){
    const s=initialState();
    state.pos=s.pos;state.vel=s.vel;state.elapsed=0;state.trail=[{...s.pos,_t:0}];
    state.crashed=false;state.explosion=null;state.playing=true;state.lastRocketAngle=-Math.PI/2;
    els.playPause.textContent='Pause';updatePrediction();updateTelemetry();
  }
  function formatDistance(km){
    if(Math.abs(km)>=1e8)return `${(km/1e6).toFixed(1)} million km`;
    if(Math.abs(km)>=1e6)return `${(km/1e6).toFixed(2)} million km`;
    return `${Math.round(km).toLocaleString()} km`;
  }
  function formatTime(s){
    if(s<120)return `${Math.round(s)} s`;
    if(s<7200)return `${(s/60).toFixed(1)} min`;
    if(s<172800)return `${(s/3600).toFixed(1)} h`;
    return `${(s/86400).toFixed(1)} d`;
  }
  function updateTelemetry(){
    state.status=state.crashed?'Impact':classifyOrbit();
    els.status.textContent=state.status;els.distanceLabel.textContent=body().scaleLabel;
    els.distanceValue.textContent=formatDistance(Math.max(0,vec.mag(state.pos)-body().radius));
    els.speedValue.textContent=`${vec.mag(state.vel).toFixed(state.bodyKey==='earth'?2:1)} km/s`;
    els.elapsedValue.textContent=formatTime(state.elapsed);
  }
  function renderPresets(){
    els.presetGrid.innerHTML='';
    PRESETS[state.bodyKey].forEach(p=>{
      const button=document.createElement('button');button.textContent=p.name;
      button.addEventListener('click',()=>{
        els.altitude.value=Number(p.altitude.toFixed(2));els.initialSpeed.value=Number(p.speed.toFixed(3));
        els.direction.value=p.direction;els.inclination.value=p.inclination;resetSimulation();
      });
      els.presetGrid.appendChild(button);
    });
  }
  function configureMode(key){
    state.bodyKey=key;const b=body();
    els.radiusInputLabel.textContent=key==='earth'?'Starting altitude (km)':'Starting distance from Sun surface (km)';
    els.altitude.step=key==='earth'?'10':'1000000';els.initialSpeed.step=key==='earth'?'.01':'.1';
    els.altitude.value=Number(b.defaultAltitude.toFixed(2));els.initialSpeed.value=Number(b.defaultSpeed.toFixed(3));
    els.direction.value=0;els.inclination.value=0;els.gravity.value=1;els.gravityOut.textContent='1.00×';
    renderPresets();homeCamera();resetSimulation();
  }

  function homeCamera(){
    state.camera={yaw:-.55,pitch:.5,zoom:1};
    els.cameraPreset.value='free';
  }
  function applyCameraPreset(){
    const mode=els.cameraPreset.value;
    if(mode==='top'){state.camera.yaw=0;state.camera.pitch=Math.PI/2-.01;}
    else if(mode==='side'){state.camera.yaw=0;state.camera.pitch=.02;}
    else if(mode==='track'||mode==='follow'){
      const a=Math.atan2(state.pos.y,state.pos.x);
      state.camera.yaw=-a-.7;state.camera.pitch=.38;
    }
  }
  function cameraCenter(){
    return els.cameraPreset.value==='follow'?state.pos:{x:0,y:0,z:0};
  }

  function resizeCanvas(){
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function rotatePoint(p){
    const cy=Math.cos(state.camera.yaw),sy=Math.sin(state.camera.yaw),cp=Math.cos(state.camera.pitch),sp=Math.sin(state.camera.pitch);
    const x1=cy*p.x-sy*p.y,y1=sy*p.x+cy*p.y;
    return {x:x1,y:cp*y1-sp*p.z,z:sp*y1+cp*p.z};
  }
  function makeFrame(width,height){
    const current=Math.max(vec.mag(state.pos),body().radius*1.2);
    const extent=Math.max(body().radius*1.25,Math.min(state.predictionExtent||current,current*3.6));
    const scale=Math.min(width,height)*.40/extent*state.camera.zoom;
    const center=cameraCenter();
    return {width,height,extent,scale,center};
  }
  function project(p,frame){
    const relative=vec.sub(p,frame.center),r=rotatePoint(relative);
    return {x:frame.width/2+r.x*frame.scale,y:frame.height/2-r.y*frame.scale,depth:r.z};
  }

  function drawStars(frame){
    const {width,height}=frame;ctx.save();
    for(let i=0;i<100;i++){
      const x=(i*97.31)%width,y=(i*i*19.17+37)%height,a=.15+((i*13)%55)/100;
      ctx.fillStyle=`rgba(230,238,255,${a})`;const s=i%11===0?1.6:1;ctx.fillRect(x,y,s,s);
    }ctx.restore();
  }
  function drawPath(points,frame,style,lineWidth,dash=[]){
    if(points.length<2)return;
    ctx.save();ctx.strokeStyle=style;ctx.lineWidth=lineWidth;ctx.setLineDash(dash);ctx.beginPath();
    points.forEach((point,i)=>{const p=project(point,frame);if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
    ctx.stroke();ctx.restore();
  }
  function drawArrow(from,vector,frame,color,maxPixels=78){
    const start=project(from,frame),m=Math.max(vec.mag(vector),1e-9),u=vec.scale(vector,1/m);
    const end=project(vec.add(from,vec.scale(u,frame.extent*.16)),frame);
    let dx=end.x-start.x,dy=end.y-start.y;const len=Math.hypot(dx,dy)||1,f=Math.min(1,maxPixels/len);
    dx*=f;dy*=f;const ex=start.x+dx,ey=start.y+dy,a=Math.atan2(dy,dx);
    ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(ex,ey);ctx.stroke();
    ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex-10*Math.cos(a-.45),ey-10*Math.sin(a-.45));ctx.lineTo(ex-10*Math.cos(a+.45),ey-10*Math.sin(a+.45));ctx.closePath();ctx.fill();ctx.restore();
  }
  function drawEarth(frame){
    const o=project({x:0,y:0,z:0},frame),r=body().radius*frame.scale;
    if(r<1)return;
    const rotation=(state.elapsed/86164.0905)*Math.PI*2;
    if(earthGlobe)earthGlobe(ctx,{x:o.x,y:o.y,radius:r,yaw:state.camera.yaw,pitch:state.camera.pitch,rotation});
    else{
      const g=ctx.createRadialGradient(o.x-r*.35,o.y-r*.4,r*.06,o.x,o.y,r);
      g.addColorStop(0,'#9de2ff');g.addColorStop(.3,'#2696d1');g.addColorStop(1,'#05294f');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(o.x,o.y,r,0,Math.PI*2);ctx.fill();
    }
  }
  function drawSun(frame){
    const o=project({x:0,y:0,z:0},frame),r=body().radius*frame.scale;
    const g=ctx.createRadialGradient(o.x-r*.28,o.y-r*.3,Math.max(1,r*.04),o.x,o.y,Math.max(1,r));
    g.addColorStop(0,'#fffbd0');g.addColorStop(.3,'#ffd66c');g.addColorStop(.75,'#f19a30');g.addColorStop(1,'#9a4518');
    ctx.save();ctx.shadowColor='rgba(255,190,80,.6)';ctx.shadowBlur=Math.max(18,r*.25);ctx.fillStyle=g;ctx.beginPath();ctx.arc(o.x,o.y,r,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function drawBody(frame){state.bodyKey==='earth'?drawEarth(frame):drawSun(frame);}
  function drawMarker(p){ctx.save();ctx.shadowColor='rgba(157,240,208,.75)';ctx.shadowBlur=12;ctx.fillStyle='#d9fff1';ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();ctx.restore();}
  function drawRocket(frame,p){
    const speed=vec.mag(state.vel);
    if(speed>1e-6){
      const ahead=project(vec.add(state.pos,vec.scale(state.vel,frame.extent*.06/speed)),frame);
      const a=Math.atan2(ahead.y-p.y,ahead.x-p.x);if(Number.isFinite(a))state.lastRocketAngle=a;
    }
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(state.lastRocketAngle);ctx.shadowColor='rgba(120,195,255,.55)';ctx.shadowBlur=7;
    if(state.playing&&!state.crashed){
      const flick=1+.12*Math.sin(state.elapsed*4.7),flame=ctx.createLinearGradient(-24,0,-9,0);
      flame.addColorStop(0,'rgba(255,80,30,.1)');flame.addColorStop(.45,'#ff7c31');flame.addColorStop(1,'#ffe56c');
      ctx.fillStyle=flame;ctx.beginPath();ctx.moveTo(-10,-3);ctx.lineTo(-24*flick,0);ctx.lineTo(-10,3);ctx.closePath();ctx.fill();
    }
    ctx.fillStyle='#dc3f46';ctx.beginPath();ctx.moveTo(-8,-5);ctx.lineTo(-13,-10);ctx.lineTo(-12,-3);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(-8,5);ctx.lineTo(-13,10);ctx.lineTo(-12,3);ctx.closePath();ctx.fill();
    ctx.fillStyle='#f1f5f8';ctx.strokeStyle='#a7bbca';ctx.lineWidth=1.1;ctx.beginPath();ctx.moveTo(12,0);ctx.quadraticCurveTo(7,-5.2,-6,-5.2);ctx.lineTo(-10,-3.6);ctx.lineTo(-10,3.6);ctx.lineTo(-6,5.2);ctx.quadraticCurveTo(7,5.2,12,0);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle='#e44b50';ctx.beginPath();ctx.moveTo(12,0);ctx.quadraticCurveTo(9,-3.4,6.8,-4.3);ctx.lineTo(6.8,4.3);ctx.quadraticCurveTo(9,3.4,12,0);ctx.closePath();ctx.fill();
    ctx.fillStyle='#56b9e9';ctx.strokeStyle='#d7f4ff';ctx.beginPath();ctx.arc(1.8,0,2.35,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
  }
  function drawObject(frame){
    if(state.crashed)return;
    const p=project(state.pos,frame);els.orbitObject.value==='rocket'?drawRocket(frame,p):drawMarker(p);
  }
  function triggerImpact(hitPos,hitVel){
    state.pos=vec.scale(vec.unit(hitPos),body().radius);state.vel=hitVel;state.crashed=true;state.playing=false;state.status='Impact';els.playPause.textContent='Play';
    const particles=[];for(let i=0;i<28;i++)particles.push({angle:Math.PI*2*i/28+(Math.random()-.5)*.25,speed:28+Math.random()*90,size:1.4+Math.random()*3.5});
    state.explosion={pos:{...state.pos},age:0,duration:2.1,particles};updateTelemetry();
  }
  function drawExplosion(frame){
    const ex=state.explosion;if(!ex||ex.age>=ex.duration)return;
    const p=project(ex.pos,frame),t=ex.age/ex.duration,fade=1-t,rad=12+55*Math.sin(Math.min(1,t*2.2)*Math.PI/2)*fade;
    const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,rad);g.addColorStop(0,`rgba(255,255,220,${.95*fade})`);g.addColorStop(.3,`rgba(255,210,65,${.9*fade})`);g.addColorStop(.62,`rgba(255,88,25,${.7*fade})`);g.addColorStop(1,'rgba(100,20,5,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,rad,0,Math.PI*2);ctx.fill();
    ex.particles.forEach((q,i)=>{const d=q.speed*ex.age*(1-.3*t);ctx.fillStyle=i%3===0?`rgba(255,225,100,${fade})`:`rgba(255,105,35,${fade})`;ctx.beginPath();ctx.arc(p.x+Math.cos(q.angle)*d,p.y+Math.sin(q.angle)*d,q.size*fade,0,Math.PI*2);ctx.fill();});
  }

  function render(){
    resizeCanvas();applyCameraPreset();
    const rect=canvas.getBoundingClientRect(),frame=makeFrame(rect.width,rect.height);
    ctx.clearRect(0,0,frame.width,frame.height);
    const bg=ctx.createLinearGradient(0,0,0,frame.height);bg.addColorStop(0,'#050914');bg.addColorStop(1,'#020409');ctx.fillStyle=bg;ctx.fillRect(0,0,frame.width,frame.height);
    drawStars(frame);
    if(els.showPrediction.checked&&!state.crashed)drawPath(state.prediction,frame,'rgba(131,182,255,.48)',1.5,[7,7]);
    if(els.showTrail.checked)drawPath(state.trail,frame,'rgba(157,240,208,.72)',2);
    drawBody(frame);drawObject(frame);
    if(!state.crashed&&els.showVelocity.checked)drawArrow(state.pos,state.vel,frame,'#9df0d0');
    if(!state.crashed&&els.showGravity.checked)drawArrow(state.pos,acceleration(state.pos),frame,'#ffae7c');
    drawExplosion(frame);
  }

  function advanceBy(dt){
    const b=body(),p0={...state.pos},v0={...state.vel},next=rk4Step(p0,v0,dt);
    if(vec.mag(next.pos)>b.radius){state.pos=next.pos;state.vel=next.vel;state.elapsed+=dt;return true;}
    let lo=0,hi=dt,hit=next;
    for(let i=0;i<20;i++){const mid=(lo+hi)/2,test=rk4Step(p0,v0,mid);if(vec.mag(test.pos)>b.radius)lo=mid;else{hi=mid;hit=test;}}
    state.elapsed+=hi;triggerImpact(hit.pos,hit.vel);return false;
  }
  function simulationStep(realDt){
    if(state.explosion)state.explosion.age+=realDt;
    if(!state.playing||state.crashed)return;
    let remaining=realDt*Number(els.simSpeed.value)*body().playbackRate;
    while(remaining>0&&!state.crashed){
      const dt=Math.min(remaining,integrationStepLimit());
      if(!advanceBy(dt))break;remaining-=dt;
    }
    const every=state.bodyKey==='earth'?45:54000;
    if(!state.crashed&&(state.trail.length===0||state.elapsed-(state.trail[state.trail.length-1]._t||0)>=every)){
      state.trail.push({...state.pos,_t:state.elapsed});if(state.trail.length>700)state.trail.shift();
    }
    updateTelemetry();
  }
  function animate(now){
    const dt=Math.min(.05,Math.max(0,(now-state.lastFrame)/1000));state.lastFrame=now;simulationStep(dt);render();requestAnimationFrame(animate);
  }

  let resetTimer;
  const scheduleReset=()=>{clearTimeout(resetTimer);resetTimer=setTimeout(resetSimulation,180);};
  els.mode.addEventListener('change',()=>configureMode(els.mode.value));
  [els.altitude,els.initialSpeed,els.direction,els.inclination].forEach(i=>i.addEventListener('input',scheduleReset));
  els.gravity.addEventListener('input',()=>{els.gravityOut.textContent=`${Number(els.gravity.value).toFixed(2)}×`;scheduleReset();});
  els.simSpeed.addEventListener('input',()=>{els.simSpeedOut.textContent=`${Number(els.simSpeed.value).toFixed(2).replace(/\.00$/,'')}×`;});
  els.playPause.addEventListener('click',()=>{if(state.crashed)return;state.playing=!state.playing;els.playPause.textContent=state.playing?'Pause':'Play';});
  els.restart.addEventListener('click',resetSimulation);els.homeCamera.addEventListener('click',homeCamera);
  els.cameraPreset.addEventListener('change',()=>{if(els.cameraPreset.value==='free')return;applyCameraPreset();});

  canvas.addEventListener('pointerdown',e=>{state.pointer.down=true;state.pointer.x=e.clientX;state.pointer.y=e.clientY;canvas.setPointerCapture(e.pointerId);els.cameraPreset.value='free';});
  canvas.addEventListener('pointermove',e=>{
    if(!state.pointer.down)return;
    const dx=e.clientX-state.pointer.x,dy=e.clientY-state.pointer.y;state.pointer.x=e.clientX;state.pointer.y=e.clientY;
    state.camera.yaw+=dx*.008;state.camera.pitch=Math.max(-1.45,Math.min(1.45,state.camera.pitch-dy*.008));
  });
  canvas.addEventListener('pointerup',()=>state.pointer.down=false);
  canvas.addEventListener('pointercancel',()=>state.pointer.down=false);
  canvas.addEventListener('wheel',e=>{e.preventDefault();state.camera.zoom=Math.max(.35,Math.min(4,state.camera.zoom*Math.exp(-e.deltaY*.0012)));},{passive:false});
  window.addEventListener('resize',render);

  configureMode('earth');
  requestAnimationFrame(t=>{state.lastFrame=t;animate(t);});
})();