(function(){
"use strict";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
if(!window.THREE||!window.mapboxgl){$("#load").textContent="Couldn't load the map engine. Check your connection and reload.";return;}
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow=()=>innerWidth<=820;
const E=MetroEngine(DATA);
const ORDER=["purple","green","yellow","pink","blue"];
const routes=ORDER.map(c=>E.byColor[c]);
const hm=(s,sec)=>{s=Math.floor(s);const h=Math.floor(s/3600)%24,m=Math.floor(s%3600/60),x=s%60;return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+(sec?":"+String(x).padStart(2,"0"):"");};
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const slug=s=>s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const stations=E.feats.filter(f=>f.kind==="station"&&f.routes.length);
stations.forEach(f=>{f.slug=slug(f.name);f.colors=[...new Set(f.routes.map(r=>r.route.color))];f.ix=f.colors.length>1;f.terminal=f.routes.some(st=>st.idx===0||st.idx===st.route.stops.length-1);f.open=f.routes.some(st=>st.route.status==="open");});
const byName=new Map(stations.map(f=>[f.name.toLowerCase(),f]));
const rng=(s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;})(20111020);

/* ---------- theme ---------- */
const T={};const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const TK=["silver","sky","ink","ink-2","concrete","ballast","tunnel","lamp","panel-solid","rain","person","brand",...ORDER];
const readTheme=()=>TK.forEach(k=>T[k]=css("--"+k));readTheme();
const col=k=>new THREE.Color(T[k]);
const M=new THREE.Matrix4(),Q=new THREE.Quaternion(),Q2=new THREE.Quaternion(),V=new THREE.Vector3(),S=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0),AX=new THREE.Vector3(1,0,0),C=new THREE.Color();

/* ---------- map ---------- */
mapboxgl.accessToken=window.MAPBOX_TOKEN||"";
if(!mapboxgl.accessToken){$("#load").textContent="No Mapbox token configured. Set MAPBOX_TOKEN in .env (local) or in Netlify environment variables.";return;}
const HOME={center:[77.605,12.965],zoom:11.3,pitch:58,bearing:-18};
/* basemap palettes: "vivid" recolours Mapbox Standard; "classic" keeps Mapbox defaults */
const VIVID={colorLand:"#fff6ee",colorWater:"#2bb3ff",colorGreenspace:"#3fd27a",colorBuildings:"#ffd7c2",colorCommercial:"#ffd0e4",colorEducation:"#ffe27a",
  colorMedical:"#ffb3b3",colorIndustrial:"#d4cbff",colorMotorways:"#ff8a3d",colorTrunks:"#ffb43d",colorRoads:"#ffffff",show3dTrees:true,show3dLandmarks:true,show3dFacades:true,show3dBuildings:false};
/* building colours: low and mid-rise pick one of eight shades per building; towers run indigo → violet → magenta with height */
const BLDG=["#ffa5b8","#ffc085","#ffe08a","#8fe8c3","#86d3ff","#b9a6ff","#ffb0ec","#aee88a"];
let palette="vivid",satellite=false,xray=false;
function syncBuildings(){try{map.getLayer("color-bldg")&&map.setLayoutProperty("color-bldg","visibility",palette==="vivid"&&!satellite&&!xray?"visible":"none");}catch(e){}}
const baseConfig=preset=>({lightPreset:preset,showPointOfInterestLabels:false,showTransitLabels:false,...(palette==="vivid"?VIVID:{})});
/* sky colours per light preset (used when the weather is clear) */
const SKY={dawn:{color:"#ffc7a8","high-color":"#8a6bff","horizon-blend":.14,"space-color":"#2a2466","star-intensity":.1},
  day:{color:"#ffe2cf","high-color":"#4f8dff","horizon-blend":.1,"space-color":"#1c3a8a","star-intensity":0},
  dusk:{color:"#ff9d7a","high-color":"#6a3fb5","horizon-blend":.16,"space-color":"#24124a","star-intensity":.2},
  night:{color:"#2a2f5a","high-color":"#0f1440","horizon-blend":.12,"space-color":"#05061a","star-intensity":.6}};
const map=new mapboxgl.Map({container:"stage",style:"mapbox://styles/mapbox/standard",...HOME,maxPitch:85,antialias:true,attributionControl:false,
  config:{basemap:baseConfig("day")}});
map.addControl(new mapboxgl.AttributionControl({compact:true}),"bottom-left");

/* local metric frame anchored at Majestic: x east, z south, y up, in metres, exact in Web Mercator */
const ORIGIN=[77.5730,12.9757];
const O=mapboxgl.MercatorCoordinate.fromLngLat(ORIGIN,0),MS=O.meterInMercatorCoordinateUnits();
const llToLocal=(lon,lat)=>{const m=mapboxgl.MercatorCoordinate.fromLngLat([lon,lat],0);return [(m.x-O.x)/MS,(m.y-O.y)/MS];};
const engToLocal=(x,y)=>{const [lo,la]=E.toLL(x,y);return llToLocal(lo,la);};
const localToLL=(X,Z)=>{const ll=new mapboxgl.MercatorCoordinate(O.x+X*MS,O.y+Z*MS,0).toLngLat();return [ll.lng,ll.lat];};
/* a route sample in local metres, with heading */
function at(R,s){const p=E.pointAt(R,s),[X,Z]=engToLocal(p.x,p.y),q=E.pointAt(R,Math.min(R.len,Math.max(0,s+1))),[X2,Z2]=engToLocal(q.x,q.y);
  let dx=X2-X,dz=Z2-Z;if(s>=R.len-1){const r=E.pointAt(R,s-1),[X0,Z0]=engToLocal(r.x,r.y);dx=X-X0;dz=Z-Z0;}const L=Math.hypot(dx,dz)||1;return {X,Z,h:p.h,dx:dx/L,dz:dz/L};}

/* ---------- three.js scene in the custom layer ---------- */
const scene=new THREE.Scene(),camera=new THREE.Camera();
const hemi=new THREE.HemisphereLight(0xffffff,0x40506a,.75);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,.8);sun.position.set(-1,2,.6);scene.add(sun);
const twin=new THREE.Group();scene.add(twin);
const wideU={value:1};let lenK=1;
const lateral=mat=>{mat.onBeforeCompile=sh=>{sh.uniforms.uWide=wideU;
  sh.vertexShader="attribute vec2 aLat;\nuniform float uWide;\n"+sh.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\ntransformed.x+=aLat.x*uWide;transformed.z+=aLat.y*uWide;");};return mat;};
const visible={};ORDER.forEach(c=>visible[c]=true);
const groups={};ORDER.forEach(c=>{groups[c]=new THREE.Group();twin.add(groups[c]);});

/* U-girder deck, metres: [l0,v0,l1,v1, normal l, normal v, part] */
const PROF=[[-5,-1.8,5,-1.8,0,-1,0],[5,-1.8,5,1.1,1,0,0],[5,1.1,4.6,1.1,0,1,1],[4.6,1.1,4.6,0,-1,0,1],[4.6,0,-4.6,0,0,1,2],[-4.6,0,-4.6,1.1,1,0,1],[-4.6,1.1,-5,1.1,0,1,1],[-5,1.1,-5,-1.8,-1,0,0]];
const decks=[];
function buildDeck(R){
  const step=12,n=Math.ceil(R.len/step)+1,smp=[];
  for(let k=0;k<n;k++)smp.push(at(R,Math.min(R.len,k*step)));
  const lat=smp.map((p,k)=>{const a=smp[Math.max(0,k-1)],b=smp[Math.min(n-1,k+1)];const dx=b.X-a.X,dz=b.Z-a.Z,L=Math.hypot(dx,dz)||1;return [-dz/L,dx/L];});
  const nv=n*PROF.length*2,pos=new Float32Array(nv*3),al=new Float32Array(nv*2),nor=new Float32Array(nv*3),colA=new Float32Array(nv*3),part=new Uint8Array(nv),under=new Uint8Array(nv),idx=[];
  let v=0;
  PROF.forEach(([l0,v0,l1,v1,nl,nvv,pt])=>{const base=v;
    for(let k=0;k<n;k++){const p=smp[k],[lx,lz]=lat[k];
      for(const [l,vv] of [[l0,v0],[l1,v1]]){pos.set([p.X,p.h+vv,p.Z],v*3);al.set([lx*l,lz*l],v*2);nor.set([lx*nl,nvv,lz*nl],v*3);part[v]=pt;under[v]=p.h<-1?1:0;v++;}}
    for(let k=0;k<n-1;k++){const a=base+k*2,b=a+2;idx.push(a,b,a+1,a+1,b,b+1);}});
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.setAttribute("aLat",new THREE.BufferAttribute(al,2));
  g.setAttribute("normal",new THREE.BufferAttribute(nor,3));g.setAttribute("color",new THREE.BufferAttribute(colA,3));g.setIndex(idx);
  const open=R.status==="open";
  const mesh=new THREE.Mesh(g,lateral(new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.85,transparent:!open,opacity:open?1:.55,depthWrite:open})));
  mesh.frustumCulled=false;decks.push({R,g,part,under});groups[R.color].add(mesh);
}
function colourDecks(){
  const c=new THREE.Color(),line=new THREE.Color(),bed=new THREE.Color(),con=col("concrete"),tun=col("tunnel");
  decks.forEach(({R,g,part,under})=>{line.set(T[R.color]);bed.copy(line).lerp(col("ballast"),.25);
    if(R.status!=="open"){line.lerp(con,.35);bed.lerp(con,.5);}
    const a=g.attributes.color;
    for(let i=0;i<part.length;i++){if(under[i])c.copy(line).lerp(tun,.3);else c.copy(part[i]===0?line:part[i]===1?con:bed);a.setXYZ(i,c.r,c.g,c.b);}
    a.needsUpdate=true;});
}
routes.forEach(buildDeck);

