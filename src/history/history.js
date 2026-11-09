/* История мира: лента времени регионы × годы на canvas.
   Данные — <script id="hdata"> (src/history/data.json): regions, spheres, eras, items [id,name,a,b,region,sphere,desc,flags], events [id,year,name,desc,region,weight].
   Шкала кусочно-линейная («Сжать древность»): год → u ∈ [0,1], вид — окно [u0,u1] и вертикальный сдвиг sy. */
(function(){
'use strict';
var D=JSON.parse(document.getElementById('hdata').textContent);
var NOW=D.now,Y0=-3500,Y1=NOW+6;
var box=document.getElementById('hbox'),cv=document.getElementById('hcv'),ctx=cv.getContext('2d');
var tip=document.getElementById('htip'),hp=document.getElementById('hp'),hpc=document.getElementById('hpc');
function st(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function lc(s){return String(s).toLowerCase().replace(/ё/g,'е')}
/* ---------- данные ---------- */
var REG={},RI={},SPH=D.spheres,IT=[],EV=[],BYID={};
D.regions.forEach(function(r,i){REG[r[0]]={id:r[0],name:r[1],sub:r[2],i:i,items:[],evs:[],rows:[]};RI[r[0]]=i});
D.items.forEach(function(x){var o={id:x[0],name:x[1],a:x[2],b:x[3],r:x[4],s:x[5],d:x[6],fa:x[7].indexOf('a')>=0,fb:x[7].indexOf('b')>=0,t:'s'};IT.push(o);BYID[o.id]=o;REG[o.r].items.push(o)});
D.events.forEach(function(x){var o={id:x[0],y:x[1],name:x[2],d:x[3],r:x[4],w:x[5],t:'e'};EV.push(o);BYID[o.id]=o;REG[o.r].evs.push(o)});
var ERAS=D.eras.map(function(e,i){return {id:'era'+i,name:e[0],a:e[1],b:e[2],d:e[3],t:'r'}});ERAS.forEach(function(e){BYID[e.id]=e});
/* раскладка полос по строкам внутри региона: сначала государства, потом культуры */
D.regions.forEach(function(r){var R=REG[r[0]],rows=[];
  function put(x){for(var k=0;k<rows.length;k++){if(rows[k].it.every(function(o){return o.b<=x.a||o.a>=x.b})){rows[k].it.push(x);x.row=k;return}}rows.push({it:[x]});x.row=rows.length-1}
  R.items.filter(function(x){return x.s!=='cul'}).sort(function(p,q){return p.a-q.a||q.b-p.b}).forEach(put);
  R.items.filter(function(x){return x.s==='cul'}).sort(function(p,q){return p.a-q.a||q.b-p.b}).forEach(put);
  R.rows=rows});
function pl(n,a,b,c){var m=n%10,h=n%100;return n+' '+(m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c)}
document.getElementById('hlead').textContent=pl(IT.filter(function(x){return x.s!=='cul'}).length,'государство','государства','государств')+', '+pl(IT.filter(function(x){return x.s==='cul'}).length,'культура','культуры','культур')+' и '+pl(EV.length,'событие','события','событий')+' за 5,5 тысячи лет на одной ленте. Нажми на полосу, событие или любое место ленты, чтобы прочитать, что было в мире в этот год.';
/* ---------- шкала ---------- */
var KC=[[Y0,0],[-1000,.15],[500,.4],[1500,.64],[1800,.82],[Y1,1]],KL=[[Y0,0],[Y1,1]],comp=st('ist:comp')!=='0',KN=comp?KC:KL;
function y2u(y){if(y<=KN[0][0])return KN[0][1]+(y-KN[0][0])*(KN[1][1]-KN[0][1])/(KN[1][0]-KN[0][0]);
  for(var i=1;i<KN.length;i++)if(y<=KN[i][0]||i===KN.length-1){var p=KN[i-1],q=KN[i];return p[1]+(y-p[0])*(q[1]-p[1])/(q[0]-p[0])}}
function u2y(u){for(var i=1;i<KN.length;i++)if(u<=KN[i][1]||i===KN.length-1){var p=KN[i-1],q=KN[i];return p[0]+(u-p[1])*(q[0]-p[0])/(q[1]-p[1])}}
var V={u0:-.01,u1:1.01,sy:0},W=800,H=500,K=1,DPR=1;
function X(y){return (y2u(y)-V.u0)/(V.u1-V.u0)*W}
function XY(x){return u2y(V.u0+x/W*(V.u1-V.u0))}
/* ---------- оформление ---------- */
var C={};
function theme(){var cs=getComputedStyle(document.documentElement);function g(n,d){return (cs.getPropertyValue(n)||'').trim()||d}
  C.bg=g('--bg','#F4F1E8');C.sf=g('--surface','#FBF9F3');C.fg=g('--fg','#25221C');C.mu=g('--muted','#665F52');C.fa=g('--faint','#857E6E');C.ln=g('--line','#D9D3C2');C.ac=g('--a2','#1F6B57');C.a1=g('--a1','#A93D28');
  var m=C.bg.match(/^#(..)(..)(..)/),L=m?(parseInt(m[1],16)*.3+parseInt(m[2],16)*.59+parseInt(m[3],16)*.11):240;C.dark=L<110;
  C.fill={};C.f0={};C.edge={};C.txt={};Object.keys(SPH).forEach(function(k){var h=SPH[k][1],s=SPH[k][2];
    if(C.dark){C.fill[k]='hsl('+h+','+Math.round(s*.62)+'%,'+(k==='cul'?23:27)+'%)';C.f0[k]='hsla('+h+','+Math.round(s*.62)+'%,'+(k==='cul'?23:27)+'%,0)';C.edge[k]='hsl('+h+','+Math.round(s*.7)+'%,42%)';C.txt[k]='hsl('+h+','+Math.min(40,s)+'%,88%)'}
    else{C.fill[k]='hsl('+h+','+s+'%,'+(k==='cul'?89:84)+'%)';C.f0[k]='hsla('+h+','+s+'%,'+(k==='cul'?89:84)+'%,0)';C.edge[k]='hsl('+h+','+s+'%,'+(k==='cul'?72:60)+'%)';C.txt[k]='hsl('+h+','+Math.min(55,s)+'%,'+(k==='cul'?34:21)+'%)'}});
  legend();draw()}
function sw(k){return C.dark?'hsl('+SPH[k][1]+','+Math.round(SPH[k][2]*.7)+'%,45%)':'hsl('+SPH[k][1]+','+SPH[k][2]+'%,62%)'}
/* ---------- раскладка по вертикали ---------- */
var TOUCH=matchMedia('(pointer:coarse)').matches,RH=TOUCH?22:19,HH=24,AX=26,ERH=19,TOP=AX+ERH,EVR=3,EVH=17;
var fold={};try{fold=JSON.parse(st('ist:fold')||'{}')||{}}catch(e){}
var LAY=[],CH=0;
function layout(){LAY=[];var y=6;
  LAY.push({k:'ev',y:y,h:HH+EVR*EVH+6});y+=HH+EVR*EVH+10;
  D.regions.forEach(function(r){var R=REG[r[0]],f=!!fold[r[0]],h=HH+(f?0:R.rows.length*RH+6);LAY.push({k:'rg',R:R,y:y,h:h,f:f});y+=h+4});
  CH=y+8;clampY()}
function clampY(){var m=Math.max(0,CH-(H-TOP));if(V.sy>m)V.sy=m;if(V.sy<0)V.sy=0}
/* ---------- размеры ---------- */
function size(){var r=cv.getBoundingClientRect();W=cv.clientWidth||800;H=cv.clientHeight||500;K=r.width/W||1;DPR=Math.min(3,(window.devicePixelRatio||1)*K);
  cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);clampY();draw()}
/* ---------- рисование ---------- */
var FONT="500 12px 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif",FONTB="600 12px 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif",FONTS="400 11px 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif";
var MW={};function mw(t,f){var k=f+'|'+t;if(MW[k]==null){ctx.font=f;MW[k]=ctx.measureText(t).width}return MW[k]}
var SEL=null,HOV=null,YSEL=null,HL=null,CUR=null,raf=0;
function draw(){if(!raf)raf=requestAnimationFrame(paint)}
function fy(y,short){if(y>=NOW)return 'наши дни';return y<0?(-y)+(short?' до н.э.':' до н. э.'):String(y)}
function ticks(){var ya=Math.max(Y0,XY(0)),yb=Math.min(NOW,XY(W)),out=[],xs=[],gap=TOUCH?78:86,mx=0;
  for(var i=1;i<KN.length;i++){var d=(KN[i][1]-KN[i-1][1])/(KN[i][0]-KN[i-1][0])*W/(V.u1-V.u0);if(d>mx)mx=d}
  [1000,500,100,50,10,5,1].forEach(function(s){if(s*mx<gap*.95)return;var y=Math.ceil(ya/s)*s;var n=0;
    for(;y<=yb&&n<4000;y+=s,n++){if(y===0)continue;var x=X(y),lo=0,hi=xs.length;while(lo<hi){var m=(lo+hi)>>1;if(xs[m]<x)lo=m+1;else hi=m}
      if((lo<xs.length&&xs[lo]-x<gap)||(lo>0&&x-xs[lo-1]<gap))continue;xs.splice(lo,0,x);out.splice(lo,0,{y:y,x:x,s:s})}});
  return out}
function rr(x,y,w,h,r){if(w<0){x+=w;w=-w}r=Math.max(0,Math.min(r,w/2,h/2));ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath()}
function dia(x,y,r){ctx.beginPath();ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath()}
function label(t,x0,x1,y,f,col){var av=x1-x0;if(av<14)return;ctx.font=f;ctx.fillStyle=col;var w=mw(t,f);
  if(w<=av){ctx.fillText(t,x0,y);return}
  var n=Math.max(1,Math.floor(t.length*av/w)-1);while(n>1&&mw(t.slice(0,n)+'…',f)>av)n--;if(av>22)ctx.fillText(t.slice(0,n)+'…',x0,y)}
var EVP=[],HDR=[];
function paint(){raf=0;var c=ctx;c.setTransform(DPR,0,0,DPR,0,0);c.clearRect(0,0,W,H);c.fillStyle=C.bg;c.fillRect(0,0,W,H);
  var T=ticks(),oy=TOP-V.sy,ya=XY(-40),yb=XY(W+40);c.textBaseline='middle';
  /* сетка */
  T.forEach(function(t){c.fillStyle=t.s>=500?C.ln:(C.dark?'rgba(255,255,255,.045)':'rgba(0,0,0,.05)');c.fillRect(Math.round(t.x),TOP,1,H-TOP)});
  /* граница эр (до/после н. э.) и «сейчас» */
  var x0=X(.5);if(x0>0&&x0<W){c.fillStyle=C.dark?'rgba(255,255,255,.12)':'rgba(0,0,0,.12)';c.fillRect(Math.round(x0),TOP,1,H-TOP)}
  HDR=[];EVP=[];
  LAY.forEach(function(L){var top=oy+L.y;if(top>H||top+L.h<TOP)return;
    if(L.k==='ev'){paintEv(top,L);return}
    var R=L.R;/* заголовок региона */
    c.fillStyle=C.dark?'rgba(255,255,255,.035)':'rgba(0,0,0,.028)';c.fillRect(0,top,W,HH);
    /* события региона ромбиками */
    R.evs.forEach(function(e){if(e.y<ya||e.y>yb)return;var x=X(e.y),on=SEL===e||HOV===e;c.fillStyle=on?C.ac:(e.w===1?C.a1:C.fa);dia(x,top+HH/2,on?6:(e.w===1?4.5:3.5));c.fill();EVP.push({e:e,x:x,y:top+HH/2,r:7})});
    var nm=R.name,nw=mw(nm,FONTB);
    var px=8,pw=nw+30;c.fillStyle=C.sf;rr(px-4,top+3,pw,HH-6,6);c.fill();c.strokeStyle=C.ln;c.lineWidth=1;c.stroke();
    c.fillStyle=C.mu;c.font=FONTB;c.fillText((L.f?'▸ ':'▾ ')+nm,px+2,top+HH/2+.5);HDR.push({R:R,x0:px-4,x1:px-4+pw,y0:top,y1:top+HH});
    if(L.f)return;
    R.rows.forEach(function(row,k){var y=top+HH+3+k*RH;if(y>H||y+RH<TOP)return;
      row.it.forEach(function(it){if(it.b<ya||it.a>yb)return;var a=X(it.a),b=X(Math.min(it.b,NOW)),w=Math.max(2,b-a);var bh=RH-4;
        var dim=HL&&HL!==it.s,on=SEL===it,hv=HOV===it;c.globalAlpha=dim?.22:1;
        var xa=Math.max(a,-4),xb=Math.min(a+w,W+4);
        if((it.fa||it.fb)&&w>10){var g=c.createLinearGradient(a,0,a+w,0),f=Math.min(.3,18/w),col=C.fill[it.s];g.addColorStop(0,it.fa?C.f0[it.s]:col);if(it.fa)g.addColorStop(f,col);if(it.fb)g.addColorStop(1-f,col);g.addColorStop(1,it.fb?C.f0[it.s]:col);
          c.save();rr(xa,y,xb-xa,bh,4);c.clip();c.fillStyle=C.bg;c.fillRect(xa,y,xb-xa,bh);c.fillStyle=g;c.fillRect(a,y,w,bh);c.restore()}
        else{c.fillStyle=C.fill[it.s];rr(xa,y,xb-xa,bh,4);c.fill()}
        if(on||hv){rr(xa+.5,y+.5,xb-xa-1,bh-1,4);c.strokeStyle=on?C.ac:C.fg;c.lineWidth=on?2:1.2;c.stroke()}
        else if(it.s!=='cul'){c.fillStyle=C.edge[it.s];c.fillRect(Math.max(a,xa),y+2,1.5,bh-4)}
        var tx=Math.max(a,0)+6;label(it.name,tx,Math.min(a+w,W)-5,y+bh/2+.5,it.s==='cul'?FONTS:FONT,C.txt[it.s]);c.globalAlpha=1;
        it._y=y;it._x0=a;it._x1=a+w})})});
  /* выбранный год */
  if(YSEL!=null){var xs=X(YSEL);if(xs>-2&&xs<W+2){c.fillStyle=C.ac;c.globalAlpha=.85;c.fillRect(Math.round(xs)-1,TOP,2,H-TOP);c.globalAlpha=1}}
  /* шапка: шкала и эпохи (поверх) */
  c.fillStyle=C.bg;c.fillRect(0,0,W,TOP);c.fillStyle=C.ln;c.fillRect(0,TOP-1,W,1);
  ERAS.forEach(function(e,i){var a=Math.max(X(e.a),0),b=Math.min(X(e.b),W);if(b<=a)return;c.fillStyle=SEL===e?(C.dark?'rgba(95,194,163,.22)':'rgba(31,107,87,.14)'):(i%2?(C.dark?'rgba(255,255,255,.06)':'rgba(0,0,0,.045)'):(C.dark?'rgba(255,255,255,.025)':'rgba(0,0,0,.018)'));c.fillRect(a,AX,b-a,ERH-1);
    var w=mw(e.name,FONTS),cx=Math.max(a+6,Math.min((a+b)/2-w/2,b-w-6));if(b-a>w+12){c.font=FONTS;c.fillStyle=C.mu;c.fillText(e.name,cx,AX+ERH/2)}else label(e.name,a+4,b-4,AX+ERH/2,FONTS,C.mu)});
  c.font=FONTS;T.forEach(function(t){var s=fy(t.y,true),w=mw(s,FONTS),x=Math.max(2,Math.min(W-w-2,t.x-w/2));c.fillStyle=t.s>=500?C.fg:C.mu;c.fillText(s,x,AX/2+1);c.fillStyle=C.ln;c.fillRect(Math.round(t.x),AX-5,1,5)});
  /* курсор */
  if(CUR!=null){var cy=XY(CUR),s=fy(Math.round(cy)===0?1:Math.round(cy)),w=mw(s,FONTB)+14,x=Math.max(0,Math.min(W-w,CUR-w/2));c.fillStyle=C.dark?'rgba(255,255,255,.35)':'rgba(0,0,0,.28)';c.fillRect(Math.round(CUR),TOP,1,H-TOP);
    c.fillStyle=C.fg;rr(x,3,w,AX-6,5);c.fill();c.font=FONTB;c.fillStyle=C.bg;c.fillText(s,x+7,AX/2+.5)}
  /* полоса прокрутки */
  var vh=H-TOP;if(CH>vh){var th=Math.max(30,vh*vh/CH),ty=TOP+(vh-th)*V.sy/(CH-vh);c.fillStyle=C.dark?'rgba(255,255,255,.18)':'rgba(0,0,0,.16)';rr(W-6,ty+2,4,th-4,2);c.fill()}}
function paintEv(top,L){var c=ctx,ya=XY(-40),yb=XY(W+40);c.fillStyle=C.dark?'rgba(255,255,255,.035)':'rgba(0,0,0,.028)';c.fillRect(0,top,W,HH);
  var nm='Главные события',nw=mw(nm,FONTB);c.fillStyle=C.sf;rr(4,top+3,nw+22,HH-6,6);c.fill();c.strokeStyle=C.ln;c.lineWidth=1;c.stroke();c.font=FONTB;c.fillStyle=C.mu;c.fillText(nm,15,top+HH/2+.5);
  var vis=EV.filter(function(e){return e.y>=ya&&e.y<=yb}).sort(function(p,q){return p.w-q.w||p.y-q.y}),rows=[];for(var i=0;i<EVR;i++)rows.push([]);
  var base=top+HH+2;
  vis.forEach(function(e){var x=X(e.y),w=mw(e.name,FONTS)+16,placed=-1;
    for(var r=0;r<EVR&&placed<0;r++){var ok=rows[r].every(function(s){return x+w<s[0]-4||x-6>s[1]+4});if(ok){rows[r].push([x-6,x+w]);placed=r}}
    var on=SEL===e||HOV===e;
    if(placed>=0){var y=base+placed*EVH+EVH/2;c.fillStyle=C.ln;c.fillRect(Math.round(x),base,1,placed*EVH+EVH/2);c.fillStyle=on?C.ac:(e.w===1?C.a1:C.fa);dia(x,y,on?5.5:4);c.fill();
      c.font=FONTS;c.fillStyle=on?C.ac:(e.w===1?C.fg:C.mu);c.fillText(e.name,x+8,y+.5);EVP.push({e:e,x:x,y:y,r:7,x1:x+w})}
    else{c.fillStyle=on?C.ac:C.fa;c.fillRect(Math.round(x),base,1,4);EVP.push({e:e,x:x,y:base+2,r:5})}})}
/* ---------- попадание ---------- */
function hit(x,y){if(y<AX)return {k:'ax',y:XY(x)};if(y<TOP){for(var i=0;i<ERAS.length;i++){var e=ERAS[i];if(x>=X(e.a)&&x<=X(e.b))return {k:'it',o:e}}return null}
  for(i=0;i<HDR.length;i++){var h=HDR[i];if(x>=h.x0&&x<=h.x1&&y>=h.y0&&y<=h.y1)return {k:'fold',R:h.R}}
  var best=null,bd=1e9;EVP.forEach(function(p){var d=Math.abs(p.x-x)+Math.abs(p.y-y)*1.2;if(p.x1&&x>=p.x-6&&x<=p.x1&&Math.abs(p.y-y)<EVH/2)d=0;if(d<p.r+(TOUCH?8:2)&&d<bd){bd=d;best=p.e}});if(best)return {k:'it',o:best};
  var cy=y+V.sy-TOP,yr=XY(x),tol=(TOUCH?10:3);
  for(var j=0;j<LAY.length;j++){var L=LAY[j];if(L.k!=='rg'||cy<L.y||cy>L.y+L.h)continue;if(L.f)break;var k=Math.floor((cy-L.y-HH-3)/RH);var row=L.R.rows[k];if(!row)break;
    var hit2=null;row.it.forEach(function(it){if(it._x0!=null&&x>=it._x0-tol&&x<=Math.max(it._x1,it._x0+2)+tol)hit2=it});if(hit2)return {k:'it',o:hit2};break}
  return {k:'yr',y:yr}}
/* ---------- вид: анимация, масштаб ---------- */
var anim=0;
function minSpan(c){var y=u2y(c);return Math.max(1e-5,y2u(y+3)-y2u(y-3))}
function setView(u0,u1,sy){var s=u1-u0,ms=minSpan((u0+u1)/2);if(s<ms){var c=(u0+u1)/2;u0=c-ms/2;u1=c+ms/2;s=ms}if(s>1.2){u0=-.1;u1=1.1;s=1.2}
  if(u0<-.08*s-.02){u1+=(-.08*s-.02)-u0;u0=-.08*s-.02}if(u1>1+.08*s+.02){u0-=u1-(1+.08*s+.02);u1=1+.08*s+.02}
  V.u0=u0;V.u1=u1;if(sy!=null)V.sy=sy;clampY();draw();preOn()}
function animTo(u0,u1,sy){cancelAnimationFrame(anim);var a={u0:V.u0,u1:V.u1,sy:V.sy},t0=performance.now(),D0=matchMedia('(prefers-reduced-motion:reduce)').matches?1:380;
  function st2(t){var k=Math.min(1,(t-t0)/D0);k=1-Math.pow(1-k,3);setView(a.u0+(u0-a.u0)*k,a.u1+(u1-a.u1)*k,sy==null?null:a.sy+(sy-a.sy)*k);if(k<1)anim=requestAnimationFrame(st2)}anim=requestAnimationFrame(st2)}
function zoomAt(x,f){var u=V.u0+x/W*(V.u1-V.u0);setView(u-(u-V.u0)*f,u+(V.u1-u)*f)}
function usableW(){return !hp.hidden&&W>720?W-400:W}
function fitYears(a,b,sy){var ua=y2u(a),ub=y2u(Math.min(b,NOW)),uw=usableW(),pad=(ub-ua)*.12+1e-4,span=(ub-ua+2*pad)*W/uw;animTo(ua-pad,ua-pad+span,sy)}
function rowY(it){for(var j=0;j<LAY.length;j++){var L=LAY[j];if(L.k==='rg'&&L.R.id===it.r)return L.f?L.y:L.y+HH+3+it.row*RH}return 0}
function scrollTo(it){var y=rowY(it),vh=H-TOP-(hp.hidden||W>720?0:H*.62);if(y-V.sy<20||y-V.sy>vh-40)return Math.max(0,y-Math.max(30,vh*.35));return null}
var PRE={all:[Y0,NOW],anc:[-3500,-500],ant:[-800,520],mid:[450,1520],new:[1480,1925],xx:[1895,NOW]};
function preOn(){var k=null;Object.keys(PRE).forEach(function(p){var a=y2u(PRE[p][0]),b=y2u(PRE[p][1]),s=b-a;if(Math.abs(V.u0-(a-s*.03))<s*.08&&Math.abs(V.u1-(b+s*.03))<s*.08)k=p});
  document.querySelectorAll('#hpre button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-pre')===k)})}
