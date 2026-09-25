#!/usr/bin/env python3
"""미리보기 시트 생성: 밝은 배경/어두운 배경(카카오톡 다크모드) 두 가지로 가독성을 확인한다."""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "png")
out_dir = os.path.join(root, "preview")
os.makedirs(out_dir, exist_ok=True)

files = sorted(glob.glob(os.path.join(src_dir, "*.png")))
cols = 5
cell = 372
pad = 14
rows = (len(files) + cols - 1) // cols
font_path = os.path.expanduser("~/.fonts/Jua-Regular.ttf")
font = ImageFont.truetype(font_path, 22) if os.path.exists(font_path) else ImageFont.load_default()

for bg_name, bg in (("light", (236, 241, 247)), ("dark", (36, 40, 48))):
    sheet = Image.new("RGB", (cols * cell + pad, rows * (cell + 30) + pad), bg)
    draw = ImageDraw.Draw(sheet)
    for i, fp in enumerate(files):
        im = Image.open(fp).convert("RGBA")
        if im.size != (360, 360):
            im = im.resize((360, 360), Image.LANCZOS)
        x = pad + (i % cols) * cell
        y = pad + (i // cols) * (cell + 30)
        sheet.alpha_composite(im, (x, y)) if sheet.mode == "RGBA" else sheet.paste(im, (x, y), im)
        label = os.path.basename(fp).replace(".png", "")
        size_kb = os.path.getsize(fp) / 1024
        draw.text((x + 4, y + 362), f"{label}  {size_kb:.0f}KB", fill=(120, 120, 120) if bg_name == "light" else (180, 180, 180), font=font)
    out = os.path.join(out_dir, f"sheet_{bg_name}.png")
    sheet.save(out)
    print("wrote", out, sheet.size)
