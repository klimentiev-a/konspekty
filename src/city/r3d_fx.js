/* ============ 3D: интерьер (срез дома), эффекты, кадр ============ */
function fl(par,w,d,col,x,z){bx(w,.05,d,x||0,.0,z||0,MAT(col),par)}
function wallsOf(par,col,doorX){var m=MAT(col),H_=.46;
  bx(1.84,H_,.05,0,0,-.9,m,par);bx(.05,H_,1.84,-.9,0,0,m,par);bx(.05,H_,1.84,.9,0,0,m,par);
  var l=doorX-.15+.9,r=.9-(doorX+.15);bx(l,H_,.05,-.9+l/2,0,.9,m,par);bx(r,H_,.05,.9-r/2,0,.9,m,par)}
function furn(par,w,h,d,x,y,z,col){return bx(w,h,d,x,y,z,MAT(col),par)}
function bedF(par,x,z,col){furn(par,.34,.12,.62,x,.05,z,'#8a6a4a');furn(par,.3,.07,.5,x,.17,z+.04,col);furn(par,.22,.06,.12,x,.24,z-.2,'#f4f1e8')}
function interBuild(L){var g=new THREE.Group(),P_=palOf(L),T=L.type,dX=L.doorX,spots={sit:[],stand:[],bed:[],work:[]};
  if(T==='house'||T==='flat'){
    fl(g,1.84,1.84,'#cfae82');wallsOf(g,P_.wall,dX);furn(g,1.6,.46,.05,0,0,-.1,P_.wall).scale.x=1;
    /* перегородки */
    var pm=MAT(sh(P_.wall,.95));bx(.05,.46,.8,0,0,-.5,pm,g);bx(.5,.46,.05,-.62,0,-.1,pm,g);bx(.5,.46,.05,.62,0,-.1,pm,g);
    bedF(g,-.62,-.5,'#5b8bc9');bedF(g,-.25,-.5,'#c95b7a');bedF(g,.25,-.5,'#5bc99a');bedF(g,.62,-.5,'#c9b05b');
    spots.bed=[[-.62,-.5,0],[-.25,-.5,0],[.25,-.5,0],[.62,-.5,0]];
    furn(g,.7,.02,.45,-.4,.05,.3,'#b5533c');furn(g,.62,.14,.2,-.45,.05,.05,'#4a6a9a');furn(g,.62,.16,.05,-.45,.18,-.02,'#3d5a85');
    furn(g,.4,.26,.05,-.45,.05,.8,'#222');furn(g,.36,.2,.02,-.45,.08,.775,'#6aa0c8');
    furn(g,.45,.05,.32,.45,.28,.4,'#a8825a');for(var i=0;i<4;i++){var px=[.45,.45,.2,.7][i],pz=[.17,.63,.4,.4][i];furn(g,.14,.18,.14,px,.0,pz,'#8a6a4a')}
    furn(g,.12,.4,.7,.8,.05,.45,'#dfe3e6');furn(g,.14,.5,.14,.8,.05,.05,'#f2f2f2');
    furn(g,.16,.1,.16,-.78,.05,.78,'#9a6a3a');bush(g,-.78,.78,.07);
    spots.sit=[[-.6,.08,0,1],[-.45,.08,0,1],[-.3,.08,0,1],[.45,.17,0,1],[.45,.63,Math.PI,1],[.2,.4,Math.PI/2,1],[.7,.4,-Math.PI/2,1]];
    spots.stand=[[-.3,.5,0],[0,.35,0],[.1,.65,0],[-.65,.55,0]]}
  else if(T==='shop'){var S0=SUB[L.sub||'grocery'];fl(g,1.84,1.84,'#e8e2d2');wallsOf(g,P_.wall,dX);
    for(var r=0;r<3;r++){furn(g,.5,.4,.16,-.6+r*.0,.05,-.7+r*.0,S0.col);}
    [[-.5,-.7],[.0,-.7],[.5,-.7]].forEach(function(s){furn(g,.4,.5,.14,s[0],.05,s[1],S0.col);furn(g,.38,.04,.12,s[0],.3,s[1],'#fff')});
    [[-.45,-.15],[.1,-.15]].forEach(function(s){furn(g,.5,.34,.18,s[0],.05,s[1],sh(S0.col,.8))});
    furn(g,.8,.3,.22,.35,.05,.45,'#6a4a30');furn(g,.14,.1,.12,.5,.35,.45,'#555');
    spots.work=[[.35,.68,Math.PI,0]];spots.stand=[[-.6,.3,0],[-.2,.4,0],[-.3,-.45,Math.PI],[.3,-.45,Math.PI],[.1,.05,0],[-.7,-.2,Math.PI/2]];spots.sit=spots.stand}
  else if(T==='factory'){fl(g,1.84,1.84,'#8f8f88');wallsOf(g,P_.wall,dX);
    [[-.5,-.5],[.2,-.5],[-.5,.1],[.3,.05]].forEach(function(s,i){furn(g,.5,.4,.3,s[0],.05,s[1],['#c0722e','#2e7ac0','#8a5a9a','#3a9a6a'][i]);furn(g,.12,.3,.12,s[0]+.15,.45,s[1],'#555')});
    furn(g,.5,.2,.4,.45,.05,-.6,'#a07a50');
    spots.stand=[[-.5,-.2,Math.PI],[.2,-.2,Math.PI],[-.5,.4,Math.PI],[.3,.35,Math.PI],[-.1,.1,0],[.7,-.2,0]];spots.sit=spots.stand;spots.work=spots.stand}
  else if(T==='hospital'){fl(g,1.84,1.84,'#e6eef2');wallsOf(g,'#f4f6f8',dX);
    [[-.6,-.55],[-.2,-.55],[.2,-.55],[.6,-.55]].forEach(function(s){furn(g,.34,.1,.6,s[0],.05,s[1],'#c8d4dc');furn(g,.3,.06,.5,s[0],.15,s[1],'#fff');furn(g,.2,.05,.1,s[0],.21,s[1]-.2,'#e8f0f4')});
    spots.bed=[[-.6,-.55,0],[-.2,-.55,0],[.2,-.55,0],[.6,-.55,0]];furn(g,.9,.28,.2,.3,.05,.5,'#9ab');
    spots.stand=[[-.5,.2,0],[0,.1,0],[.3,.3,Math.PI],[-.4,.6,0],[.6,.05,0]];spots.sit=spots.stand;spots.work=spots.stand}
  else if(T==='park'){return null}
  else{ /* офис, школа, полиция, мэрия: столы */
    fl(g,1.84,1.84,T==='school'?'#d8c9a0':'#c4b8a4');wallsOf(g,P_.wall,dX);
    var rows=T==='school'?[-.55,-.2,.15]:[-.6,-.25,.1],cols=[-.55,0,.55];
    rows.forEach(function(z,ri){cols.forEach(function(x){furn(g,.4,.18,.24,x,.05,z,T==='school'?'#c89a5a':'#8a8a92');furn(g,.14,.1,.02,x,.23,z-.04,'#222');spots.sit.push([x,z+.2,Math.PI,1]);spots.work.push([x,z+.2,Math.PI,1])})});
    if(T==='school')furn(g,.9,.35,.03,0,.3,-.86,'#2a4a3a');
    spots.stand=[[-.7,.55,0],[0,.6,0],[.7,.55,0],[.4,.4,0]]}
  g.userData.spots=spots;return g}