function goPre(p){var r=PRE[p];if(!r)return;var a=y2u(r[0]),b=y2u(r[1]),s=b-a;animTo(a-s*.03,b+s*.03)}
/* ---------- карточки ---------- */
function plural(n,a,b,c){var m=n%10,h=n%100;return n+' '+(m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c)}
function dur(a,b){var n=Math.min(b,NOW)-a-(a<0&&b>0?1:0);return n<1?'меньше года':plural(n,'год','года','лет')}
function span(o){return (o.fa?'около ':'')+fy(o.a)+' – '+(o.b>=NOW?'наши дни':(o.fb?'около ':'')+fy(o.b))}
function chip(o,extra){var col=o.t==='s'?sw(o.s):(o.t==='e'?C.a1:C.fa);return '<li><button type="button" data-go="'+o.id+'"><i style="background:'+col+'"></i><span><b>'+esc(o.name)+'</b>'+(extra?'<em>'+esc(extra)+'</em>':'')+'</span><small>'+(o.t==='e'?fy(o.y):span(o).replace(/около /g,'~'))+'</small></button></li>'}
function wiki(n){return 'https://ru.wikipedia.org/w/index.php?search='+encodeURIComponent(n)}
function openP(html){hpc.innerHTML=html;hp.hidden=false;box.classList.add('pon');hpc.scrollTop=0;draw()}
function closeP(){hp.hidden=true;box.classList.remove('pon');SEL=null;YSEL=null;setHash('');draw()}
function alive(y,r){return IT.filter(function(x){return x.a<=y&&x.b>y&&(!r||x.r===r)})}
function showItem(o,fit){SEL=o;YSEL=null;var h='';
  if(o.t==='s'){var R=REG[o.r];
    h+='<div class="k"><i style="background:'+sw(o.s)+'"></i>'+esc(SPH[o.s][0])+' · '+esc(R.name)+'</div><h2>'+esc(o.name)+'</h2><div class="yr">'+span(o)+' <span>· '+dur(o.a,o.b)+'</span></div><p class="d">'+esc(o.d)+'</p>';
    h+='<div class="act"><button type="button" class="pri" data-fit="'+o.id+'">Показать на ленте</button><button type="button" data-year="'+Math.round((o.a+Math.min(o.b,NOW))/2)+'">Мир в те годы</button><a href="'+wiki(o.name.replace(/\s*\(.*\)$/,''))+'" target="_blank" rel="noopener">Википедия ↗</a></div>';
    var pre=R.items.filter(function(x){return x!==o&&x.s!=='cul'&&x.b>=o.a-60&&x.b<=o.a+40&&x.a<o.a}).sort(function(p,q){return Math.abs(p.b-o.a)-Math.abs(q.b-o.a)}).slice(0,3),
        nx=R.items.filter(function(x){return x!==o&&x.s!=='cul'&&x.a>=o.b-40&&x.a<=o.b+60&&x.b>o.b}).sort(function(p,q){return Math.abs(p.a-o.b)-Math.abs(q.a-o.b)}).slice(0,3);
    if(pre.length||nx.length){h+='<h3>До и после в регионе</h3><ul>'+pre.map(function(x){return chip(x,'раньше')}).join('')+nx.map(function(x){return chip(x,'позже')}).join('')+'</ul>'}
    var ev=EV.filter(function(e){return e.r===o.r&&e.y>=o.a&&e.y<=o.b}).slice(0,10);if(ev.length)h+='<h3>События</h3><ul>'+ev.map(function(e){return chip(e)}).join('')+'</ul>';
    var same=[],a=o.a,b=Math.min(o.b,NOW);D.regions.forEach(function(r){if(r[0]===o.r)return;var best=null,bo=0;REG[r[0]].items.forEach(function(x){var ov=Math.min(x.b,b)-Math.max(x.a,a);if(ov<=0)return;var sc=ov*(x.s==='cul'?.3:1);if(sc>bo){bo=sc;best=x}});if(best)same.push([bo,best,r[1]])});
    same.sort(function(p,q){return q[0]-p[0]});if(same.length)h+='<h3>В это же время в мире</h3><ul>'+same.slice(0,10).map(function(s){return chip(s[1],s[2])}).join('')+'</ul>';
  }else if(o.t==='e'){var R2=REG[o.r];
    h+='<div class="k"><i style="background:'+C.a1+';transform:rotate(45deg) scale(.8)"></i>Событие · '+esc(R2.name)+'</div><h2>'+esc(o.name)+'</h2><div class="yr">'+fy(o.y)+'</div><p class="d">'+esc(o.d)+'</p>';
    h+='<div class="act"><button type="button" class="pri" data-year="'+o.y+'">Весь мир в '+(o.y<0?fy(o.y):o.y+' году')+'</button><a href="'+wiki(o.name)+'" target="_blank" rel="noopener">Википедия ↗</a></div>';
    var al=alive(o.y,o.r);if(al.length)h+='<h3>Кто правил в регионе</h3><ul>'+al.map(function(x){return chip(x)}).join('')+'</ul>';
    var nb=EV.filter(function(e){return e!==o&&Math.abs(e.y-o.y)<=(o.y<0?150:30)}).sort(function(p,q){return Math.abs(p.y-o.y)-Math.abs(q.y-o.y)}).slice(0,6);if(nb.length)h+='<h3>Рядом по времени</h3><ul>'+nb.map(function(e){return chip(e,REG[e.r].name)}).join('')+'</ul>';
  }else{h+='<div class="k">Эпоха</div><h2>'+esc(o.name)+'</h2><div class="yr">'+fy(o.a)+' – '+fy(o.b)+' <span>· '+dur(o.a,o.b)+'</span></div><p class="d">'+esc(o.d)+'</p><div class="act"><button type="button" class="pri" data-fit="'+o.id+'">Показать эпоху</button></div>';
    var big=EV.filter(function(e){return e.w===1&&e.y>=o.a&&e.y<o.b});if(big.length)h+='<h3>Главные события</h3><ul>'+big.map(function(e){return chip(e,REG[e.r].name)}).join('')+'</ul>'}
  openP(h);setHash((o.t==='e'?'e=':o.t==='r'?'era=':'s=')+o.id.replace(/^era/,''));
  if(fit){if(o.t==='e'){var u=y2u(o.y),s=Math.min(V.u1-V.u0,y2u(o.y+60)-y2u(o.y-60)),uw=usableW(),S=s*W/uw;animTo(u-s/2,u-s/2+S,0)}else fitYears(o.a,o.b,o.t==='s'?scrollTo(o):null)}}