/* piers every 30 m where the deck is above 3 m */
const piers=[];
routes.forEach(R=>{for(let s=15;s<R.len;s+=30){const p=at(R,s);if(p.h>3)piers.push({R,X:p.X,Z:p.Z,top:p.h-1.8,ang:Math.atan2(p.dx,p.dz)});}});
const colGeo=new THREE.CylinderGeometry(.9,1.1,1,12);colGeo.translate(0,.5,0);
const capGeo=new THREE.BoxGeometry(7.5,2.2,2.2);capGeo.translate(0,-1.1,0);
const pierMat=new THREE.MeshStandardMaterial({roughness:.95}),pierGhost=new THREE.MeshStandardMaterial({roughness:.95,transparent:true,opacity:.45});
const pierSets=[true,false].map(open=>{const list=piers.filter(p=>(p.R.status==="open")===open),m=open?pierMat:pierGhost;
  const c=new THREE.InstancedMesh(colGeo,m,list.length),k=new THREE.InstancedMesh(capGeo,m,list.length);c.frustumCulled=k.frustumCulled=false;twin.add(c,k);return {list,c,k};});

/* stations */
const box=()=>{const g=new THREE.BoxGeometry(1,1,1);g.translate(0,.5,0);return g;};
const stops=routes.flatMap(R=>R.stops);
stops.forEach(st=>{st.p=at(st.route,st.ch);st.ang=Math.atan2(st.p.dx,st.p.dz);});
const elev=stops.filter(st=>!st.under),ug=stops.filter(st=>st.under);
const roofMat=new THREE.MeshStandardMaterial({roughness:.5,emissive:new THREE.Color(0),side:THREE.DoubleSide});
const concMat=new THREE.MeshStandardMaterial({roughness:.8}),platMat=new THREE.MeshStandardMaterial({roughness:.7});
const ugMat=new THREE.MeshStandardMaterial({roughness:.6,transparent:true,opacity:.8});
const roofM=new THREE.InstancedMesh(box(),roofMat,elev.length),concM=new THREE.InstancedMesh(box(),concMat,elev.length);
const platM=new THREE.InstancedMesh(box(),platMat,stops.length*2);
const ugM=new THREE.InstancedMesh(box(),ugMat,ug.length),entM=new THREE.InstancedMesh(box(),concMat,ug.length);
const edgeM=new THREE.InstancedMesh(box(),new THREE.MeshStandardMaterial({color:0xf5c400,roughness:.6,emissive:0x3a2a00}),stops.length*2);
[roofM,concM,platM,edgeM,ugM,entM].forEach(m=>{m.frustumCulled=false;twin.add(m);});

/* platform crowds */
const PPS=28;
const personGeo=new THREE.CylinderGeometry(.28,.32,1.7,6);personGeo.translate(0,.85,0);
const crowdM=new THREE.InstancedMesh(personGeo,new THREE.MeshStandardMaterial({roughness:.8}),stops.length*2*PPS);crowdM.frustumCulled=false;twin.add(crowdM);
const crowdSeed=[];for(let i=0;i<stops.length*2*PPS;i++)crowdSeed.push([rng()*2-1,rng(),rng()]);

/* trains: six 20.8 m cars with window band, roof and livery stripe */
function carGeometry(){
  const parts=[[2.88,2.3,20.4,1.15,1],[2.92,.95,19.6,2.75,.2],[2.6,.45,20.0,3.45,.78],[2.9,.6,1.2,1.5,.3]],P=[],N=[],Cc=[],I=[];let off=0;
  parts.forEach(([w,h,l,y,shade])=>{const g=new THREE.BoxGeometry(w,h,l);g.translate(0,y,0);
    const p=g.attributes.position.array,nn=g.attributes.normal.array;P.push(...p);N.push(...nn);for(let i=0;i<p.length/3;i++)Cc.push(shade,shade,shade);
    I.push(...g.index.array.map(i=>i+off));off+=p.length/3;});
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(P,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(N,3));g.setAttribute("color",new THREE.Float32BufferAttribute(Cc,3));g.setIndex(I);return g;
}
const MAXCARS=6*160,CAR=21.6,TRAIN=6*CAR;
const carMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,metalness:.25,emissive:new THREE.Color(0)});
const carM=new THREE.InstancedMesh(carGeometry(),carMat,MAXCARS);carM.count=0;carM.frustumCulled=false;
const bandGeo=new THREE.BoxGeometry(2.96,.55,20.2);bandGeo.translate(0,1.55,0);
const bandM=new THREE.InstancedMesh(bandGeo,new THREE.MeshStandardMaterial({roughness:.5}),MAXCARS);bandM.count=0;bandM.frustumCulled=false;twin.add(carM,bandM);

/* rain streaks around the camera */
const RN=2500,rainPos=new Float32Array(RN*6),rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute("position",new THREE.BufferAttribute(rainPos,3));
const rainLines=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({transparent:true,opacity:.5}));rainLines.frustumCulled=false;rainLines.visible=false;scene.add(rainLines);
const drops=[];for(let i=0;i<RN;i++)drops.push([rng()*2-1,rng(),rng()*2-1]);

/* ---------- placement ---------- */
let selected=null,selTrip=null,showCrowds=true,trainScale=3,mode="orbit",active=[];
const shown=st=>visible[st.route.color];
/* station geometry, in metres before scaling. Trains run 2.1 m either side of the centreline and are 2.88 m wide,
   so each side platform starts just past the train's outer edge. Platforms are 160 m long, longer than the 130 m train. */
const PLAT={len:160,w:4.5,centre:6.05,edgeIn:3.95,top:1.0,roofY:5.2,roofW:18,roofLen:168};
const stScale=()=>mode==="ride"?1:trainScale;
function placeStatic(){
  const w=wideU.value,ts=stScale(),L=lenK*ts;
  pierSets.forEach(({list,c,k})=>{list.forEach((p,i)=>{const on=visible[p.R.color]?1:0;Q.setFromAxisAngle(UP,p.ang);
    M.compose(V.set(p.X,0,p.Z),Q,S.set(w*on,p.top*on||1e-4,w*on));c.setMatrixAt(i,M);
    M.compose(V.set(p.X,p.top,p.Z),Q,S.set(w*on,on||1e-4,w*on));k.setMatrixAt(i,M);});c.instanceMatrix.needsUpdate=k.instanceMatrix.needsUpdate=true;});
  elev.forEach((st,i)=>{const on=shown(st)?1:0,big=st.f===selected?1.15:1,p=st.p;Q.setFromAxisAngle(UP,st.ang);
    M.compose(V.set(p.X,st.h+PLAT.roofY*ts,p.Z),Q,S.set(PLAT.roofW*w*on*big,.6*ts*on||1e-4,PLAT.roofLen*L*on*big));roofM.setMatrixAt(i,M);
    M.compose(V.set(p.X,st.h-9.5,p.Z),Q,S.set(20*w*on,5.5*on||1e-4,120*L*on));concM.setMatrixAt(i,M);});
  stops.forEach((st,i)=>{const on=shown(st)?1:0,p=st.p;Q.setFromAxisAngle(UP,st.ang);
    for(const sd of [-1,1]){const j=i*2+(sd>0?1:0),lo=PLAT.centre*w*sd,le=PLAT.edgeIn*w*sd;
      M.compose(V.set(p.X-p.dz*lo,st.h,p.Z+p.dx*lo),Q,S.set(PLAT.w*w*on,PLAT.top*ts*on||1e-4,PLAT.len*L*on));platM.setMatrixAt(j,M);
      M.compose(V.set(p.X-p.dz*le,st.h+PLAT.top*ts,p.Z+p.dx*le),Q,S.set(.6*w*on,.06*ts*on||1e-4,PLAT.len*L*on));edgeM.setMatrixAt(j,M);}});
  ug.forEach((st,i)=>{const on=shown(st)?1:0,big=st.f===selected?1.15:1,p=st.p;Q.setFromAxisAngle(UP,st.ang);
    M.compose(V.set(p.X,st.h-2.5,p.Z),Q,S.set(20*w*on*big,8.5*on||1e-4,175*L*on*big));ugM.setMatrixAt(i,M);
    M.compose(V.set(p.X-p.dz*14*w,0,p.Z+p.dx*14*w),Q,S.set(9*w*on,4.5*on||1e-4,12*L*on));entM.setMatrixAt(i,M);});
  [roofM,concM,platM,edgeM,ugM,entM].forEach(m=>m.instanceMatrix.needsUpdate=true);
  placeCrowds();
}
function colourStatic(){
  pierMat.color.set(T.concrete);pierGhost.color.set(T.concrete);concMat.color.set(T.concrete);platMat.color.set(T.silver);ugMat.color.set(T.tunnel);
  elev.forEach((st,i)=>roofM.setColorAt(i,st.f.ix?col("ink"):C.set(T[st.route.color]).lerp(col("concrete"),st.route.status==="open"?.12:.5)));
  ug.forEach((st,i)=>ugM.setColorAt(i,C.set(T[st.route.color]).lerp(col("tunnel"),.45)));
  roofM.instanceColor.needsUpdate=true;ugM.instanceColor.needsUpdate=true;crowdM.material.color.set(T.person);rainLines.material.color.set(T.rain);
}
function demand(){const m=(clock.sec/60)%1440,d=dayKey();if(!active.length)return 0;
  const v=m<420?.2:m<480?.5:m<660?1:m<1020?.45:m<1200?.95:m<1320?.5:.2;return d==="sun"?v*.6:d==="sat"?v*.8:v;}
