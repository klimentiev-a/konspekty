/* ============ 3D: здания ============ */
var LG=[],FACT={},GBL={},SIGT={};
function sh(h,f){var c=new THREE.Color(h).multiplyScalar(f);return '#'+c.getHexString()}
function facade(wall,floors,cols,seed,glass,wide){var k=[wall,floors,cols,seed%4,glass,wide].join('|');if(FACT[k])return FACT[k];
  var c=document.createElement('canvas');c.width=c.height=128;var g=c.getContext('2d'),e=document.createElement('canvas');e.width=e.height=128;var ge=e.getContext('2d'),r=mulberry(seed*13+3);
  g.fillStyle=wall;g.fillRect(0,0,128,128);ge.fillStyle='#000';ge.fillRect(0,0,128,128);
  var mx=8,my=6,cw=(128-2*mx)/cols,ch=(128-2*my)/floors;
  for(var i=0;i<floors;i++)for(var j=0;j<cols;j++){var ww=cw*(wide?.8:.56),wh=ch*.56,x=mx+j*cw+(cw-ww)/2,y=my+i*ch+(ch-wh)/2;
    if(wide&&i===floors-1){ww=cw*.86;wh=ch*.62;x=mx+j*cw+(cw-ww)/2}
    g.fillStyle='rgba(0,0,0,.18)';g.fillRect(x-1,y-1,ww+2,wh+3);g.fillStyle=glass;g.fillRect(x,y,ww,wh);g.fillStyle='rgba(255,255,255,.28)';g.fillRect(x,y,ww*.4,wh*.5);g.fillStyle='rgba(0,0,0,.22)';g.fillRect(x+ww/2-.5,y,1,wh);
    if(r()<.55){ge.fillStyle=r()<.5?'#ffd27a':'#ffe9b0';ge.fillRect(x,y,ww,wh)}}
  var t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;var te=new THREE.CanvasTexture(e);te.colorSpace=THREE.SRGBColorSpace;
  var m=new THREE.MeshLambertMaterial({map:t,emissive:'#ffffff',emissiveMap:te,emissiveIntensity:EMI});FACM.push(m);FACT[k]=m;return m}
function gable(w,h,d){var k=w+'_'+h+'_'+d,g=GBL[k];if(g)return g;var sp=new THREE.Shape();sp.moveTo(-w/2,0);sp.lineTo(w/2,0);sp.lineTo(0,h);sp.closePath();g=new THREE.ExtrudeGeometry(sp,{depth:d,bevelEnabled:false});g.translate(0,0,-d/2);GBL[k]=g;return g}
function roofG(w,h,d,mat,x,y,z,par,rot){var m=new THREE.Mesh(gable(w,h,d),mat);m.position.set(x,y,z);if(rot)m.rotation.y=Math.PI/2;m.castShadow=true;par.add(m);return m}
function boxM(wall,wallTop,fl){var s=MAT(wall);return [s,s,MAT(wallTop),MAT(fl||'#777'),s,s]}
function facBox(w,h,d,x,y,z,fm,top,par){var m=new THREE.Mesh(GEO.box,[fm,fm,MAT(top),MAT('#666'),fm,fm]);m.scale.set(w,h,d);m.position.set(x,y+h/2,z);m.castShadow=m.receiveShadow=true;par.add(m);return m}
function signTex(ic,bg){var k='s'+ic+bg;if(SIGT[k])return SIGT[k];var c=document.createElement('canvas');c.width=128;c.height=64;var g=c.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,128,64);g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=4;g.strokeRect(3,3,122,58);g.font='40px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(ic,64,36);var t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;SIGT[k]=t;return t}
function door(par,x,z,w,h,col){bx(w,h,.06,x,0,z,MAT(col||'#5a4636'),par)}
function bush(par,x,z,r){var m=new THREE.Mesh(GEO.ico,MAT('#4f9a4b',{flatShading:true}));m.scale.set(r,r*.8,r);m.position.set(x,r*.7,z);m.castShadow=true;par.add(m)}
function smokeP(par,x,y,z){var a=[];for(var i=0;i<3;i++){var m=new THREE.Mesh(GEO.sph,MAT('#8a8a8a',{transparent:true,opacity:.6}));m.visible=false;m.userData.keep=1;par.add(m);a.push(m)}return {x:x,y:y,z:z,m:a}}