function showYear(y,center){y=Math.round(y);if(y===0)y=1;y=Math.max(Y0,Math.min(NOW,y));SEL=null;YSEL=y;var t=y<0?fy(y)+' год':y+' год',era=ERAS.filter(function(e){return y>=e.a&&y<e.b})[0];
  var sp=Math.max(1,Math.round(Math.abs(XY(W/2+120)-XY(W/2))));var b1=sp>=100?100:sp>=10?10:1,b2=b1*10;
  var h='<div class="k">'+(era?'Эпоха: '+esc(era.name):'')+'</div><h2>'+(y<0?(-y)+' год до н. э.':y+' год')+'</h2>'+
    '<div class="nav"><button type="button" data-year="'+(y-b2)+'">−'+b2+'</button><button type="button" data-year="'+(y-b1)+'">−'+b1+'</button><button type="button" data-year="'+(y+b1)+'">+'+b1+'</button><button type="button" data-year="'+(y+b2)+'">+'+b2+'</button></div>';
  var win=Math.max(y<-1000?100:y<500?30:y<1800?15:5,Math.round(sp/3)),ev=EV.filter(function(e){return Math.abs(e.y-y)<=win}).sort(function(p,q){return Math.abs(p.y-y)-Math.abs(q.y-y)}).slice(0,8);
  if(ev.length)h+='<h3>События рядом ('+(win>1?'±'+plural(win,'год','года','лет'):'этот год')+')</h3><ul>'+ev.map(function(e){return chip(e,REG[e.r].name)}).join('')+'</ul>';
  h+='<h3>Что было в мире</h3>';var any=false;
  D.regions.forEach(function(r){var al=alive(y,r[0]).sort(function(p,q){return (p.s==='cul')-(q.s==='cul')||(p.b-p.a)-(q.b-q.a)});if(!al.length)return;any=true;h+='<div class="rg">'+esc(r[1])+'</div><ul>'+al.map(function(x){return chip(x)}).join('')+'</ul>'});
  if(!any)h+='<p class="none">Для этого года нет записей.</p>';
  openP(h);setHash('y='+y);if(center){var u=y2u(y),S=V.u1-V.u0;if(S>.6)S=(y2u(y+250)-y2u(y-250))*W/usableW();var a=u-S*usableW()/W/2;animTo(a,a+S)}}
