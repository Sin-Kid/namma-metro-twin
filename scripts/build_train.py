"""Convert the Shanghai Metro Line 6 AC04 train (by zengwish, CGTrader, Royalty Free) into src/train.bin.

The source OBJ is NOT kept in this repo (the licence doesn't allow redistributing the model file).
Download it from https://www.cgtrader.com/free-3d-models/vehicle/train/shanghai-metro-line6-ac-04-train-alstom-sh-company
and run:  python3 scripts/build_train.py path/to/3d-model.obj

Output: one driving car and one middle car, pantographs removed, body kept at full detail (Namma Metro uses third rail),
scaled to Namma Metro proportions (21.6 m car pitch, ~2.9 m wide, floor ~0.94 m above rail),
simplified for real-time use. Car length runs along +Z (the driving car's nose at +Z), Y up, rail top at Y=0.
File layout (little-endian): "NMTR", u32 version (2), then per car: u32 nVerts, u32 nTris, f32[nVerts*3] positions,\ni8[nVerts*4] normals, u16/u32 indices, padded to 4 bytes.
"""
import sys, struct, pathlib
import numpy as np
import fast_simplification

src = sys.argv[1]
V, F = [], []
for line in open(src, encoding="latin-1"):
  if line.startswith("v "):
    V.append([float(t) for t in line.split()[1:4]])
  elif line.startswith("f "):
    ids = [int(t.split("/")[0]) for t in line.split()[1:]]
    ids = [i - 1 if i > 0 else len(V) + i for i in ids]
    for k in range(1, len(ids) - 1):
      F.append([ids[0], ids[k], ids[k + 1]])
V = np.asarray(V, np.float64) / 1000.0      # mm -> m; length along X, up Y, width Z
F = np.asarray(F, np.int64)
C = V[F].mean(1)

SEAMS = [-45.4, -22.6, 0.0]                  # driving car [-45.4,-22.6], middle car [-22.6,0]
SCALE = np.array([21.6 / 22.65, 0.85, 0.88])  # length, height, width

def car(x0, x1, target):
  # drop the pantographs: every face lying wholly above the roof crown (5.04 m in the source)
  keep = (C[:, 0] >= x0) & (C[:, 0] < x1) & (V[F][:, :, 1].min(1) < 5.06) & (V[F][:, :, 1].max(1) < 5.12)
  f = F[keep]
  used, inv = np.unique(f, return_inverse=True)
  v = V[used]; f = inv.reshape(-1, 3)
  # weld near-duplicate vertices so simplification can collapse across part seams
  q = np.round(v / 0.0005).astype(np.int64)
  _, first, remap = np.unique(q, axis=0, return_index=True, return_inverse=True)
  v = v[first]; f = remap.reshape(-1)[f]
  f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
  # keep the whole body shell exactly (simplifying it tore holes in the roof and nose);
  # simplify only the underframe (bogies, equipment boxes) below the solebar
  big = v[f][:, :, 1].mean(1) >= 1.12
  small = f[~big]
  ratio = max(0.0, 1.0 - max(1, target - big.sum()) / max(1, len(small)))
  vs, fs = fast_simplification.simplify(v.astype(np.float32), small.astype(np.int32), target_reduction=ratio)
  v2 = np.vstack([v.astype(np.float32), vs]); f2 = np.vstack([f[big].astype(np.int64), fs.astype(np.int64) + len(v)])
  used2, inv2 = np.unique(f2, return_inverse=True); v2 = v2[used2]; f2 = inv2.reshape(-1, 3)
  # to car-local: centre the car, length -> +Z with the nose (min X) at +Z, width -> X
  cx = (x0 + x1) / 2
  out = np.empty_like(v2)
  out[:, 0] = v2[:, 2] * SCALE[2]
  out[:, 1] = v2[:, 1] * SCALE[1]
  out[:, 2] = -(v2[:, 0] - cx) * SCALE[0]
  # (x, y, z) -> (z, y, -x) is a rotation, so triangle winding is unchanged
  if x0 == SEAMS[0]: out, f2 = round_nose(out, f2)
  out, f2, nrm = crease_normals(out, f2)
  print(f"car {x0}..{x1}: {keep.sum()} -> {len(f2)} triangles, {len(out)} vertices, "
        f"extent x {out[:,0].min():.2f}..{out[:,0].max():.2f} y {out[:,1].min():.2f}..{out[:,1].max():.2f} z {out[:,2].min():.2f}..{out[:,2].max():.2f}")
  return out.astype(np.float32), f2.astype(np.uint32), nrm

