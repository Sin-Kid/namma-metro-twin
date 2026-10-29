/* Namma Metro twin engine: geometry, height profile, timetable, train positions. Distances in metres, times in seconds. */
function MetroEngine(DATA){
  "use strict";
  const LAT0=12.97,LON0=77.59,KX=111320*Math.cos(LAT0*Math.PI/180),KY=110540;
  const toXY=(lon,lat)=>[(lon-LON0)*KX,-(lat-LAT0)*KY];            // x east, y = south (scene z)
  const toLL=(x,y)=>[LON0+x/KX,LAT0-y/KY];

  const META={
    purple:{name:"Purple Line",code:"Line 1",status:"open",elev:12,depth:16,
      term:["Challaghatta","Whitefield (Kadugodi)"]},
    green:{name:"Green Line",code:"Line 2",status:"open",elev:14,depth:22,
      term:["Madavara","Silk Institute"]},
    yellow:{name:"Yellow Line",code:"Line 3",status:"open",elev:18,depth:18,term:["Rashtreeya Vidyalaya Road","Delta Electronics Bommasandra"]},
    pink:{name:"Pink Line",code:"Line 4",status:"building",elev:15,depth:19,term:["Kalena Agrahara","Nagawara"],
      note:"Elevated Kalena Agrahara–Tavarekere stretch has safety clearance and awaits inauguration. Underground section still under construction."},
    blue:{name:"Blue Line",code:"Line 5",status:"building",elev:16,depth:16,term:["Central Silk Board","KIAL Airport"],
      note:"Under construction. Airport-side stations are not in the source data."},
  };

  /* features: [name, lon, lat, kind] */
  const feats=DATA.feats.map(([n,lon,lat,k],i)=>{const [x,y]=toXY(lon,lat);return {i,name:n,lon,lat,x,y,kind:k==="s"?"station":k==="d"?"depot":"ramp",routes:[]};});

  const SLOPE=0.035, PORTAL_EASE=1; // 3.5% ramps
  const routes=DATA.routes.map(r=>{
    const m=META[r.color],p=r.c.map(c=>toXY(c[0],c[1]));
    const cum=[0];for(let k=1;k<p.length;k++)cum.push(cum[k-1]+Math.hypot(p[k][0]-p[k-1][0],p[k][1]-p[k-1][1]));
    const R={color:r.color,...m,p,cum,len:cum[cum.length-1],ramps:r.ramps.slice().sort((a,b)=>a-b)};
    // tunnels: pairs of portals. Pink's second portal sits past Nagawara, so the line ends underground.
    R.tunnels=[];for(let k=0;k+1<R.ramps.length;k+=2)R.tunnels.push([R.ramps[k],R.ramps[k+1]]);
    R.stops=r.stops.map(([ch,j],idx)=>{const f=feats[j];const st={route:R,idx,ch,f};f.routes.push(st);return st;});
    return R;
  });
  const byColor={};routes.forEach(r=>byColor[r.color]=r);

  /* height of track level (m above ground; negative = underground) */
  function height(R,s){
    let best=R.elev;
    for(const [a,b] of R.tunnels){
      if(s>=a&&s<=b){const d=Math.min(s-a,b-s);return -Math.min(R.depth,d*SLOPE);}
      const d=s<a?a-s:s-b;best=Math.min(best,d*SLOPE);
    }
    return best;
  }
  function pointAt(R,s){
    s=Math.max(0,Math.min(R.len,s));
    let lo=0,hi=R.cum.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(R.cum[m]<=s)lo=m;else hi=m;}
    const a=R.p[lo],b=R.p[lo+1]||a,sl=(R.cum[lo+1]-R.cum[lo])||1,t=(s-R.cum[lo])/sl;
    return {x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t,dx:(b[0]-a[0])/sl,dy:(b[1]-a[1])/sl,h:height(R,s)};
  }
  routes.forEach(R=>R.stops.forEach(st=>{st.h=height(R,st.ch);st.under=st.h<-2;}));

  /* ---- running: trapezoid profile ---- */
  const ACC=0.8, VMAX=15.5;          // m/s², m/s (≈56 km/h cruise; RDSO commercial limit is 67.5 km/h)
  const DWELL=40, DWELL_X=60;        // s; interchanges dwell longer
  const runTime=d=>d>=VMAX*VMAX/ACC?d/VMAX+VMAX/ACC:2*Math.sqrt(d/ACC);
  function runPos(d,u){ // distance covered after u seconds on a segment of length d
    const T=runTime(d);u=Math.max(0,Math.min(T,u));
    if(d>=VMAX*VMAX/ACC){const ta=VMAX/ACC,da=VMAX*VMAX/(2*ACC);
      if(u<ta)return [.5*ACC*u*u,ACC*u];if(u<T-ta)return [da+VMAX*(u-ta),VMAX];const r=T-u;return [d-.5*ACC*r*r,ACC*r];}
    const th=T/2;if(u<th)return [.5*ACC*u*u,ACC*u];const r=T-u;return [d-.5*ACC*r*r,ACC*r];
  }
  routes.forEach(R=>{
    const S=R.stops,n=S.length;
    R.seg=[];for(let i=0;i<n-1;i++){const d=S[i+1].ch-S[i].ch;R.seg.push({d,t:runTime(d)});}
    const dw=i=>S[i].f.routes.length>1?DWELL_X:DWELL;
    // direction 0: first → last stop; direction 1: last → first
    const a0=new Array(n),d0=new Array(n),a1=new Array(n),d1=new Array(n);
    a0[0]=0;d0[0]=0;for(let i=1;i<n;i++){a0[i]=d0[i-1]+R.seg[i-1].t;d0[i]=a0[i]+(i===n-1?0:dw(i));}
    a1[n-1]=0;d1[n-1]=0;for(let i=n-2;i>=0;i--){a1[i]=d1[i+1]+R.seg[i].t;d1[i]=a1[i]+(i===0?0:dw(i));}
    R.arr=[a0,a1];R.dep=[d0,d1];R.endToEnd=a0[n-1];
    const find=name=>S.findIndex(s=>s.f.name===name);
    R.termIdx=[0,n-1];
  });

  /* ---- timetable ----
     Terminal first/last trains and headway bands follow BMRCL's published pattern as reported in Oct 2026.
     Times in minutes after midnight; the service day runs 03:00 → 27:00. */
  const TT={
    purple:{first:{mon:255,wk:300,sat:300,sun:420},last:[{mon:1385,wk:1382,sat:1385,sun:1385},{mon:1365,wk:1365,sat:1365,sun:1365}]},
    green:{first:{mon:255,wk:300,sat:300,sun:420},last:[{mon:1377,wk:1377,sat:1380,sun:1380},{mon:1385,wk:1385,sat:1385,sun:1385}]},
    yellow:{first:{mon:305,wk:360,sat:360,sun:420},last:[{mon:1435,wk:1435,sat:1435,sun:1435},{mon:1362,wk:1362,sat:1362,sun:1362}]},
  };
  const PEAKS=[[480,660],[1020,1200]];
  const inPeak=m=>PEAKS.some(([a,b])=>m>=a&&m<b);
  function headway(color,m,day){
    const Y=color==="yellow",wkday=day==="wk"||day==="mon";
    if(day==="sun")return {h:Y?12:10,band:"Sunday"};
    if(m<420)return {h:15,band:"Early morning"};
    if(m<480)return {h:10,band:"Morning"};
    if(inPeak(m))return {h:Y?(wkday?8:10):(wkday?7:8),band:"Peak"};
    if(m<1020)return {h:Y?11:9,band:"Off-peak"};
    if(m<1320)return {h:Y?12:10,band:"Evening"};
    return {h:15,band:"Late night"};
  }
  const dayType=dow=>dow===0?"sun":dow===6?"sat":dow===1?"mon":"wk";

  function buildDay(day){
    const trips=[];
    routes.forEach(R=>{
      const tt=TT[R.color];if(!tt||R.status!=="open")return;
      for(const dir of [0,1]){
        const i0=R.termIdx[dir],i1=R.termIdx[1-dir];
        const first=tt.first[day]*60,last=tt.last[dir][day]*60;
        for(let t=first;t<=last;){
          const hw=headway(R.color,t/60,day);
          trips.push({R,dir,i0,i1,t0:t,kind:"through"});
          const nx=t+hw.h*60;
          t=(nx>last&&t<last)?last:nx;   // always run the published last train
        }
      }
    });
    trips.forEach((tr,k)=>{tr.id=k;const A=tr.R.arr[tr.dir],D=tr.R.dep[tr.dir];tr.base=D[tr.i0];tr.dur=A[tr.i1]-D[tr.i0];});
    return trips;
  }
  const dayCache={};
  const tripsFor=day=>dayCache[day]||(dayCache[day]=buildDay(day));

  /* state of a trip at service-day second t */
  const LAY_BEFORE=150,LAY_AFTER=90;   // seconds a train stands at the terminus platform before departing / after arriving
  function tripState(tr,t){
    const tau=t-tr.t0;
    if(tau<0){if(tau<-LAY_BEFORE)return null;return {ch:tr.R.stops[tr.i0].ch,v:0,at:tr.i0,next:tr.i0+(tr.dir?-1:1),layover:"departing"};}
    if(tau>tr.dur){if(tau>tr.dur+LAY_AFTER)return null;return {ch:tr.R.stops[tr.i1].ch,v:0,at:tr.i1,next:tr.i1,layover:"arrived"};}
    const R=tr.R,A=R.arr[tr.dir],D=R.dep[tr.dir],T=tau+tr.base,step=tr.dir?-1:1;
    for(let i=tr.i0;i!==tr.i1;i+=step){
      if(T<=D[i]&&i!==tr.i0)return {ch:R.stops[i].ch,v:0,at:i,next:i};
      const j=i+step;
      if(T<A[j]){const seg=R.seg[Math.min(i,j)],[s,v]=runPos(seg.d,T-D[i]);
        return {ch:R.stops[i].ch+step*s,v,at:-1,next:j,prev:i};}
      if(j===tr.i1)return {ch:R.stops[j].ch,v:0,at:j,next:j};
    }
    return {ch:R.stops[tr.i1].ch,v:0,at:tr.i1,next:tr.i1};
  }
  const timeAtStop=(tr,i)=>tr.t0+tr.R.arr[tr.dir][i]-tr.base;
  const depAtStop=(tr,i)=>tr.t0+tr.R.dep[tr.dir][i]-tr.base;
  const serves=(tr,i)=>tr.dir?(i<=tr.i0&&i>=tr.i1):(i>=tr.i0&&i<=tr.i1);

  function departures(st,day,t,count=3){ // next departures at a stop, per direction
    const R=st.route,i=st.idx,out=[[],[]];
    for(const tr of tripsFor(day)){if(tr.R!==R||!serves(tr,i)||i===tr.i1)continue;
      const dt=depAtStop(tr,i);if(dt>=t)out[tr.dir].push({t:dt,tr});}
    out.forEach(a=>a.sort((x,y)=>x.t-y.t));
    const lastFirst=[0,1].map(dir=>{const ts=tripsFor(day).filter(tr=>tr.R===R&&tr.dir===dir&&serves(tr,i)&&i!==tr.i1).map(tr=>depAtStop(tr,i));
      return ts.length?[Math.min(...ts),Math.max(...ts)]:null;});
    return {next:out.map(a=>a.slice(0,count)),span:lastFirst};
  }

  /* IST clock: service day starts 03:00 IST */
  function istNow(ms=Date.now()){
    const d=new Date(ms+5.5*3600e3);let sec=d.getUTCHours()*3600+d.getUTCMinutes()*60+d.getUTCSeconds()+d.getUTCMilliseconds()/1000;
    let dow=d.getUTCDay();if(sec<3*3600){sec+=86400;dow=(dow+6)%7;}
    return {sec,dow,date:new Date(ms+5.5*3600e3-(sec>=86400?86400e3:0))};
  }

  /* journey planner: fewest-minutes path over open lines, then timed against the real trip list */
  function plan(fromF,toF,day,t){
    const open=routes.filter(R=>R.status==="open"),key=st=>st.route.color+":"+st.idx;
    const dist=new Map(),prev=new Map(),Q=[];
    fromF.routes.filter(st=>st.route.status==="open").forEach(st=>{dist.set(key(st),0);Q.push([0,st]);});
    let goal=null;
    while(Q.length){Q.sort((a,b)=>a[0]-b[0]);const [d,st]=Q.shift();if(d>dist.get(key(st)))continue;
      if(st.f===toF){goal=st;break;}
      const R=st.route,nb=[];
      if(st.idx>0)nb.push([R.stops[st.idx-1],R.seg[st.idx-1].t+DWELL]);
      if(st.idx<R.stops.length-1)nb.push([R.stops[st.idx+1],R.seg[st.idx].t+DWELL]);
      st.f.routes.forEach(o=>{if(o!==st&&o.route.status==="open")nb.push([o,300]);});
      for(const [n,w] of nb){const nd=d+w,k=key(n);if(nd<(dist.has(k)?dist.get(k):1e18)){dist.set(k,nd);prev.set(k,st);Q.push([nd,n]);}}
    }
    if(!goal)return null;
    const path=[goal];while(prev.has(key(path[0])))path.unshift(prev.get(key(path[0])));
    const legs=[];for(const st of path){const L=legs[legs.length-1];if(L&&L.R===st.route)L.to=st;else legs.push({R:st.route,from:st,to:st});}
    const real=legs.filter(L=>L.from!==L.to);
    let now=t;const trips=tripsFor(day);
    for(const L of real){
      L.dir=L.to.idx>L.from.idx?0:1;L.stops=Math.abs(L.to.idx-L.from.idx);
      const cand=trips.filter(tr=>tr.R===L.R&&tr.dir===L.dir&&serves(tr,L.from.idx)&&serves(tr,L.to.idx)&&L.from.idx!==tr.i1)
        .map(tr=>({tr,dep:depAtStop(tr,L.from.idx)})).filter(c=>c.dep>=now).sort((a,b)=>a.dep-b.dep)[0];
      if(!cand){L.none=true;break;}
      L.trip=cand.tr;L.dep=cand.dep;L.arr=timeAtStop(cand.tr,L.to.idx);now=L.arr+180;
    }
    return real;
  }

  return {toXY,toLL,routes,byColor,feats,META,height,pointAt,tripsFor,tripState,timeAtStop,depAtStop,departures,headway,dayType,istNow,TT,DWELL,VMAX,plan,serves};
}
if(typeof module!=="undefined")module.exports=MetroEngine;