let crowdLevel=-1;
function placeCrowds(){
  const dm=showCrowds?demand():0,w=wideU.value,ts=stScale(),L=lenK*ts,cs=Math.min(w,3*ts);crowdLevel=dm;let k=0;
  stops.forEach(st=>{const on=shown(st)&&st.route.status==="open",wt=st.f.ix?1:st.f.terminal?.7:.5,p=st.p;
    for(const sd of [-1,1])for(let j=0;j<PPS;j++,k++){const [a,b,c]=crowdSeed[k];
      if(!on||c>dm*wt*1.25){M.compose(V.set(0,-999,0),Q.identity(),S.set(0,0,0));crowdM.setMatrixAt(k,M);continue;}
      const along=a*PLAT.len*.45*L,lo=(PLAT.centre+(b-.5)*(PLAT.w-1.2))*w*sd;
      M.compose(V.set(p.X-p.dz*lo+p.dx*along,st.h+PLAT.top*ts,p.Z+p.dx*lo+p.dz*along),Q.identity(),S.set(cs,cs,cs));crowdM.setMatrixAt(k,M);}});
  crowdM.instanceMatrix.needsUpdate=true;
}

/* ---------- clock ---------- */
const clock={live:true,speed:1,sec:0,dow:4};
const dayKey=()=>E.dayType(clock.dow);
const DAYN=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function syncLive(){const n=E.istNow();clock.sec=n.sec;clock.dow=n.dow;clock.date=n.date;}
syncLive();

/* ---------- trains ---------- */
const carTrip=new Array(MAXCARS);
function placeTrains(){
  const trips=E.tripsFor(dayKey()),t=clock.sec,riding=mode==="ride",w=wideU.value,lk=riding?1:lenK,ts=riding?1:trainScale,cs=CAR*lk*ts;let n=0;active=[];
  const body=col("silver");
  for(const tr of trips){
    if(!visible[tr.R.color])continue;
    const st=E.tripState(tr,t);if(!st)continue;active.push({tr,st});
    const R=tr.R,sg=tr.dir?-1:1,band=new THREE.Color(T[R.color]);
    for(let k=0;k<6&&n<MAXCARS;k++){
      const s=st.ch+sg*(TRAIN*lk*ts/2-(k+.5)*cs),p=at(R,Math.max(0,Math.min(R.len,s))),h2=E.height(R,s+sg*8);
      const tx=sg*p.dx,tz=sg*p.dz,off=2.1*w,slope=(h2-p.h)/8;
      Q.setFromAxisAngle(UP,Math.atan2(tx,tz));Q2.setFromAxisAngle(AX,-Math.atan(slope));Q.multiply(Q2);
      M.compose(V.set(p.X+tz*off,p.h,p.Z-tx*off),Q,S.set(w,ts,lk*ts));
      carM.setMatrixAt(n,M);carM.setColorAt(n,body);bandM.setMatrixAt(n,M);bandM.setColorAt(n,band);carTrip[n]=tr;n++;
    }
  }
  carM.count=bandM.count=n;carM.instanceMatrix.needsUpdate=bandM.instanceMatrix.needsUpdate=true;
  if(carM.instanceColor){carM.instanceColor.needsUpdate=true;bandM.instanceColor.needsUpdate=true;}
}
const trainPos=tr=>{const st=E.tripState(tr,clock.sec);if(!st)return null;const p=at(tr.R,st.ch);return {st,p,ll:localToLL(p.X,p.Z)};};

/* ---------- custom layer ---------- */
let renderer=null,lastT=performance.now();
const layerMatrix=new THREE.Matrix4().makeTranslation(O.x,O.y,O.z).scale(new THREE.Vector3(MS,-MS,MS)).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1,0,0),Math.PI/2));
const metroLayer={id:"metro-3d",type:"custom",renderingMode:"3d",
  onAdd(m,gl){renderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl,antialias:true});renderer.autoClear=false;},
  render(gl,matrix){
    const now=performance.now(),dt=Math.min(.1,(now-lastT)/1000);lastT=now;tick(dt,now);
    camera.projectionMatrix=new THREE.Matrix4().fromArray(matrix).multiply(layerMatrix);
    renderer.resetState();renderer.render(scene,camera);map.triggerRepaint();
  }};

/* ---------- map overlay layers: route lines + stations ---------- */
function routeGeo(){return {type:"FeatureCollection",features:routes.map(R=>({type:"Feature",properties:{color:T[R.color],open:R.status==="open"?1:0,name:R.name},
  geometry:{type:"LineString",coordinates:R.p.map(([x,y])=>E.toLL(x,y))}}))};}
function stationGeo(){return {type:"FeatureCollection",features:stations.map(f=>({type:"Feature",id:stations.indexOf(f),properties:{name:f.name.replace(/ \(.*\)/,""),slug:f.slug,color:T[f.colors[0]],ix:f.ix?1:0,term:f.terminal?1:0,vis:f.routes.some(shown)?1:0},
  geometry:{type:"Point",coordinates:[f.lon,f.lat]}}))};}
function addLayers(){
  if(!map.getSource("routes")){map.addSource("routes",{type:"geojson",data:routeGeo()});map.addSource("stations",{type:"geojson",data:stationGeo()});}
  const fade=["interpolate",["linear"],["zoom"],13.5,1,16.5,0];
  if(!map.getLayer("route-glow"))map.addLayer({id:"route-glow",type:"line",source:"routes",slot:"middle",layout:{"line-cap":"round","line-join":"round"},
    paint:{"line-color":["get","color"],"line-width":["interpolate",["linear"],["zoom"],10,14,14,22],"line-blur":["interpolate",["linear"],["zoom"],10,8,14,14],
      "line-opacity":["interpolate",["linear"],["zoom"],10,.45,13.5,.35,16.5,0]}});
  if(!map.getLayer("route-casing"))map.addLayer({id:"route-casing",type:"line",source:"routes",slot:"middle",layout:{"line-cap":"round","line-join":"round"},
    paint:{"line-color":"#ffffff","line-width":["interpolate",["linear"],["zoom"],10,6.5,14,10],"line-opacity":fade}});
  if(!map.getLayer("route-lines"))map.addLayer({id:"route-lines",type:"line",source:"routes",slot:"middle",layout:{"line-cap":"round","line-join":"round"},
    paint:{"line-color":["get","color"],"line-width":["interpolate",["linear"],["zoom"],10,4,14,6.5],"line-opacity":fade,
      "line-dasharray":["case",["==",["get","open"],1],["literal",[1,0]],["literal",[2,1.5]]]}});
  /* the metro's three.js layer must come before the building extrusions, or the buildings render flat */
  if(!map.getLayer("metro-3d"))map.addLayer(metroLayer,undefined);
  if(!map.getSource("streets"))map.addSource("streets",{type:"vector",url:"mapbox://mapbox.mapbox-streets-v8"});
  if(!map.getLayer("color-bldg"))map.addLayer({id:"color-bldg",type:"fill-extrusion",source:"streets","source-layer":"building",slot:"middle",minzoom:13,
    filter:["all",["==",["get","extrude"],"true"],["!=",["get","underground"],"true"]],
    layout:{visibility:palette==="vivid"&&!satellite&&!xray?"visible":"none"},
    paint:{"fill-extrusion-color":["case",[">=",["get","height"],45],["interpolate",["linear"],["get","height"],45,"#5b6cff",90,"#b04cff",150,"#ff3c8e"],
        ["match",["%",["to-number",["id"],0],8],0,BLDG[0],1,BLDG[1],2,BLDG[2],3,BLDG[3],4,BLDG[4],5,BLDG[5],6,BLDG[6],BLDG[7]]],
      "fill-extrusion-height":["get","height"],"fill-extrusion-base":["get","min_height"],
      "fill-extrusion-opacity":["interpolate",["linear"],["zoom"],13,0,13.6,.95],"fill-extrusion-vertical-gradient":true,"fill-extrusion-ambient-occlusion-intensity":.35}});

  if(!map.getLayer("st-dots"))map.addLayer({id:"st-dots",type:"circle",source:"stations",slot:"top",filter:["==",["get","vis"],1],
    paint:{"circle-radius":["interpolate",["linear"],["zoom"],10,["case",["==",["get","ix"],1],5.5,3.4],15,["case",["==",["get","ix"],1],9,6]],
      "circle-color":["case",["==",["get","ix"],1],"#ffffff",["get","color"]],"circle-stroke-color":["case",["==",["get","ix"],1],"#18202b","#ffffff"],"circle-stroke-width":2.2,
      "circle-opacity":["interpolate",["linear"],["zoom"],14,1,16.5,0],"circle-stroke-opacity":["interpolate",["linear"],["zoom"],14,1,16.5,0]}});
  if(!map.getLayer("st-labels"))map.addLayer({id:"st-labels",type:"symbol",source:"stations",slot:"top",filter:["==",["get","vis"],1],
    layout:{"text-field":["get","name"],"text-size":["interpolate",["linear"],["zoom"],10,10.5,15,13],"text-font":["DIN Pro Medium","Arial Unicode MS Regular"],
      "text-offset":[0,1.1],"text-anchor":"top","text-optional":true,"symbol-sort-key":["-",0,["+",["*",["get","ix"],2],["get","term"]]]},
    paint:{"text-color":"#18202b","text-halo-color":"rgba(255,255,255,.95)","text-halo-width":1.6}});
}
function refreshSources(){const r=map.getSource("routes"),s=map.getSource("stations");if(r)r.setData(routeGeo());if(s)s.setData(stationGeo());}