function setHash(h){try{history.replaceState(null,'',h?'#'+h:location.pathname+location.search)}catch(e){}}
function route(){var h=decodeURIComponent((location.hash||'').slice(1)),m;
  if((m=h.match(/^y=(-?\d+)/)))showYear(+m[1],true);
  else if((m=h.match(/^s=(.+)$/))&&BYID[m[1]])showItem(BYID[m[1]],true);
  else if((m=h.match(/^e=(.+)$/))&&BYID[m[1]])showItem(BYID[m[1]],true);
  else if((m=h.match(/^era=(\d+)$/))&&BYID['era'+m[1]])showItem(BYID['era'+m[1]],true)}
/* ---------- указатель ---------- */
var P={},drag=null,pinch=null,moved=false,lastTap=0;
function pt(e){var r=cv.getBoundingClientRect();return {x:(e.clientX-r.left)/K,y:(e.clientY-r.top)/K}}
cv.addEventListener('pointerdown',function(e){if(e.button>0)return;cv.setPointerCapture(e.pointerId);var p=pt(e);P[e.pointerId]=p;var ids=Object.keys(P);
  if(ids.length===2){var a=P[ids[0]],b=P[ids[1]];pinch={d:Math.max(30,Math.abs(a.x-b.x)),u0:V.u0,u1:V.u1,cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,sy:V.sy};drag=null;moved=true}
  else{drag={x:p.x,y:p.y,u0:V.u0,u1:V.u1,sy:V.sy,sb:p.x>W-14&&p.y>TOP};moved=false}tip.hidden=true});
