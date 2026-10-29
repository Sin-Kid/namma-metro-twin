"""Apply BMRCL's official station names (operational-lines map, version 05) to src/data.js.

Renames are per line and keyed by the source name. A station shared with another
line keeps one shared feature only when both lines use the same official name
(true interchanges such as Majestic); otherwise the renamed line gets its own copy.
Also adds Hopefarm Channasandra, which the 2020 source data lacks.
Run: python3 scripts/official_names.py
"""
import json, math, re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data.js"

RENAMES = {
  "purple": {
    "Mailasandra": "Kengeri Bus Terminal",
    "Bangalore University": "Jnanabharathi",
    "Nayandahalli": "Pantharapalya - Nayandahalli",
    "Hosahalli": "Balagangadharanatha Swamiji Station, Hosahalli",
    "City Railway Station": "Krantivira Sangolli Rayanna Railway Station",
    "Majestic (Nadaprabhu Kempegowda)": "Nadaprabhu Kempegowda Station, Majestic",
    "Sir M. Visvesvaraya": "Sir M. Visvesvaraya Station, Central College",
    "Vidhana Soudha": "Dr. B. R. Ambedkar Station, Vidhana Soudha",
    "Jyothipuram": "Benniganahalli",
    "KR Puram": "K. R. Pura",
    "Mahadevapura": "Singayyanapalya",
    "Doddanakundi Industrial Area": "Hoodi",
    "Visvesvaraya Industrial Area": "Seetharampalya",
    "Vydehi Hospital": "Nallur Halli",
    "Sri Satya Sai Hospital": "Sri Sathya Sai Hospital",
    "ITPL": "Pattandur Agrahara",
    "Kadugodi": "Kadugodi Tree Park",
    "Whitefield": "Whitefield (Kadugodi)",
  },
  "green": {
    "Madavara (BIEC)": "Madavara",
    "Jindal": "Chikkabidarakallu",
    "Manjunathanagar": "Manjunatha Nagar",
    "Yeshwanthpur Industry": "Goraguntepalya",
    "Kuvempu Road": "Mahakavi Kuvempu Road",
    "Sampige Road": "Mantri Square Sampige Road",
    "Majestic (Nadaprabhu Kempegowda)": "Nadaprabhu Kempegowda Station, Majestic",
    "Chickpet": "Chickpete",
    "KR Market": "Krishna Rajendra Market",
    "Southend Circle": "South End Circle",
    "RV Road": "Rashtreeya Vidyalaya Road",
    "Jayaprakash Nagar": "Jaya Prakash Nagar",
    "Anjanapura Cross Road": "Konanakunte Cross",
    "Krishna Leela Park": "Doddakallasandra",
    "Vajrahalli": "Vajarahalli",
    "Thalgattapura": "Thalaghattapura",
  },
  "yellow": {
    "RV Road": "Rashtreeya Vidyalaya Road",
    "HSR Layout": "Bommanahalli",
    "Oxford College": "Hongasandra",
    "Muneshwara Nagar": "Kudlu Gate",
    "Chikkabegur": "Singasandra",
    "Basapura Road": "Hosa Road",
    "Hosa Road": "Beratena Agrahara",
    "Electronic City-I": "Electronic City",
    "Electronic City-II": "Infosys Foundation Konappana Agrahara",
    "Hebbagodi": "Biocon Hebbagodi",
    "Bommasandra": "Delta Electronics Bommasandra",
  },
  "pink": {
    "Kalena Agrahara (Gottigere)": "Kalena Agrahara",
    "IIM-Bangalore": "IIMB",
    "Tavarekere (Swagath Road)": "Tavarekere",
  },
}

src = DATA.read_text()
d = json.loads(src[src.index("{"):src.rindex("}") + 1])
feats, routes = d["feats"], d["routes"]
by_color = {r["color"]: r for r in routes}

# target name of every (route, feature) pair, computed before any change
target = {}
for r in routes:
  ren = RENAMES.get(r["color"], {})
  for ch, j in r["stops"]:
    target[(r["color"], j)] = ren.get(feats[j][0], feats[j][0])

users = {}
for r in routes:
  for ch, j in r["stops"]:
    users.setdefault(j, []).append(r["color"])

for r in routes:
  for k, (ch, j) in enumerate(r["stops"]):
    new = target[(r["color"], j)]
    if new == feats[j][0]:
      continue
    others = [c for c in users[j] if c != r["color"]]
    if all(target[(c, j)] == new for c in others):
      feats[j][0] = new                      # shared interchange or sole user: rename in place
    else:
      feats.append([new, feats[j][1], feats[j][2], feats[j][3]])
      r["stops"][k][1] = len(feats) - 1      # this line gets its own copy

# Hopefarm Channasandra: midway between Kadugodi Tree Park and Whitefield (Kadugodi) on the Purple Line
LAT0, LON0 = 12.97, 77.59
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540
P = lambda c: ((c[0] - LON0) * KX, (c[1] - LAT0) * KY)
pur = by_color["purple"]
names = [feats[j][0] for ch, j in pur["stops"]]
if "Hopefarm Channasandra" not in names:
  a = names.index("Kadugodi Tree Park"); b = names.index("Whitefield (Kadugodi)")
  mid = (pur["stops"][a][0] + pur["stops"][b][0]) / 2
  xy = [P(c) for c in pur["c"]]; cum = 0
  for i in range(len(xy) - 1):
    seg = math.dist(xy[i], xy[i + 1])
    if cum + seg >= mid:
      t = (mid - cum) / seg
      lon = pur["c"][i][0] + (pur["c"][i + 1][0] - pur["c"][i][0]) * t
      lat = pur["c"][i][1] + (pur["c"][i + 1][1] - pur["c"][i][1]) * t
      break
    cum += seg
  feats.append(["Hopefarm Channasandra", round(lon, 5), round(lat, 5), "s"])
  pur["stops"].insert(b, [round(mid), len(feats) - 1])

DATA.write_text(re.sub(r"const DATA = .*;\s*$", "const DATA = " + json.dumps(d, separators=(",", ":"), ensure_ascii=False) + ";\n", src, flags=re.S))
for r in routes:
  print(r["color"], len(r["stops"]), " | ".join(feats[j][0] for ch, j in r["stops"]))