/* ---------- toast ---------- */
let toastT=0;
function toast(html,ms=2600){const t=$("#toast");t.innerHTML=html;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,ms);}

/* ---------- camera helpers ---------- */
const flyToLL=(ll,zoom,opts={})=>{map.stop();map.flyTo({center:ll,zoom,pitch:opts.pitch??Math.max(map.getPitch(),55),bearing:opts.bearing??map.getBearing(),duration:reduce?0:(opts.duration??1600),essential:true});};
const home=()=>{map.stop();map.flyTo({...HOME,duration:reduce?0:1600,essential:true});};

/* ---------- lines pane ---------- */
const kmF=m=>(m/1000).toFixed(1);
const linesEl=$("#lines");
routes.forEach(R=>{
  const open=R.status==="open",d=document.createElement("div");d.className="lrow";d.style.setProperty("--c",`var(--${R.color})`);d.tabIndex=0;d.setAttribute("role","button");
  d.innerHTML=`<span class="sw${open?"":" ghost"}"></span><span><b>${R.name}</b><small>${esc(R.term[0])} – ${esc(R.term[1])}</small><span class="now" id="now-${R.color}"></span></span>
    <span class="num">${kmF(R.len)} km<br>${R.stops.length} stn${open?`<br>${Math.round(R.endToEnd/60)} min`:""}<br><button class="icon eye" aria-label="Show or hide ${R.name}" aria-pressed="true"><svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 9S4.5 3.5 9 3.5 16.5 9 16.5 9 13.5 14.5 9 14.5 1.5 9 1.5 9z"/><circle cx="9" cy="9" r="2.4"/></svg></button></span>`;
  d.querySelector(".eye").onclick=e=>{e.stopPropagation();visible[R.color]=!visible[R.color];groups[R.color].visible=visible[R.color];d.classList.toggle("off",!visible[R.color]);e.currentTarget.setAttribute("aria-pressed",visible[R.color]);placeStatic();refreshSources();
    const fl=["in",["get","name"],["literal",routes.filter(r=>visible[r.color]).map(r=>r.name)]];["route-glow","route-casing","route-lines"].forEach(l=>map.getLayer(l)&&map.setFilter(l,fl));};
  const go=()=>{const lls=R.p.map(([x,y])=>E.toLL(x,y));const b=lls.reduce((bb,c)=>bb.extend(c),new mapboxgl.LngLatBounds(lls[0],lls[0]));
    setMode("orbit");map.fitBounds(b,{padding:{top:90,bottom:150,left:narrow()?30:340,right:narrow()?30:330},pitch:50,duration:reduce?0:1500});
    toast(`<b style="color:var(--${R.color})">${R.name}</b> · ${R.stops.length} stations${open?"":" · "+(R.color==="pink"?"awaiting opening":"under construction")}`);};
  d.onclick=go;d.onkeydown=e=>{if(e.key==="Enter")go();};
  if(!open){const s=document.createElement("small");s.style.cssText="display:block;grid-column:2/4;color:var(--ink-2);font-size:11px;line-height:1.4";s.textContent=R.note;d.appendChild(s);}
  linesEl.appendChild(d);
});
function lineStatus(){
  const mm=clock.sec/60,day=dayKey();
  routes.forEach(R=>{const el=$("#now-"+R.color);
    if(R.status!=="open"){el.innerHTML=`<span class="dot build"></span>${R.color==="pink"?"Awaiting opening":"Under construction"}`;return;}
    const tt=E.TT[R.color],first=tt.first[day]*60,running=active.filter(a=>a.tr.R===R).length;
    if(!running){el.innerHTML=`<span class="dot off"></span>Closed · first ${hm(first)}`;return;}
    const hw=E.headway(R.color,mm,day);el.innerHTML=`<span class="dot"></span>${running} trains · every ${hw.short?hw.h/2+"–"+hw.h:hw.h} min`;});
}

/* ---------- stations pane + planner ---------- */
const topStop=f=>f.routes.reduce((a,b)=>b.h>a.h?b:a);
const alpha=stations.slice().sort((a,b)=>a.name.localeCompare(b.name));
$("#stlist").innerHTML=alpha.filter(f=>f.open).map(f=>`<option value="${esc(f.name)}"></option>`).join("");
function renderStList(){const v=$("#stq").value.toLowerCase();
  $("#stl").innerHTML=alpha.filter(f=>f.name.toLowerCase().includes(v)).map(f=>`<button class="srow" data-s="${f.slug}"><span class="dots">${f.colors.map(c=>`<i style="--c:var(--${c})"></i>`).join("")}</span>${esc(f.name)}<small>${topStop(f).under?"UG":"EL"}</small></button>`).join("");
  $$("#stl .srow").forEach(b=>b.onclick=()=>selectStation(stations.find(f=>f.slug===b.dataset.s)));}
$("#stq").oninput=renderStList;renderStList();
function tab(id){["plan","lines","st"].forEach(k=>{$("#tab-"+k).setAttribute("aria-selected",k===id);$("#pane-"+k).hidden=k!==id;});}
$("#tab-plan").onclick=()=>tab("plan");$("#tab-lines").onclick=()=>tab("lines");$("#tab-st").onclick=()=>tab("st");
const drawer=$("#drawer");
function setDrawer(open){drawer.hidden=!open;$("#menu").setAttribute("aria-expanded",open);}
$("#menu").onclick=()=>setDrawer(drawer.hidden);
if(narrow())setDrawer(false);

let planFrom=null,planTo=null;
function setPlan(which,f){if(which==="from"){planFrom=f;$("#pfrom").value=f?f.name:"";}else{planTo=f;$("#pto").value=f?f.name:"";}runPlan();}
function runPlan(){
  const out=$("#planout");
  if(!planFrom||!planTo){out.innerHTML=`<p class="note">Pick two stations. The route uses open lines only, with each train timed from the timetable at the current clock.</p>`;return;}
  if(planFrom===planTo){out.innerHTML=`<p class="note">From and To are the same station.</p>`;return;}
  if(!planFrom.open||!planTo.open){out.innerHTML=`<p class="note">${esc((!planFrom.open?planFrom:planTo).name)} is on a line that isn't open yet.</p>`;return;}
  const legs=E.plan(planFrom,planTo,dayKey(),clock.sec);
  if(!legs||!legs.length){out.innerHTML=`<p class="note">No route found on open lines.</p>`;return;}
  const none=legs.some(L=>L.none),changes=legs.length-1;let h="";
  legs.forEach((L,i)=>{const toward=L.R.stops[L.dir?0:L.R.stops.length-1].f.name;
    if(i)h+=`<div class="xfer">Change at ${esc(L.from.f.name)} · walk about 3 min</div>`;
    h+=`<div class="leg" style="--c:var(--${L.R.color})"><span class="bar"></span><div><b>${esc(L.from.f.name)} → ${esc(L.to.f.name)}</b><small>${L.R.name} towards ${esc(toward)} · ${L.stops} stop${L.stops>1?"s":""}</small></div><div class="t">${L.none?"—":hm(L.dep)+"<br>"+hm(L.arr)}</div></div>`;});
  if(none)h+=`<p class="note">No more connecting trains tonight on this route. Try an earlier time from the clock.</p>`;
  else{const tot=Math.round((legs[legs.length-1].arr-legs[0].dep)/60);
    h+=`<div class="sum"><span><b>${tot} min</b><br><small style="color:var(--ink-2)">${changes?changes+" change"+(changes>1?"s":""):"Direct"} · leaves ${hm(legs[0].dep)}</small></span><button class="btn primary" id="rideplan">Ride first train</button></div>`;}
  out.innerHTML=`<div class="legs">${h}</div>`;
  const rb=$("#rideplan");if(rb)rb.onclick=()=>{const L=legs[0];if(L.dep>clock.sec+30){leaveLive();clock.sec=L.dep-20;placeTrains();toast(`Clock moved to ${hm(L.dep-20)} so you board on time`);}startRide(L.trip);};
}
const pickF=v=>byName.get(String(v).trim().toLowerCase())||null;
$("#pfrom").onchange=e=>{planFrom=pickF(e.target.value);runPlan();};$("#pto").onchange=e=>{planTo=pickF(e.target.value);runPlan();};
$("#swap").onclick=()=>{const a=planFrom;setPlan("from",planTo);setPlan("to",a);};

