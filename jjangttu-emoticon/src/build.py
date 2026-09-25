#!/usr/bin/env python3
"""
짱뚜 (JJANGTTU) 카카오 이모티콘 생성기.

캐릭터를 파라메트릭 SVG로 정의하고, 10종 이모티콘 SVG를 svg/ 폴더에 출력한다.
PNG 렌더링은 render.mjs (Playwright + Chromium)가 담당한다.

카카오 이모티콘 스튜디오 멈춰있는 이모티콘 규격: 360 x 360 px, PNG, 투명 배경, 150KB 이하.
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field

W = H = 360

# ---------------------------------------------------------------- 팔레트
OUT = "#3B2A1E"       # 외곽선 (다크 초콜릿 브라운)
BODY = "#BCA271"      # 몸통 (갯벌 황토 탄)
BODY_SH = "#9C8353"   # 몸통 그림자
BELLY = "#F3E6C4"     # 배 (크림)
FIN = "#A78A56"       # 등지느러미 / 꼬리
FIN_RAY = "#6E5735"   # 지느러미 살
SPOT = "#79DBF8"      # 하늘색 반점 (짱뚱어 시그니처)
SPOT_HI = "#FFFFFF"
CHEEK = "#F6A0A8"
MOUTH = "#4A1C1C"
THROAT = "#7A2E2E"
TONGUE = "#F27B90"
MUD = "#7C5B40"
MUD_HI = "#A5836A"
WHITE = "#FFFFFF"
PUPIL = "#2A1B12"
HEART = "#FF5C7A"
TEAR = "#79C9F5"
SWEAT = "#8AD4F7"
ZZ = "#7C86D6"
SPARK = "#FFD84D"

SW = 7  # 기본 외곽선 두께

FONT = "Jua"


# ---------------------------------------------------------------- 유틸
def pol(cx: float, cy: float, r: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def f(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def circle(cx, cy, r, fill, stroke=None, sw=SW, extra="") -> str:
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    return f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="{fill}"{s} {extra}/>'


def ellipse(cx, cy, rx, ry, fill, stroke=None, sw=SW, extra="") -> str:
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    return (f'<ellipse cx="{f(cx)}" cy="{f(cy)}" rx="{f(rx)}" ry="{f(ry)}" '
            f'fill="{fill}"{s} {extra}/>')


def path(d, fill="none", stroke=None, sw=SW, extra="") -> str:
    s = f' stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"' if stroke else ""
    return f'<path d="{d}" fill="{fill}"{s} {extra}/>'


def group(inner: str, transform: str = "", extra: str = "") -> str:
    t = f' transform="{transform}"' if transform else ""
    return f"<g{t} {extra}>{inner}</g>"


def text(s: str, x: float, y: float, size: float = 58, fill: str = OUT,
         rotate: float = 0, anchor: str = "middle", stroke_w: float = 12,
         outer: bool = True, font: str = FONT, weight: str = "normal") -> str:
    """스티커 스타일 텍스트: 바깥 어두운 외곽선 + 흰 테두리 + 컬러 본문."""
    common = (f'x="{f(x)}" y="{f(y)}" font-family="{font}" font-size="{f(size)}" '
              f'font-weight="{weight}" text-anchor="{anchor}" '
              f'stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"')
    layers = []
    if outer:
        layers.append(f'<text {common} fill="{OUT}" stroke="{OUT}" stroke-width="{f(stroke_w + 7)}">{s}</text>')
    layers.append(f'<text {common} fill="{fill}" stroke="{WHITE}" stroke-width="{f(stroke_w)}">{s}</text>')
    inner = "".join(layers)
    if rotate:
        return group(inner, f"rotate({f(rotate)} {f(x)} {f(y)})")
    return inner


# ---------------------------------------------------------------- 캐릭터 부위
BODY_PATH = ("M 180 118 C 242 118 276 166 275 224 C 274 270 246 300 180 300 "
             "C 114 300 86 270 85 224 C 84 166 118 118 180 118 Z")

# 얼굴 안쪽(눈 사이~볼)을 피해 배치한 반점. (x, y, r)
BODY_SPOTS = [
    (118, 150, 6), (104, 178, 5), (133, 132, 4.5), (96, 210, 4.5),
    (242, 150, 6), (256, 178, 5), (227, 132, 4.5), (264, 210, 4.5),
    (110, 240, 4), (250, 240, 4), (180, 112, 0),  # 마지막은 자리표시(그리지 않음)
    (150, 152, 3.5), (210, 152, 3.5),
]


def spot(cx, cy, r) -> str:
    if r <= 0:
        return ""
    return (circle(cx, cy, r, SPOT) +
            circle(cx - r * 0.32, cy - r * 0.32, r * 0.36, SPOT_HI))


def dorsal_fin(mode: str = "normal") -> str:
    """등지느러미 (몸 뒤에 그림). 정면 뷰에서 머리 뒤로 돛처럼 솟아오른다."""
    if mode == "raised":
        cx, cy, R, a0, a1 = 184, 165, 118, 208, 332
    elif mode == "droop":
        cx, cy, R, a0, a1 = 184, 178, 70, 212, 328
    else:
        cx, cy, R, a0, a1 = 184, 170, 92, 204, 336
    n = 5
    angs = [a0 + (a1 - a0) * i / (n - 1) for i in range(n)]
    tips = [pol(cx, cy, R, a) for a in angs]
    d = f"M {f(cx)} {f(cy + 40)} L {f(tips[0][0])} {f(tips[0][1])}"
    for i in range(n - 1):
        mid = (angs[i] + angs[i + 1]) / 2
        qx, qy = pol(cx, cy, R * 0.80, mid)
        d += f" Q {f(qx)} {f(qy)} {f(tips[i + 1][0])} {f(tips[i + 1][1])}"
    d += " Z"
    out = path(d, FIN, OUT)
    # 지느러미 살
    for a in angs[1:-1] if mode != "droop" else angs[1:-1]:
        tx, ty = pol(cx, cy, R - 12, a)
        bx, by = pol(cx, cy, R * 0.35, a)
        out += path(f"M {f(bx)} {f(by)} L {f(tx)} {f(ty)}", "none", FIN_RAY, 3.5, 'opacity="0.55"')
    # 지느러미 반점
    for i, a in enumerate(angs):
        for rr in (0.62, 0.86) if i in (1, 2, 3) else (0.62,):
            sx, sy = pol(cx, cy, R * rr, a + (5 if rr > 0.7 else -6))
            out += spot(sx, sy, 4.2 if rr > 0.7 else 3.6)
    return out


def tail(mode: str = "normal") -> str:
    """꼬리 (몸 뒤에 그림). 오른쪽 아래에서 나와 위로 살짝 들린다."""
    if mode == "curl":
        # 점프 시 꼬리를 아래로 말아 찬다
        tr = "translate(0 0)"
        d = ("M 236 262 C 262 250 292 262 306 292 C 316 314 300 334 280 336 "
             "C 300 344 322 336 328 318 C 338 290 320 250 288 236 C 270 228 250 236 236 244 Z")
    else:
        tr = ""
        d = ("M 232 246 C 264 236 296 240 314 214 C 322 200 344 196 352 210 "
             "C 360 224 352 244 348 252 C 354 264 350 286 336 290 C 322 294 312 276 310 262 "
             "C 294 274 262 288 232 284 Z")
    out = path(d, FIN, OUT)
    # 꼬리지느러미 살
    if mode == "curl":
        rays = ["M 300 300 L 322 322", "M 306 292 L 330 306", "M 298 308 L 312 330"]
        sp = [(318, 308, 4), (306, 320, 3.5), (296, 276, 3.5)]
    else:
        rays = ["M 318 232 L 344 214", "M 320 246 L 346 252", "M 318 258 L 338 282"]
        sp = [(336, 226, 4), (334, 262, 3.5), (298, 250, 3.5), (268, 254, 3)]
    for r in rays:
        out += path(r, "none", FIN_RAY, 3.5, 'opacity="0.55"')
    for s in sp:
        out += spot(*s)
    return out


def body(shade: bool = True) -> str:
    out = path(BODY_PATH, BODY, OUT)
    # 배
    out += f'<clipPath id="bodyclip"><path d="{BODY_PATH}"/></clipPath>'
    out += group(
        ellipse(180, 262, 66, 44, BELLY) +
        (path("M 275 224 C 274 270 246 300 180 300 C 150 300 128 294 112 282 "
              "C 150 302 236 302 262 250 C 270 236 272 226 275 224 Z", BODY_SH, None,
              extra='opacity="0.55"') if shade else ""),
        extra='clip-path="url(#bodyclip)"')
    for s in BODY_SPOTS:
        out += spot(*s)
    return out


def cheeks(op: float = 0.8) -> str:
    return (ellipse(120, 182, 17, 11, CHEEK, extra=f'opacity="{op}"') +
            ellipse(240, 182, 17, 11, CHEEK, extra=f'opacity="{op}"'))


# 눈: 머리 위로 툭 튀어나온 두 개의 구슬 (짱뚱어 시그니처)
EYE_L = (147, 122)
EYE_R = (213, 122)
EYE_R_ = 36


def eye_dome(cx, cy, fill=WHITE, r=EYE_R_) -> str:
    return circle(cx, cy, r, fill, OUT)


def pupil(cx, cy, dx=3, dy=7, r=17, hi=True) -> str:
    out = circle(cx + dx, cy + dy, r, PUPIL)
    if hi:
        out += circle(cx + dx - 6, cy + dy - 7, 6, WHITE)
        out += circle(cx + dx + 5, cy + dy + 5, 3, WHITE)
    return out


def eyes(mode: str = "normal") -> str:
    (lx, ly), (rx, ry) = EYE_L, EYE_R
    o = ""
    if mode == "normal":
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        o += pupil(lx, ly, 4, 7) + pupil(rx, ry, -4, 7)
    elif mode == "happy":       # ^ ^  (감은 눈, 위로 볼록)
        o += eye_dome(lx, ly, BODY) + eye_dome(rx, ry, BODY)
        for cx, cy in (EYE_L, EYE_R):
            o += path(f"M {cx-19} {cy+8} Q {cx} {cy-16} {cx+19} {cy+8}", "none", OUT, 6.5)
    elif mode == "sleep":       # ︶ ︶ (감은 눈, 아래로 볼록)
        o += eye_dome(lx, ly, BODY) + eye_dome(rx, ry, BODY)
        for cx, cy in (EYE_L, EYE_R):
            o += path(f"M {cx-18} {cy-2} Q {cx} {cy+18} {cx+18} {cy-2}", "none", OUT, 6.5)
    elif mode == "cry":         # 꾹 감은 눈 + 눈물 줄기는 별도 prop
        o += eye_dome(lx, ly, BODY) + eye_dome(rx, ry, BODY)
        for cx, cy in (EYE_L, EYE_R):
            o += path(f"M {cx-18} {cy-4} Q {cx} {cy+14} {cx+18} {cy-4}", "none", OUT, 6.5)
    elif mode == "shock":       # 동공 지진
        o += eye_dome(lx, ly, WHITE, 38) + eye_dome(rx, ry, WHITE, 38)
        o += pupil(lx, ly, 0, 4, 9, hi=False) + pupil(rx, ry, 0, 4, 9, hi=False)
        o += circle(lx - 3, ly + 1, 2.5, WHITE) + circle(rx - 3, ry + 1, 2.5, WHITE)
    elif mode == "heart":
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        for cx, cy in (EYE_L, EYE_R):
            o += heart(cx, cy + 8, 21, HEART, outline=False)
            o += circle(cx - 7, cy - 1, 4.5, WHITE)
    elif mode == "side":        # 눈동자를 옆으로 (뻘쭘)
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        o += pupil(lx, ly, 15, 6, 14) + pupil(rx, ry, 15, 6, 14)
    elif mode == "wink":        # 왼쪽 뜸, 오른쪽 감음
        o += eye_dome(lx, ly) + eye_dome(rx, ry, BODY)
        o += pupil(lx, ly, 4, 7)
        o += path(f"M {rx-19} {ry+8} Q {rx} {ry-16} {rx+19} {ry+8}", "none", OUT, 6.5)
    elif mode == "fire":        # 의지 불타는 눈 + 눈썹
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        o += pupil(lx, ly, 3, 6, 16) + pupil(rx, ry, -3, 6, 16)
        o += circle(lx + 3 - 3, ly + 6 - 3, 4, SPARK) + circle(rx - 3 - 3, ry + 6 - 3, 4, SPARK)
        o += path(f"M {lx-24} {ly-30} L {lx+10} {ly-16}", "none", OUT, 8)
        o += path(f"M {rx+24} {ry-30} L {rx-10} {ry-16}", "none", OUT, 8)
    elif mode == "sparkle":     # 반짝반짝 (고마워)
        o += eye_dome(lx, ly, BODY) + eye_dome(rx, ry, BODY)
        for cx, cy in (EYE_L, EYE_R):
            o += path(f"M {cx-19} {cy+8} Q {cx} {cy-16} {cx+19} {cy+8}", "none", OUT, 6.5)
    return o


def mouth(mode: str = "smile", cx: float = 180, cy: float = 192) -> str:
    if mode == "smile":
        return path(f"M {cx-28} {cy-4} Q {cx} {cy+20} {cx+28} {cy-4}", "none", OUT, 6.5)
    if mode == "grin":          # 살짝 벌린 미소
        d = f"M {cx-30} {cy-6} Q {cx} {cy+38} {cx+30} {cy-6} Q {cx} {cy+4} {cx-30} {cy-6} Z"
        o = path(d, MOUTH, OUT, 6)
        o += f'<clipPath id="m_grin"><path d="{d}"/></clipPath>'
        o += group(ellipse(cx, cy + 32, 20, 14, TONGUE), extra='clip-path="url(#m_grin)"')
        return o
    if mode == "laugh":         # 크게 웃는 입
        d = f"M {cx-40} {cy-8} Q {cx} {cy+62} {cx+40} {cy-8} Q {cx} {cy+6} {cx-40} {cy-8} Z"
        o = path(d, MOUTH, OUT, 6)
        o += f'<clipPath id="m_laugh"><path d="{d}"/></clipPath>'
        o += group(ellipse(cx, cy + 48, 26, 18, TONGUE), extra='clip-path="url(#m_laugh)"')
        return o
    if mode == "gape":          # 짱뚱어 시그니처: 얼굴만 한 입
        d = (f"M {cx-52} {cy-24} C {cx-52} {cy-40} {cx+52} {cy-40} {cx+52} {cy-24} "
             f"C {cx+58} {cy+20} {cx+34} {cy+58} {cx} {cy+58} "
             f"C {cx-34} {cy+58} {cx-58} {cy+20} {cx-52} {cy-24} Z")
        o = path(d, MOUTH, OUT, 6.5)
        o += f'<clipPath id="m_gape"><path d="{d}"/></clipPath>'
        o += group(ellipse(cx, cy + 22, 30, 24, THROAT) +
                   ellipse(cx, cy + 54, 30, 20, TONGUE) +
                   ellipse(cx - 6, cy + 46, 6, 4, "#FFB3C0", extra='opacity="0.8"'),
                   extra='clip-path="url(#m_gape)"')
        return o
    if mode == "shout":         # 화이팅!
        d = (f"M {cx-30} {cy-6} C {cx-34} {cy+40} {cx+34} {cy+40} {cx+30} {cy-6} "
             f"Q {cx} {cy+2} {cx-30} {cy-6} Z")
        o = path(d, MOUTH, OUT, 6)
        o += f'<clipPath id="m_shout"><path d="{d}"/></clipPath>'
        o += group(ellipse(cx, cy + 36, 20, 14, TONGUE), extra='clip-path="url(#m_shout)"')
        return o
    if mode == "wavy":          # 우는/뻘쭘한 입
        return path(f"M {cx-26} {cy+2} Q {cx-13} {cy-10} {cx} {cy+2} T {cx+26} {cy+2}",
                    "none", OUT, 6.5)
    if mode == "sad":
        return path(f"M {cx-24} {cy+10} Q {cx} {cy-10} {cx+24} {cy+10}", "none", OUT, 6.5)
    if mode == "flat":
        return path(f"M {cx-18} {cy+2} L {cx+18} {cy+2}", "none", OUT, 6.5)
    if mode == "o":
        return ellipse(cx, cy + 4, 9, 11, MOUTH, OUT, 5.5)
    if mode == "sleep":
        return ellipse(cx + 12, cy + 6, 7, 8, MOUTH, OUT, 5)
    return ""


FIN_D = "M 0 -13 C 16 -22 44 -20 54 -6 C 60 2 52 16 30 16 C 14 16 2 12 0 0 Z"


def pec_fin(side: str, angle: float, sx: float | None = None, sy: float | None = None,
            scale: float = 1.0) -> str:
    """가슴지느러미(팔). side='R'은 오른쪽 어깨에서 +x 바깥 방향이 angle=0.
    angle>0 시계방향(아래로), angle<0 위로. 왼쪽은 좌우 반전."""
    if side == "R":
        sx = 252 if sx is None else sx
        sy = 236 if sy is None else sy
        tr = f"translate({f(sx)} {f(sy)}) rotate({f(angle)}) scale({f(scale)})"
    else:
        sx = 108 if sx is None else sx
        sy = 236 if sy is None else sy
        tr = f"translate({f(sx)} {f(sy)}) scale(-1 1) rotate({f(angle)}) scale({f(scale)})"
    inner = path(FIN_D, BODY, OUT)
    inner += path("M 14 -8 L 44 -9", "none", FIN_RAY, 3, 'opacity="0.45"')
    inner += path("M 14 4 L 42 6", "none", FIN_RAY, 3, 'opacity="0.45"')
    inner += spot(30, -4, 3.2)
    return group(inner, tr)


def mud(kind: str = "base") -> str:
    if kind == "none":
        return ""
    d = ("M 46 302 C 66 272 122 284 180 282 C 240 280 292 270 314 302 "
         "C 324 318 292 326 180 328 C 70 326 36 318 46 302 Z")
    o = path(d, MUD, OUT)
    o += ellipse(96, 306, 16, 5, MUD_HI, extra='opacity="0.8"')
    o += ellipse(270, 304, 14, 4.5, MUD_HI, extra='opacity="0.8"')
    o += ellipse(150, 316, 10, 3.5, MUD_HI, extra='opacity="0.6"')
    return o


# ---------------------------------------------------------------- 소품
def heart(cx, cy, s, fill=HEART, outline=True, rot=0) -> str:
    d = (f"M 0 {f(s*0.95)} C {f(-s*1.1)} {f(s*0.2)} {f(-s*1.05)} {f(-s*0.75)} {f(-s*0.5)} {f(-s*0.75)} "
         f"C {f(-s*0.2)} {f(-s*0.75)} 0 {f(-s*0.45)} 0 {f(-s*0.3)} "
         f"C 0 {f(-s*0.45)} {f(s*0.2)} {f(-s*0.75)} {f(s*0.5)} {f(-s*0.75)} "
         f"C {f(s*1.05)} {f(-s*0.75)} {f(s*1.1)} {f(s*0.2)} 0 {f(s*0.95)} Z")
    p = path(d, fill, OUT if outline else None, SW if outline else 0)
    if outline:
        p += ellipse(-s * 0.42, -s * 0.38, s * 0.18, s * 0.12, WHITE, extra='opacity="0.85" transform="rotate(-30)"')
    return group(p, f"translate({f(cx)} {f(cy)}) rotate({f(rot)})")


def sparkle(cx, cy, s, fill=SPARK, rot=0) -> str:
    d = (f"M 0 {f(-s)} Q {f(s*0.12)} {f(-s*0.12)} {f(s)} 0 Q {f(s*0.12)} {f(s*0.12)} 0 {f(s)} "
         f"Q {f(-s*0.12)} {f(s*0.12)} {f(-s)} 0 Q {f(-s*0.12)} {f(-s*0.12)} 0 {f(-s)} Z")
    return group(path(d, fill, OUT, 4.5), f"translate({f(cx)} {f(cy)}) rotate({f(rot)})")


def sweat(cx, cy, s=1.0, fill=SWEAT) -> str:
    d = "M 0 -22 C 8 -8 16 0 16 8 C 16 18 9 24 0 24 C -9 24 -16 18 -16 8 C -16 0 -8 -8 0 -22 Z"
    return group(path(d, fill, OUT, 5) + ellipse(-5, 6, 3, 5, WHITE, extra='opacity="0.9"'),
                 f"translate({f(cx)} {f(cy)}) scale({f(s)})")


def tear_stream(cx, cy, length=95, width=16) -> str:
    """ㅠㅠ 스타일 눈물 폭포."""
    d = (f"M {f(cx-width/2)} {f(cy)} C {f(cx-width/2-4)} {f(cy+length*0.5)} {f(cx-width*0.9)} {f(cy+length*0.8)} "
         f"{f(cx-width*0.5)} {f(cy+length)} Q {f(cx)} {f(cy+length+14)} {f(cx+width*0.5)} {f(cy+length)} "
         f"C {f(cx+width*0.9)} {f(cy+length*0.8)} {f(cx+width/2+4)} {f(cy+length*0.5)} {f(cx+width/2)} {f(cy)} Z")
    o = path(d, TEAR, OUT, 5)
    o += path(f"M {f(cx-3)} {f(cy+14)} L {f(cx-4)} {f(cy+length*0.7)}", "none", WHITE, 4, 'opacity="0.8"')
    return o


def motion_arcs(cx, cy, r0=26, n=3, rot=0, span=60) -> str:
    o = ""
    for i in range(n):
        r = r0 + i * 11
        a0, a1 = -span / 2, span / 2
        x0, y0 = pol(0, 0, r, a0)
        x1, y1 = pol(0, 0, r, a1)
        o += path(f"M {f(x0)} {f(y0)} A {f(r)} {f(r)} 0 0 1 {f(x1)} {f(y1)}", "none", OUT, 5)
    return group(o, f"translate({f(cx)} {f(cy)}) rotate({f(rot)})")


def splash(cx, cy, s=1.0) -> str:
    """진흙 튀는 방울들."""
    drops = [(-58, -18, 9), (-40, -40, 6), (52, -22, 8), (36, -46, 5.5), (-8, -52, 6), (70, -2, 5)]
    o = ""
    for dx, dy, r in drops:
        o += ellipse(dx, dy, r, r * 1.25, MUD, OUT, 4.5)
    return group(o, f"translate({f(cx)} {f(cy)}) scale({f(s)})")


def zzz(x, y) -> str:
    o = text("Z", x, y, 46, ZZ, rotate=-12, stroke_w=8, outer=True)
    o += text("Z", x + 30, y - 36, 34, ZZ, rotate=-8, stroke_w=7, outer=True)
    o += text("z", x + 54, y - 62, 26, ZZ, rotate=0, stroke_w=6, outer=True)
    return o


def moon(cx, cy, r) -> str:
    # 바깥 호(반지름 r, 왼쪽으로 볼록) + 안쪽 호(반지름 1.35r, 덜 볼록) = 오른쪽이 파인 초승달
    d = (f"M {f(cx)} {f(cy-r)} A {f(r)} {f(r)} 0 1 0 {f(cx)} {f(cy+r)} "
         f"A {f(r*1.35)} {f(r*1.35)} 0 0 1 {f(cx)} {f(cy-r)} Z")
    return path(d, SPARK, OUT, 5)


def star(cx, cy, r, fill=SPARK) -> str:
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.45
        pts.append(pol(cx, cy, rr, -90 + i * 36))
    d = "M " + " L ".join(f"{f(x)} {f(y)}" for x, y in pts) + " Z"
    return path(d, fill, OUT, 4)


def sign_board(cx, cy, w, h, label, size=40, fill="#FFF6D6", color=OUT) -> str:
    o = f'<rect x="{f(cx-w/2)}" y="{f(cy-h/2)}" width="{f(w)}" height="{f(h)}" rx="14" fill="{fill}" stroke="{OUT}" stroke-width="{SW}"/>'
    o += (f'<text x="{f(cx)}" y="{f(cy + size*0.36)}" font-family="{FONT}" font-size="{f(size)}" '
          f'text-anchor="middle" fill="{color}">{label}</text>')
    return o


# ---------------------------------------------------------------- 캐릭터 조립
@dataclass
class Pose:
    eyes: str = "normal"
    mouth: str = "smile"
    mouth_pos: tuple[float, float] = (180, 192)
    fin_l: float | None = 38     # None이면 그리지 않음
    fin_r: float | None = 38
    fin_l_at: tuple | None = None
    fin_r_at: tuple | None = None
    dorsal: str = "normal"
    tail: str = "normal"
    cheeks: float = 0.8
    shade: bool = True
    transform: str = ""          # 캐릭터 전체 변환
    behind: str = ""             # 몸 뒤 소품 (캐릭터 변환 포함)
    front: str = ""              # 몸 앞 소품 (캐릭터 변환 포함)
    fins_front: bool = True      # 지느러미를 몸 앞에 그릴지


def character(p: Pose) -> str:
    parts = [p.behind, dorsal_fin(p.dorsal), tail(p.tail)]
    fins = ""
    if p.fin_l is not None:
        fins += pec_fin("L", p.fin_l, *(p.fin_l_at or (None, None)))
    if p.fin_r is not None:
        fins += pec_fin("R", p.fin_r, *(p.fin_r_at or (None, None)))
    if not p.fins_front:
        parts.append(fins)
    parts.append(body(p.shade))
    parts.append(cheeks(p.cheeks))
    parts.append(mouth(p.mouth, *p.mouth_pos))
    parts.append(eyes(p.eyes))
    if p.fins_front:
        parts.append(fins)
    parts.append(p.front)
    return group("".join(parts), p.transform)


FIT: dict = {}          # fit.py가 만든 파일별 여백 보정 변환 (name -> scale/tx/ty)
_CURRENT = ""           # 현재 생성 중인 이모티콘 이름


MEASURE_PAD = 120       # --measure 모드: 캔버스 밖으로 넘친 부분까지 측정하기 위한 확장 여백


def svg_doc(inner: str) -> str:
    fit = FIT.get(_CURRENT)
    if fit:
        inner = group(inner, f"translate({fit['tx']:.2f} {fit['ty']:.2f}) scale({fit['scale']:.4f})")
    if "--measure" in sys.argv:
        size = W + 2 * MEASURE_PAD
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
                f'viewBox="{-MEASURE_PAD} {-MEASURE_PAD} {size} {size}">{inner}</svg>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            f'viewBox="0 0 {W} {H}">{inner}</svg>')


# ---------------------------------------------------------------- 이모티콘 10종
def e01_hello() -> str:
    """안녕! : 오른쪽 지느러미 흔들며 인사."""
    p = Pose(eyes="normal", mouth="grin", fin_l=42, fin_r=-72,
             front=motion_arcs(300, 168, 22, 3, rot=-30, span=70))
    return svg_doc(mud() + character(p) + text("안녕!", 92, 82, 62, "#FF8A3D", rotate=-8))


def e02_lol() -> str:
    """ㅋㅋㅋㅋ : 뒤로 넘어가며 폭소, 지느러미로 뻘 두드림."""
    p = Pose(eyes="happy", mouth="laugh", fin_l=-26, fin_r=-26, cheeks=0.9,
             fin_l_at=(110, 244), fin_r_at=(250, 244),
             transform="rotate(-12 180 290) translate(6 8)",
             front=(ellipse(112, 130, 6, 9, TEAR, OUT, 4, 'transform="rotate(20 112 130)"') +
                    ellipse(248, 130, 6, 9, TEAR, OUT, 4, 'transform="rotate(-20 248 130)"')))
    extra = motion_arcs(72, 292, 16, 2, rot=120, span=70) + motion_arcs(302, 270, 16, 2, rot=-50, span=70)
    txt = (text("ㅋ", 176, 74, 60, "#3AA3F0", rotate=-24) + text("ㅋ", 226, 62, 70, "#3AA3F0", rotate=-8) +
           text("ㅋ", 282, 66, 74, "#3AA3F0", rotate=10) + text("ㅋ", 330, 92, 58, "#3AA3F0", rotate=24))
    return svg_doc(mud() + character(p) + extra + txt)


def e03_love() -> str:
    """사랑해 : 큰 하트를 두 지느러미로 안고, 눈은 하트."""
    p = Pose(eyes="heart", mouth="grin", fin_l=-128, fin_r=-128,
             fin_l_at=(118, 244), fin_r_at=(242, 244), cheeks=0.95,
             front=heart(180, 252, 44, rot=-6))
    deco = (heart(56, 120, 14, rot=-20) + heart(312, 106, 11, rot=22) + heart(320, 176, 8, rot=10) +
            heart(40, 190, 8, rot=-10))
    return svg_doc(mud() + character(p) + deco + text("사랑해", 180, 340, 60, HEART))


def e04_thanks() -> str:
    """고마워 : 앞으로 꾸벅, 지느러미를 앞으로 모으고 반짝반짝."""
    p = Pose(eyes="sparkle", mouth="smile", mouth_pos=(180, 196), fin_l=-62, fin_r=-62,
             fin_l_at=(128, 250), fin_r_at=(232, 250), dorsal="normal",
             transform="rotate(22 180 300) translate(-6 12)")
    deco = (sparkle(300, 128, 15, rot=20) + sparkle(322, 210, 10) +
            sparkle(52, 150, 12, rot=15) + sparkle(74, 232, 8) +
            motion_arcs(84, 104, 22, 3, rot=150, span=70))
    return svg_doc(mud() + character(p) + deco + text("고마워!", 180, 74, 62, "#F5A623"))


def e05_gasp() -> str:
    """헐 : 짱뚱어 시그니처, 얼굴만 한 입."""
    p = Pose(eyes="shock", mouth="gape", mouth_pos=(180, 210), fin_l=-40, fin_r=-40,
             fin_l_at=(100, 238), fin_r_at=(260, 238), cheeks=0.0, dorsal="raised",
             front=sweat(268, 96, 0.95))
    lines = "".join(path(d, "none", OUT, 6) for d in
                    ["M 62 96 L 82 120", "M 44 150 L 72 158", "M 298 88 L 284 112"])
    return svg_doc(mud() + character(p) + lines + text("헐", 62, 112, 88, "#7B5CF0", rotate=-10))


def e06_fighting() -> str:
    """화이팅! : 꼬리를 차며 점프, 등지느러미를 깃발처럼 세움."""
    p = Pose(eyes="fire", mouth="shout", fin_l=-158, fin_r=36, fin_l_at=(118, 220),
             dorsal="raised", tail="curl", shade=True,
             transform="translate(8 -52) rotate(-14 180 220)")
    deco = (splash(176, 318, 1.15) +
            "".join(path(d, "none", OUT, 6) for d in
                    ["M 22 292 L 62 292", "M 34 268 L 64 268", "M 296 286 L 338 286", "M 306 262 L 334 262"]))
    return svg_doc(mud() + character(p) + deco + text("화이팅!", 180, 340, 62, "#FF6A2B"))


def e07_cry() -> str:
    """ㅠㅠ : 눈물 폭포, 등지느러미는 축 처짐."""
    p = Pose(eyes="cry", mouth="wavy", mouth_pos=(180, 198), fin_l=48, fin_r=48, dorsal="droop",
             cheeks=0.6, front=tear_stream(147, 150, 96) + tear_stream(213, 150, 96))
    return svg_doc(mud() + character(p) + text("ㅠㅠ", 180, 84, 78, "#3AA3F0"))


def e08_goodnight() -> str:
    """굿밤 : 뻘 속에서 새근새근, ZZZ."""
    p = Pose(eyes="sleep", mouth="sleep", fin_l=50, fin_r=50, dorsal="droop", cheeks=0.7,
             transform="translate(0 16)")
    bubble = (circle(214, 190, 16, "#BFEAF9", OUT, 5) + circle(208, 185, 4, WHITE))
    deco = zzz(250, 110) + moon(60, 78, 26) + star(112, 62, 9) + star(300, 40, 7)
    return svg_doc(mud() + character(p) + bubble + deco + text("굿밤", 72, 320, 56, "#5E68C7", rotate=-6))


def e09_awkward() -> str:
    """뻘쭘... : 뻘에서 뻘쭘. 눈은 옆으로, 지느러미 콕콕."""
    p = Pose(eyes="side", mouth="wavy", mouth_pos=(178, 196), fin_l=-100, fin_r=-100,
             fin_l_at=(130, 252), fin_r_at=(230, 252), cheeks=0.9,
             front=sweat(262, 92, 0.8))
    return svg_doc(mud() + character(p) + text("뻘쭘...", 180, 78, 62, "#7A8C99"))


def e10_ok() -> str:
    """오케이! : 두 지느러미로 머리 위에 동그라미, 윙크."""
    # 팔: 어깨에서 눈 바깥으로 크게 돌아 머리 위에서 만나는 동그라미
    arm_l = "M 104 226 C 60 200 56 120 94 76 C 112 56 140 42 168 44"
    arm_r = "M 256 226 C 300 200 304 120 266 76 C 248 56 220 42 192 44"
    arms = (path(arm_l, "none", OUT, 36) + path(arm_r, "none", OUT, 36) +
            path(arm_l, "none", BODY, 23) + path(arm_r, "none", BODY, 23))
    tips = pec_fin("L", 150, 152, 46, 0.8) + pec_fin("R", 150, 208, 46, 0.8)
    p = Pose(eyes="wink", mouth="grin", fin_l=None, fin_r=None, cheeks=0.85,
             behind=arms, front=tips)
    return svg_doc(mud() + character(p) + text("오케이!", 180, 340, 60, "#2FB36B"))


EMOTICONS = [
    ("01_hello", e01_hello, "안녕!"),
    ("02_lol", e02_lol, "ㅋㅋㅋㅋ"),
    ("03_love", e03_love, "사랑해"),
    ("04_thanks", e04_thanks, "고마워!"),
    ("05_gasp", e05_gasp, "헐"),
    ("06_fighting", e06_fighting, "화이팅!"),
    ("07_cry", e07_cry, "ㅠㅠ"),
    ("08_goodnight", e08_goodnight, "굿밤"),
    ("09_awkward", e09_awkward, "뻘쭘..."),
    ("10_ok", e10_ok, "오케이!"),
]


def main() -> None:
    global _CURRENT
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "measure" if "--measure" in sys.argv else "svg")
    os.makedirs(out, exist_ok=True)
    fit_path = os.path.join(root, "src", "fit.json")
    if "--fit" in sys.argv and os.path.exists(fit_path):
        import json
        with open(fit_path, encoding="utf-8") as fh:
            FIT.update(json.load(fh))
        print(f"applying margin fit for {len(FIT)} files")
    for name, fn, _ in EMOTICONS:
        _CURRENT = name
        with open(os.path.join(out, f"{name}.svg"), "w", encoding="utf-8") as fh:
            fh.write(fn())
    print(f"wrote {len(EMOTICONS)} svg files to {out}")



# ================================================================ 추가 표정 (정면)
def eyes_extra(mode: str) -> str:
    """정면 리그용 추가 눈 표정."""
    (lx, ly), (rx, ry) = EYE_L, EYE_R
    o = ""
    if mode == "sorry":         # 미안: 눈동자 아래, 걱정 눈썹
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        o += pupil(lx, ly, 2, 12, 15) + pupil(rx, ry, -2, 12, 15)
        o += path(f"M {lx-22} {ly-24} L {lx+6} {ly-34}", "none", OUT, 7)
        o += path(f"M {rx+22} {ry-24} L {rx-6} {ry-34}", "none", OUT, 7)
    elif mode == "dead":        # 월요일: 반쯤 감긴 눈, 작은 동공
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        o += pupil(lx, ly, 0, 10, 9, hi=False) + pupil(rx, ry, 0, 10, 9, hi=False)
        for cx, cy in (EYE_L, EYE_R):
            o += path(f"M {cx-36} {cy} A 36 36 0 0 1 {cx+36} {cy} Z", BODY, OUT, 6)
    elif mode == "smirk":       # 씨익: 반쯤 감긴 눈 + 또렷한 동공
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        o += pupil(lx, ly, 6, 10, 15) + pupil(rx, ry, 0, 10, 15)
        for cx, cy in (EYE_L, EYE_R):
            o += path(f"M {cx-36} {cy-4} A 36 36 0 0 1 {cx+36} {cy-4} L {cx+36} {cy-8} A 36 36 0 0 0 {cx-36} {cy-8} Z",
                      BODY, None)
            o += path(f"M {cx-33} {cy-8} Q {cx} {cy-2} {cx+33} {cy-8}", "none", OUT, 6)
    elif mode == "dot":         # 멍: 점 눈
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        o += circle(lx + 2, ly + 8, 6, PUPIL) + circle(rx - 2, ry + 8, 6, PUPIL)
    elif mode == "angry":       # 화남: 눈썹 + 작은 동공
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        o += pupil(lx, ly, 4, 8, 13) + pupil(rx, ry, -4, 8, 13)
        o += path(f"M {lx-26} {ly-30} L {lx+14} {ly-10}", "none", OUT, 9)
        o += path(f"M {rx+26} {ry-30} L {rx-14} {ry-10}", "none", OUT, 9)
    elif mode == "glitter":     # 두근두근: 반짝이 동공
        o += eye_dome(lx, ly) + eye_dome(rx, ry)
        for cx, cy, dx in ((lx, ly, 3), (rx, ry, -3)):
            o += circle(cx + dx, cy + 7, 18, PUPIL)
            o += circle(cx + dx - 6, cy, 7, WHITE) + circle(cx + dx + 6, cy + 12, 4, WHITE)
            o += sparkle(cx + dx + 4, cy + 2, 6, WHITE)
    elif mode == "salute":      # 넵: 또렷 + 한쪽 눈썹 살짝
        o += eyes("normal")
        o += path(f"M {lx-20} {ly-32} L {lx+12} {ly-40}", "none", OUT, 6.5)
        o += path(f"M {rx+20} {ry-32} L {rx-12} {ry-40}", "none", OUT, 6.5)
    return o


def mouth_extra(mode: str, cx: float = 180, cy: float = 192) -> str:
    if mode == "smirk":
        return path(f"M {cx-20} {cy+2} Q {cx+4} {cy+22} {cx+30} {cy-6}", "none", OUT, 6.5)
    if mode == "angry":
        d = (f"M {cx-42} {cy-14} C {cx-42} {cy-30} {cx+42} {cy-30} {cx+42} {cy-14} "
             f"C {cx+44} {cy+26} {cx+26} {cy+50} {cx} {cy+50} C {cx-26} {cy+50} {cx-44} {cy+26} {cx-42} {cy-14} Z")
        o = path(d, MOUTH, OUT, 6.5)
        o += f'<clipPath id="m_angry"><path d="{d}"/></clipPath>'
        o += group(ellipse(cx, cy + 20, 22, 16, THROAT) + ellipse(cx, cy + 48, 26, 16, TONGUE),
                   extra='clip-path="url(#m_angry)"')
        # 윗니 (화난 입)
        o += path(f"M {cx-30} {cy-18} L {cx-18} {cy-6} L {cx-6} {cy-18}", WHITE, OUT, 3)
        o += path(f"M {cx+6} {cy-18} L {cx+18} {cy-6} L {cx+30} {cy-18}", WHITE, OUT, 3)
        return o
    return mouth(mode, cx, cy)


def character2(p: "Pose") -> str:
    """정면 리그 + 추가 표정 지원."""
    parts = [p.behind, dorsal_fin(p.dorsal), tail(p.tail)]
    fins = ""
    if p.fin_l is not None:
        fins += pec_fin("L", p.fin_l, *(p.fin_l_at or (None, None)))
    if p.fin_r is not None:
        fins += pec_fin("R", p.fin_r, *(p.fin_r_at or (None, None)))
    if not p.fins_front:
        parts.append(fins)
    parts.append(body(p.shade))
    parts.append(cheeks(p.cheeks))
    parts.append(mouth_extra(p.mouth, *p.mouth_pos))
    e = eyes(p.eyes)
    parts.append(e if e else eyes_extra(p.eyes))
    if p.fins_front:
        parts.append(fins)
    parts.append(p.front)
    return group("".join(parts), p.transform)


# ================================================================ 옆모습 리그 (왼쪽을 보는 프로필)
S_BODY = ("M 62 150 C 62 106 98 84 146 84 C 190 84 218 100 240 114 C 256 124 262 136 262 150 "
          "C 262 164 254 174 236 178 C 200 190 150 200 110 198 C 82 196 62 176 62 150 Z")
S_SPOTS = [(100, 116, 5), (126, 136, 4.5), (158, 112, 5.5), (186, 116, 4.5), (212, 126, 5),
           (236, 134, 4), (150, 156, 4), (180, 156, 4.5), (212, 156, 4), (238, 158, 3.5),
           (92, 172, 3.5), (128, 176, 3.5), (200, 100, 3.5)]
S_EYE_FAR = (150, 90, 26)
S_EYE_NEAR = (118, 98, 30)


def s_dorsal(mode: str = "normal") -> str:
    if mode == "raised":
        cx, cy, R, a0, a1 = 196, 148, 100, 232, 336
    elif mode == "droop":
        cx, cy, R, a0, a1 = 196, 152, 62, 262, 346
    else:
        cx, cy, R, a0, a1 = 196, 148, 80, 236, 336
    n = 5
    angs = [a0 + (a1 - a0) * i / (n - 1) for i in range(n)]
    tips = [pol(cx, cy, R, a) for a in angs]
    d = f"M {f(cx)} {f(cy + 30)} L {f(tips[0][0])} {f(tips[0][1])}"
    for i in range(n - 1):
        qx, qy = pol(cx, cy, R * 0.80, (angs[i] + angs[i + 1]) / 2)
        d += f" Q {f(qx)} {f(qy)} {f(tips[i + 1][0])} {f(tips[i + 1][1])}"
    d += " Z"
    out = path(d, FIN, OUT)
    for a in angs[1:-1]:
        tx, ty = pol(cx, cy, R - 12, a)
        bx, by = pol(cx, cy, R * 0.35, a)
        out += path(f"M {f(bx)} {f(by)} L {f(tx)} {f(ty)}", "none", FIN_RAY, 3.5, 'opacity="0.55"')
    for i, a in enumerate(angs):
        for rr in ((0.62, 0.86) if i in (1, 2, 3) else (0.62,)):
            sx, sy = pol(cx, cy, R * rr, a + (5 if rr > 0.7 else -6))
            out += spot(sx, sy, 4 if rr > 0.7 else 3.4)
    return out


S_TAIL_D = ("M 254 140 C 274 132 288 124 300 108 C 308 98 324 102 324 116 C 324 128 316 140 314 152 "
            "C 316 166 322 178 316 190 C 310 200 296 198 288 186 C 280 174 274 168 264 164 "
            "C 262 172 256 178 250 176 Z")


def s_tail(mode: str = "normal") -> str:
    rot = {"normal": 0, "up": -38, "curl": 42}.get(mode, 0)
    o = path(S_TAIL_D, FIN, OUT)
    for r in ["M 292 128 L 314 112", "M 294 144 L 316 150", "M 292 160 L 310 184"]:
        o += path(r, "none", FIN_RAY, 3.5, 'opacity="0.55"')
    for sp in ((306, 124, 4), (304, 166, 3.5), (276, 146, 3.5)):
        o += spot(*sp)
    return group(o, f"rotate({rot} 256 156)")


def s_eyes(mode: str = "normal") -> str:
    fx, fy, fr = S_EYE_FAR
    nx, ny, nr = S_EYE_NEAR
    o = ""
    if mode in ("normal", "shock", "side", "sleepy"):
        o += circle(fx, fy, fr, WHITE, OUT) + circle(nx, ny, nr, WHITE, OUT)
        if mode == "normal":
            o += circle(fx - 9, fy + 5, 11, PUPIL) + circle(fx - 13, fy + 1, 4, WHITE)
            o += circle(nx - 10, ny + 6, 14, PUPIL) + circle(nx - 15, ny + 1, 5, WHITE) + circle(nx - 6, ny + 11, 2.5, WHITE)
        elif mode == "shock":
            o += circle(fx - 6, fy + 4, 6, PUPIL) + circle(nx - 8, ny + 6, 7, PUPIL)
        elif mode == "side":    # 뒤(오른쪽)를 흘끗
            o += circle(fx + 8, fy + 4, 10, PUPIL) + circle(fx + 5, fy + 1, 3.5, WHITE)
            o += circle(nx + 10, ny + 5, 12, PUPIL) + circle(nx + 6, ny + 1, 4, WHITE)
        elif mode == "sleepy":  # 반쯤 감김
            o += circle(fx - 8, fy + 8, 9, PUPIL) + circle(nx - 9, ny + 9, 11, PUPIL)
            o += path(f"M {fx-fr} {fy-2} A {fr} {fr} 0 0 1 {fx+fr} {fy-2} Z", BODY, OUT, 5.5)
            o += path(f"M {nx-nr} {ny-2} A {nr} {nr} 0 0 1 {nx+nr} {ny-2} Z", BODY, OUT, 5.5)
    elif mode == "happy":
        o += circle(fx, fy, fr, BODY, OUT) + circle(nx, ny, nr, BODY, OUT)
        o += path(f"M {fx-16} {fy+6} Q {fx} {fy-12} {fx+16} {fy+6}", "none", OUT, 6)
        o += path(f"M {nx-18} {ny+7} Q {nx} {ny-14} {nx+18} {ny+7}", "none", OUT, 6.5)
    elif mode == "closed":      # 편안히 감음 (인사)
        o += circle(fx, fy, fr, BODY, OUT) + circle(nx, ny, nr, BODY, OUT)
        o += path(f"M {fx-15} {fy-2} Q {fx} {fy+12} {fx+15} {fy-2}", "none", OUT, 6)
        o += path(f"M {nx-17} {ny-2} Q {nx} {ny+14} {nx+17} {ny-2}", "none", OUT, 6.5)
    return o


def s_mouth(mode: str = "smile") -> str:
    if mode == "smile":
        return path("M 68 156 Q 92 184 126 168", "none", OUT, 6.5)
    if mode == "grin":
        d = "M 68 154 Q 98 194 128 166 Q 100 176 68 154 Z"
        o = path(d, MOUTH, OUT, 6)
        o += f'<clipPath id="s_grin"><path d="{d}"/></clipPath>'
        o += group(ellipse(104, 186, 18, 12, TONGUE), extra='clip-path="url(#s_grin)"')
        return o
    if mode == "laugh":
        d = "M 66 150 Q 104 214 132 166 Q 100 178 66 150 Z"
        o = path(d, MOUTH, OUT, 6)
        o += f'<clipPath id="s_laugh"><path d="{d}"/></clipPath>'
        o += group(ellipse(108, 200, 22, 14, TONGUE), extra='clip-path="url(#s_laugh)"')
        return o
    if mode == "gape":          # 옆에서 본 대왕 입: 아래턱이 뚝 떨어짐
        d = "M 130 168 L 64 144 C 58 164 60 186 74 204 C 88 220 116 214 130 168 Z"
        o = path(d, MOUTH, OUT, 6.5)
        o += f'<clipPath id="s_gape"><path d="{d}"/></clipPath>'
        o += group(ellipse(96, 178, 20, 14, THROAT) + ellipse(90, 204, 22, 12, TONGUE),
                   extra='clip-path="url(#s_gape)"')
        return o
    if mode == "o":
        return ellipse(76, 168, 8, 10, MOUTH, OUT, 5.5)
    if mode == "flat":
        return path("M 70 166 L 118 170", "none", OUT, 6.5)
    if mode == "wavy":
        return path("M 70 168 Q 82 158 94 168 T 118 168", "none", OUT, 6.5)
    if mode == "sad":
        return path("M 70 172 Q 96 156 124 172", "none", OUT, 6.5)
    return ""


@dataclass
class SidePose:
    eyes: str = "normal"
    mouth: str = "smile"
    fin: float = 120            # 앞 가슴지느러미 각도 (120 = 아래앞으로 짚음)
    fin_at: tuple = (120, 186)
    fin_far: bool = True
    dorsal: str = "normal"
    tail: str = "normal"
    cheek: float = 0.8
    transform: str = ""         # 리그 좌표계(스케일 전) 기준 변환
    squash: float = 1.0         # 세로 찌그러뜨림 (엎드림)
    behind: str = ""
    front: str = ""


def side_character(p: SidePose, tx: float = -46, ty: float = 34, scale: float = 1.25) -> str:
    parts = [p.behind, s_dorsal(p.dorsal), s_tail(p.tail)]
    if p.fin_far:
        parts.append(group(path(FIN_D, BODY_SH, OUT) + spot(30, -4, 3), "translate(150 184) rotate(104)"))
    bodyp = path(S_BODY, BODY, OUT)
    bodyp += f'<clipPath id="sbodyclip"><path d="{S_BODY}"/></clipPath>'
    bodyp += group(ellipse(160, 196, 100, 24, BELLY) +
                   path("M 262 150 C 262 164 254 174 236 178 C 200 190 150 200 110 198 "
                        "C 160 190 230 176 262 150 Z", BODY_SH, None, extra='opacity="0.5"'),
                   extra='clip-path="url(#sbodyclip)"')
    for sp in S_SPOTS:
        bodyp += spot(*sp)
    parts.append(bodyp)
    parts.append(ellipse(102, 150, 14, 9, CHEEK, extra=f'opacity="{p.cheek}"'))
    parts.append(s_mouth(p.mouth))
    parts.append(s_eyes(p.eyes))
    parts.append(pec_fin("R", p.fin, *p.fin_at))
    parts.append(p.front)
    inner = "".join(parts)
    if p.squash != 1.0:
        inner = group(inner, f"translate(0 198) scale(1 {p.squash}) translate(0 -198)")
    if p.transform:
        inner = group(inner, p.transform)
    return group(inner, f"translate({f(tx)} {f(ty)}) scale({f(scale)})")


# ================================================================ 뒷모습 / 위에서 본 모습
def back_character(glance: bool = True, transform: str = "") -> str:
    """3/4 뒷모습: 얼굴 없음, 눈 뒤통수만, 등지느러미가 몸 앞에 보임."""
    parts = []
    parts.append(path(BODY_PATH, BODY, OUT))
    parts.append(f'<clipPath id="bodyclip_b"><path d="{BODY_PATH}"/></clipPath>')
    parts.append(group(path("M 275 224 C 274 270 246 300 180 300 C 150 300 128 294 112 282 "
                            "C 150 302 236 302 262 250 C 270 236 272 226 275 224 Z", BODY_SH, None,
                            extra='opacity="0.5"'), extra='clip-path="url(#bodyclip_b)"'))
    back_spots = [(150, 150, 5), (180, 140, 5.5), (210, 152, 5), (120, 176, 4.5), (240, 180, 4.5),
                  (150, 200, 4.5), (100, 212, 4), (168, 232, 4), (128, 250, 4), (215, 258, 3.5), (256, 226, 4)]
    for sp in back_spots:
        parts.append(spot(*sp))
    # 눈 (뒤에서 본 흰 돔). glance면 오른쪽 눈동자가 살짝 보임
    (lx, ly), (rx, ry) = EYE_L, EYE_R
    parts.append(circle(lx, ly, EYE_R_, WHITE, OUT) + circle(rx, ry, EYE_R_, WHITE, OUT))
    if glance:
        parts.append(f'<clipPath id="eyeclip_r"><circle cx="{rx}" cy="{ry}" r="{EYE_R_-3}"/></clipPath>')
        parts.append(group(circle(rx + 30, ry + 6, 13, PUPIL) + circle(rx + 27, ry + 1, 4, WHITE),
                           extra='clip-path="url(#eyeclip_r)"'))
    # 등지느러미: 등줄기(머리 뒤 -> 꼬리)를 밑변으로 오른쪽으로 펼쳐진 돛
    spine = [(182, 150), (186, 186), (190, 222), (194, 258), (198, 290)]
    tips = [(232, 118), (270, 150), (286, 200), (272, 254), (236, 292)]
    d = f"M {spine[0][0]} {spine[0][1]} L {tips[0][0]} {tips[0][1]}"
    for i in range(len(tips) - 1):
        mx = (tips[i][0] + tips[i + 1][0]) / 2 - 14
        my = (tips[i][1] + tips[i + 1][1]) / 2
        d += f" Q {f(mx)} {f(my)} {tips[i + 1][0]} {tips[i + 1][1]}"
    d += f" L {spine[-1][0]} {spine[-1][1]} Z"
    fin = path(d, FIN, OUT)
    fin += path(" ".join(f"L {x} {y}" for x, y in spine).replace("L", "M", 1), "none", OUT, 5)
    for (sx, sy), (tx_, ty_) in zip(spine[1:-1], tips[1:-1]):
        fin += path(f"M {sx} {sy} L {f(tx_ - (tx_ - sx) * 0.12)} {f(ty_ - (ty_ - sy) * 0.12)}", "none", FIN_RAY, 3.5, 'opacity="0.55"')
    for sp in ((236, 160, 4), (256, 200, 4.2), (246, 244, 4), (224, 210, 3.5), (214, 270, 3.5)):
        fin += spot(*sp)
    parts.append(fin)
    # 가슴지느러미 양옆으로 살짝
    parts.append(pec_fin("L", 30, 100, 236, 0.9))
    parts.append(pec_fin("R", 30, 260, 236, 0.9))
    # 꼬리: 아래로 내려와 보는 사람 쪽으로 (몸 앞)
    tail_d = ("M 176 292 C 196 292 214 296 226 312 C 238 326 232 346 214 346 C 198 346 186 332 182 322 "
              "C 176 334 160 344 150 336 C 138 326 146 306 160 296 Z")
    parts.append(path(tail_d, FIN, OUT))
    parts.append(path("M 190 306 L 216 334", "none", FIN_RAY, 3.5, 'opacity="0.55"'))
    parts.append(path("M 184 308 L 162 330", "none", FIN_RAY, 3.5, 'opacity="0.55"'))
    parts.append(spot(206, 322, 3.5) + spot(166, 318, 3))
    return group("".join(parts), transform)


T_BODY = ("M 180 84 C 236 84 262 130 258 172 C 254 210 236 250 224 280 C 218 296 210 306 180 308 "
          "C 150 306 142 296 136 280 C 124 250 106 210 102 172 C 98 130 124 84 180 84 Z")


def top_character(transform: str = "", eyes_mode: str = "closed") -> str:
    """위에서 본 엎드린 모습: 머리 위, 지느러미 쫙, 꼬리 아래."""
    parts = []
    # 꼬리 (뒤)
    parts.append(path("M 166 300 C 160 322 150 338 152 352 C 154 362 170 360 180 348 C 190 360 206 362 208 352 "
                      "C 210 338 200 322 194 300 Z", FIN, OUT))
    parts.append(path("M 170 330 L 162 352", "none", FIN_RAY, 3.5, 'opacity="0.55"') +
                 path("M 190 330 L 198 352", "none", FIN_RAY, 3.5, 'opacity="0.55"'))
    # 가슴지느러미 쫙 (뒤에 깔림)
    parts.append(pec_fin("L", -36, 108, 178, 1.1))
    parts.append(pec_fin("R", -36, 252, 178, 1.1))
    parts.append(path(T_BODY, BODY, OUT))
    parts.append(f'<clipPath id="tbodyclip"><path d="{T_BODY}"/></clipPath>')
    parts.append(group(path("M 258 172 C 254 210 236 250 224 280 C 218 296 210 306 180 308 "
                            "C 214 300 232 260 244 214 C 250 194 254 182 258 172 Z", BODY_SH, None,
                            extra='opacity="0.5"'), extra='clip-path="url(#tbodyclip)"'))
    # 등지느러미: 등줄기에서 오른쪽으로 쓰러진 돛 (힘 빠져 접힘)
    spine = [(180, 150), (182, 184), (184, 218), (186, 252), (186, 280)]
    tips = [(214, 138), (240, 168), (246, 214), (232, 256), (206, 286)]
    d = f"M {spine[0][0]} {spine[0][1]} L {tips[0][0]} {tips[0][1]}"
    for i in range(len(tips) - 1):
        mx = (tips[i][0] + tips[i + 1][0]) / 2 - 10
        my = (tips[i][1] + tips[i + 1][1]) / 2
        d += f" Q {f(mx)} {f(my)} {tips[i + 1][0]} {tips[i + 1][1]}"
    d += f" L {spine[-1][0]} {spine[-1][1]} Z"
    parts.append(path(d, FIN, OUT, 5))
    parts.append(path("M 180 150 L 182 184 L 184 218 L 186 252 L 186 280", "none", OUT, 5))
    for (sx, sy), (tx_, ty_) in zip(spine[1:-1], tips[1:-1]):
        parts.append(path(f"M {sx} {sy} L {f(tx_ - (tx_ - sx) * 0.15)} {f(ty_ - (ty_ - sy) * 0.15)}", "none", FIN_RAY, 3, 'opacity="0.55"'))
    parts.append(spot(214, 176, 3.5) + spot(226, 214, 3.5) + spot(212, 250, 3.2))
    for sp in [(140, 152, 5), (124, 200, 4.5), (150, 240, 4), (162, 280, 3.5), (242, 150, 4),
               (156, 200, 4), (130, 262, 3.5), (236, 122, 3.5), (124, 122, 3.5)]:
        parts.append(spot(*sp))
    # 눈 (머리 위 두 돔)
    for cx, cy in ((152, 108), (208, 108)):
        if eyes_mode == "closed":
            parts.append(circle(cx, cy, 30, BODY, OUT))
            parts.append(path(f"M {cx-16} {cy-2} Q {cx} {cy+14} {cx+16} {cy-2}", "none", OUT, 6.5))
        elif eyes_mode == "dead":   # 반쯤 감고 멍하니 앞을 봄
            parts.append(circle(cx, cy, 30, WHITE, OUT))
            parts.append(circle(cx, cy - 8, 9, PUPIL, hi=False) if False else circle(cx, cy - 8, 9, PUPIL))
            parts.append(path(f"M {cx-30} {cy-4} A 30 30 0 0 1 {cx+30} {cy-4} Z", BODY, OUT, 5.5))
        else:
            parts.append(circle(cx, cy, 30, WHITE, OUT))
            parts.append(circle(cx, cy + 6, 13, PUPIL) + circle(cx - 5, cy + 1, 5, WHITE))
    return group("".join(parts), transform)


# ================================================================ 추가 소품
def confetti(seed_pts) -> str:
    cols = ["#FF6B8A", "#FFD84D", "#5ED3F3", "#8BE38B", "#B48CF2"]
    o = ""
    for i, (x, y, rot) in enumerate(seed_pts):
        c = cols[i % len(cols)]
        if i % 3 == 0:
            o += circle(x, y, 6, c, OUT, 3.5)
        else:
            o += (f'<rect x="{x-7}" y="{y-5}" width="14" height="10" rx="2" fill="{c}" stroke="{OUT}" '
                  f'stroke-width="3.5" transform="rotate({rot} {x} {y})"/>')
    return o


def party_hat(x, y, s=1.0, rot=0) -> str:
    d = "M 0 -46 L 24 14 L -24 14 Z"
    o = path(d, "#FF6B8A", OUT, 5.5)
    o += path("M -18 0 L 18 0", "none", "#FFD84D", 7)
    o += path("M -9 -22 L 9 -22", "none", "#FFD84D", 6)
    o += circle(0, -46, 8, "#FFD84D", OUT, 4.5)
    return group(o, f"translate({x} {y}) rotate({rot}) scale({s})")


def coffee_cup(x, y, s=1.0) -> str:
    o = path("M -22 -18 L -18 26 Q -18 32 -12 32 L 12 32 Q 18 32 18 26 L 22 -18 Z", "#F4E9D8", OUT, 5.5)
    o += path("M -24 -18 L 24 -18", "none", OUT, 6)
    o += path("M -20 -6 L 20 -6", "none", "#C89A6A", 5)
    o += path("M 22 -8 Q 40 -8 38 8 Q 36 20 18 20", "none", OUT, 12) + path("M 22 -8 Q 40 -8 38 8 Q 36 20 18 20", "none", "#F4E9D8", 5)
    for dx in (-8, 2, 12):
        o += path(f"M {dx} -30 Q {dx-6} -42 {dx} -52", "none", "#B8B8B8", 4, 'opacity="0.8"')
    return group(o, f"translate({x} {y}) scale({s})")


def steam(x, y, s=1.0) -> str:
    o = ""
    for dx, dy, r in ((0, 0, 14), (16, -12, 11), (-14, -10, 10), (6, -24, 9)):
        o += circle(dx, dy, r, "#F2F2F2", OUT, 4.5)
    return group(o, f"translate({x} {y}) scale({s})")


def qmark(x, y, size=96, color="#FF8A3D", rot=0) -> str:
    return text("?", x, y, size, color, rotate=rot, stroke_w=12, font="Jua")


def bang(x, y, size=90, color="#FF5C5C", rot=0) -> str:
    return text("!", x, y, size, color, rotate=rot, stroke_w=12, font="Jua")


def dots(x, y, color=OUT, r=6, gap=20) -> str:
    return "".join(circle(x + i * gap, y, r, color) for i in range(3))


def rain(pts) -> str:
    o = ""
    for x, y in pts:
        o += path(f"M {x} {y} L {x-6} {y+18}", "none", "#7FB7E8", 6)
    return o


def cloud(x, y, s=1.0, fill="#C9D3DC") -> str:
    d = ("M -40 10 C -60 10 -60 -18 -38 -18 C -36 -40 -6 -44 4 -26 C 18 -40 46 -30 42 -10 "
         "C 60 -8 58 12 40 12 Z")
    return group(path(d, fill, OUT, 5.5), f"translate({x} {y}) scale({s})")


def mud_front(y0: float = 262) -> str:
    """몸 앞에 덮이는 뻘 (가라앉음 표현)."""
    d = (f"M 40 {y0+40} C 60 {y0+4} 110 {y0+16} 150 {y0+8} C 190 {y0} 240 {y0+20} 280 {y0+8} "
         f"C 300 {y0+2} 316 {y0+14} 320 {y0+40} C 320 {y0+60} 300 {y0+68} 180 {y0+68} "
         f"C 60 {y0+68} 40 {y0+60} 40 {y0+40} Z")
    return path(d, MUD, OUT) + ellipse(100, y0 + 42, 16, 5, MUD_HI, extra='opacity="0.8"') + \
        ellipse(262, y0 + 44, 14, 4.5, MUD_HI, extra='opacity="0.8"')


def puff(x, y, s=1.0) -> str:
    """흥! 콧김"""
    o = path("M 0 0 C 10 -10 26 -6 22 6 C 30 10 24 22 12 18 C 6 26 -8 22 -6 12 C -16 10 -12 -4 0 0 Z",
             "#F2F2F2", OUT, 4.5)
    return group(o, f"translate({x} {y}) scale({s})")


def bubbles(pts) -> str:
    o = ""
    for x, y, r in pts:
        o += circle(x, y, r, "#D6F0FA", OUT, 4) + circle(x - r * 0.35, y - r * 0.35, r * 0.28, WHITE)
    return o


def speed_lines(lines) -> str:
    return "".join(path(f"M {x0} {y0} L {x1} {y1}", "none", OUT, 6) for x0, y0, x1, y1 in lines)


# ================================================================ 이모티콘 11~32
def e11_yes() -> str:
    """넵! : 경례."""
    p = Pose(eyes="salute", mouth="grin", fin_l=40, fin_r=-112, fin_r_at=(262, 198), cheeks=0.8)
    return svg_doc(mud() + character2(p) + text("넵!", 84, 96, 78, "#2F80ED", rotate=-8))


def e12_thanks_formal() -> str:
    """감사합니다 : 옆모습 90도 인사."""
    p = SidePose(eyes="closed", mouth="smile", fin=140, dorsal="normal", tail="up",
                 transform="rotate(-42 150 200)")
    deco = sparkle(60, 300, 12) + sparkle(300, 110, 12, rot=20) + motion_arcs(96, 112, 22, 3, rot=140, span=70)
    return svg_doc(mud() + side_character(p, tx=-20, ty=60) + deco + text("감사합니다", 196, 74, 58, "#F5A623"))


def e13_sorry() -> str:
    """미안... : 움츠러들어 지느러미 모으고 땀."""
    p = Pose(eyes="sorry", mouth="wavy", mouth_pos=(180, 198), fin_l=-100, fin_r=-100,
             fin_l_at=(130, 252), fin_r_at=(230, 252), cheeks=0.9,
             transform="translate(180 300) scale(0.86) translate(-180 -300)",
             front=sweat(258, 96, 0.8))
    return svg_doc(mud() + character2(p) + text("미안...", 180, 76, 62, "#7A8C99"))


def e14_congrats() -> str:
    """축하해! : 고깔 쓰고 점프, 색종이."""
    p = Pose(eyes="happy", mouth="laugh", fin_l=-120, fin_r=-120, fin_l_at=(112, 226), fin_r_at=(248, 226),
             cheeks=0.9, dorsal="raised", transform="translate(0 -30)",
             front=party_hat(182, 66, 1.05, rot=14))
    conf = confetti([(50, 60, 20), (90, 130, -30), (300, 70, 40), (322, 150, -15), (40, 210, 10),
                     (326, 230, 30), (130, 40, 0), (250, 44, -40), (70, 270, 25), (306, 288, -20)])
    deco = splash(180, 320, 0.9)
    return svg_doc(mud() + character2(p) + deco + conf + text("축하해!", 180, 342, 60, "#FF5C7A"))


def e15_hungry() -> str:
    """배고파 : 옆으로 납작 엎드려 축 늘어짐."""
    p = SidePose(eyes="sleepy", mouth="wavy", fin=150, fin_at=(114, 190), dorsal="droop", tail="normal",
                 squash=0.72, cheek=0.5)
    growl = motion_arcs(150, 292, 14, 2, rot=90, span=90)
    return svg_doc(mud() + side_character(p, tx=-30, ty=44) + growl + sweat(74, 150, 0.7) +
                   text("배고파", 180, 84, 66, "#FF8A3D"))


def e16_whatdoing() -> str:
    """뭐해? : 뻘 언덕 뒤에서 빼꼼."""
    p = SidePose(eyes="normal", mouth="o", fin=150, fin_at=(112, 186), fin_far=False, dorsal="normal", tail="up")
    hill = (path("M 20 330 C 40 250 140 236 200 262 C 250 282 300 280 340 330 Z", MUD, OUT) +
            ellipse(120, 300, 20, 6, MUD_HI, extra='opacity="0.8"') + ellipse(250, 306, 16, 5, MUD_HI, extra='opacity="0.8"'))
    return svg_doc(side_character(p, tx=-2, ty=66) + hill + qmark(300, 120, 92, "#2F80ED", rot=12) +
                   text("뭐해?", 108, 84, 62, "#2F80ED", rotate=-6))


def e17_offwork() -> str:
    """퇴근! : 옆모습 S자 점프."""
    p = SidePose(eyes="happy", mouth="laugh", fin=-30, fin_at=(122, 176), dorsal="raised", tail="curl",
                 transform="rotate(-34 160 150)")
    deco = splash(176, 318, 1.1) + speed_lines([(300, 250, 336, 262), (306, 274, 332, 282), (28, 296, 62, 296)])
    return svg_doc(mud() + side_character(p, tx=-20, ty=24) + deco + text("퇴근!", 258, 92, 74, "#2FB36B", rotate=8))


def e18_monday() -> str:
    """월요일 싫어 : 비 맞으며 뻘에 가라앉음."""
    p = Pose(eyes="dead", mouth="wavy", mouth_pos=(180, 200), fin_l=50, fin_r=50, dorsal="droop", cheeks=0.5,
             transform="translate(0 24)")
    deco = (cloud(96, 60, 0.9) + cloud(270, 72, 0.7) +
            rain([(60, 90), (120, 98), (240, 104), (300, 100), (170, 96), (330, 140), (30, 150)]) +
            mud_front(268))
    return svg_doc(mud() + character2(p) + deco + text("월요일 싫어", 180, 342, 54, "#5E68C7"))


def e19_tired() -> str:
    """힘들다... : 위에서 본 엎드린 모습."""
    deco = sweat(262, 112, 0.75) + cloud(72, 262, 0.5, "#E8E8E8") + dots(292, 232, "#9AA5AE", 5, 16)
    return svg_doc(mud() + top_character("translate(0 20) rotate(-16 180 220)", "dead") + deco +
                   text("힘들다...", 150, 74, 60, "#7A8C99", rotate=-4))


def e20_huh() -> str:
    """응? : 고개 갸웃 + 물음표 (텍스트 없음)."""
    p = Pose(eyes="normal", mouth="o", mouth_pos=(184, 196), fin_l=40, fin_r=-60, fin_r_at=(250, 232),
             transform="rotate(14 180 300)")
    return svg_doc(mud() + character2(p) + qmark(72, 120, 110, "#FF8A3D", rot=-14))


def e21_best() -> str:
    """최고! : 지느러미 번쩍, 별."""
    p = Pose(eyes="wink", mouth="grin", fin_l=30, fin_r=-72, fin_r_at=(262, 214), cheeks=0.85)
    deco = star(300, 84, 16) + star(322, 140, 10) + star(62, 110, 12) + sparkle(40, 170, 9)
    return svg_doc(mud() + character2(p) + deco + text("최고!", 180, 340, 64, "#FFB300"))


def e22_goodjob() -> str:
    """수고했어 : 커피 한 잔 건네기."""
    p = Pose(eyes="happy", mouth="grin", fin_l=40, fin_r=-150, fin_r_at=(244, 236), cheeks=0.85,
             front=coffee_cup(230, 222, 1.1))
    return svg_doc(mud() + character2(p) + text("수고했어", 180, 78, 60, "#8B5E3C"))


def e23_bored() -> str:
    """심심해 : 옆으로 누워 뒹굴 (텍스트 없음, ··· 만)."""
    p = Pose(eyes="normal", mouth="flat", mouth_pos=(180, 194), fin_l=-40, fin_r=60, cheeks=0.5, dorsal="droop",
             transform="translate(0 -24) rotate(88 180 240)")
    wide_mud = (path("M 24 306 C 44 276 120 288 180 286 C 250 284 310 274 336 306 "
                     "C 346 322 306 330 180 332 C 54 330 14 322 24 306 Z", MUD, OUT) +
                ellipse(70, 310, 16, 5, MUD_HI, extra='opacity="0.8"') + ellipse(290, 312, 14, 4.5, MUD_HI, extra='opacity="0.8"'))
    deco = dots(60, 110, OUT, 7, 24) + bubbles([(290, 96, 9), (312, 70, 6)])
    return svg_doc(wide_mud + character2(p) + deco)


def e24_flutter() -> str:
    """두근두근 : 볼 감싸고 하트 (텍스트 없음)."""
    p = Pose(eyes="glitter", mouth="grin", fin_l=-128, fin_r=-128, fin_l_at=(118, 214), fin_r_at=(242, 214),
             cheeks=1.0)
    deco = (heart(72, 90, 20, rot=-16) + heart(296, 74, 16, rot=18) + heart(320, 150, 10, rot=8) +
            heart(48, 170, 9, rot=-12) + heart(292, 240, 8, rot=14) +
            motion_arcs(72, 90, 30, 2, rot=-90, span=60) + motion_arcs(296, 74, 26, 2, rot=-90, span=60))
    return svg_doc(mud() + character2(p) + deco)


def e25_angry() -> str:
    """화났어 : 대왕 입 + 눈썹 + 김 (텍스트 없음)."""
    p = Pose(eyes="angry", mouth="angry", mouth_pos=(180, 214), fin_l=30, fin_r=30, cheeks=0.0, dorsal="raised",
             front=(ellipse(120, 176, 20, 12, "#FF7A7A", extra='opacity="0.55"') +
                    ellipse(240, 176, 20, 12, "#FF7A7A", extra='opacity="0.55"')))
    deco = (steam(70, 96, 0.9) + steam(292, 84, 1.0) +
            path("M 300 150 L 330 140", "none", OUT, 6) + path("M 296 176 L 330 176", "none", OUT, 6) +
            path("M 60 150 L 30 140", "none", OUT, 6) + path("M 64 176 L 30 176", "none", OUT, 6))
    return svg_doc(mud() + character2(p) + deco)


def e26_startled() -> str:
    """놀람 : 옆모습 화들짝 점프 (텍스트 없음, !! 만)."""
    p = SidePose(eyes="shock", mouth="o", fin=-20, fin_at=(122, 178), dorsal="raised", tail="up",
                 transform="rotate(-26 160 150)")
    deco = (splash(170, 322, 1.0) + bang(286, 120, 96, "#FF5C5C", rot=8) + bang(324, 108, 70, "#FF5C5C", rot=16) +
            speed_lines([(28, 292, 66, 292), (40, 268, 70, 268)]))
    return svg_doc(mud() + side_character(p, tx=-24, ty=20) + deco)


def e27_hmph() -> str:
    """흥! : 뒷모습으로 홱 돌아섬."""
    deco = puff(262, 128, 1.1) + text("흥!", 82, 110, 78, "#7B5CF0", rotate=-10)
    return svg_doc(mud() + back_character(True) + deco)


def e28_hide() -> str:
    """숨기 : 뻘 구멍에서 눈만 빼꼼 (텍스트 없음)."""
    big_mud = (path("M 28 240 C 60 196 130 208 180 204 C 236 200 300 196 332 240 C 344 280 330 330 180 332 "
                    "C 30 330 16 280 28 240 Z", MUD, OUT) +
               ellipse(80, 268, 22, 7, MUD_HI, extra='opacity="0.8"') + ellipse(290, 300, 18, 6, MUD_HI, extra='opacity="0.8"') +
               ellipse(140, 312, 14, 4.5, MUD_HI, extra='opacity="0.6"'))
    hole = ellipse(180, 222, 84, 30, "#4A3423", OUT)
    head = (f'<clipPath id="headclip"><rect x="0" y="0" width="360" height="222"/></clipPath>' +
            group(path(BODY_PATH, BODY, OUT) + "".join(spot(*s) for s in BODY_SPOTS if s[1] < 200) +
                  cheeks(0.9) + eyes("normal"), "translate(0 56)", 'clip-path="url(#headclip)"'))
    deco = bubbles([(268, 190, 8), (286, 168, 5)]) + sweat(112, 140, 0.55)
    # 구멍 앞쪽 뻘 가장자리
    rim = path("M 96 222 Q 180 262 264 222", "none", OUT, 7)
    return svg_doc(big_mud + hole + head + rim + deco)


def e29_pointless() -> str:
    """뻘짓중... : 엎드려 꼬리로 뻘 튀기기."""
    p = SidePose(eyes="side", mouth="flat", fin=150, fin_at=(114, 190), dorsal="droop", tail="up",
                 squash=0.78, cheek=0.6)
    drops = "".join(ellipse(x, y, r, r * 1.3, MUD, OUT, 4) for x, y, r in
                    ((300, 130, 7), (326, 168, 6), (282, 100, 5), (336, 118, 4.5)))
    deco = motion_arcs(318, 214, 22, 2, rot=-120, span=70) + drops
    return svg_doc(mud() + side_character(p, tx=-34, ty=44) + deco + text("뻘짓중...", 150, 84, 60, "#7A8C99"))


def e30_blank() -> str:
    """멍 : 점 눈 + ··· (텍스트 없음)."""
    p = Pose(eyes="dot", mouth="flat", fin_l=40, fin_r=40, cheeks=0.4)
    return svg_doc(mud() + character2(p) + dots(236, 96, OUT, 7, 24))


def e31_smirk() -> str:
    """씨익 : 반쯤 감은 눈 + 한쪽 입꼬리 (텍스트 없음)."""
    p = Pose(eyes="smirk", mouth="smirk", mouth_pos=(182, 194), fin_l=40, fin_r=-56, fin_r_at=(250, 232),
             cheeks=0.7, transform="rotate(-6 180 300)")
    return svg_doc(mud() + character2(p) + sparkle(292, 128, 14) + sparkle(318, 176, 8))


def e32_clap() -> str:
    """박수 : 지느러미 짝짝 (텍스트 없음)."""
    p = Pose(eyes="happy", mouth="laugh", fin_l=-120, fin_r=-120, fin_l_at=(124, 244), fin_r_at=(236, 244),
             cheeks=0.9)
    deco = (motion_arcs(118, 196, 26, 2, rot=-150, span=60) + motion_arcs(242, 196, 26, 2, rot=-30, span=60) +
            sparkle(64, 110, 14) + sparkle(300, 96, 12, rot=20) + sparkle(322, 180, 8) + sparkle(44, 190, 8))
    return svg_doc(mud() + character2(p) + deco)


EMOTICONS += [
    ("11_yes", e11_yes, "넵!"),
    ("12_thanks_formal", e12_thanks_formal, "감사합니다"),
    ("13_sorry", e13_sorry, "미안..."),
    ("14_congrats", e14_congrats, "축하해!"),
    ("15_hungry", e15_hungry, "배고파"),
    ("16_whatdoing", e16_whatdoing, "뭐해?"),
    ("17_offwork", e17_offwork, "퇴근!"),
    ("18_monday", e18_monday, "월요일 싫어"),
    ("19_tired", e19_tired, "힘들다..."),
    ("20_huh", e20_huh, "(텍스트 없음) 응?"),
    ("21_best", e21_best, "최고!"),
    ("22_goodjob", e22_goodjob, "수고했어"),
    ("23_bored", e23_bored, "(텍스트 없음) 심심해"),
    ("24_flutter", e24_flutter, "(텍스트 없음) 두근두근"),
    ("25_angry", e25_angry, "(텍스트 없음) 화났어"),
    ("26_startled", e26_startled, "(텍스트 없음) 놀람"),
    ("27_hmph", e27_hmph, "흥!"),
    ("28_hide", e28_hide, "(텍스트 없음) 숨기"),
    ("29_pointless", e29_pointless, "뻘짓중..."),
    ("30_blank", e30_blank, "(텍스트 없음) 멍"),
    ("31_smirk", e31_smirk, "(텍스트 없음) 씨익"),
    ("32_clap", e32_clap, "(텍스트 없음) 박수"),
]


if __name__ == "__main__":
    main()
