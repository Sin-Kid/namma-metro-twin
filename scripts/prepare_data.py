import json, math, sys
d=json.load(open(sys.argv[1]))
lines=[f for f in d['features'] if f['geometry']['type']=='LineString']
pts=[f for f in d['features'] if f['geometry']['type']=='Point']
lat0=12.97;lon0=77.59;kx=111320*math.cos(math.radians(lat0));ky=110540
P=lambda c:((c[0]-lon0)*kx,(c[1]-lat0)*ky)
SPEC=[('purple',[(2,1),(0,1),(3,0)]),('green',[(4,1),(1,0),(5,0)]),('yellow',[(6,0)]),('pink',[(7,0)]),('blue',[(8,1),(9,0)])]
RENAME={'Challegatta':'Challaghatta','Gurudacharpalya':'Garudacharpalya','Hesaraghatta Cross (Nagasandra)':'Nagasandra','BIEC':'Madavara (BIEC)',
 'Anjanapura Township':'Silk Institute','Mysore Road':'Mysuru Road','Sir M. Visveshwaraya':'Sir M. Visvesvaraya','Majestic':'Majestic (Nadaprabhu Kempegowda)',
 'Rashtreeya Vidyalaya Road':'RV Road','Central Silkboard':'Central Silk Board','Gottigere':'Kalena Agrahara (Gottigere)','Swagath Road Cross':'Tavarekere (Swagath Road)','Mahadevpura':'Mahadevapura'}
def clean(n):
  n=n.replace('\xa0',' ').replace('*','').strip();return RENAME.get(n,n)
def nearest_line(p):
  best=(1e18,None)
  for i,f in enumerate(lines):
    xy=[P(c) for c in f['geometry']['coordinates']]
    best=min(best,(proj(xy,p)[0],i))
  return best[1]
def proj(xy,p):
  best=(1e18,0);cum=0
  for k in range(len(xy)-1):
    a,b=xy[k],xy[k+1];dx,dy=b[0]-a[0],b[1]-a[1];L=dx*dx+dy*dy;Ls=math.sqrt(L)
    t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L)) if L else 0
    dd=math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
    if dd<best[0]:best=(dd,cum+t*Ls)
    cum+=Ls
  return best
color_of=[f['properties']['description'] for f in lines]
feat=[]
for f in pts:
  c=f['geometry']['coordinates'];raw=f['properties']['Name'].replace('\xa0',' ').strip()
  kind='ramp' if 'Ramp' in raw else 'depot' if 'Depot' in raw else 'station'
  feat.append(dict(n=clean(raw),lon=round(c[0],5),lat=round(c[1],5),kind=kind,home=color_of[nearest_line(P(c))]))
routes=[]
for color,parts in SPEC:
  coords=[]
  for i,rev in parts:
    cc=lines[i]['geometry']['coordinates'][::-1] if rev else lines[i]['geometry']['coordinates']
    cc=[[round(x[0],5),round(x[1],5)] for x in cc]
    if coords and math.dist(P(coords[-1]),P(cc[0]))<5: cc=cc[1:]
    elif coords: print('GAP',color,i,math.dist(P(coords[-1]),P(cc[0])))
    coords+=cc
  xy=[P(c) for c in coords]
  stops=[]
  for j,s in enumerate(feat):
    if s['kind']=='depot':continue
    dd,ch=proj(xy,P((s['lon'],s['lat'])))
    if dd<120: stops.append([round(ch),j,s['kind'],s['home']==color])
  stops.sort()
  out=[]
  for st in stops:
    if out and st[2]=='station' and out[-1][2]=='station' and st[0]-out[-1][0]<350:
      if st[3] and not out[-1][3]: out[-1]=st
      continue
    out.append(st)
  routes.append(dict(color=color,c=coords,stops=[[o[0],o[1]] for o in out if o[2]=='station'],ramps=[o[0] for o in out if o[2]=='ramp']))
  print(color,len(coords),'stations',sum(o[2]=='station' for o in out),'ramps',[ (o[0],feat[o[1]]['n']) for o in out if o[2]=='ramp'])
  print('  ',' | '.join(feat[o[1]]['n'] for o in out if o[2]=='station'))
json.dump(dict(routes=routes,feats=[[f['n'],f['lon'],f['lat'],f['kind'][0]] for f in feat]),open(sys.argv[2],'w'),separators=(',',':'),ensure_ascii=False)