var BUILD={};
BUILD.house=function(L,sh_,P_){var g=sh_,c=P_.wall,rf=P_.roof,rot=L.v%2;
  bx(1.84,.05,1.84,0,0,0,MAT('#8cc46c'),g);
  var fm=facade(c,1,2,L.v,'#6f93ad');
  facBox(1.35,.95,1.2,0,.05,-.08,fm,sh(c,.9),g);
  roofG(1.5,.62,1.4,MAT(rf),0,1.0,-.08,g,rot);
  bx(.16,.4,.16,.35,.9,-.35,MAT('#8b5a4a'),g);
  door(g,L.doorX,.58,.22,.5);bx(.3,.04,.3,L.doorX,.05,.62,MAT('#d8d2c2'),g);
  bush(g,-.72,.7,.14);bush(g,.72,.72,.12);
  [[0,.88,1.8,.08],[0,-.88,1.8,.08],[-.9,0,.08,1.7],[.9,0,.08,1.7]].forEach(function(f,i){if(i===0)return;bx(f[2],.16,f[3],f[0],.05,f[1],MAT('#f4efe4'),g)});
  return 1.6};
BUILD.flat=function(L,g,P_){var fl=4+(L.v%3),h=fl*.72,c=P_.wall;
  bx(1.84,.05,1.84,0,0,0,MAT('#c4c4ba'),g);
  var fm=facade(c,fl,4,L.v,'#6f93ad');facBox(1.6,h,1.4,0,.05,-.1,fm,sh(P_.roof,1),g);
  bx(1.66,.1,1.46,0,h+.05,-.1,MAT(sh(P_.roof,.9)),g);bx(.4,.25,.4,-.4,h+.15,-.2,MAT('#9aa0a6'),g);
  bx(.5,.08,.35,L.doorX,.5,.68,MAT('#4a5560'),g);door(g,L.doorX,.6,.28,.46,'#4a3a2e');
  bush(g,.7,.78,.12);bush(g,-.7,.8,.12);return h+.3};
BUILD.shop=function(L,g,P_){var S0=SUB[L.sub||'grocery'],h=1.0;
  bx(1.84,.05,1.84,0,0,0,MAT('#c4c4ba'),g);
  var fm=facade(P_.wall,1,2,L.v,'#a9d6e8',1);facBox(1.7,h,1.3,0,.05,-.2,fm,sh(S0.col,.8),g);
  bx(1.74,.08,1.34,0,h+.05,-.2,MAT(sh(S0.col,.7)),g);
  var aw=new THREE.Mesh(GEO.box,MAT(S0.awn));aw.scale.set(1.7,.05,.5);aw.position.set(0,.74,.62);aw.rotation.x=.38;aw.castShadow=true;g.add(aw);
  var sg=new THREE.Mesh(new THREE.PlaneGeometry(.75,.375),new THREE.MeshBasicMaterial({map:signTex(S0.ic,S0.awn)}));sg.position.set(0,1.28,.46);g.add(sg);
  bx(.06,.28,.06,-.3,1.06,.45,MAT('#555'),g);bx(.06,.28,.06,.3,1.06,.45,MAT('#555'),g);
  door(g,L.doorX*.5,.46,.22,.52,'#3a3a3a');return 1.5};
BUILD.office=function(L,g,P_){var fl=5+(L.v%3),h=fl*.56;
  bx(1.84,.05,1.84,0,0,0,MAT('#c4c4ba'),g);
  var fm=facade(P_.wall,fl,5,L.v,'#35607f');facBox(1.5,h,1.5,0,.05,0,fm,'#556',g);
  facBox(.9,.5,.9,0,h+.05,0,fm,'#445',g);bx(.04,.5,.04,0,h+.55,0,MAT('#999'),g);
  bx(1.1,.1,.4,L.doorX*.6,.4,.75,MAT('#2a3a4a'),g);door(g,L.doorX*.6,.74,.4,.4,'#2a3a4a');
  bush(g,.75,.8,.12);bush(g,-.75,.8,.12);return h+.6};