cv.addEventListener('pointermove',function(e){var p=pt(e);if(P[e.pointerId])P[e.pointerId]=p;
  if(pinch){var ids=Object.keys(P);if(ids.length<2)return;var a=P[ids[0]],b=P[ids[1]],d=Math.max(30,Math.abs(a.x-b.x)),f=pinch.d/d,cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
    var s=(pinch.u1-pinch.u0)*f,uc=pinch.u0+pinch.cx/W*(pinch.u1-pinch.u0);var u0=uc-cx/W*s;V.sy=pinch.sy-(cy-pinch.cy);setView(u0,u0+s);return}
  if(drag){var dx=p.x-drag.x,dy=p.y-drag.y;if(!moved&&Math.abs(dx)+Math.abs(dy)>(e.pointerType==='touch'?8:4)){moved=true;cv.classList.add('dr');CUR=null}
    if(moved){if(drag.sb){var vh=H-TOP;V.sy=drag.sy+dy*CH/vh;clampY();draw();return}var du=dx/W*(drag.u1-drag.u0);V.sy=drag.sy-dy;setView(drag.u0-du,drag.u1-du)}return}
  if(e.pointerType==='mouse'){var h=hit(p.x,p.y),o=h&&h.k==='it'?h.o:null;if(o!==HOV){HOV=o}cv.classList.toggle('pt',!!(o||h&&h.k==='fold'));CUR=p.y>=TOP||p.y<AX?p.x:null;
    if(o){tip.innerHTML=esc(o.name)+'<small>'+(o.t==='e'?fy(o.y):span(o))+'</small>';tip.hidden=false;var tw=tip.offsetWidth,th=tip.offsetHeight;tip.style.left=Math.min(W-tw-8,p.x+14)+'px';tip.style.top=(p.y+18+th>H?p.y-th-10:p.y+18)+'px'}else tip.hidden=true;draw()}});
