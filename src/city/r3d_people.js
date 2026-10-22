/* ============ 3D: куклы-люди ============ */
var MAXS=1400,PB=8,DBOX,DSPH,DSHD,SLOTS=[],FREES=[],nextSlot=0,SEEN=new Uint8Array(MAXS),selRing;
var SK2=['#f6d3b3','#e8b98f','#c98e63','#8a5a3a'],HR2=['#1c1a1a','#3a2a1e','#5a3a22','#8a5a2a','#d9b25a','#b5532a','#d8d8d8'],SH2=['#c0392b','#2e86c1','#27ae60','#f1c40f','#8e44ad','#e67e22','#16a085','#ec7aa8','#e8e4d8','#34495e','#7fb3d5','#a3d977','#f08a4b','#6c5ce7'],PN2=['#2c3e50','#3d4a5c','#2a2a2e','#8a7a5a','#5a4636','#4a6a8a'];
var _m=new THREE.Matrix4(),_qa=new THREE.Quaternion(),_qb=new THREE.Quaternion(),_qc=new THREE.Quaternion(),_v=new THREE.Vector3(),_w=new THREE.Vector3(),_s=new THREE.Vector3(),_col=new THREE.Color(),AX=new THREE.Vector3(1,0,0),AY=new THREE.Vector3(0,1,0),ZERO=new THREE.Matrix4().makeScale(0,0,0);
function initPeople(){
  DBOX=new THREE.InstancedMesh(GEO.box,new THREE.MeshLambertMaterial({color:'#ffffff'}),MAXS*PB);DSPH=new THREE.InstancedMesh(GEO.sph,new THREE.MeshLambertMaterial({color:'#ffffff'}),MAXS*2);
  DSHD=new THREE.InstancedMesh(new THREE.CircleGeometry(1,12),new THREE.MeshBasicMaterial({color:'#000',transparent:true,opacity:.27,depthWrite:false}),MAXS);
  [DBOX,DSPH,DSHD].forEach(function(m){m.frustumCulled=false;m.count=0;for(var i=0;i<m.instanceMatrix.count;i++)m.setMatrixAt(i,ZERO);m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)});
  DBOX.castShadow=DSPH.castShadow=false;scene.add(DBOX);scene.add(DSPH);scene.add(DSHD);
  selRing=new THREE.Mesh(new THREE.RingGeometry(.2,.26,28),new THREE.MeshBasicMaterial({color:'#ff3b4a',side:THREE.DoubleSide,transparent:true,opacity:.95,depthTest:false}));selRing.rotation.x=-Math.PI/2;selRing.visible=false;selRing.renderOrder=9;scene.add(selRing)}
function hash(id,k){var h=(id*2654435761+k*40503)>>>0;h^=h>>>13;h=Math.imul(h,1274126177)>>>0;return ((h^h>>>16)>>>0)/4294967296}
function colSig(p){var J=p.job>=0?S.lots[p.job]:null;return (J?J.type:'')+(p.riot?'R':'')}
function setCols(p,sl){var a=ageOf(p),J=p.job>=0?S.lots[p.job]:null,jt=J?J.type:'',id=p.id;
  var skin=SK2[Math.floor(hash(id,1)*4)],hair=a>62?(hash(id,9)<.8?'#d8d8d8':HR2[Math.floor(hash(id,2)*6)]):HR2[Math.floor(hash(id,2)*6)],shirt=SH2[Math.floor(hash(id,3)*SH2.length)],pants=PN2[Math.floor(hash(id,4)*PN2.length)];
  if(jt==='police'){shirt='#3b5ba5';pants='#222a3d'}else if(jt==='hospital'){shirt='#f2f6f8';pants='#4a8aa5'}else if(jt==='shop'){shirt=SUB[J.sub||'grocery'].awn}else if(jt==='factory'){shirt='#e8963a';pants='#3a4452'}else if(jt==='office'&&!p.g){pants='#26303f'}
  if(p.riot)shirt='#d62828';
  var long=p.g&&hash(id,5)<.6,b=sl*PB,c=_col;
  function sc(i,h){c.set(h);DBOX.setColorAt(b+i,c)}
  sc(0,pants);sc(1,pants);sc(2,shirt);sc(3,shirt);sc(4,shirt);sc(5,'#222');sc(6,'#222');sc(7,hair);
  c.set(skin);DSPH.setColorAt(sl*2,c);c.set(hair);DSPH.setColorAt(sl*2+1,c);
  if(DBOX.instanceColor)DBOX.instanceColor.needsUpdate=true;if(DSPH.instanceColor)DSPH.instanceColor.needsUpdate=true;
  p._long=long;p._cs=colSig(p);p._ka=a<14?0:1}
