#!/usr/bin/env python3
"""캐릭터 컨셉 시트 SVG 생성 (제안서 첨부용): 기본 포즈 + 표정 3종 + 팔레트 + 이름."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b  # noqa: E402

CW, CH = 1200, 720


def swatch(x, y, color, label):
    return (f'<rect x="{x}" y="{y}" width="64" height="64" rx="16" fill="{color}" stroke="{b.OUT}" stroke-width="5"/>'
            f'<text x="{x+32}" y="{y+92}" font-family="{b.FONT}" font-size="16" text-anchor="middle" fill="#5A4A3A">{label}</text>')


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parts = [f'<rect width="{CW}" height="{CH}" fill="#F4F0E6"/>']
    # 기본 포즈 (크게)
    base = b.Pose(eyes="normal", mouth="grin", fin_l=38, fin_r=38)
    parts.append(b.group(b.mud() + b.character(base), "translate(40 130) scale(1.35)"))
    # 표정 3종 (작게)
    faces = [
        b.Pose(eyes="happy", mouth="laugh", fin_l=-26, fin_r=-26, fin_l_at=(110, 244), fin_r_at=(250, 244)),
        b.Pose(eyes="shock", mouth="gape", mouth_pos=(180, 210), fin_l=-40, fin_r=-40,
               fin_l_at=(100, 238), fin_r_at=(260, 238), cheeks=0.0, dorsal="raised"),
        b.Pose(eyes="cry", mouth="wavy", mouth_pos=(180, 198), fin_l=48, fin_r=48, dorsal="droop",
               front=b.tear_stream(147, 150, 96) + b.tear_stream(213, 150, 96)),
    ]
    for i, p in enumerate(faces):
        parts.append(b.group(b.mud() + b.character(p), f"translate({560 + i*205} 330) scale(0.56)"))
    # 이름 / 설명
    parts.append(b.text("짱뚜", 800, 120, 96, "#FF8A3D", stroke_w=16))
    parts.append(f'<text x="800" y="170" font-family="{b.FONT}" font-size="30" text-anchor="middle" fill="#5A4A3A">JJANGTTU · 갯벌에서 온 짱뚱어</text>')
    parts.append(f'<text x="800" y="212" font-family="{b.FONT}" font-size="22" text-anchor="middle" fill="#7A6A5A">머리 위로 툭 튀어나온 눈, 하늘색 물방울 무늬, 얼굴만 한 입, 돛 같은 등지느러미</text>')
    # 팔레트
    pal = [(b.BODY, "몸통"), (b.BELLY, "배"), (b.FIN, "지느러미"), (b.SPOT, "반점"),
           (b.CHEEK, "볼"), (b.MUD, "뻘"), (b.OUT, "외곽선")]
    for i, (c, l) in enumerate(pal):
        parts.append(swatch(560 + i * 90, 560, c, l))
    parts.append(f'<text x="560" y="540" font-family="{b.FONT}" font-size="22" fill="#5A4A3A">컬러 팔레트</text>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{CW}" height="{CH}" viewBox="0 0 {CW} {CH}">'
           + "".join(parts) + "</svg>")
    out = os.path.join(root, "preview")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "concept_sheet.svg"), "w", encoding="utf-8") as fh:
        fh.write(svg)
    print("wrote concept_sheet.svg")


if __name__ == "__main__":
    main()