function up(e){var p=pt(e),was=P[e.pointerId];delete P[e.pointerId];if(Object.keys(P).length<2)pinch=null;cv.classList.remove('dr');
  if(drag&&!moved&&was){var now=Date.now();if(e.pointerType!=='mouse'&&now-lastTap<300){zoomAt(p.x,.5);lastTap=0;drag=null;return}lastTap=now;click(p.x,p.y)}
  if(!Object.keys(P).length)drag=null}
cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',function(e){delete P[e.pointerId];pinch=null;drag=null});
cv.addEventListener('pointerleave',function(e){if(e.pointerType==='mouse'){HOV=null;CUR=null;tip.hidden=true;draw()}});
cv.addEventListener('dblclick',function(e){var p=pt(e);zoomAt(p.x,.45)});
function click(x,y){var h=hit(x,y);if(!h)return;
  if(h.k==='fold'){fold[h.R.id]=!fold[h.R.id];st('ist:fold',JSON.stringify(fold));layout();draw();syncFold();return}
  if(h.k==='it'){showItem(h.o,h.o.t==='r');return}
  showYear(h.y,false)}
box.addEventListener('wheel',function(e){if(e.target!==cv)return;e.preventDefault();var p=pt(e),dy=e.deltaMode===1?e.deltaY*16:e.deltaY,dx=e.deltaMode===1?e.deltaX*16:e.deltaX;
  if(e.shiftKey&&!e.ctrlKey){V.sy+=dy||dx;clampY();draw();return}
  if(Math.abs(dx)>Math.abs(dy)&&!e.ctrlKey){var du=dx/W*(V.u1-V.u0);setView(V.u0+du,V.u1+du);return}
  zoomAt(p.x,Math.exp(dy*(e.ctrlKey?.01:.0018)));tip.hidden=true},{passive:false});