function slotOf(p){if(p._sl!=null&&SLOTS[p._sl]===p.id)return p._sl;var s=FREES.length?FREES.pop():nextSlot++;if(s>=MAXS)return -1;SLOTS[s]=p.id;p._sl=s;setCols(p,s);return s}
function hideSlot(s){for(var i=0;i<PB;i++)DBOX.setMatrixAt(s*PB+i,ZERO);DSPH.setMatrixAt(s*2,ZERO);DSPH.setMatrixAt(s*2+1,ZERO);DSHD.setMatrixAt(s,ZERO)}
function part(mesh,idx,qB,bx0,by0,bz0,sc,lx,ly,lz,sx,sy,sz,rx){
  _v.set(lx*sc,ly*sc,lz*sc).applyQuaternion(qB);_v.x+=bx0;_v.y+=by0;_v.z+=bz0;
  if(rx){_qc.setFromAxisAngle(AX,rx);_qa.copy(qB).multiply(_qc)}else _qa.copy(qB);
  _s.set(sx*sc,sy*sc,sz*sc);_m.compose(_v,_qa,_s);mesh.setMatrixAt(idx,_m)}
/* поза: 0 стоит/идёт, 1 сидит, 2 лежит */
function putDoll(p,sl,x,y,z,yaw,sc,wp,pose,walk){
  var b=sl*PB,sw=walk?Math.sin(wp)*.75:0,bob=walk?Math.abs(Math.sin(wp))*.018*sc:0;
  _qb.setFromAxisAngle(AY,yaw);if(pose===2){_qc.setFromAxisAngle(AX,-Math.PI/2);_qb.multiply(_qc);y+=.26*sc;x+=Math.sin(yaw)*.36*sc;z+=Math.cos(yaw)*.36*sc}else if(pose===1)y+=.06*sc;
  var hy=pose===1?-.12:0,leg=pose===1?-1.5:sw,arm=pose===1?-.7:-sw*.9;if(pose===2){leg=0;arm=0}
  y+=bob;
  part(DBOX,b,_qb,x,y,z,sc,-.055,.25+hy-.12*Math.cos(leg),-.12*Math.sin(leg),.08,.24,.09,leg);
  part(DBOX,b+1,_qb,x,y,z,sc,.055,.25+hy-.12*Math.cos(-leg),-.12*Math.sin(-leg),.08,.24,.09,-leg);
  part(DBOX,b+2,_qb,x,y,z,sc,0,.375+hy,0,.2,.25,.12,0);
  part(DBOX,b+3,_qb,x,y,z,sc,-.13,.48+hy-.1*Math.cos(arm),-.1*Math.sin(arm),.06,.21,.07,arm);
  part(DBOX,b+4,_qb,x,y,z,sc,.13,.48+hy-.1*Math.cos(-arm),-.1*Math.sin(-arm),.06,.21,.07,-arm);
  var hs=p._ka?1:1.18;
  part(DSPH,sl*2,_qb,x,y,z,sc,0,.6*(p._ka?1:.97)+hy,0,.095*hs,.1*hs,.095*hs,0);
  part(DSPH,sl*2+1,_qb,x,y,z,sc,0,.625*(p._ka?1:.97)+hy,-.026,.1*hs,.098*hs,.101*hs,0);
  part(DBOX,b+5,_qb,x,y,z,sc,-.037,.6+hy,.092*hs,.022,.026,.012,0);part(DBOX,b+6,_qb,x,y,z,sc,.037,.6+hy,.092*hs,.022,.026,.012,0);
  if(p._long)part(DBOX,b+7,_qb,x,y,z,sc,0,.52+hy,-.085,.17,.2,.05,0);else DBOX.setMatrixAt(b+7,ZERO);
  if(pose<2){_v.set(x,.025,z);_qa.setFromAxisAngle(AX,-Math.PI/2);_s.set(.13*sc,.13*sc,.13*sc);_m.compose(_v,_qa,_s);DSHD.setMatrixAt(sl,_m)}else DSHD.setMatrixAt(sl,ZERO)}