/* ---------- card ---------- */
const card=$("#card");
const inMin=dt=>dt<45?"now":dt<3600?`${Math.round(dt/60)} min`:"";
const xBtn=`<button class="icon x" id="cx" aria-label="Close details"><svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.6"><path d="M2 2l10 10M12 2 2 12"/></svg></button>`;
function stationTiles(f){
  const allUG=f.routes.every(s=>s.under),anyUG=f.routes.some(s=>s.under);
  const lvl=f.routes.map(s=>s.under?`−${Math.round(-s.h)} m`:`+${Math.round(s.h)} m`).join(" / ");
  return `<div class="tiles"><div class="tile"><span class="eyebrow">Structure</span><b>${allUG?"Underground":anyUG?"Mixed levels":"Elevated"}</b></div><div class="tile"><span class="eyebrow">Type</span><b>${f.ix?"Interchange":f.terminal?"Terminal":"Regular"}</b></div>
    <div class="tile"><span class="eyebrow">Platforms</span><b>${f.routes.length*2}</b></div><div class="tile"><span class="eyebrow">Track level</span><b>${lvl}</b></div></div>`;
}
function stationDeps(f){
  const day=dayKey(),rows=[];
  f.routes.forEach(st=>{const R=st.route;if(R.status!=="open")return;const d=E.departures(st,day,clock.sec,2);
    [0,1].forEach(dir=>{if((dir===0&&st.idx===R.stops.length-1)||(dir===1&&st.idx===0))return;
      const toName=R.stops[dir?0:R.stops.length-1].f.name,nx=d.next[dir];
      rows.push(`<div class="dep" style="--c:var(--${R.color})"><i></i><span class="to">to ${esc(toName)}</span><span class="t${nx[0]&&nx[0].t-clock.sec<300?" soon":""}">${nx.length?hm(nx[0].t)+` <small>${inMin(nx[0].t-clock.sec)}</small>`:"No more today"}</span></div>`);});});
  return rows.length?`<div class="eyebrow" style="margin-bottom:4px">Next trains · ${clock.live?"live":"sim "+hm(clock.sec)}</div><div class="deps">${rows.join("")}</div>`:"";
}
function renderCard(){
  if(mode==="ride"){card.hidden=true;return;}
  if(selected){const f=selected;
    card.innerHTML=`${xBtn}<h2>${esc(f.name)}</h2><div class="chips">${f.routes.map(s=>`<span class="chip" style="--c:var(--${s.route.color})"><i></i>${s.route.name}</span>`).join("")}</div>
      ${stationTiles(f)}${stationDeps(f)}
      <div class="acts"><button class="btn primary" id="cfly">Fly there</button><button class="btn" id="cfrom">Set From</button><button class="btn" id="cto">Set To</button></div>`;
    $("#cfly").onclick=()=>{setMode("orbit");flyToLL([f.lon,f.lat],17.2,{pitch:68});};
    $("#cfrom").onclick=()=>{setPlan("from",f);setDrawer(true);tab("plan");toast(`From: <b>${esc(f.name)}</b>`);};
    $("#cto").onclick=()=>{setPlan("to",f);setDrawer(true);tab("plan");toast(`To: <b>${esc(f.name)}</b>`);};
  }else if(selTrip){const tr=selTrip,R=tr.R,tp=trainPos(tr);
    if(!tp){card.innerHTML=`${xBtn}<h2>Trip finished</h2><p class="note" style="padding:0">This train reached ${esc(R.stops[tr.i1].f.name)}.</p>`;}
    else{const st=tp.st,dest=R.stops[tr.i1].f.name,nxt=R.stops[st.next],eta=st.at>=0&&st.at!==tr.i1?E.depAtStop(tr,st.at):E.timeAtStop(tr,st.next);
      card.innerHTML=`${xBtn}<h2>To ${esc(dest)}</h2><div class="chips"><span class="chip" style="--c:var(--${R.color})"><i></i>${R.name}</span>${tr.kind==="short"?`<span class="chip" style="--c:var(--ink-2)">Short-turn</span>`:""}</div>
      <div class="tiles"><div class="tile"><span class="eyebrow">Speed</span><b>${Math.round(st.v*3.6)} km/h</b></div><div class="tile"><span class="eyebrow">${st.at>=0?"At platform":"Next stop"}</span><b>${esc(st.at>=0?R.stops[st.at].f.name:nxt.f.name)}</b></div>
      <div class="tile"><span class="eyebrow">${st.at>=0?"Departs":"Arrives"}</span><b>${hm(eta,st.at>=0)}</b></div><div class="tile"><span class="eyebrow">Level</span><b>${tp.p.h<-1?"Tunnel":"Viaduct"} ${Math.abs(Math.round(tp.p.h))} m</b></div></div>
      <div class="acts" style="grid-template-columns:1.3fr 1fr"><button class="btn primary" id="cride">Ride this train</button><button class="btn" id="cfol" aria-pressed="${follow}">${follow?"Following":"Follow"}</button></div>`;
      $("#cride").onclick=()=>startRide(tr);$("#cfol").onclick=()=>{follow=!follow;renderCard();};}
  }else{card.hidden=true;return;}
  card.hidden=false;$("#cx").onclick=()=>{selected=null;selTrip=null;follow=false;placeStatic();renderCard();history.replaceState(null,"",location.pathname+location.search);};
}
let follow=false;
function selectStation(f,fly=true){
  if(!f)return;if(mode==="ride"||mode==="tour"||mode==="fly")setMode("orbit");
  selTrip=null;follow=false;selected=f;placeStatic();renderCard();history.replaceState(null,"","#"+f.slug);
  if(fly)flyToLL([f.lon,f.lat],Math.max(map.getZoom(),15.6),{pitch:62});
  if(narrow())setDrawer(false);
}
function selectTrip(tr){selected=null;selTrip=tr;follow=true;placeStatic();renderCard();const p=trainPos(tr);if(p)flyToLL(p.ll,Math.max(map.getZoom(),15.8),{pitch:65});}

/* ---------- search ---------- */
const q=$("#q"),res=$("#results");
const norm=t=>t.toLowerCase().replace(/[^a-z0-9]/g,"");
function search(){
  const v=norm(q.value);res.innerHTML="";if(!v){res.hidden=true;return;}
  const lh=routes.filter(R=>norm(R.name).includes(v)).map(R=>({R}));
  const sh=stations.filter(s=>norm(s.name).includes(v)).sort((a,b)=>norm(a.name).indexOf(v)-norm(b.name).indexOf(v)).slice(0,8).map(f=>({f}));
  const all=[...lh,...sh];
  if(!all.length){res.innerHTML=`<li style="padding:8px 10px;color:var(--ink-2)">Nothing matches "${esc(q.value)}"</li>`;res.hidden=false;return;}
  all.forEach(h=>{const li=document.createElement("li"),b=document.createElement("button");
    if(h.R){b.innerHTML=`<span class="dots"><i style="--c:var(--${h.R.color})"></i></span>${h.R.name}<small>${h.R.stops.length} stations</small>`;b.onclick=()=>{[...linesEl.children][routes.indexOf(h.R)].click();done();};}
    else{b.innerHTML=`<span class="dots">${h.f.colors.map(c=>`<i style="--c:var(--${c})"></i>`).join("")}</span>${esc(h.f.name)}<small>${h.f.ix?"Interchange":"Station"}</small>`;b.onclick=()=>{selectStation(h.f);done();};}
    li.appendChild(b);res.appendChild(li);});
  res.hidden=false;
  function done(){q.value="";res.hidden=true;q.blur();}
}
q.addEventListener("input",search);
q.addEventListener("keydown",e=>{if(e.key==="Enter"){const b=res.querySelector("button");b&&b.click();}if(e.key==="Escape"){q.value="";search();q.blur();}if(e.key==="ArrowDown"){const b=res.querySelector("button");b&&b.focus();e.preventDefault();}});
document.addEventListener("click",e=>{if(!e.target.closest(".search"))res.hidden=true;});

/* ---------- popovers ---------- */
const pops={time:$("#pop-time"),wx:$("#pop-wx"),more:$("#pop-more")};
function togglePop(k){Object.entries(pops).forEach(([n,el])=>{const on=n===k&&el.hidden;el.hidden=!on;$(`.tool[data-t="${n}"]`).setAttribute("aria-pressed",on);});}
$("#clockpill").onclick=()=>togglePop("time");
document.addEventListener("pointerdown",e=>{if(!e.target.closest(".pop,.tool,#clockpill"))togglePop(null);});
const liveBtn=$("#livebtn"),scrub=$("#scrub"),daySel=$("#day");
const setSpeedUI=()=>$$("#speeds button").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.s===clock.speed));
function goLive(){clock.live=true;clock.speed=1;syncLive();setSpeedUI();liveBtn.setAttribute("aria-pressed","true");placeTrains();renderCard();runPlan();}
function leaveLive(){if(clock.live){clock.live=false;liveBtn.setAttribute("aria-pressed","false");}}
liveBtn.onclick=goLive;
$$("#speeds button").forEach(b=>b.onclick=()=>{const s=+b.dataset.s;if(s!==1)leaveLive();clock.speed=s;setSpeedUI();});
scrub.addEventListener("input",()=>{leaveLive();clock.sec=+scrub.value*60;placeTrains();renderCard();});
scrub.addEventListener("change",runPlan);
daySel.addEventListener("change",()=>{leaveLive();clock.dow=+daySel.value;placeTrains();renderCard();runPlan();});
function updateClockUI(){
  $("#clocktxt").textContent=hm(clock.sec,!narrow());$("#livedot").className="dot"+(clock.live?"":" off");
  $("#bigtime").innerHTML=`${hm(clock.sec,true)}<small>IST</small>`;
  const day=dayKey(),dn=DAYN[clock.dow],tt={mon:"Monday timetable",wk:"weekday timetable",sat:"Saturday timetable",sun:"Sunday timetable"}[day];
  $("#dayline").textContent=clock.live?`${dn} ${clock.date.getUTCDate()} ${clock.date.toLocaleString("en-IN",{month:"short",timeZone:"UTC"})} · ${tt}`:`Simulated ${dn} · ${tt}${clock.speed>1?` · ${clock.speed}×`:""}`;
  if(document.activeElement!==scrub)scrub.value=Math.round(clock.sec/60);
  if(document.activeElement!==daySel)daySel.value=clock.dow===0?"0":clock.dow===6?"6":clock.dow===1?"1":"4";
  const hw=E.headway("purple",clock.sec/60,day),n=active.length;
  if(!n){const today=Math.min(...["purple","green","yellow"].map(c=>E.TT[c].first[day]*60));
    const first=clock.sec<today?today:Math.min(...["purple","green","yellow"].map(c=>E.TT[c].first[E.dayType((clock.dow+1)%7)]*60));
    $("#svc").innerHTML=`<b>Service closed.</b> First trains leave terminals at ${hm(first)}.`;}
  else $("#svc").innerHTML=`<b>${n} trains running</b> · ${hw.band.toLowerCase()} pattern${hw.short?". Purple and Green cores every 5 min, ends every 10.":"."}`;
}

