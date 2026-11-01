"""Traces brand/scopeflow-logo-source.png into clean SVG paths (dark + blue). Run: python3 brand/trace.py"""
import numpy as np, potrace
from PIL import Image

DARK, BLUE, WHITE = np.array([33, 41, 51]), np.array([0, 93, 212]), np.array([254, 254, 254])
S = 3  # upsample for smoother curves
src = Image.open("brand/scopeflow-logo-source.png").convert("RGB")
big = np.asarray(src.resize((src.width * S, src.height * S), Image.LANCZOS)).astype(float)

def mask(target):
    d = {k: np.linalg.norm(big - c, axis=2) for k, c in (("d", DARK), ("b", BLUE), ("w", WHITE))}
    t = d["d"] if target == "d" else d["b"]
    others = [v for k, v in d.items() if k != target]
    return t < np.minimum(*others)

def path_d(m, x0, y0):
    bm = potrace.Bitmap(~m)  # potracer traces the False pixels
    plist = bm.trace(turdsize=40, alphamax=1.0, opticurve=True, opttolerance=0.2)
    f = lambda p: f"{(p.x / S - x0):.2f} {(p.y / S - y0):.2f}"
    out = []
    for curve in plist:
        out.append(f"M{f(curve.start_point)}")
        for seg in curve.segments:
            if seg.is_corner:
                out.append(f"L{f(seg.c)}L{f(seg.end_point)}")
            else:
                out.append(f"C{f(seg.c1)} {f(seg.c2)} {f(seg.end_point)}")
        out.append("Z")
    return "".join(out)

def region(x1, x2, y1=180, y2=570):
    sl = (slice(y1 * S, y2 * S), slice(x1 * S, x2 * S))
    md, mb = np.zeros(big.shape[:2], bool), np.zeros(big.shape[:2], bool)
    md[sl], mb[sl] = mask("d")[sl], mask("b")[sl]
    return md, mb

import json
out = {}
for name, (x1, x2) in {"mark": (160, 545), "word": (585, 2025)}.items():
    md, mb = region(x1, x2)
    ys, xs = np.where(md | mb)
    bx0, by0, bx1, by1 = xs.min() / S, ys.min() / S, (xs.max() + 1) / S, (ys.max() + 1) / S
    out[name] = {"w": round(bx1 - bx0, 2), "h": round(by1 - by0, 2), "x": bx0, "y": by0,
                 "dark": path_d(md, bx0, by0), "blue": path_d(mb, bx0, by0)}
json.dump(out, open("brand/paths.json", "w"))
for k, v in out.items(): print(k, v["w"], v["h"], v["x"], v["y"], len(v["dark"]), len(v["blue"]))