/* внешние позиции */
function visP(p){if(p.loc===-1||p.loc===-2)return true;var L=S.lots[p.loc];return !!L&&L.type==='park'}
function pPos(p){if(p.loc>=0){var L=S.lots[p.loc],h=p.id*2654435761%1000/1000,h2=p.id*40503%1000/1000,w=S.t/25+p.id;return [L.x+.35+h*1.3+Math.sin(w)*.18,L.y+.35+h2*1.3+Math.cos(w*.8)*.18]}return [p._x,p._y]}
var lastDraw=0;
function updatePeople(now){var dt=Math.min(.1,(now-lastDraw)/1000);lastDraw=now;SEEN.fill(0);var maxs=0;
  for(var i=0;i<S.people.length;i++){var p=S.people[i],inCut=cutL!=null&&p.loc===cutL&&p.loc>=0,vis=inCut||visP(p);
    if(p._sl!=null||vis){var sl=slotOf(p);if(sl<0)continue;SEEN[sl]=1;if(sl+1>maxs)maxs=sl+1;
      if(p._cs!==colSig(p))setCols(p,sl);
      if(!vis){if(p._shown){hideSlot(sl);p._shown=0}continue}
      p._shown=1;var a=ageOf(p),sc=(a<16?.58+a*.026:1)*(inCut?.92:1.08);
      if(inCut){var q=interiorPos(p);putDoll(p,sl,q.x,q.y,q.z,q.yaw,sc,S.t*.5+p.id,q.pose,0);continue}
      var ps=pPos(p),moving=!!p._path&&p.loc<0,dx=ps[0]-(p._lx==null?ps[0]:p._lx),dz=ps[1]-(p._lz==null?ps[1]:p._lz),d=Math.hypot(dx,dz);
      if(d>.002&&d<2){var ty=Math.atan2(dx,dz),df=ty-(p._yw||0);df=Math.atan2(Math.sin(df),Math.cos(df));p._yw=(p._yw||0)+df*Math.min(1,dt*14);p._wp=(p._wp||0)+d*10}
      else if(!moving&&p.loc>=0){p._yw=(p._yw||0)+Math.sin(S.t/40+p.id)*.002}
      p._lx=ps[0];p._lz=ps[1];
      putDoll(p,sl,ps[0],0,ps[1],p._yw||0,sc,p._wp||0,0,d>.0015&&d<2)}}
  for(var s=0;s<nextSlot;s++){if(!SEEN[s]&&SLOTS[s]!=null){SLOTS[s]=null;FREES.push(s);hideSlot(s)}}
  DBOX.count=maxs*PB;DSPH.count=maxs*2;DSHD.count=maxs;DBOX.instanceMatrix.needsUpdate=DSPH.instanceMatrix.needsUpdate=DSHD.instanceMatrix.needsUpdate=true;DSHD.visible=true;
  var sp=S.sel&&S.sel.k==='p'?P(S.sel.id):null,lb=$('#lbl');
  if(sp&&(visP(sp)||(cutL!=null&&sp.loc===cutL))){var pp=cutL!=null&&sp.loc===cutL?interiorPos(sp):null,u=pp?pp.x:pPos(sp)[0],v=pp?pp.z:pPos(sp)[1];selRing.visible=true;selRing.position.set(u,.05,v);var pl=1+Math.sin(now/200)*.12;selRing.scale.set(pl,pl,pl);
    _v.set(u,.9,v).project(camera);if(lb&&_v.z<1){lb.style.display='block';lb.textContent=dsp(sp);lb.style.left=((_v.x+1)/2*W)+'px';lb.style.top=((1-_v.y)/2*H)+'px'}}
  else{selRing.visible=false;if(lb)lb.style.display='none'}}