/* ---------- light, weather ---------- */
let lighting="auto",weather="clear",curPreset="";
function presetFor(){const h=(clock.sec/3600)%24;return lighting!=="auto"?lighting:h<5.6||h>=19.2?"night":h<6.8?"dawn":h<17.6?"day":"dusk";}
function updateLight(){
  const p=presetFor();if(p!==curPreset&&map.isStyleLoaded()){curPreset=p;try{map.setConfigProperty("basemap","lightPreset",p);}catch(e){}applyWeather();
    try{map.getLayer("color-bldg")&&map.setPaintProperty("color-bldg","fill-extrusion-emissive-strength",{night:.55,dusk:.25,dawn:.15,day:0}[p]);}catch(e){}}
  const h=(clock.sec/3600)%24,day=p==="night"?0:p==="day"?1:.5,wl={clear:1,haze:.8,rain:.6,storm:.45}[weather];
  sun.intensity=(.25+.7*day)*wl;hemi.intensity=(.45+.4*day)*(.6+.4*wl);
  const night=p==="night"?1:p==="day"?0:.5;roofMat.emissive.set(T.lamp).multiplyScalar(.45*night);carMat.emissive.set(T.lamp).multiplyScalar(.25*night);
}
const WX={clear:null,haze:{range:[.6,6],color:"#c9c6bd","horizon-blend":.25},rain:{range:[.4,4],color:"#9aa3ad","horizon-blend":.3},storm:{range:[.2,2.5],color:"#6f7782","horizon-blend":.4}};
function applyWeather(){
  try{map.setFog(WX[weather]||(palette==="vivid"?SKY[presetFor()]:null));}catch(e){}
  rainLines.visible=weather==="rain"||weather==="storm";$$("#wx button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.w===weather));
}
$$("#wx button").forEach(b=>b.onclick=()=>{weather=b.dataset.w;applyWeather();updateLight();toast(`Weather: <b>${b.textContent}</b>`);});
let camLocal=new THREE.Vector3();
function updateRain(dt){if(!rainLines.visible)return;const k=weather==="storm"?2:1,c=camLocal,R=Math.max(40,Math.min(500,c.y*1.1)),hgt=R*.9,fall=hgt*.8*dt*k,len=R*.035*k;
  for(let i=0;i<RN;i++){const d=drops[i];d[1]-=fall/hgt;if(d[1]<0)d[1]+=1;const x=c.x+d[0]*R,z=c.z+d[2]*R,y=Math.max(0,c.y-hgt*.6)+d[1]*hgt;
    rainPos[i*6]=x;rainPos[i*6+1]=y;rainPos[i*6+2]=z;rainPos[i*6+3]=x+len*.15;rainPos[i*6+4]=y-len;rainPos[i*6+5]=z;}
  rainGeo.attributes.position.needsUpdate=true;}

/* more */
$("#tsz").oninput=e=>{trainScale=+e.target.value;$("#tszv").textContent=trainScale+"×";wideU.value=-1;};
const tog=(id,get,set)=>{$(id).onclick=e=>{set(!get());e.currentTarget.setAttribute("aria-pressed",get());e.currentTarget.textContent=get()?"On":"Off";};};
let showLabels=true;
tog("#lblbtn",()=>showLabels,v=>{showLabels=v;["st-labels"].forEach(l=>map.getLayer(l)&&map.setLayoutProperty(l,"visibility",v?"visible":"none"));});
let voice=true;tog("#voicebtn",()=>voice,v=>{voice=v;if(!v)try{speechSynthesis.cancel();}catch(e){}});
$("#satbtn").onclick=e=>{satellite=!satellite;e.currentTarget.setAttribute("aria-pressed",satellite);e.currentTarget.textContent=satellite?"Satellite":"3D city";
  curPreset="";map.setStyle(satellite?"mapbox://styles/mapbox/standard-satellite":"mapbox://styles/mapbox/standard",{config:{basemap:satellite?{lightPreset:presetFor(),showPointOfInterestLabels:false,showTransitLabels:false}:baseConfig(presetFor())}});};
$("#palbtn").onclick=e=>{palette=palette==="vivid"?"classic":"vivid";e.currentTarget.textContent=palette==="vivid"?"Vivid":"Classic";e.currentTarget.setAttribute("aria-pressed",palette==="vivid");
  if(!satellite)try{map.setConfig("basemap",baseConfig(presetFor()));if(xray)map.setConfigProperty("basemap","show3dObjects",false);}catch(e){}applyWeather();syncBuildings();curPreset="";toast(`Colours: <b>${palette==="vivid"?"Vivid":"Classic"}</b>`);};
$("#lightsel").onchange=e=>{lighting=e.target.value;updateLight();};
$("#tilt").onclick=()=>{setMode("orbit");map.easeTo({pitch:map.getPitch()<5?60:0,duration:reduce?0:800});};

/* ---------- modes ---------- */
const HINTS={orbit:[["Drag","pan"],["Right-drag","rotate"],["Scroll","zoom"],["R","ride a train"],["T","tour"],["F","fly"]],
  fly:[["W A S D","move"],["Q / E","down / up"],["Shift","boost"],["Drag","look"],["Esc","orbit"]],
  ride:[["← →","switch train"],["Drag","look around"],["Esc","exit"]],tour:[["T","stop tour"],["Click","stop"]]};
function setHints(){$("#hints").innerHTML=HINTS[mode].map(([k,t])=>`<span class="hint"><kbd>${k}</kbd>${t}</span>`).join("");}
const handlers=["dragPan","dragRotate","scrollZoom","keyboard","doubleClickZoom","touchZoomRotate","touchPitch","boxZoom"];
const setInteractive=on=>handlers.forEach(h=>map[h]&&(on?map[h].enable():map[h].disable()));
function setMode(m){
  if(m===mode)return;
  if(mode==="ride")endRide();
  if(mode==="tour")endTour();
  if(mode==="fly")endFly();
  mode=m;setInteractive(m==="orbit"||m==="tour");
  $$(".modes button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.m===m||(m==="tour"&&b.dataset.m==="orbit")));
  $(`.tool[data-t="tour"]`).setAttribute("aria-pressed",m==="tour");
  if(m==="fly")startFly();
  setHints();renderCard();
}
$$(".modes button").forEach(b=>b.onclick=()=>{const m=b.dataset.m;if(m==="ride")startRide(selTrip||nearestTrain());else setMode(m);});

/* fly: free camera */
const keys=new Set(),fly={X:0,Y:300,Z:0,yaw:0,pitch:60};
function startFly(){map.stop();const fc=map.getFreeCameraOptions(),p=fc.position;const X=(p.x-O.x)/MS,Z=(p.y-O.y)/MS,Y=p.z/MS;
  Object.assign(fly,{X,Y,Z,yaw:map.getBearing(),pitch:Math.min(80,map.getPitch()+5)});toast("<b>Fly mode</b> · WASD to move, Q/E altitude, Shift to boost",3500);}
function endFly(){map.jumpTo({center:localToLL(fly.X+Math.sin(fly.yaw*Math.PI/180)*fly.Y,fly.Z-Math.cos(fly.yaw*Math.PI/180)*fly.Y),zoom:Math.max(12,Math.min(18,17-Math.log2(Math.max(1,fly.Y/120)))),pitch:Math.min(70,fly.pitch),bearing:fly.yaw});}
function setFreeCam(X,Y,Z,yaw,pitch){const fc=map.getFreeCameraOptions();fc.position=new mapboxgl.MercatorCoordinate(O.x+X*MS,O.y+Z*MS,Y*MS);fc.setPitchBearing(pitch,yaw);map.setFreeCameraOptions(fc);}
function updateFly(dt){
  const sp=Math.max(25,Math.min(1500,fly.Y*1.3))*(keys.has("shift")?4:1)*dt,r=fly.yaw*Math.PI/180;
  const fx=Math.sin(r),fz=-Math.cos(r),rx=Math.cos(r),rz=Math.sin(r);
  if(keys.has("w")){fly.X+=fx*sp;fly.Z+=fz*sp;}if(keys.has("s")){fly.X-=fx*sp;fly.Z-=fz*sp;}
  if(keys.has("d")){fly.X+=rx*sp;fly.Z+=rz*sp;}if(keys.has("a")){fly.X-=rx*sp;fly.Z-=rz*sp;}
  if(keys.has("e"))fly.Y+=sp;if(keys.has("q"))fly.Y=Math.max(8,fly.Y-sp);
  setFreeCam(fly.X,fly.Y,fly.Z,fly.yaw,fly.pitch);
}

/* ride: cab view on the free camera, with next-station announcements */
let ride=null;
function nearestTrain(){
  if(!active.length){toast("No trains running at this time. Open <b>Time</b> to pick a service hour.");return null;}
  const c=map.getCenter(),[cx,cz]=llToLocal(c.lng,c.lat);let best=null,bd=1e18;
  active.forEach(({tr})=>{const p=trainPos(tr);if(!p)return;const d=(p.p.X-cx)**2+(p.p.Z-cz)**2;if(d<bd){bd=d;best=tr;}});return best;
}
function say(text){if(!voice)return;try{const u=new SpeechSynthesisUtterance(text);u.lang="en-IN";u.rate=.95;speechSynthesis.cancel();speechSynthesis.speak(u);}catch(e){}}
function startRide(tr){
  if(!tr)return;if(mode!=="ride"){if(mode==="tour")endTour();if(mode==="fly")endFly();mode="ride";}
  map.stop();follow=false;selected=null;selTrip=null;placeStatic();setInteractive(false);
  ride={tr,lastAt:null,yaw:0,pitch:0,pos:null,yawS:null};
  $$(".modes button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.m==="ride"));
  const R=tr.R;$("#ride").hidden=false;$("#ride").style.setProperty("--c",`var(--${R.color})`);
  $("#rline").textContent=`${R.name} · to ${R.stops[tr.i1].f.name}`;
  setHints();renderCard();togglePop(null);
  toast(`Riding the <b>${R.name}</b> to ${esc(R.stops[tr.i1].f.name)}`);
}
function endRide(){
  const r=ride;ride=null;$("#ride").hidden=true;try{speechSynthesis.cancel();}catch(e){}
  if(r&&r.pos)map.jumpTo({center:localToLL(r.pos.x,r.pos.z),zoom:16.3,pitch:62,bearing:map.getBearing()});
}
$("#rexit").onclick=()=>setMode("orbit");
function switchTrain(d){if(!ride)return;const same=active.filter(a=>a.tr.R===ride.tr.R&&a.tr.dir===ride.tr.dir).sort((a,b)=>a.st.ch-b.st.ch);
  const i=same.findIndex(a=>a.tr===ride.tr);const n=same[(i+d+same.length)%same.length];if(n&&n.tr!==ride.tr)startRide(n.tr);}
function updateRide(){
  const tr=ride.tr,R=tr.R,st=E.tripState(tr,clock.sec);
  if(!st){toast(`Arrived at <b>${esc(R.stops[tr.i1].f.name)}</b>. End of the line.`,4000);say(`This is ${R.stops[tr.i1].f.name.replace(/ \(.*\)/,"")}. This train terminates here.`);setMode("orbit");return;}
  const sg=tr.dir?-1:1,front=Math.max(0,Math.min(R.len,st.ch+sg*(TRAIN/2-3))),p=at(R,front),a=at(R,Math.max(0,Math.min(R.len,front+sg*60)));
  const tx=sg*p.dx,tz=sg*p.dz,off=2.1;
  // underground: keep the camera just above street level so the city stays visible; the tunnel shows through
  const eyeY=p.h<-1?3:p.h+3,eye=new THREE.Vector3(p.X+tz*off,eyeY,p.Z-tx*off);
  if(!ride.pos)ride.pos=eye.clone();else ride.pos.lerp(eye,.35);
  let yaw=Math.atan2(a.X-p.X,-(a.Z-p.Z))*180/Math.PI;
  if(ride.yawS==null)ride.yawS=yaw;let dy=((yaw-ride.yawS+540)%360)-180;ride.yawS+=dy*.12;
  setFreeCam(ride.pos.x,ride.pos.y,ride.pos.z,ride.yawS+ride.yaw,Math.max(40,Math.min(85,84+ride.pitch)));
  const nxt=R.stops[st.at>=0&&st.at!==tr.i1?st.at+sg:st.next],here=st.at>=0?R.stops[st.at]:null;
  $("#rspd").innerHTML=`${Math.round(st.v*3.6)}<small> km/h</small>`;
  $("#rnext").innerHTML=(here?`At <b>${esc(here.f.name)}</b> · doors open · departs ${hm(E.depAtStop(tr,st.at),true)}`:`<span class="kn" lang="kn">ಮುಂದಿನ ನಿಲ್ದಾಣ</span> · Next: <b>${esc(nxt.f.name)}</b> ${hm(E.timeAtStop(tr,st.next))}`)+(p.h<-1?" · <i>in tunnel</i>":"");
  const up=[];for(let i=st.next+(st.at>=0?sg:0),c=0;c<4&&(sg>0?i<=tr.i1:i>=tr.i1);i+=sg,c++)up.push(`<span>${esc(R.stops[i].f.name.replace(/ \(.*\)/,""))} ${hm(E.timeAtStop(tr,i))}</span>`);
  $("#ridenext").innerHTML=up.join("")||"<span>Final stop</span>";
  const key=st.at>=0?"at"+st.at:"run"+st.next;
  if(key!==ride.lastAt){
    if(ride.lastAt!==null){
      if(here){const xs=here.f.routes.filter(o=>o.route!==R&&o.route.status==="open").map(o=>o.route.name);
        say(`This is ${here.f.name.replace(/ \(.*\)/,"")}.${xs.length?" Change here for the "+xs.join(" and ")+".":""}`);}
      else say(`Next station is ${nxt.f.name.replace(/ \(.*\)/,"")}.`);
    }
    ride.lastAt=key;
  }
}

/* tour */
const TOUR=[
  ["Majestic (Nadaprabhu Kempegowda)","Purple and Green lines cross underground at the network's busiest interchange."],
  ["Cubbon Park","The Purple Line runs in tunnel beneath the park and the Vidhana Soudha."],
  ["Mahatma Gandhi Road","The Purple Line climbs out of the tunnel onto the viaduct along MG Road."],
  ["Indiranagar","Elevated Purple Line station in Indiranagar."],
  ["Whitefield","Eastern terminus of the Purple Line, beside the ITPL tech parks."],
  ["Central Silk Board","The Yellow Line passes the Silk Board junction; a future Blue Line interchange."],
  ["Electronic City-I","The Yellow Line serves the Electronic City tech hub."],
  ["RV Road","The Green Line meets the Yellow Line to Bommasandra."],
  ["Yeshwanthpur","Green Line stop beside Yeshwanthpur railway station."],
];
let tourI=-1,tourTimer=0;
function startTour(){setMode("tour");tourI=-1;nextTourStop();}
function nextTourStop(){
  if(mode!=="tour")return;
  tourI=(tourI+1)%TOUR.length;const [n,txt]=TOUR[tourI],f=byName.get(n.toLowerCase());if(!f)return nextTourStop();
  selected=f;placeStatic();
  map.flyTo({center:[f.lon,f.lat],zoom:16.4,pitch:66,bearing:map.getBearing()+50,duration:reduce?0:4500,essential:true});
  map.once("moveend",()=>{if(mode==="tour"&&!reduce)map.easeTo({bearing:map.getBearing()+40,duration:6000,easing:t=>t});});
  const c=$("#caption");c.hidden=false;c.innerHTML=`<b>${esc(f.name.replace(/ \(.*\)/,""))}</b><span>${esc(txt)}</span>`;
  clearTimeout(tourTimer);tourTimer=setTimeout(nextTourStop,11000);
}
function endTour(){clearTimeout(tourTimer);$("#caption").hidden=true;map.stop();selected=null;placeStatic();}

/* tools */
$$(".tool").forEach(b=>b.onclick=()=>{const t=b.dataset.t;
  if(t==="time"||t==="wx"||t==="more")return togglePop(t);
  togglePop(null);
  if(t==="rush"){showCrowds=!showCrowds;b.setAttribute("aria-pressed",showCrowds);placeCrowds();toast(showCrowds?"<b>Platform crowds</b> on · they swell in the 8–11 and 17–20 peaks":"Platform crowds off");}
  if(t==="xray"){xray=!xray;try{map.setConfigProperty("basemap","show3dObjects",!xray);}catch(e){}syncBuildings();b.setAttribute("aria-pressed",xray);toast(xray?"<b>X-ray</b> · buildings hidden; tunnels under Majestic, Cubbon Park and KR Market stand out":"X-ray off");}
  if(t==="tour"){mode==="tour"?setMode("orbit"):startTour();}
  if(t==="photo"){document.body.classList.add("photo");toast("Photo view · press <b>Esc</b> to bring the controls back",3000);}
  if(t==="full"){const d=document;try{d.fullscreenElement?d.exitFullscreen():d.documentElement.requestFullscreen().catch(()=>toast("Full screen isn't available here"));}catch(e){toast("Full screen isn't available here");}}
  if(t==="reset"){setMode("orbit");selected=null;selTrip=null;follow=false;placeStatic();renderCard();home();}
});
$("#compass").onclick=()=>{if(mode==="orbit")map.easeTo({bearing:0,duration:reduce?0:700});};

/* keyboard */
addEventListener("keydown",e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();q.focus();q.select();return;}
  if(e.target.closest("input,select,textarea"))return;
  const k=e.key.toLowerCase();
  if(document.body.classList.contains("photo")){if(k==="escape"||k==="p")document.body.classList.remove("photo");return;}
  if(mode==="fly"&&"wasdqe".includes(k)&&k.length===1){keys.add(k);e.preventDefault();return;}
  if(e.key==="Shift")keys.add("shift");
  if(k==="escape"){if(mode!=="orbit")setMode("orbit");else togglePop(null);}
  else if(k==="r")startRide(selTrip||nearestTrain());
  else if(k==="t")mode==="tour"?setMode("orbit"):startTour();
  else if(k==="f")setMode(mode==="fly"?"orbit":"fly");
  else if(k==="p")document.body.classList.add("photo");
  else if(mode==="ride"&&(e.key==="ArrowRight"||e.key==="ArrowLeft"))switchTrain(e.key==="ArrowRight"?1:-1);
});
addEventListener("keyup",e=>{keys.delete(e.key.toLowerCase());if(e.key==="Shift")keys.delete("shift");});
addEventListener("blur",()=>keys.clear());

/* ---------- picking (screen space, via map.project) ---------- */
const tip=$("#tip");
function pick(pt){
  let best=null,bd=18*18;
  const test=(ll,o)=>{const s=map.project(ll),dx=s.x-pt.x,dy=s.y-pt.y,d=dx*dx+dy*dy;if(d<bd){bd=d;best=o;}};
  active.forEach(({tr})=>{const p=trainPos(tr);if(p)test(p.ll,{trip:tr});});
  stations.forEach(f=>{if(f.routes.some(shown))test([f.lon,f.lat],{f});});
  return best;
}
const cont=map.getCanvasContainer();let drag=null;
cont.addEventListener("pointerdown",e=>{if(mode==="fly"||mode==="ride"){drag=[e.clientX,e.clientY];cont.setPointerCapture(e.pointerId);}if(mode==="tour")setMode("orbit");});
cont.addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-drag[0],dy=e.clientY-drag[1];drag=[e.clientX,e.clientY];
  if(mode==="fly"){fly.yaw+=dx*.25;fly.pitch=Math.max(0,Math.min(88,fly.pitch-dy*.25));}else if(ride){ride.yaw+=dx*.25;ride.pitch=Math.max(-44,Math.min(1,ride.pitch-dy*.25));}});
