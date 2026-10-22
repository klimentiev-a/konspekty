/* ============ 3D: сцена, земля, свет, камера, ввод ============ */
var cv=$('#cv'),W=0,H=0,GR=null,TREES=[],QL=2,FOVD=32;
var cam={tx:18.5,tz:18.5,dist:60,yaw:.78,pitch:.95,minD:6,maxD:95};
var cutLight,renderer,scene,camera,sun,hemi,sunTarget,groundTex,groundCv,waterMesh,slabMesh,treeG;
var PITCHES=[.55,.95,1.3];
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function lotAt(i,j){var bx=Math.floor((i-1)/R),by=Math.floor((j-1)/R),lx=(i-1)%R,ly=(j-1)%R;return S.lots[(by*6+bx)*4+((ly>=3?1:0)*2+(lx>=3?1:0))]}
function initGround(){GR=new Uint8Array(N*N);var r=mulberry(77);TREES=[];
  for(var j=0;j<N;j++)for(var i=0;i<N;i++){var v;if(i%R===0&&j%R===0)v=3;else if(isRoad(i,j))v=2;else{var lx=(i-1)%R,ly=(j-1)%R;if(lx!==2&&ly!==2&&lx<5&&ly<5)v=4;else{v=(i+j)&1?1:0;if(r()<.34)TREES.push([i+.25+r()*.5,j+.25+r()*.5,r()])}}GR[j*N+i]=v}}

/* --- материалы и мелочи --- */
var MC={};function MAT(c,o){var k=c+(o?JSON.stringify(o):''),m=MC[k];if(!m){m=new THREE.MeshLambertMaterial(Object.assign({color:c},o||{}));MC[k]=m}return m}
var GEO={box:new THREE.BoxGeometry(1,1,1),cyl:new THREE.CylinderGeometry(1,1,1,10),cone4:new THREE.ConeGeometry(1,1,4),cone8:new THREE.ConeGeometry(1,1,8),sph:new THREE.SphereGeometry(1,12,9),ico:new THREE.IcosahedronGeometry(1,0)};
function bx(w,h,d,x,y,z,mat,par){var m=new THREE.Mesh(GEO.box,mat);m.scale.set(w,h,d);m.position.set(x,y+h/2,z);m.castShadow=true;m.receiveShadow=true;if(par)par.add(m);return m}
function cyl(r,h,x,y,z,mat,par,seg){var m=new THREE.Mesh(GEO.cyl,mat);m.scale.set(r,h,r);m.position.set(x,y+h/2,z);m.castShadow=true;if(par)par.add(m);return m}

/* --- земля: одна текстура --- */
function drawGroundTex(){var T=32,c=groundCv,g=c.getContext('2d'),r=mulberry(5);
  for(var j=0;j<N;j++)for(var i=0;i<N;i++){var v=GR[j*N+i],x=i*T,y=j*T,col;
    if(v===2||v===3)col='#4a4f57';else if(v===4){var lt=lotAt(i,j).type;col=lt==='park'?'#7dbb64':lt==='empty'?'#d8d0b2':(lt==='house'?'#8cc46c':'#c4c4ba')}else col=(i+j)&1?'#86bb68':'#7fb461';
    g.fillStyle=col;g.fillRect(x,y,T,T);
    if(v<2||(v===4&&(lotAt(i,j).type==='park'))){for(var q=0;q<5;q++){g.fillStyle=r()<.5?'rgba(255,255,255,.07)':'rgba(0,50,0,.07)';g.fillRect(x+r()*T,y+r()*T,3+r()*4,3+r()*4)}}}
  /* тротуары и разметка */
  for(var j2=0;j2<N;j2++)for(var i2=0;i2<N;i2++){var v2=GR[j2*N+i2];if(v2>=2&&v2<4&&v2!==3||v2===3){}
    if(v2===2||v2===3){var x2=i2*T,y2=j2*T;
      var nb=[[0,-1,x2,y2,T,5],[0,1,x2,y2+T-5,T,5],[-1,0,x2,y2,5,T],[1,0,x2+T-5,y2,5,T]];
      nb.forEach(function(n){var a=i2+n[0],b=j2+n[1];if(a<0||b<0||a>=N||b>=N)return;if(!isRoad(a,b)){g.fillStyle='#b9b6ab';g.fillRect(n[2],n[3],n[4],n[5])}});
      if(v2===2){g.fillStyle='#e8e4c8';var hz=(j2%R===0);if(hz){g.fillRect(x2+T*.25,y2+T/2-1,T*.5,2)}else{g.fillRect(x2+T/2-1,y2+T*.25,2,T*.5)}}
      else{g.fillStyle='rgba(255,255,255,.55)';for(var s=0;s<4;s++){g.fillRect(x2+4+s*7,y2+1,4,4);g.fillRect(x2+4+s*7,y2+T-5,4,4);g.fillRect(x2+1,y2+4+s*7,4,4);g.fillRect(x2+T-5,y2+4+s*7,4,4)}}}}
  groundTex.needsUpdate=true}