box.addEventListener('keydown',function(e){if(e.target!==box)return;var s=V.u1-V.u0,k=e.key;
  if(k==='ArrowLeft'){setView(V.u0-s*.12,V.u1-s*.12)}else if(k==='ArrowRight'){setView(V.u0+s*.12,V.u1+s*.12)}
  else if(k==='ArrowUp'){V.sy-=60;clampY();draw()}else if(k==='ArrowDown'){V.sy+=60;clampY();draw()}
  else if(k==='+'||k==='='){zoomAt(W/2,.7)}else if(k==='-'||k==='_'){zoomAt(W/2,1/.7)}else if(k==='0'){goPre('all')}
  else return;e.preventDefault()});
document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;if(document.activeElement===document.getElementById('hq')&&!res.hidden){res.hidden=true;return}if(box.classList.contains('full')){full(false);return}if(!hp.hidden)closeP()});
/* кнопки */
box.querySelector('.hctl').addEventListener('click',function(e){var b=e.target.closest('[data-z]');if(!b)return;var z=b.getAttribute('data-z');
  if(z==='in')animTo.apply(null,(function(){var c=(V.u0+V.u1)/2,s=(V.u1-V.u0)*.55;return [c-s/2,c+s/2]})());else if(z==='out')animTo.apply(null,(function(){var c=(V.u0+V.u1)/2,s=(V.u1-V.u0)/.55;return [c-s/2,c+s/2]})());
  else if(z==='all')goPre('all');else if(z==='full')full(!box.classList.contains('full'))});
function full(on){box.classList.toggle('full',on);document.documentElement.style.overflow=on?'hidden':'';setTimeout(size,30);box.focus()}
document.getElementById('hpx').addEventListener('click',closeP);
hpc.addEventListener('click',function(e){var g=e.target.closest('[data-go]');if(g){var o=BYID[g.getAttribute('data-go')];if(o)showItem(o,true);return}
  var f=e.target.closest('[data-fit]');if(f){var o2=BYID[f.getAttribute('data-fit')];if(o2){if(o2.t==='s')fitYears(o2.a,o2.b,scrollTo(o2));else fitYears(o2.a,o2.b)}return}
  var y=e.target.closest('[data-year]');if(y){showYear(+y.getAttribute('data-year'),true)}});
