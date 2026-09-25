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


if __name__ == "__main__":
    main()