function initScene(){
  renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,powerPreference:'high-performance'});
  scene=new THREE.Scene();scene.background=new THREE.Color('#a8d8ee');scene.fog=new THREE.Fog('#a8d8ee',90,210);
  camera=new THREE.PerspectiveCamera(FOVD,1,.5,500);
  hemi=new THREE.HemisphereLight('#cfe8ff','#7a8a66',1.1);scene.add(hemi);
  cutLight=new THREE.PointLight('#ffd9a0',0,7,1.6);scene.add(cutLight);sun=new THREE.DirectionalLight('#fff4e0',2.4);sunTarget=new THREE.Object3D();sunTarget.position.set(18.5,0,18.5);scene.add(sunTarget);sun.target=sunTarget;scene.add(sun);
  var sc=sun.shadow.camera;sc.left=-30;sc.right=30;sc.top=30;sc.bottom=-30;sc.near=1;sc.far=180;sun.shadow.bias=-.0006;sun.shadow.normalBias=.03;
  groundCv=document.createElement('canvas');groundCv.width=groundCv.height=N*32;groundTex=new THREE.CanvasTexture(groundCv);groundTex.colorSpace=THREE.SRGBColorSpace;groundTex.anisotropy=4;
  var gm=new THREE.Mesh(new THREE.PlaneGeometry(N,N),new THREE.MeshLambertMaterial({map:groundTex}));gm.rotation.x=-Math.PI/2;gm.position.set(N/2,0,N/2);gm.receiveShadow=true;scene.add(gm);
  slabMesh=new THREE.Mesh(GEO.box,new THREE.MeshLambertMaterial({color:'#8a6a4a'}));slabMesh.scale.set(N+.6,.9,N+.6);slabMesh.position.set(N/2,-.46,N/2);scene.add(slabMesh);
  waterMesh=new THREE.Mesh(new THREE.PlaneGeometry(900,900),new THREE.MeshLambertMaterial({color:'#5fa6c8'}));waterMesh.rotation.x=-Math.PI/2;waterMesh.position.set(N/2,-.7,N/2);scene.add(waterMesh);
  initGround();drawGroundTex();buildTrees();buildLamps();setQuality(QL);resize();GPUN=gpuName();if(/swiftshader|llvmpipe|basic render|software/i.test(GPUN)){QL=0;setQuality(0);setTimeout(function(){toast('Браузер рисует без видеокарты ('+GPUN+'). Включи аппаратное ускорение в настройках браузера — тогда лагать не будет.','warn')},1500)}}