BUILD.factory=function(L,g,P_){var c=P_.wall;
  bx(1.84,.05,1.84,0,0,0,MAT('#a8a8a0'),g);
  var fm=facade(c,1,4,L.v,'#556a7a');facBox(1.7,.9,1.3,0,.05,-.2,fm,'#7d7a74',g);
  for(var i=0;i<3;i++)roofG(.56,.34,1.3,MAT(P_.roof),-.57+i*.57,.95,-.2,g,1);
  cyl(.1,1.7,-.62,.05,-.7,MAT('#8a5a4a'),g);cyl(.12,.1,-.62,1.7,-.7,MAT('#5a3a30'),g);
  bx(.3,.28,.5,.65,.05,.62,MAT('#c0722e'),g);bx(.3,.28,.5,.25,.05,.7,MAT('#2e7ac0'),g);
  door(g,L.doorX,.46,.4,.5,'#444');L._sm=smokeP(g,-.62,1.9,-.7);return 1.8};
BUILD.school=function(L,g,P_){var c=P_.wall;
  bx(1.84,.05,1.84,0,0,0,MAT('#d6cfa8'),g);
  var fm=facade(c,2,5,L.v,'#6f93ad');facBox(1.74,1.4,1.0,0,.05,-.45,fm,'#b8923a',g);facBox(.9,1.1,.8,.4,.05,.4,fm,'#b8923a',g);
  roofG(1.8,.35,1.02,MAT(P_.roof),0,1.45,-.45,g,0);
  bx(.04,.9,.04,-.78,0,.75,MAT('#999'),g);bx(.3,.2,.02,-.62,.68,.75,MAT('#c0392b'),g);
  door(g,L.doorX,.5,.26,.5,'#6a4a2a');return 1.9};
BUILD.hospital=function(L,g,P_){
  bx(1.84,.05,1.84,0,0,0,MAT('#d0d4d8'),g);
  var fm=facade('#f4f6f8',3,4,L.v,'#8fb4cf');facBox(1.6,2.1,1.3,0,.05,-.15,fm,'#dde3e8',g);
  bx(.7,.16,.2,0,2.2,0,MAT('#d63a3a'),g);bx(.2,.16,.7,0,2.2,0,MAT('#d63a3a'),g);
  var sg=new THREE.Mesh(new THREE.PlaneGeometry(.5,.25),new THREE.MeshBasicMaterial({map:signTex('✚','#d63a3a')}));sg.position.set(0,1.6,.51);g.add(sg);
  bx(.6,.1,.4,L.doorX*.3,.55,.8,MAT('#c0c8d0'),g);door(g,L.doorX*.3,.66,.3,.5,'#4a6a8a');return 2.4};
BUILD.police=function(L,g,P_){
  bx(1.84,.05,1.84,0,0,0,MAT('#a8acb6'),g);
  var fm=facade('#6a7fa8',2,3,L.v,'#a5c0d8');facBox(1.5,1.4,1.2,0,.05,-.1,fm,'#46557a',g);
  var a=bx(.12,.1,.12,-.15,1.5,0,MAT('#d63a3a',{emissive:'#d63a3a',emissiveIntensity:.5}),g),b=bx(.12,.1,.12,.15,1.5,0,MAT('#2e6aff',{emissive:'#2e6aff',emissiveIntensity:.5}),g);a.userData.keep=1;b.userData.keep=1;L._pl=[a,b];
  door(g,L.doorX,.52,.24,.5,'#2a3550');var sg=new THREE.Mesh(new THREE.PlaneGeometry(.5,.25),new THREE.MeshBasicMaterial({map:signTex('🛡','#2a3f78')}));sg.position.set(L.doorX*.2,1.15,.51);g.add(sg);return 1.6};
