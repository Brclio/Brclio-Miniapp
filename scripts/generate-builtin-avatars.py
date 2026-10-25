#!/usr/bin/env python3
"""Draw the 1,000 original Brclio avatars, with no network calls or fonts.

Requires Pillow. IDs and artwork are deterministic: 10 characters, 10 palettes,
and 10 accessories/expressions. PNGs are small palette images, served remotely
to keep the WeChat main package small. Run from any working directory.
"""
from pathlib import Path
from PIL import Image, ImageDraw
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "avatars"
SIZE = 160
SCALE = 3
INK = "#343432"
PAPER = "#fefcf6"
PALETTES = [
    ("#f5ecd8", "#e9af66", "#2b7fd8"),
    ("#e8eff5", "#85add2", "#f4d758"),
    ("#f6e5df", "#d68b79", "#2b7fd8"),
    ("#ececd9", "#a4b98a", "#e84a5f"),
    ("#f6eed2", "#e4c86c", "#2b7fd8"),
    ("#efe8e2", "#b59a82", "#f4d758"),
    ("#f5e7e5", "#dda8ac", "#2b7fd8"),
    ("#e6eee8", "#87afa0", "#f4d758"),
    ("#ece8df", "#b2a797", "#e84a5f"),
    ("#f2ecdc", "#dbb88b", "#2b7fd8"),
]
MOTIFS = ["cat", "fox", "bear", "rabbit", "panda", "dog", "frog", "owl", "penguin", "robot"]


