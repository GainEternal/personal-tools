(() => {
  const DEG=Math.PI/180;
  const LAND=[
    [[-168,71],[-150,60],[-130,55],[-124,47],[-117,33],[-104,22],[-96,18],[-88,20],[-82,28],[-76,36],[-66,45],[-55,52],[-60,63],[-82,72],[-110,78],[-142,76]],
    [[-82,12],[-72,11],[-60,7],[-48,2],[-36,-9],[-39,-23],[-49,-35],[-56,-52],[-68,-55],[-74,-38],[-77,-20],[-81,-3]],
    [[-18,36],[4,37],[24,34],[39,25],[51,11],[43,-12],[34,-27],[18,-35],[4,-31],[-8,-18],[-16,4]],
    [[-11,36],[-5,50],[12,60],[32,70],[65,76],[105,72],[139,64],[170,52],[164,40],[145,31],[126,22],[111,8],[93,9],[80,21],[65,25],[52,34],[39,38],[27,35],[17,43],[6,42]],
    [[112,-11],[129,-10],[145,-14],[154,-26],[151,-39],[135,-44],[119,-38],[112,-26]],
    [[-73,60],[-55,59],[-34,65],[-19,77],[-29,84],[-51,83],[-64,75]],
    [[43,-13],[50,-17],[50,-26],[46,-25],[43,-18]],
    [[130,31],[143,34],[146,43],[139,45],[132,39]]
  ];
  const DESERT=[
    [[-16,16],[4,28],[29,31],[36,20],[30,12],[4,10]],
    [[36,19],[56,30],[66,25],[55,16],[43,12]],
    [[112,-20],[139,-18],[143,-30],[124,-34],[114,-28]],
    [[67,35],[91,44],[106,39],[95,29],[74,29]]
  ];
  const wrapLon=lon=>{while(lon>180)lon-=360;while(lon<-180)lon+=360;return lon;};
  function inside(lon,lat,poly){
    let yes=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];
      if(((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-9)+xi))yes=!yes;
    }
    return yes;
  }
  const norm=v=>{const m=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/m,y:v.y/m,z:v.z/m};};
  const mix=(a,b,t)=>a+(b-a)*t;
  const mixColor=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];
  const byte=x=>Math.max(0,Math.min(255,Math.round(x)));

  window.createEarthGlobeRenderer=function(){
    const texture=document.createElement('canvas');
    const tctx=texture.getContext('2d',{alpha:true});
    const SIZE=192,MAP_W=360,MAP_H=180;
    texture.width=texture.height=SIZE;

    // Geographic classification is precomputed once. Globe rebuilds no longer
    // run polygon intersection tests for every rendered pixel.
    const surface=new Uint8Array(MAP_W*MAP_H);
    for(let y=0;y<MAP_H;y++){
      const lat=89.5-y;
      for(let x=0;x<MAP_W;x++){
        const lon=x-179.5,polar=Math.abs(lat)>70;
        const land=polar||LAND.some(p=>inside(lon,lat,p));
        const desert=land&&!polar&&DESERT.some(p=>inside(lon,lat,p));
        surface[y*MAP_W+x]=polar?3:desert?2:land?1:0;
      }
    }
    const surfaceAt=(lon,lat)=>{
      const x=Math.max(0,Math.min(MAP_W-1,Math.floor(wrapLon(lon)+180)));
      const y=Math.max(0,Math.min(MAP_H-1,Math.floor(90-lat)));
      return surface[y*MAP_W+x];
    };

    let cacheKey='';
    function inverseCamera(cam,yaw,pitch){
      const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
      const y1=cp*cam.y+sp*cam.z,z=-sp*cam.y+cp*cam.z;
      return{x:cy*cam.x+sy*y1,y:-sy*cam.x+cy*y1,z};
    }
    const q=(v,step)=>Math.round(v/step);
    function build(yaw,pitch,rotation){
      const key=`${q(yaw,.012)}|${q(pitch,.012)}|${q(rotation,.018)}`;
      if(key===cacheKey)return;
      cacheKey=key;
      const image=tctx.createImageData(SIZE,SIZE),data=image.data,half=SIZE/2;
      const light=norm({x:-.48,y:.38,z:.79}),cr=Math.cos(rotation),sr=Math.sin(rotation);

      for(let py=0;py<SIZE;py++){
        const sy=((py+.5)-half)/half;
        for(let px=0;px<SIZE;px++){
          const sx=((px+.5)-half)/half,rr=sx*sx+sy*sy,idx=(py*SIZE+px)*4;
          if(rr>1){data[idx+3]=0;continue;}
          const cam={x:sx,y:-sy,z:Math.sqrt(Math.max(0,1-rr))};
          const w=inverseCamera(cam,yaw,pitch);
          const bx=cr*w.x+sr*w.y,by=-sr*w.x+cr*w.y,bz=w.z;
          const lon=wrapLon(Math.atan2(by,bx)/DEG);
          const lat=Math.asin(Math.max(-1,Math.min(1,bz)))/DEG;
          const kind=surfaceAt(lon,lat),land=kind>0,polar=kind===3,desert=kind===2;

          let base;
          if(polar)base=[226,240,244];
          else if(desert)base=[177,154,86];
          else if(land){
            const lush=.5+.5*Math.sin((lon*.10+lat*.17)*DEG*10);
            base=mixColor([52,103,49],[92,133,62],lush*.55);
          }else{
            const deep=.45+.55*Math.max(0,-lat/90);
            base=mixColor([10,70,122],[13,92,154],deep);
          }

          const diffuse=Math.max(0,cam.x*light.x+cam.y*light.y+cam.z*light.z);
          let illumination=.27+.80*diffuse;
          illumination*=.78+.22*Math.pow(Math.max(0,cam.z),.38);
          if(!land&&!polar){
            const spec=Math.pow(diffuse,18)*Math.pow(cam.z,3);
            base=mixColor(base,[175,222,241],spec*.55);
          }

          const cloudNoise=
            Math.sin((lon*.16+lat*.09+rotation/DEG*.22)*DEG*8)+
            .65*Math.sin((lon*.07-lat*.21)*DEG*11)+
            .35*Math.sin((lon+lat*1.7)*DEG*17);
          const band=Math.exp(-Math.pow(lat/34,2));
          const cloud=cloudNoise>1.05?Math.min(.58,(cloudNoise-1.05)*.48+band*.08):0;
          if(cloud>0)base=mixColor(base,[236,245,248],cloud);
          const city=land&&!polar&&diffuse<.06&&Math.sin(lon*2.7*DEG+lat*4.1*DEG)*Math.sin(lon*5.3*DEG-lat*1.9*DEG)>.72;

          data[idx]=byte(base[0]*illumination+(city?46:0));
          data[idx+1]=byte(base[1]*illumination+(city?34:0));
          data[idx+2]=byte(base[2]*illumination+(city?10:0));
          data[idx+3]=byte(255*(rr>.965?Math.max(0,(1-rr)/.035):1));
        }
      }
      tctx.putImageData(image,0,0);
    }

    return function(ctx,{x,y,radius,yaw,pitch,rotation}){
      if(!Number.isFinite(radius)||radius<=0)return;
      build(yaw,pitch,rotation);
      ctx.save();ctx.shadowColor='rgba(74,169,255,.72)';ctx.shadowBlur=Math.max(10,radius*.13);
      ctx.drawImage(texture,x-radius,y-radius,radius*2,radius*2);ctx.restore();

      const atm=ctx.createRadialGradient(x,y,radius*.91,x,y,radius*1.08);
      atm.addColorStop(0,'rgba(83,177,255,0)');atm.addColorStop(.68,'rgba(87,185,255,.04)');atm.addColorStop(.83,'rgba(95,194,255,.27)');atm.addColorStop(1,'rgba(95,194,255,0)');
      ctx.fillStyle=atm;ctx.beginPath();ctx.arc(x,y,radius*1.08,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(151,216,255,.50)';ctx.lineWidth=Math.max(1.1,radius*.008);
      ctx.beginPath();ctx.arc(x,y,radius+ctx.lineWidth*.3,0,Math.PI*2);ctx.stroke();
    };
  };
})();