BUILD.hall=function(L,g,P_){
  bx(1.84,.05,1.84,0,0,0,MAT('#d6cfa8'),g);
  var fm=facade('#e9dcc0',2,4,L.v,'#8fa8bb');facBox(1.7,1.6,1.1,0,.05,-.3,fm,'#c9b98a',g);
  for(var i=0;i<4;i++)cyl(.07,1.4,-.6+i*.4,.05,.45,MAT('#f0e8d4'),g);
  roofG(1.7,.4,.7,MAT('#b99a4a'),0,1.65,.45,g,0);bx(.5,.9,.5,0,1.65,-.5,MAT('#e9dcc0'),g);
  var cp=new THREE.Mesh(GEO.cone4,MAT('#7a6a3a'));cp.scale.set(.4,.45,.4);cp.position.set(0,2.8,-.5);cp.rotation.y=Math.PI/4;g.add(cp);
  bx(.03,.4,.03,0,2.95,-.5,MAT('#888'),g);bx(.2,.12,.02,.12,3.2,-.5,MAT('#c0392b'),g);return 3.3};
BUILD.park=function(L,g,P_){
  bx(1.84,.03,1.84,0,0,0,MAT('#7dbb64'),g);bx(1.7,.02,.22,0,.03,0,MAT('#e6dcc0'),g);bx(.22,.02,1.7,0,.03,0,MAT('#e6dcc0'),g);
  var pd=new THREE.Mesh(GEO.cyl,MAT('#5fa6c8'));pd.scale.set(.32,.04,.32);pd.position.set(L.v%2?.5:-.5,.04,L.v%3?.5:-.5);g.add(pd);
  [[-.6,-.6],[.6,.6],[-.6,.6],[.6,-.6]].forEach(function(t,i){var r=.2+((L.v+i)%4)*.03,tr=new THREE.Mesh(GEO.cyl,MAT('#6b4a2b'));tr.scale.set(.04,.35,.04);tr.position.set(t[0],.2,t[1]);g.add(tr);var cr=new THREE.Mesh(i%2?GEO.cone8:GEO.ico,MAT(i%2?'#2f7a45':'#4f9a4b',{flatShading:true}));cr.scale.set(r,i%2?.55:r,r);cr.position.set(t[0],i%2?.6:.52,t[1]);cr.castShadow=true;g.add(cr)});
  bx(.3,.08,.1,.3,.1,-.12,MAT('#9a6a3a'),g);bx(.3,.08,.1,-.3,.1,.12,MAT('#9a6a3a'),g);return .9};
BUILD.empty=function(L,g,P_){bx(1.84,.03,1.84,0,0,0,MAT('#d8d0b2'),g);bx(.05,.5,.05,.7,0,.7,MAT('#8a6a3a'),g);bx(.4,.25,.03,.7,.4,.7,MAT('#e8e0c8'),g);return .3};
var PLAIN=null;
function bake(shell){if(!PLAIN)PLAIN=new THREE.MeshLambertMaterial({vertexColors:true});
  var kids=shell.children.slice(),buck=new Map(),v=new THREE.Vector3();
  kids.forEach(function(m){if(!m.isMesh||m.userData.keep)return;shell.remove(m);m.updateMatrix();
    var geo=m.geometry,mats=Array.isArray(m.material)?m.material:null,idx=geo.index,pos=geo.attributes.position,nor=geo.attributes.normal,uv=geo.attributes.uv,nm=new THREE.Matrix3().getNormalMatrix(m.matrix);
    var groups=mats?geo.groups:[{start:0,count:idx?idx.count:pos.count,materialIndex:0}];
    groups.forEach(function(gr){var mat=mats?mats[gr.materialIndex]:m.material,plain=!mat.map&&!mat.transparent&&!mat.emissiveMap&&!mat.isMeshBasicMaterial&&!(mat.emissiveIntensity>0&&mat.emissive.getHex()!==0),key=plain?'P':mat.uuid,b=buck.get(key);
      if(!b){b={mat:plain?PLAIN:mat,p:[],n:[],u:[],c:[]};buck.set(key,b)}
      for(var i=gr.start;i<gr.start+gr.count;i++){var vi=idx?idx.getX(i):i;v.fromBufferAttribute(pos,vi).applyMatrix4(m.matrix);b.p.push(v.x,v.y,v.z);v.fromBufferAttribute(nor,vi).applyMatrix3(nm).normalize();b.n.push(v.x,v.y,v.z);if(uv)b.u.push(uv.getX(vi),uv.getY(vi));else b.u.push(0,0);if(plain)b.c.push(mat.color.r,mat.color.g,mat.color.b)}})});
  buck.forEach(function(b){var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.u,2));if(b.c.length)g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));var mm=new THREE.Mesh(g,b.mat);mm.castShadow=mm.receiveShadow=true;shell.add(mm)})}