def crease_normals(v, f, crease_deg=38):
  """Smooth shading across gentle curves (the nose, the roof), hard edges at creases.
  The source mixes face windings, so neighbouring normals are sign-aligned before averaging."""
  v = np.asarray(v, np.float64); f = np.asarray(f, np.int64)
  fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
  area = np.linalg.norm(fn, axis=1); fn = fn / np.maximum(area, 1e-12)[:, None]
  inc = [[] for _ in range(len(v))]
  for i, t in enumerate(f):
    for c in t: inc[c].append(i)
  cosT = np.cos(np.radians(crease_deg)); verts, nrms, key, out_f = [], [], {}, np.empty_like(f)
  for i, t in enumerate(f):
    for j, c in enumerate(t):
      n0 = fn[i]; acc = np.zeros(3)
      for k in inc[c]:
        d = fn[k] @ n0
        if abs(d) >= cosT: acc += np.sign(d or 1) * fn[k] * area[k]
      acc = acc / (np.linalg.norm(acc) or 1)
      q = (c, *np.round(acc * 64).astype(int))
      if q not in key: key[q] = len(verts); verts.append(v[c]); nrms.append(acc)
      out_f[i, j] = key[q]
  return np.array(verts, np.float32), out_f, np.array(nrms, np.float32)

def round_nose(v, f, zs=8.6, depth=1.05, max_edge=0.4):
  """Bend the source's flat cab front into the rounded nose of BEML's Namma Metro cars:
  curved in plan, slightly raked top and bottom. The nose faces are subdivided first so the bend is smooth."""
  v = [tuple(p) for p in v]; mid = {}
  def midpoint(a, b):
    k = (a, b) if a < b else (b, a)
    if k not in mid: mid[k] = len(v); v.append(tuple((np.array(v[a]) + np.array(v[b])) / 2))
    return mid[k]
  faces = [tuple(t) for t in f]
  for _ in range(4):
    nxt, split = [], 0
    for a, b, c in faces:
      P = np.array([v[a], v[b], v[c]])
      if P[:, 2].min() > zs - 0.4 and max(np.linalg.norm(P[0] - P[1]), np.linalg.norm(P[1] - P[2]), np.linalg.norm(P[2] - P[0])) > max_edge:
        ab, bc, ca = midpoint(a, b), midpoint(b, c), midpoint(c, a)
        nxt += [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]; split += 1
      else: nxt.append((a, b, c))
    faces = nxt; print("  nose split", split)
    if not split: break
  v = np.array(v, np.float64); f = np.array(faces, np.int64)
  zf = v[:, 2].max(); t = np.clip((v[:, 2] - zs) / (zf - zs), 0, 1) ** 1.6
  bend = 0.85 * (v[:, 0] / 1.47) ** 2 + 0.35 * np.clip((v[:, 1] - 2.2) / 2.1, -1, 1) ** 2
  v[:, 2] -= depth * t * bend
  return v.astype(np.float32), f

cars = [car(SEAMS[0], SEAMS[1], 18000), car(SEAMS[1], SEAMS[2], 24000)]
buf = bytearray(b"NMTR" + struct.pack("<I", 2))   # v2: per-vertex normals as int8x4 after the positions
for v, f, n in cars:
  buf += struct.pack("<II", len(v), len(f))
  buf += v.tobytes()
  n8 = np.zeros((len(n), 4), np.int8); n8[:, :3] = np.clip(np.round(n * 127), -127, 127)
  buf += n8.tobytes()
  buf += (f.astype(np.uint16) if len(v) < 65536 else f).tobytes()
  if len(buf) % 4: buf += b"\0" * (4 - len(buf) % 4)
out = pathlib.Path(__file__).resolve().parent.parent / "src" / "train.bin"
out.write_bytes(bytes(buf))
print("wrote", out, len(buf), "bytes")