def draw_avatar(motif, palette, variant):
    bg, coat, accent = PALETTES[palette]
    image = Image.new("RGB", (SIZE * SCALE, SIZE * SCALE), bg)
    d = ImageDraw.Draw(image)

    def points(values):
        return [(round(x * SCALE), round(y * SCALE)) for x, y in values]

    def box(values):
        return tuple(round(value * SCALE) for value in values)

    def ellipse(bounds, fill, outline=None, width=1.5):
        d.ellipse(box(bounds), fill=fill, outline=outline, width=round(width * SCALE))

    def line(values, fill=INK, width=2):
        d.line(points(values), fill=fill, width=round(width * SCALE), joint="curve")

    def polygon(values, fill):
        d.polygon(points(values), fill=fill)

    def rounded(bounds, radius, fill, outline=None, width=1.5):
        d.rounded_rectangle(box(bounds), radius=round(radius * SCALE), fill=fill, outline=outline, width=round(width * SCALE))

    def arc(bounds, start, end, fill=INK, width=2):
        d.arc(box(bounds), start, end, fill=fill, width=round(width * SCALE))

    # Offset little paper marks keep the illustration warm without visual noise.
    ellipse((12, 24, 18, 30), accent)
    line([(136, 31), (142, 37)], accent, 2)
    line([(142, 31), (136, 37)], accent, 2)
    ellipse((128, 118, 132, 122), coat)
    # The shoulders are visible even when the avatar is circularly cropped.
    ellipse((32, 115, 128, 190), accent)
    ellipse((47, 126, 113, 177), PAPER)

    if motif in (0, 1):  # Cat / fox: noticeably different silhouettes and faces.
        polygon([(36, 70), (38, 26), (68, 48)], coat)
        polygon([(92, 48), (122, 26), (124, 72)], coat)
        polygon([(43, 58), (44, 37), (60, 51)], "#eab4a6")
        polygon([(100, 51), (116, 37), (117, 58)], "#eab4a6")
    elif motif in (2, 4):
        ears = INK if motif == 4 else coat
        ellipse((29, 30, 68, 72), ears)
        ellipse((92, 30, 131, 72), ears)
        if motif == 2:
            ellipse((38, 40, 59, 61), "#eab4a6")
            ellipse((101, 40, 122, 61), "#eab4a6")
    elif motif == 3:
        ellipse((42, 7, 68, 77), coat)
        ellipse((91, 5, 117, 77), coat)
        ellipse((50, 16, 61, 65), "#eab4a6")
        ellipse((98, 14, 109, 65), "#eab4a6")
    elif motif == 5:
        ellipse((27, 44, 59, 110), INK)
        ellipse((101, 44, 133, 110), INK)
    elif motif == 6:
        ellipse((38, 33, 73, 67), coat)
        ellipse((87, 33, 122, 67), coat)
    elif motif == 7:
        polygon([(34, 68), (32, 32), (74, 51)], coat)
        polygon([(86, 51), (128, 32), (126, 68)], coat)
    elif motif == 9:
        line([(80, 43), (80, 24)], INK, 3)
        ellipse((73, 12, 87, 26), accent)
        rounded((25, 66, 42, 96), 5, accent)
        rounded((118, 66, 135, 96), 5, accent)

    if motif == 9:
        rounded((36, 42, 124, 126), 23, coat)
        rounded((46, 56, 114, 104), 14, PAPER)
    else:
        ellipse((34, 42, 126, 132), PAPER if motif == 4 else coat)

    if motif == 1:
        polygon([(36, 80), (79, 98), (69, 128), (44, 115)], PAPER)
        polygon([(124, 80), (81, 98), (91, 128), (116, 115)], PAPER)
    elif motif == 4:
        ellipse((46, 65, 73, 95), INK)
        ellipse((87, 65, 114, 95), INK)
    elif motif == 5:
        ellipse((45, 52, 75, 94), "#f2dfbf")
        ellipse((63, 90, 101, 121), PAPER)
    elif motif == 6:
        ellipse((44, 40, 66, 62), PAPER)
        ellipse((94, 40, 116, 62), PAPER)
    elif motif == 7:
        ellipse((41, 59, 79, 103), PAPER)
        ellipse((81, 59, 119, 103), PAPER)
        polygon([(72, 98), (88, 98), (80, 108)], "#db9b53")
    elif motif == 8:
        ellipse((44, 52, 116, 127), PAPER)
        polygon([(73, 91), (87, 91), (80, 101)], "#db9b53")

    eye_y = 80 if motif != 6 else 52
    eye_x = (59, 101) if motif == 7 else (59, 101) if motif == 6 else (62, 98)
    for index, x in enumerate(eye_x):
        if variant == 2 or variant == 8 and index == 1:
            arc((x - 5, eye_y - 3, x + 5, eye_y + 6), 195, 345, INK, 2.5)
        else:
            ellipse((x - 3, eye_y - 5, x + 3, eye_y + 4), PAPER if motif == 4 else INK)
            if motif == 4:
                ellipse((x - 1.5, eye_y - 2, x + 1.5, eye_y + 3), INK)

    if motif in (0, 1, 2, 3, 4, 5):
        if motif == 3:
            polygon([(76, 96), (84, 96), (80, 101)], "#d88885")
        else:
            ellipse((75, 94, 85, 101), INK)
        line([(80, 100), (80, 105)], INK, 1.5)
        arc((70, 99, 81, 111), 0, 95, INK, 1.5)
        arc((79, 99, 90, 111), 85, 180, INK, 1.5)
    elif motif == 6:
        arc((59, 81, 101, 107), 8, 172, INK, 2)
    elif motif == 9:
        rounded((67, 92, 93, 96), 2, INK)

    if motif == 0:
        line([(41, 96), (28, 93)], INK, 1)
        line([(41, 101), (27, 103)], INK, 1)
        line([(119, 96), (132, 93)], INK, 1)
        line([(119, 101), (133, 103)], INK, 1)
    if motif != 9:
        ellipse((46, 92, 55, 98), "#e8aa9e")
        ellipse((105, 92, 114, 98), "#e8aa9e")

    # Ten independently recognizable variants, beyond palette changes.
    if variant == 0:  # Neckerchief.
        polygon([(62, 130), (99, 130), (85, 145)], accent)
    elif variant == 1:  # Round spectacles.
        for x in eye_x:
            ellipse((x - 11, eye_y - 12, x + 11, eye_y + 11), None, INK, 1.5)
        line([(eye_x[0] + 11, eye_y - 2), (eye_x[1] - 11, eye_y - 2)], INK, 1.5)
    elif variant == 2:  # Little beret.
        ellipse((50, 32, 110, 51), accent)
        rounded((59, 44, 102, 51), 3, accent)
        line([(81, 33), (86, 27)], INK, 2)
    elif variant == 3:  # Flower by the temple.
        for x, y in [(110, 48), (120, 54), (117, 65), (105, 65), (101, 54)]:
            ellipse((x - 5, y - 5, x + 5, y + 5), accent)
        ellipse((105, 52, 117, 64), "#f4d758")
    elif variant == 4:  # Headphones.
        arc((31, 35, 129, 125), 180, 360, accent, 5)
        rounded((29, 75, 42, 102), 6, accent)
        rounded((118, 75, 131, 102), 6, accent)
    elif variant == 5:  # Bow tie.
        polygon([(63, 128), (79, 134), (63, 143)], accent)
        polygon([(97, 128), (81, 134), (97, 143)], accent)
        ellipse((76, 130, 84, 138), INK)
    elif variant == 6:  # Stripe knit cap.
        d.pieslice(box((45, 27, 115, 78)), 180, 360, fill=accent)
        rounded((43, 47, 117, 57), 5, "#f4d758")
        ellipse((74, 19, 86, 31), accent)
    elif variant == 7:  # Three visible freckles and a striped scarf.
        for x in [49, 54, 106, 111]:
            ellipse((x - 1, 92, x + 1, 94), INK)
        rounded((57, 126, 103, 135), 4, accent)
        rounded((90, 129, 101, 151), 3, accent)
        line([(91, 142), (100, 142)], "#f4d758", 3)
    elif variant == 8:  # Star hair clip plus wink.
        polygon([(112, 44), (115, 51), (123, 52), (117, 57), (119, 65), (112, 61), (105, 65), (107, 57), (101, 52), (109, 51)], accent)
    elif variant == 9:  # Small crown.
        polygon([(57, 48), (53, 29), (70, 38), (80, 21), (90, 38), (107, 29), (103, 48)], "#f4d758")
        for x in (66, 80, 94):
            ellipse((x - 2, 40, x + 2, 44), accent)

    image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return image.quantize(colors=96, method=Image.Quantize.MEDIANCUT)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    hashes = set()
    total = 0
    for motif in range(10):
        for palette in range(10):
            for variant in range(10):
                avatar_id = motif * 100 + palette * 10 + variant + 1
                target = OUT / f"{avatar_id:04}.png"
                draw_avatar(motif, palette, variant).save(target, optimize=True)
                data = target.read_bytes()
                digest = hashlib.sha256(data).hexdigest()
                if digest in hashes:
                    raise RuntimeError(f"Duplicate avatar {avatar_id}")
                hashes.add(digest)
                total += len(data)
    if total > 5 * 1024 * 1024:
        raise RuntimeError("Built-in avatar set exceeds 5 MiB")
    print(json.dumps({"count": len(hashes), "width": SIZE, "height": SIZE, "bytes": total, "motifs": MOTIFS}))


if __name__ == "__main__":
    main()