/* --- деревья и фонари (instanced) --- */
var TRM=null,TRC=null,TRP=null,lampHead=null;
function buildTrees(){if(treeG)scene.remove(treeG);treeG=new THREE.Group();var n=TREES.length;
  TRM=new THREE.InstancedMesh(GEO.cyl,MAT('#6b4a2b'),n);TRC=new THREE.InstancedMesh(GEO.ico,new THREE.MeshLambertMaterial({color:'#ffffff',flatShading:true}),n);TRP=null;
  var m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),sc=new THREE.Vector3(),col=new THREE.Color(),r=mulberry(9);
  TREES.forEach(function(t,i){var h=.5+t[2]*.45,rad=.22+t[2]*.12;p.set(t[0],h*.5,t[1]);sc.set(.045,h,.045);m.compose(p,q,sc);TRM.setMatrixAt(i,m);
    p.set(t[0],h+rad*.7,t[1]);sc.set(rad,rad*(1.0+r()*.3),rad);q.setFromEuler(new THREE.Euler(0,r()*6,0));m.compose(p,q,sc);TRC.setMatrixAt(i,m);col.setHSL(.27+r()*.07,.45,.32+r()*.1);TRC.setColorAt(i,col)});
  TRM.castShadow=TRC.castShadow=true;treeG.add(TRM);treeG.add(TRC);scene.add(treeG)}
function buildLamps(){var pts=[];for(var a=0;a<=N;a+=3)for(var b=0;b<=N;b+=R){if(a%R===0&&b%R===0)continue;pts.push([a+.5,b+.12]);pts.push([b+.12,a+.5])}
  for(var i=0;i<=N;i+=R)for(var j=0;j<=N;j+=R){pts.push([i+.15,j+.15])}
  var pole=new THREE.InstancedMesh(GEO.cyl,MAT('#40444a'),pts.length);lampHead=new THREE.InstancedMesh(GEO.sph,new THREE.MeshBasicMaterial({color:'#ffffff'}),pts.length);
  var m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),sc=new THREE.Vector3();
  pts.forEach(function(t,i){p.set(t[0],.35,t[1]);sc.set(.02,.7,.02);m.compose(p,q,sc);pole.setMatrixAt(i,m);p.set(t[0],.74,t[1]);sc.set(.07,.07,.07);m.compose(p,q,sc);lampHead.setMatrixAt(i,m)});
  scene.add(pole);scene.add(lampHead);lampHead.userData.n=pts.length}

/* --- день и ночь --- */
var FACM=[],_dk=-1,C1=new THREE.Color(),C2=new THREE.Color(),SKY_D=new THREE.Color('#a8d8ee'),SKY_S=new THREE.Color('#f2a574'),SKY_N=new THREE.Color('#0e1736'),SUN_L=new THREE.Color('#ffcf94'),SUN_H=new THREE.Color('#fff6e6'),MOON=new THREE.Color('#8fa4e8');
var DAYK=1,EMI=0;
function daylight(){var h=(S.t%1440)/60,se=Math.sin((h-6)/13.5*Math.PI),d=clamp((se+.14)/.5,0,1),k=Math.round(h*10);if(k===_dk)return;_dk=k;DAYK=d;renderer.shadowMap.needsUpdate=true;
  var dusk=clamp(1-Math.abs(d-.4)/.4,0,1)*(1-clamp(se*2,0,1)*.6);
  C1.copy(SKY_N).lerp(SKY_D,d).lerp(SKY_S,dusk*.55);scene.background.copy(C1);scene.fog.color.copy(C1);
  hemi.intensity=.55+.65*d;hemi.color.set('#9fb2e8').lerp(C2.set('#d6ecff'),d);hemi.groundColor.set('#1c2038').lerp(C2.set('#7a8a66'),d);
  var az=(h-6)/13.5*Math.PI;
  if(d>.06){sun.color.copy(SUN_L).lerp(SUN_H,clamp(se,0,1));sun.intensity=.2+2.4*d;sun.position.set(18.5-Math.cos(az)*48,10+Math.max(se,.1)*46,18.5+16)}
  else{sun.color.copy(MOON);sun.intensity=.7;sun.position.set(-8,50,52)}
  waterMesh.material.color.set('#2c4f7a').lerp(C2.set('#5fa6c8'),d);
  var nf=1-d,ei=clamp((nf-.25)*1.5,0,1.15);EMI=ei;FACM.forEach(function(m){m.emissiveIntensity=ei});
  if(lampHead)lampHead.material.color.set('#3a3d44').lerp(C2.set('#ffe9a8'),clamp((nf-.3)*1.6,0,1))}

