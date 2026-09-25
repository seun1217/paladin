#!/usr/bin/env python3
"""렌더된 PNG의 알파 경계 상자를 측정해 캔버스 안에 여백(margin)을 두고 중앙 정렬하는 변환을 fit.json에 기록한다.
2단계 파이프라인: build -> render -> fit -> build(fit 적용) -> render"""
import glob
import json
import os
import sys

from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
margin = float(sys.argv[1]) if len(sys.argv) > 1 else 14.0
src = sys.argv[2] if len(sys.argv) > 2 else "measure"
pad = int(sys.argv[3]) if len(sys.argv) > 3 else 120   # measure 캔버스 확장 여백
W = 360
fits = {}
for fp in sorted(glob.glob(os.path.join(root, src, "*.png"))):
    name = os.path.basename(fp)[:-4]
    im = Image.open(fp).convert("RGBA")
    bbox = im.split()[-1].getbbox()
    if not bbox:
        continue
    x0, y0, x1, y1 = [v - pad for v in bbox]   # 원래 360 캔버스 좌표계로 환산
    w, h = x1 - x0, y1 - y0
    avail = W - 2 * margin
    s = min(1.0, avail / w, avail / h)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # 중앙 정렬: 새 중심 = (180,180)
    tx, ty = W / 2 - s * cx, W / 2 - s * cy
    fits[name] = {"scale": round(s, 4), "tx": round(tx, 2), "ty": round(ty, 2), "bbox": [x0, y0, x1, y1]}
    print(f"{name:14s} bbox={bbox} -> scale {s:.3f} translate ({tx:.1f},{ty:.1f})")
with open(os.path.join(root, "src", "fit.json"), "w") as fh:
    json.dump(fits, fh, indent=1, ensure_ascii=False)
print("wrote src/fit.json")
