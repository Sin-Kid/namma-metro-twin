"""Build src/data.js from BMRCL's timetable (unofficial GTFS by Vonter, ODbL) plus the future Pink/Blue lines.

Operational lines (Purple, Green, Yellow) take their track shape, station positions, names, Kannada names
and every scheduled trip from the GTFS feed. Pink and Blue (not yet open) come from data/future-lines.json.

Output format (const DATA in src/data.js):
  routes: [{color, c:[[lon,lat]...], stops:[[chainage_m, featIdx]...], ramps:[chainage_m...]}]
  feats:  [[name, lon, lat, "s", kannada, code]]
  tt:     {patterns:[[routeIdx, [stopIdx...], [arr_s...], [dep_s...]]], trips:{service:[[patternIdx, start_s]...]},
           dates:{yyyymmdd: service}}   # arr/dep are seconds after the trip's first departure
Run: python3 scripts/build_gtfs.py
"""
import csv, io, json, math, pathlib, zipfile, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
Z = zipfile.ZipFile(ROOT / "data" / "bmrcl-gtfs.zip")
rd = lambda n: list(csv.DictReader(io.TextIOWrapper(Z.open(n), "utf-8-sig")))

# names as printed on BMRCL's operational-lines map (version 05) where the feed spells them differently
NAME_FIX = {
  "MYRD": "Mysuru Road", "KRAM": "K. R. Pura", "VDHP": "Nallur Halli", "MNJN": "Manjunatha Nagar",
  "YPM": "Yeshwanthpur", "HSLI": "Balagangadharanatha Swamiji Station, Hosahalli",
  "VSWA": "Sir M. Visvesvaraya Station, Central College",
}
# underground stations (track below street level). The feed marks most; KR Market is added by hand.
UNDERGROUND = {"BRCS", "KGWA", "VSWA", "VDSA", "CBPK", "CKPE", "KRMT"}
COLOR = {"PURPLE": "purple", "GREEN": "green", "YELLOW": "yellow"}
ORDER = ["PURPLE", "GREEN", "YELLOW"]

LAT0, LON0 = 12.97, 77.59
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540
P = lambda lon, lat: ((lon - LON0) * KX, (lat - LAT0) * KY)

def t2s(t):
  h, m, s = map(int, t.split(":")); return h * 3600 + m * 60 + s

stops = {r["stop_id"]: r for r in rd("stops.txt")}
kn = {r["record_id"]: r["translation"] for r in rd("translations.txt")
      if r["table_name"] == "stops" and r["field_name"] == "stop_name" and r["language"] == "kn"}
