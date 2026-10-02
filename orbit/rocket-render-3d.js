(() => {
  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Rocket shader compile failed');
    }
    return shader;
  }

  function program(gl, vsSource, fsSource) {
    const p = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || 'Rocket shader link failed');
    }
    return p;
  }

  const VS = `
    attribute vec3 a_position;
    attribute vec3 a_normal;
    attribute vec3 a_color;
    uniform mat3 u_rotation;
    varying vec3 v_normal;
    varying vec3 v_color;
    varying vec3 v_viewPos;
    void main() {
      vec3 p = u_rotation * a_position;
      v_normal = normalize(u_rotation * a_normal);
      v_color = a_color;
      v_viewPos = p;
      gl_Position = vec4(p.xy * 0.78, p.z * 0.22, 1.0);
    }
  `;

  const FS = `
    precision mediump float;
    varying vec3 v_normal;
    varying vec3 v_color;
    varying vec3 v_viewPos;
    void main() {
      vec3 n = normalize(v_normal);
      vec3 lightDir = normalize(vec3(-0.35, 0.72, 0.78));
      float diffuse = max(dot(n, lightDir), 0.0);
      float rim = pow(1.0 - abs(n.z), 2.0);
      vec3 color = v_color * (0.46 + 0.62 * diffuse) + vec3(0.10, 0.14, 0.18) * rim * 0.16;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function pushTri(out, a, b, c, n, color) {
    [a,b,c].forEach(p => {
      out.push(p[0],p[1],p[2], n[0],n[1],n[2], color[0],color[1],color[2]);
    });
  }

  function buildGeometry() {
    const data = [];
    const seg = 16;
    const white = [0.90,0.94,0.97];
    const white2 = [0.76,0.82,0.87];
    const red = [0.86,0.18,0.22];
    const blue = [0.16,0.58,0.84];
    const dark = [0.22,0.27,0.32];

    function ring(x, r, colorA, colorB=colorA) {
      for (let i=0;i<seg;i++) {
        const a0 = Math.PI*2*i/seg, a1 = Math.PI*2*(i+1)/seg;
        const y0=Math.cos(a0)*r,z0=Math.sin(a0)*r,y1=Math.cos(a1)*r,z1=Math.sin(a1)*r;
        const x2=x[1], x1=x[0];
        const p00=[x1,y0,z0],p01=[x1,y1,z1],p10=[x2,y0,z0],p11=[x2,y1,z1];
        const nm=[0,Math.cos((a0+a1)/2),Math.sin((a0+a1)/2)];
        pushTri(data,p00,p10,p11,nm,colorA); pushTri(data,p00,p11,p01,nm,colorB);
      }
    }

    ring([-0.58,0.38],0.205,white,white);
    ring([-0.72,-0.58],0.19,white2,white2);
    ring([0.04,0.18],0.211,blue,blue);
    ring([0.38,0.56],0.205,white,white);
    for (let i=0;i<seg;i++) {
      const a0=Math.PI*2*i/seg,a1=Math.PI*2*(i+1)/seg;
      const p0=[0.56,Math.cos(a0)*0.205,Math.sin(a0)*0.205];
      const p1=[0.56,Math.cos(a1)*0.205,Math.sin(a1)*0.205];
      const tip=[0.92,0,0];
      const mid=(a0+a1)/2;
      const n=[0.50,Math.cos(mid)*0.86,Math.sin(mid)*0.86];
      pushTri(data,p0,tip,p1,n,red);
    }

    for (let i=0;i<seg;i++) {
      const a0=Math.PI*2*i/seg,a1=Math.PI*2*(i+1)/seg;
      pushTri(data,[-0.72,0,0],[-0.72,Math.cos(a1)*0.16,Math.sin(a1)*0.16],[-0.72,Math.cos(a0)*0.16,Math.sin(a0)*0.16],[-1,0,0],dark);
    }

    const finAngles=[0,Math.PI/2,Math.PI,Math.PI*1.5];
    finAngles.forEach(a=>{
      const ry=Math.cos(a), rz=Math.sin(a);
      const ty=-rz, tz=ry;
      const p0=[-0.58,ry*0.17,rz*0.17];
      const p1=[-0.18,ry*0.18,rz*0.18];
      const p2=[-0.67,ry*0.44,rz*0.44];
      const n=[0,ty,tz];
      pushTri(data,p0,p1,p2,n,red);
      pushTri(data,p0,p2,p1,[-n[0],-n[1],-n[2]],red);
    });

    return new Float32Array(data);
  }

  function rotationMatrix(angle, tilt, roll) {
    const cz=Math.cos(angle),sz=Math.sin(angle);
    const cy=Math.cos(-tilt),sy=Math.sin(-tilt);
    const cx=Math.cos(roll),sx=Math.sin(roll);
    return new Float32Array([
      cz*cy,                       sz*cy,                      -sy,
      cz*sy*sx - sz*cx,           sz*sy*sx + cz*cx,          cy*sx,
      cz*sy*cx + sz*sx,           sz*sy*cx - cz*sx,          cy*cx
    ]);
  }

  window.createRocketRenderer3D = function createRocketRenderer3D() {
    const c = document.createElement('canvas');
    const size = 128;
    c.width=size; c.height=size;
    let gl;
    try {
      gl=c.getContext('webgl',{alpha:true,antialias:true,depth:true,stencil:false,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:'low-power'});
    } catch (_) {}
    if (!gl) return null;

    let prog;
    try { prog=program(gl,VS,FS); }
    catch (e) { console.warn('3D rocket renderer unavailable:',e); return null; }

    const geo=buildGeometry();
    const stride=9*4;
    const buffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,geo,gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(prog,'a_position');
    const norm=gl.getAttribLocation(prog,'a_normal');
    const color=gl.getAttribLocation(prog,'a_color');
    [pos,norm,color].forEach(x=>gl.enableVertexAttribArray(x));
    gl.vertexAttribPointer(pos,3,gl.FLOAT,false,stride,0);
    gl.vertexAttribPointer(norm,3,gl.FLOAT,false,stride,3*4);
    gl.vertexAttribPointer(color,3,gl.FLOAT,false,stride,6*4);
    const rot=gl.getUniformLocation(prog,'u_rotation');
    gl.viewport(0,0,size,size);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    return function drawRocket3D(ctx,{x,y,size:drawSize=38,angle=0,tilt=0,roll=.34}) {
      gl.useProgram(prog);
      gl.clearColor(0,0,0,0);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(rot,false,rotationMatrix(angle,tilt,roll));
      gl.drawArrays(gl.TRIANGLES,0,geo.length/9);
      const s=Math.max(22,drawSize);
      ctx.save();
      ctx.shadowColor='rgba(120,195,255,.45)';
      ctx.shadowBlur=Math.max(4,s*.14);
      ctx.drawImage(c,x-s/2,y-s/2,s,s);
      ctx.restore();
    };
  };
})();