document.getElementById('hpre').addEventListener('click',function(e){var b=e.target.closest('[data-pre]');if(b)goPre(b.getAttribute('data-pre'))});
var cb=document.getElementById('hcomp');cb.setAttribute('aria-pressed',comp?'true':'false');
cb.addEventListener('click',function(){var ya=XY(0),yb=XY(W);comp=!comp;KN=comp?KC:KL;st('ist:comp',comp?'1':'0');cb.setAttribute('aria-pressed',comp?'true':'false');var a=y2u(ya),b=y2u(yb);setView(a,b)});
var fb=document.getElementById('hfold');
function syncFold(){var all=D.regions.every(function(r){return fold[r[0]]});fb.setAttribute('aria-pressed',all?'true':'false');fb.textContent=all?'Развернуть регионы':'Свернуть регионы'}
fb.addEventListener('click',function(){var all=D.regions.every(function(r){return fold[r[0]]});D.regions.forEach(function(r){fold[r[0]]=!all});st('ist:fold',JSON.stringify(fold));layout();syncFold();draw()});
/* легенда: нажатие подсвечивает сферу */
function legend(){var el=document.getElementById('hleg');el.innerHTML=Object.keys(SPH).map(function(k){return '<button type="button" data-hl="'+k+'" class="'+(HL===k?'on':'')+'"><i style="background:'+sw(k)+'"></i>'+esc(SPH[k][0])+'</button>'}).join('')}
document.getElementById('hleg').addEventListener('click',function(e){var b=e.target.closest('[data-hl]');if(!b)return;var k=b.getAttribute('data-hl');HL=HL===k?null:k;legend();draw()});
/* ---------- поиск ---------- */
var q=document.getElementById('hq'),res=document.getElementById('hres'),RS=[],ri=-1;
var LAT='qwertyuiop[]asdfghjkl;\'zxcvbnm,.',RUS='йцукенгшщзхъфывапролджэячсмитьбю';
function swap(s){return s.split('').map(function(c){var i=LAT.indexOf(c);return i>=0?RUS[i]:c}).join('')}
function parseYear(s){var m=lc(s).replace(/\s+/g,' ').trim().match(/^(-|минус )?(\d{1,4})( ?(г|год|года|году)\.?)?( ?(до н\.? ?э\.?|до нашей эры|до|bc))?$/);if(!m)return null;var y=+m[2];if(m[1]||m[5])y=-y;if(y===0||y<Y0||y>NOW)return null;return y}
function search(){var s=lc(q.value.trim());RS=[];ri=-1;if(!s){res.hidden=true;return}
  var y=parseYear(s);if(y!=null)RS.push({t:'y',y:y});
  var vs=[s];if(/[a-z]/.test(s))vs.push(swap(s));
  var sc=[];IT.concat(EV,ERAS).forEach(function(o){var n=lc(o.name),d=lc(o.d||''),best=0;vs.forEach(function(v){var p=0;if(n===v)p=100;else if(n.indexOf(v)===0)p=80;else if(new RegExp('(^|[\\s(«-])'+v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(n))p=65;else if(n.indexOf(v)>=0)p=50;else if(v.length>=4&&d.indexOf(v)>=0)p=20;if(p>best)best=p});if(best)sc.push([best,o])});
  sc.sort(function(a,b){return b[0]-a[0]||(a[1].t==='e')-(b[1].t==='e')||a[1].name.length-b[1].name.length});sc.slice(0,12).forEach(function(x){RS.push({t:'o',o:x[1]})});
  if(!RS.length){res.innerHTML='<p>Ничего не нашёл. Попробуй другое название или год: «1812», «500 до н. э.».</p>';res.hidden=false;return}
  res.innerHTML=RS.map(function(r,i){if(r.t==='y')return '<button type="button" data-i="'+i+'"><i style="background:'+C.ac+'"></i>Перейти к году: '+(r.y<0?fy(r.y):r.y)+'<small></small></button>';var o=r.o,col=o.t==='s'?sw(o.s):o.t==='e'?C.a1:C.fa;
    return '<button type="button" data-i="'+i+'"><i style="background:'+col+'"></i>'+esc(o.name)+'<small>'+(o.t==='e'?fy(o.y):fy(o.a)+' – '+fy(o.b))+'</small><em>'+(o.t==='s'?esc(REG[o.r].name):o.t==='e'?'Событие · '+esc(REG[o.r].name):'Эпоха')+'</em></button>'}).join('');res.hidden=false}
function pick(i){var r=RS[i];if(!r)return;res.hidden=true;q.blur();if(r.t==='y')showYear(r.y,true);else showItem(r.o,true)}
q.addEventListener('input',search);q.addEventListener('focus',function(){if(q.value.trim())search()});
q.addEventListener('keydown',function(e){if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(!RS.length)return;ri=(ri+(e.key==='ArrowDown'?1:-1)+RS.length)%RS.length;res.querySelectorAll('button').forEach(function(b,i){b.classList.toggle('on',i===ri)});e.preventDefault()}
  else if(e.key==='Enter'){e.preventDefault();pick(ri<0?0:ri)}});
res.addEventListener('mousedown',function(e){e.preventDefault()});
res.addEventListener('click',function(e){var b=e.target.closest('[data-i]');if(b)pick(+b.getAttribute('data-i'))});
document.addEventListener('click',function(e){if(!e.target.closest('#hs'))res.hidden=true});
/* ---------- старт ---------- */
layout();theme();size();
var a0=y2u(Y0),b0=y2u(NOW);setView(a0-(b0-a0)*.03,b0+(b0-a0)*.03,0);
if(location.hash)route();
window.addEventListener('hashchange',route);
window.addEventListener('resize',function(){size()});
try{new ResizeObserver(function(){size()}).observe(box)}catch(e){}
try{new MutationObserver(function(){setTimeout(theme,30)}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-skin']});matchMedia('(prefers-color-scheme:dark)').addEventListener('change',theme)}catch(e){}
try{document.fonts.ready.then(function(){MW={};draw()})}catch(e){}
syncFold();
})();