cont.addEventListener("pointerup",()=>drag=null);
map.on("mousemove",e=>{
  $("#ll").textContent=`${e.lngLat.lat.toFixed(4)}°N ${e.lngLat.lng.toFixed(4)}°E`;
  if(mode!=="orbit"){tip.hidden=true;return;}
  const h=pick(e.point);map.getCanvas().style.cursor=h?"pointer":"";
  if(h){tip.hidden=false;
    if(h.f)tip.textContent=h.f.name+(h.f.ix?" · interchange":"");
    else{const tp=trainPos(h.trip);tip.textContent=`${h.trip.R.name} to ${h.trip.R.stops[h.trip.i1].f.name}${tp?` · ${Math.round(tp.st.v*3.6)} km/h`:""}`;}
    tip.style.transform=`translate(${e.originalEvent.clientX+14}px,${e.originalEvent.clientY+12}px)`;}else tip.hidden=true;
});
map.on("mouseout",()=>tip.hidden=true);
map.on("click",e=>{if(mode!=="orbit")return;const h=pick(e.point);if(!h)return;h.f?selectStation(h.f):selectTrip(h.trip);});
map.on("dragstart",()=>{follow=false;});

/* ---------- minimap ---------- */
let xmin=1e9,xmax=-1e9,zmin=1e9,zmax=-1e9;
const routeLocal=routes.map(R=>R.p.map(([x,y])=>engToLocal(x,y)));
routeLocal.flat().forEach(([X,Z])=>{xmin=Math.min(xmin,X);xmax=Math.max(xmax,X);zmin=Math.min(zmin,Z);zmax=Math.max(zmax,Z);});
const W=xmax-xmin,H=zmax-zmin;
const mc=$("#minic"),mg=mc.getContext("2d");
function sizeMini(){const r=mc.getBoundingClientRect(),d=Math.min(devicePixelRatio,2);mc.width=r.width*d;mc.height=r.height*d;}
sizeMini();
const mm=()=>{const s=Math.min(mc.width/W,mc.height/H)*.9,ox=(mc.width-W*s)/2,oz=(mc.height-H*s)/2;return {X:x=>ox+(x-xmin)*s,Z:z=>oz+(z-zmin)*s,ix:x=>(x-ox)/s+xmin,iz:z=>(z-oz)/s+zmin};};
function drawMini(){
  const m=mm(),d=Math.min(devicePixelRatio,2);mg.clearRect(0,0,mc.width,mc.height);mg.lineCap=mg.lineJoin="round";
  routes.forEach((R,i)=>{if(!visible[R.color])return;mg.strokeStyle=T[R.color];mg.lineWidth=2.2*d;mg.setLineDash(R.status==="open"?[]:[3*d,3*d]);mg.globalAlpha=R.status==="open"?1:.6;
    mg.beginPath();routeLocal[i].forEach(([X,Z],k)=>k?mg.lineTo(m.X(X),m.Z(Z)):mg.moveTo(m.X(X),m.Z(Z)));mg.stroke();});
  mg.setLineDash([]);mg.globalAlpha=1;
  active.forEach(({tr,st})=>{const p=at(tr.R,st.ch);mg.fillStyle=T.silver;mg.strokeStyle=T[tr.R.color];mg.lineWidth=1.2*d;mg.beginPath();mg.arc(m.X(p.X),m.Z(p.Z),2*d,0,7);mg.fill();mg.stroke();});
  if(selected){const [X,Z]=llToLocal(selected.lon,selected.lat);mg.strokeStyle=T.ink;mg.lineWidth=1.5*d;mg.beginPath();mg.arc(m.X(X),m.Z(Z),5*d,0,7);mg.stroke();}
  let cx,cz;if(mode==="fly"){cx=fly.X;cz=fly.Z;}else if(mode==="ride"&&ride&&ride.pos){cx=ride.pos.x;cz=ride.pos.z;}else{const c=map.getCenter();[cx,cz]=llToLocal(c.lng,c.lat);}
  const a=(mode==="fly"?fly.yaw:mode==="ride"&&ride?ride.yawS||0:map.getBearing())*Math.PI/180;
  mg.save();mg.translate(m.X(cx),m.Z(cz));mg.rotate(a);mg.fillStyle=T.brand;mg.beginPath();mg.moveTo(0,-7*d);mg.lineTo(5*d,5*d);mg.lineTo(0,2.5*d);mg.lineTo(-5*d,5*d);mg.closePath();mg.fill();mg.restore();
}
$("#mini").addEventListener("click",e=>{const r=mc.getBoundingClientRect(),d=mc.width/r.width,m=mm();
  if(mode!=="orbit")setMode("orbit");flyToLL(localToLL(m.ix((e.clientX-r.left)*d),m.iz((e.clientY-r.top)*d)),Math.max(map.getZoom(),14));});