/* --- размер и качество --- */
function setQuality(l){QL=l;var sh=l>=2;renderer.shadowMap.enabled=sh;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.shadowMap.type=THREE.PCFShadowMap;sun.castShadow=sh;
  if(sh&&!sun.shadow.map){sun.shadow.mapSize.set(2048,2048)}
  scene.traverse(function(o){if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(function(m){m.needsUpdate=true})}});resize()}
function resize(){var r=cv.parentElement.getBoundingClientRect();W=r.width;H=r.height;if(!renderer)return;var dpr=Math.min(window.devicePixelRatio||1,QL>=2?1.5:QL===1?1.25:1);renderer.setPixelRatio(dpr);renderer.setSize(W,H,false);camera.aspect=W/H;camera.updateProjectionMatrix()}
var qAcc=0,qN=0,qLast=0,QAUTO=true,fpsN=0,fpsT=0,GPUN='',QN=['низкое','среднее','высокое'];
function gpuName(){try{var gl=renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e?String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)):''}catch(er){return ''}}
function fpsTick(dt,now){fpsN++;fpsT+=dt;if(fpsT>=.8){var el=$('#fps');if(el){var f=Math.round(fpsN/fpsT);el.textContent=f+' fps · '+QN[QL];el.style.color=f<30?'#ff8a80':'#fff'}fpsN=0;fpsT=0}}
function cycleQ(){QAUTO=false;setQuality((QL+2)%3)}
function qualityWatch(dt,now){fpsTick(dt,now);if(FF||document.hidden||!QAUTO)return;qAcc+=dt;qN++;if(qN>=90){var avg=qAcc/qN;qAcc=0;qN=0;if(now-qLast>2500){if(avg>.034&&QL>0){qLast=now;setQuality(QL-1)}}}}

/* --- камера --- */
function applyCam(){cam.dist=clamp(cam.dist,cam.minD,cam.maxD);cam.pitch=clamp(cam.pitch,.35,1.4);cam.tx=clamp(cam.tx,0,N);cam.tz=clamp(cam.tz,0,N);
  var cp=Math.cos(cam.pitch);camera.position.set(cam.tx+cam.dist*cp*Math.sin(cam.yaw),cam.dist*Math.sin(cam.pitch),cam.tz+cam.dist*cp*Math.cos(cam.yaw));camera.lookAt(cam.tx,0,cam.tz)}
function fitCam(){cam.tx=cam.tz=N/2;cam.yaw=.78;cam.pitch=.95;var asp=W/Math.max(1,H),t=Math.tan(FOVD*Math.PI/360),need=N*.62;cam.dist=clamp(need/(t*Math.min(asp*.92,1.5))*(asp<1?1.12:1.08),20,cam.maxD);fly=null;follow=-1}
var fly=null,follow=-1;
function flyTo(u,v,d){fly={tx:u,tz:v,d:d||20,n:0,a:cam.tx,b:cam.tz,d0:cam.dist}}
function stepFly(){if(!fly)return;fly.n+=.07;var k=Math.min(1,fly.n),e=1-Math.pow(1-k,3);cam.tx=fly.a+(fly.tx-fly.a)*e;cam.tz=fly.b+(fly.tz-fly.b)*e;cam.dist=fly.d0+(fly.d-fly.d0)*e;if(k>=1)fly=null}
function stepFollow(){if(follow<0)return;var p=P(follow);if(!p){follow=-1;return}var ps=pPos(p);cam.tx+=(ps[0]-cam.tx)*.12;cam.tz+=(ps[1]-cam.tz)*.12}
function zoomBy(f){cam.dist*=1/f;fly=null}
function rotBy(a){cam.yaw+=a;fly=null}
function cyclePitch(){var i=0,b=9;PITCHES.forEach(function(p,k){if(Math.abs(p-cam.pitch)<b){b=Math.abs(p-cam.pitch);i=k}});cam.pitch=PITCHES[(i+1)%PITCHES.length]}
/* --- ввод --- */
var RC=new THREE.Raycaster(),PLN=new THREE.Plane(new THREE.Vector3(0,1,0),0),V3=new THREE.Vector3(),V2=new THREE.Vector2();
function lp(e){var r=cv.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]}
function groundPt(x,y){V2.set(x/W*2-1,-(y/H)*2+1);RC.setFromCamera(V2,camera);var o=new THREE.Vector3();return RC.ray.intersectPlane(PLN,o)?o:null}
var ptrs={},nP=0,moved=false,pinch=null,pan0=null,rotM=false;
cv.addEventListener('contextmenu',function(e){e.preventDefault()});
cv.addEventListener('pointerdown',function(e){cv.setPointerCapture(e.pointerId);var p=lp(e);ptrs[e.pointerId]={x:p[0],y:p[1],sx:p[0],sy:p[1],btn:e.button};nP=Object.keys(ptrs).length;fly=null;follow=-1;
  if(nP===1){moved=false;rotM=e.button===2||e.shiftKey||e.ctrlKey;applyCam();camera.updateMatrixWorld();pan0=groundPt(p[0],p[1])}
  if(nP===2){var a=Object.values(ptrs);pinch={d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),dist:cam.dist,ang:Math.atan2(a[1].y-a[0].y,a[1].x-a[0].x),yaw:cam.yaw};moved=true;pan0=null}});