trips = {r["trip_id"]: r for r in rd("trips.txt")}
st = collections.defaultdict(list)
for r in rd("stop_times.txt"):
  st[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"].split("_")[0], t2s(r["arrival_time"]), t2s(r["departure_time"])))
shapes = collections.defaultdict(list)
for r in rd("shapes.txt"):
  shapes[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lon"]), float(r["shape_pt_lat"])))
for k in shapes: shapes[k].sort()

def length(pts):
  xy = [P(lo, la) for _, lo, la in pts]; return sum(math.dist(xy[i], xy[i + 1]) for i in range(len(xy) - 1))

def project(line_xy, cum, p):
  best = (1e18, 0)
  for i in range(len(line_xy) - 1):
    a, b = line_xy[i], line_xy[i + 1]; dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) if L2 else 0
    d = math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
    if d < best[0]: best = (d, cum[i] + t * math.sqrt(L2))
  return best

feats, feat_of = [], {}
def feat(code):
  if code not in feat_of:
    s = stops[code]
    feat_of[code] = len(feats)
    feats.append([NAME_FIX.get(code, s["stop_name"]), round(float(s["stop_lon"]), 6), round(float(s["stop_lat"]), 6), "s", kn.get(code, ""), code])
  return feat_of[code]

routes, stop_index = [], {}
for rid in ORDER:
  # canonical geometry: the longest shape used by this route
  sids = {trips[t]["shape_id"] for t in trips if trips[t]["route_id"] == rid}
  sid = max(sids, key=lambda s: length(shapes[s]))
  pts = shapes[sid]
  c = [[round(lo, 6), round(la, 6)] for _, lo, la in pts]
  xy = [P(*p) for p in c]
  cum = [0]
  for i in range(1, len(xy)): cum.append(cum[-1] + math.dist(xy[i - 1], xy[i]))
  codes = sorted({s for t, v in st.items() if trips[t]["route_id"] == rid for _, s, _, _ in v})
  placed = []
  for code in codes:
    d, ch = project(xy, cum, P(float(stops[code]["stop_lon"]), float(stops[code]["stop_lat"])))
    assert d < 150, (rid, code, d)
    placed.append((ch, code))
  placed.sort()
  stop_index[rid] = {code: i for i, (ch, code) in enumerate(placed)}
  # tunnel portals: a ramp between each underground/elevated pair of neighbouring stations
  ramps = []
  for (ca, a), (cb, b) in zip(placed, placed[1:]):
    if (a in UNDERGROUND) != (b in UNDERGROUND):
      ug_first = a in UNDERGROUND
      ramps.append(round(ca + (cb - ca) * (0.45 if ug_first else 0.55)))
  routes.append({"color": COLOR[rid], "c": c, "stops": [[round(ch), feat(code)] for ch, code in placed], "ramps": ramps})

# timetable: stopping patterns + trip start times per service
patterns, pat_of, by_service = [], {}, collections.defaultdict(list)
for tid, v in st.items():
  v.sort(); rid = trips[tid]["route_id"]; t0 = v[0][3]
  idxs = tuple(stop_index[rid][s] for _, s, _, _ in v)
  arr = tuple(a - t0 for _, _, a, _ in v); dep = tuple(d - t0 for _, _, _, d in v)
  key = (rid, idxs, arr, dep)
  if key not in pat_of:
    pat_of[key] = len(patterns); patterns.append([ORDER.index(rid), list(idxs), list(arr), list(dep)])
  by_service[trips[tid]["service_id"]].append([pat_of[key], t0])
for k in by_service: by_service[k].sort(key=lambda x: (x[1], x[0]))
dates = {r["date"]: r["service_id"] for r in rd("calendar_dates.txt") if r["exception_type"] == "1"}

future = json.loads((ROOT / "data" / "future-lines.json").read_text())
base = len(feats)
# merge future-line stations into an operational station within 250 m (e.g. Jayadeva Hospital, Central Silk Board)
remap = {}
for j, f in enumerate(future["feats"]):
  fx = P(f[1], f[2])
  near = min(range(base), key=lambda k: math.dist(fx, P(feats[k][1], feats[k][2])))
  if math.dist(fx, P(feats[near][1], feats[near][2])) < 250: remap[j] = near
  else: remap[j] = len(feats); feats.append([f[0], f[1], f[2], f[3], "", ""])
for r in future["routes"]:
  routes.append({"color": r["color"], "c": r["c"], "stops": [[ch, remap[j]] for ch, j in r["stops"]], "ramps": r["ramps"]})

data = {"routes": routes, "feats": feats, "tt": {"patterns": patterns, "trips": dict(by_service), "dates": dates},
        "source": "BMRCL timetable via github.com/Vonter/bmrcl-gtfs (ODbL), feed version " + rd("feed_info.txt")[0]["feed_version"]}
out = ROOT / "src" / "data.js"
out.write_text("/* Namma Metro data. Operational lines: BMRCL timetable and OpenStreetMap geometry via the unofficial GTFS by Vonter\n"
               "   (github.com/Vonter/bmrcl-gtfs, ODbL 1.0). Future lines: github.com/geohacker/namma-metro (MIT). Built by scripts/build_gtfs.py. */\n"
               "const DATA = " + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n")
print("routes", [(r["color"], len(r["stops"]), len(r["c"]), r["ramps"]) for r in routes])
print("patterns", len(patterns), {k: len(v) for k, v in by_service.items()}, "holiday dates", len(dates), "bytes", out.stat().st_size)
print("merged future stations:", [(future["feats"][j][0], feats[k][0]) for j, k in remap.items() if k < base])