function cutBuild(L){var G=LG[L.id];if(!G)return;if(!G.inter){var ig=interBuild(L);G.inter=ig;if(ig)G.g.add(ig)}if(G.inter)G.inter.visible=true;G.shell.visible=false;L._spots=G.inter?G.inter.userData.spots:null}
function cutaway(L){
  if(cutL!=null&&LG[cutL]&&(L==null||L.id!==cutL)){var o=LG[cutL];o.shell.visible=true;if(o.inter)o.inter.visible=false}
  if(L==null||L.type==='park'||L.type==='empty'){cutL=null;return}
  cutL=L.id;cutBuild(L);L._ins=null;cam.pitch=Math.max(cam.pitch,1.12)}
function interiorPos(p){var L=S.lots[p.loc],sp=L&&L._spots,rot=(L.k>>1)?0:Math.PI,cx=L.x+1,cz=L.y+1;
  if(!sp)return {x:cx,y:0,z:cz,yaw:0,pose:0};
  var ins=L._ins;if(!ins||L._insT!==S.t){ins=S.people.filter(function(q){return q.loc===L.id}).map(function(q){return q.id}).sort(function(a,b){return a-b});L._ins=ins;L._insT=S.t}
  var idx=Math.max(0,ins.indexOf(p.id)),h=(S.t%1440)/60,T=L.type,s,pose=0;
  if((T==='house'||T==='flat')){if(h<7||h>=22.5){s=sp.bed[idx%sp.bed.length];pose=2}else{var pool=sp.sit.concat(sp.stand);s=pool[idx%pool.length];pose=s[3]?1:0}}
  else if(T==='hospital'&&p.inj>S.t){var bi=0;ins.forEach(function(id,k){var q=P(id);if(q&&q.inj>S.t&&id<p.id)bi++});s=sp.bed[bi%sp.bed.length];pose=2}
  else if(p.job===L.id){var w=sp.work.length?sp.work:sp.stand,k2=L.staff.indexOf(p.id);s=w[Math.max(0,k2)%w.length];pose=s[3]?1:0}
  else{var st=sp.stand,k3=idx;s=st[k3%st.length]}
  var c=Math.cos(rot),sn=Math.sin(rot),lx=s[0],lz=s[1];
  return {x:cx+lx*c+lz*sn,y:0,z:cz-lx*sn+lz*c,yaw:(s[2]||0)+rot,pose:pose}}