cv.addEventListener('pointermove',function(e){var q=ptrs[e.pointerId];if(!q)return;var p=lp(e);
  if(nP===1){if(Math.hypot(p[0]-q.sx,p[1]-q.sy)>6)moved=true;
    if(moved){if(rotM){cam.yaw-=(p[0]-q.x)*.007;cam.pitch+=(p[1]-q.y)*.006}else if(pan0){var g=groundPt(p[0],p[1]);if(g){cam.tx+=pan0.x-g.x;cam.tz+=pan0.z-g.z;applyCam();camera.updateMatrixWorld()}}}}
  else if(nP===2&&pinch){q.x=p[0];q.y=p[1];var a=Object.values(ptrs),d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),an=Math.atan2(a[1].y-a[0].y,a[1].x-a[0].x);cam.dist=pinch.dist*pinch.d/Math.max(20,d);cam.yaw=pinch.yaw-(an-pinch.ang)}
  q.x=p[0];q.y=p[1]});
function pend(e){var q=ptrs[e.pointerId];if(!q)return;if(nP===1&&!moved)tap(q.x,q.y);delete ptrs[e.pointerId];nP=Object.keys(ptrs).length;if(nP<2)pinch=null;if(nP===1){moved=true;pan0=null}}
cv.addEventListener('pointerup',pend);cv.addEventListener('pointercancel',pend);
cv.addEventListener('wheel',function(e){e.preventDefault();if(e.ctrlKey||e.shiftKey){cam.yaw+=e.deltaY*.003}else cam.dist*=Math.exp(e.deltaY*.0013);fly=null},{passive:false});
/* --- выбор --- */
var PICKS=[];
function pickP(x,y){var best=null,bd=1e9;S.people.forEach(function(p){if(!visP(p))return;var ps=pPos(p);V3.set(ps[0],.32,ps[1]);var dc=V3.distanceTo(camera.position);V3.project(camera);if(V3.z>1)return;var sx=(V3.x+1)/2*W,sy=(1-V3.y)/2*H,ppu=H/(2*Math.tan(FOVD*Math.PI/360)*dc),rad=Math.max(15,.5*ppu),d=Math.hypot(sx-x,sy-y);if(d<rad&&d<bd){bd=d;best=p}});return best}
function pickL(x,y){V2.set(x/W*2-1,-(y/H)*2+1);RC.setFromCamera(V2,camera);var hit=RC.intersectObjects(PICKS,false);return hit.length?hit[0].object.userData.L:null}
function tap(x,y){applyCam();camera.updateMatrixWorld();var p=pickP(x,y);if(p){selP(p);return}var L=pickL(x,y);if(L){selL(L);flyTo(L.x+1,L.y+1,Math.min(cam.dist,17));return}selClear()}

var lastIn=0;['pointerdown','pointermove','wheel','keydown','touchstart'].forEach(function(e){window.addEventListener(e,function(){lastIn=performance.now()},{passive:true})});