/* ---------- HUD ---------- */
function updateHud(){
  const mpp=40075016*Math.cos(map.getCenter().lat*Math.PI/180)/(512*2**map.getZoom()),NICE=[20,50,100,200,500,1000,2000,5000,10000];
  const m=NICE.find(n=>n/mpp>=55)||10000;$("#scalebar").style.width=(m/mpp).toFixed(0)+"px";$("#scalet").textContent=m>=1000?m/1000+" km":m+" m";
  const b=mode==="fly"?fly.yaw:mode==="ride"&&ride?ride.yawS||0:map.getBearing();$("#needle").style.transform=`rotate(${(-b).toFixed(1)}deg)`;
}

/* ---------- per-frame tick (driven by the map's render loop) ---------- */
let slow=0,cardT=0,frames=0,fpsT=performance.now(),crowdT=0;
function tick(dt,now){
  frames++;
  if(clock.live)syncLive();else{clock.sec+=dt*clock.speed;if(clock.sec>=27*3600){clock.sec-=86400;clock.dow=(clock.dow+1)%7;}if(clock.sec<3*3600){clock.sec+=86400;clock.dow=(clock.dow+6)%7;}}
  if(mode==="fly")updateFly(dt);
  placeTrains();
  if(mode==="ride"&&ride)updateRide();
  if(follow&&selTrip&&mode==="orbit"&&!map.isMoving()){const p=trainPos(selTrip);if(p)map.jumpTo({center:p.ll});}
  const fc=map.getFreeCameraOptions().position;camLocal.set((fc.x-O.x)/MS,fc.z/MS,(fc.y-O.y)/MS);
  const wz=mode==="ride"?1:Math.min(14,Math.max(1,2**(15.6-map.getZoom()))),w=mode==="ride"?1:wz*trainScale;
  if(wideU.value<=0||Math.abs(w-wideU.value)/wideU.value>.04){wideU.value=w;lenK=mode==="ride"?1:Math.min(2,Math.max(1,wz/5));placeStatic();}
  crowdM.visible=showCrowds&&map.getZoom()>14.5;
  updateRain(dt);
  if(now-slow>250){slow=now;updateHud();updateClockUI();lineStatus();updateLight();drawMini();}
  if(now-crowdT>3000){crowdT=now;if(Math.abs(demand()-crowdLevel)>.01)placeCrowds();}
  if(now-cardT>(selTrip?500:5000)){cardT=now;if(selected||selTrip)renderCard();}
  if(now-fpsT>1000){$("#fps").textContent=`${Math.round(frames*1000/(now-fpsT))} FPS`;frames=0;fpsT=now;}
}

/* ---------- theme ---------- */
function applyTheme(){readTheme();colourDecks();colourStatic();refreshSources();}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
addEventListener("resize",sizeMini);

applyTheme();placeStatic();setHints();
map.on("style.load",()=>{curPreset="";addLayers();applyWeather();updateLight();if(!showLabels&&map.getLayer("st-labels"))map.setLayoutProperty("st-labels","visibility","none");if(xray)try{map.setConfigProperty("basemap","show3dObjects",false);}catch(e){}});
map.on("load",()=>{$("#load")&&$("#load").remove();
  const fromHash=stations.find(s=>s.slug===location.hash.slice(1));if(fromHash)selectStation(fromHash);});
map.on("error",e=>{const msg=e&&e.error&&e.error.message||"";if(/token|401|403|Unauthorized|Forbidden/i.test(msg)){const l=$("#load");if(l){l.textContent="The Mapbox token was rejected. Check that it's valid and allowed for this site.";}else toast("Mapbox token rejected for this site",6000);}});
addEventListener("hashchange",()=>{const s=stations.find(s=>s.slug===location.hash.slice(1));if(s&&s!==selected)selectStation(s);});
window.__twin={map,E,setMode,startRide,nearestTrain};
})();