/* --- эффекты событий --- */
function fxAdd(u,v,type){S.fx=S.fx||[];S.fx.push({u:u,v:v,type:type,until:S.t+360})}
function fxMake(f){var g=new THREE.Group(),col=f.type==='terror'?'#ff2a2a':f.type==='riot'?'#ff9a1f':'#ffb21f';
  var ring=new THREE.Mesh(new THREE.RingGeometry(.6,.7,40),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.08;g.add(ring);
  var pil=new THREE.Mesh(new THREE.CylinderGeometry(.18,.3,7,12,1,true),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:.28,side:THREE.DoubleSide,depthWrite:false}));pil.position.y=3.5;g.add(pil);
  if(f.type==='fire'){for(var i=0;i<4;i++){var fl_=new THREE.Mesh(GEO.cone8,new THREE.MeshBasicMaterial({color:i%2?'#ff7a1a':'#ffd23a'}));fl_.position.set((i%2-.5)*.5,.4,(i>>1)-.5);g.add(fl_)}}
  g.position.set(f.u,0,f.v);scene.add(g);f._g=g;f._ring=ring;f._pil=pil}
function updateFx(now){if(!S.fx)return;S.fx=S.fx.filter(function(f){if(f.until>S.t)return true;if(f._g){scene.remove(f._g)}return false});
  S.fx.forEach(function(f){if(!f._g)fxMake(f);var ph=(now/1100)%1,s=1+ph*3.2;f._ring.scale.set(s,s,s);f._ring.material.opacity=.8*(1-ph);f._pil.material.opacity=.16+.12*Math.sin(now/180);
    if(f.type==='fire')f._g.children.forEach(function(c,i){if(i>1){var k=.5+Math.abs(Math.sin(now/110+i*2))*.7;c.scale.set(.28,.7*k,.28);c.position.y=.35*k}})})}
/* --- кадр --- */
function draw(){var now=performance.now();daylight();if(cutL!=null){var cl=S.lots[cutL];cutLight.position.set(cl.x+1,1.3,cl.y+1);cutLight.intensity=(1-DAYK)*2.2}else cutLight.intensity=0;updateLots(now);updatePeople(now);updateFx(now);applyCam();renderer.render(scene,camera)}
function initR3D(){initScene();initPeople();buildAllLots();fitCam()}