function palOf(L){var p=PAL[L.type];if(!p)return {wall:'#ccc',roof:'#888'};var c=p[L.v%p.length];return {wall:c[0],roof:c[1]}}
function lotSig(L){return L.type+'|'+(L.cl?1:0)+'|'+(L.dmg>S.t?1:0)+'|'+(L.sub||'')}
function makeLot(L){var old=LG[L.id];if(old){scene.remove(old.g)}
  var g=new THREE.Group(),shell=new THREE.Group();g.add(shell);g.position.set(L.x+1,0,L.y+1);var ky=L.k>>1;g.rotation.y=ky?0:Math.PI;L.doorX=ky?-.5:.5;
  var P_=palOf(L),cl=L.cl,dm=L.dmg>S.t;if(cl){P_={wall:'#9a978f',roof:'#6a675f'}}else if(dm){P_={wall:sh(P_.wall,.5),roof:sh(P_.roof,.45)}}
  L._sm=null;L._pl=null;var f=BUILD[L.type]||BUILD.empty,top=f(L,shell,P_);L._h=top;
  if(cl&&L.type!=='empty'){var b1=bx(1.9,.08,.04,0,.5,.95,MAT('#3a2a20'),shell);b1.rotation.z=.5;var b2=bx(1.9,.08,.04,0,.5,.95,MAT('#3a2a20'),shell);b2.rotation.z=-.5}
  if(dm&&!L._sm)L._sm=smokeP(shell,0,top,0);
  bake(shell);
  scene.add(g);if(renderer)renderer.shadowMap.needsUpdate=true;var pk=old&&old.pick;
  if(!pk){pk=new THREE.Mesh(GEO.box,new THREE.MeshBasicMaterial({visible:false}));pk.userData.L=L;PICKS.push(pk)}
  pk.scale.set(1.9,top+.2,1.9);pk.position.set(L.x+1,(top+.2)/2,L.y+1);pk.updateMatrixWorld();
  LG[L.id]={g:g,shell:shell,pick:pk,sig:lotSig(L),inter:null}}
function buildAllLots(){S.lots.forEach(makeLot)}
function buildStatic(){if(!scene)return;drawGroundTex();buildAllLots();if(cutL!=null&&LG[cutL])LG[cutL].shell.visible=false}
var cutL=null;
function updateLots(now){var t=now/1000;
  for(var i=0;i<S.lots.length;i++){var L=S.lots[i],G=LG[i];if(!G)continue;if(G.sig!==lotSig(L)){makeLot(L);G=LG[i];if(cutL===i){G.shell.visible=false;if(typeof cutBuild==='function')cutBuild(L)}}
    var sm=L._sm;
    if(sm){var on=L.dmg>S.t||(L.type==='factory'&&!L.cl&&L.in>0&&DAYK>.05);for(var k=0;k<3;k++){var m=sm.m[k];m.visible=on&&G.shell.visible;if(on){var ph=(t/2.2+k/3)%1;m.position.set(sm.x+Math.sin(ph*5+k)*.1*ph,sm.y+ph*.9,sm.z);var sc=Math.sin(ph*Math.PI)*(.08+ph*.14);m.scale.set(sc,sc,sc)}}}
    if(L._pl){var bl=(Math.floor(t*2)%2)?1:0;L._pl[0].visible=!!bl;L._pl[1].visible=!bl}}}
