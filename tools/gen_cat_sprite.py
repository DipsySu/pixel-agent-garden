#!/usr/bin/env python3
"""Generate the garden cat v2 spritesheet.

The source of truth is an 80x56 character grid per cell.  The helper
functions below write authored pixel-art shapes into those grids, then the
renderer maps each character to the locked eight-color palette.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw


FRAME_W = 80
FRAME_H = 56
COLS = 10
ROWS = 3
SHEET_W = FRAME_W * COLS
SHEET_H = FRAME_H * ROWS

ROOT = Path(__file__).resolve().parents[1]
SHEET_PATH = ROOT / "assets/sprites/garden_cat/garden_cat.png"
PREVIEW_DIR = ROOT / "tools/out"

TRANSPARENT = (0, 0, 0, 0)
PALETTE = {
    "b": (0x8B, 0x6A, 0x44, 255),  # coat_base
    "d": (0x3E, 0x2A, 0x18, 255),  # coat_dark
    "l": (0xC4, 0xA4, 0x72, 255),  # coat_light
    "w": (0xE8, 0xDC, 0xC4, 255),  # belly_white
    "e": (0xD4, 0x9A, 0x3A, 255),  # eye_amber
    "n": (0xA8, 0x62, 0x4C, 255),  # nose
    "m": (0x2A, 0x1C, 0x10, 255),  # mouth
    "o": (0x1A, 0x12, 0x08, 255),  # outline
}
EXPECTED_RGBA = {TRANSPARENT, *PALETTE.values()}
NOSE_RGB = PALETTE["n"][:3]
MOUTH_RGB = PALETTE["m"][:3]


PixelSet = set[tuple[int, int]]


@dataclass(frozen=True)
class FrameSpec:
    name: str
    row: int
    col: int
    grid: "AsciiFrame"


class AsciiFrame:
    """A single 80x56 frame represented as palette-index characters."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.pixels = [["." for _ in range(FRAME_W)] for _ in range(FRAME_H)]

    def set(self, x: int, y: int, ch: str) -> None:
        if ch != "." and ch not in PALETTE:
            raise ValueError(f"unknown palette character {ch!r}")
        if 0 <= x < FRAME_W and 0 <= y < FRAME_H:
            self.pixels[y][x] = ch

    def paint(self, pixels: Iterable[tuple[int, int]], ch: str, *, overwrite_outline: bool = False) -> None:
        for x, y in pixels:
            if 0 <= x < FRAME_W and 0 <= y < FRAME_H:
                if not overwrite_outline and self.pixels[y][x] == "o":
                    continue
                self.set(x, y, ch)

    def paint_outline_fill(self, components: list[tuple[PixelSet, str]]) -> PixelSet:
        silhouette: PixelSet = set()
        for pixels, _ in components:
            silhouette |= pixels
        outline = dilate(silhouette) - silhouette
        self.paint(outline, "o", overwrite_outline=True)
        for pixels, ch in components:
            self.paint(pixels, ch, overwrite_outline=False)
        return silhouette

    def crop_image(self) -> Image.Image:
        img = Image.new("RGBA", (FRAME_W, FRAME_H), TRANSPARENT)
        px = img.load()
        for y, row in enumerate(self.pixels):
            for x, ch in enumerate(row):
                if ch != ".":
                    px[x, y] = PALETTE[ch]
        return img

    def nontransparent_bbox(self) -> tuple[int, int, int, int] | None:
        xs: list[int] = []
        ys: list[int] = []
        for y, row in enumerate(self.pixels):
            for x, ch in enumerate(row):
                if ch != ".":
                    xs.append(x)
                    ys.append(y)
        if not xs:
            return None
        return min(xs), min(ys), max(xs), max(ys)


def mask_pixels(draw_fn) -> PixelSet:
    img = Image.new("1", (FRAME_W, FRAME_H), 0)
    draw = ImageDraw.Draw(img)
    draw_fn(draw)
    data = img.load()
    return {(x, y) for y in range(FRAME_H) for x in range(FRAME_W) if data[x, y]}


def ellipse(box: tuple[int, int, int, int]) -> PixelSet:
    return mask_pixels(lambda draw: draw.ellipse(box, fill=1))


def rect(box: tuple[int, int, int, int]) -> PixelSet:
    return mask_pixels(lambda draw: draw.rectangle(box, fill=1))


def polygon(points: list[tuple[int, int]]) -> PixelSet:
    return mask_pixels(lambda draw: draw.polygon(points, fill=1))


def line(points: list[tuple[int, int]], width: int = 1) -> PixelSet:
    return mask_pixels(lambda draw: draw.line(points, fill=1, width=width, joint="curve"))


def dilate(pixels: PixelSet) -> PixelSet:
    out: PixelSet = set()
    for x, y in pixels:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nx = x + dx
                ny = y + dy
                if 0 <= nx < FRAME_W and 0 <= ny < FRAME_H:
                    out.add((nx, ny))
    return out


def draw_inner_ears_right() -> PixelSet:
    return {
        (56, 18),
        (55, 19),
        (56, 19),
        (57, 19),
        (55, 20),
        (56, 20),
        (57, 20),
        (63, 18),
        (62, 19),
        (63, 19),
        (64, 19),
        (62, 20),
        (63, 20),
        (64, 20),
    }


def draw_inner_ears_left() -> PixelSet:
    return {
        (23, 18),
        (22, 19),
        (23, 19),
        (24, 19),
        (22, 20),
        (23, 20),
        (24, 20),
        (16, 18),
        (15, 19),
        (16, 19),
        (17, 19),
        (15, 20),
        (16, 20),
        (17, 20),
    }


EAR_STAMP = (
    ".o.",
    "obo",
    "obo",
)


def paint_ear_pair(g: AsciiFrame, left_center_x: int, right_center_x: int, top_y: int) -> None:
    """Paint the mandatory separated 3x3 ear stamps."""
    if right_center_x - left_center_x < 5:
        raise ValueError("ear centers must leave at least two transparent apex columns")

    for y in range(top_y, top_y + len(EAR_STAMP)):
        for x in range(left_center_x - 1, right_center_x + 2):
            g.set(x, y, ".")

    for center_x in (left_center_x, right_center_x):
        for dy, row in enumerate(EAR_STAMP):
            for dx, ch in enumerate(row):
                if ch != ".":
                    g.set(center_x + dx - 1, top_y + dy, ch)

        g.set(center_x, top_y + len(EAR_STAMP), "o")

    dip_x = (left_center_x + right_center_x) // 2
    if g.pixels[top_y + len(EAR_STAMP)][dip_x] == "o":
        g.set(dip_x, top_y + len(EAR_STAMP), "b")


def right_tail(kind: str, dy: int) -> PixelSet:
    if kind == "up30":
        return line([(25, 36 + dy), (18, 30 + dy), (12, 27 + dy), (9, 28 + dy)], 5)
    if kind == "horizontal":
        return line([(25, 31 + dy), (17, 31 + dy), (10, 29 + dy), (8, 28 + dy)], 5) | rect((8, 26 + dy, 14, 30 + dy))
    if kind == "down10":
        return line([(25, 35 + dy), (17, 38 + dy), (10, 41 + dy), (8, 42 + dy)], 5)
    if kind == "up45":
        return line([(25, 39 + dy), (19, 32 + dy), (15, 26 + dy), (12, 25 + dy)], 5) | rect((12, 23 + dy, 18, 27 + dy))
    raise ValueError(f"unknown right tail kind {kind}")


def left_tail(kind: str, dy: int) -> PixelSet:
    if kind == "up30":
        return line([(55, 36 + dy), (62, 30 + dy), (68, 27 + dy), (71, 29 + dy)], 5)
    if kind == "horizontal":
        return line([(55, 30 + dy), (63, 30 + dy), (70, 28 + dy), (72, 29 + dy)], 5)
    if kind == "down10":
        return line([(55, 35 + dy), (63, 38 + dy), (70, 41 + dy), (72, 43 + dy)], 5)
    if kind == "up45":
        return line([(55, 39 + dy), (61, 32 + dy), (65, 27 + dy), (68, 25 + dy)], 5) | rect((62, 23 + dy, 68, 27 + dy))
    raise ValueError(f"unknown left tail kind {kind}")


RIGHT_LEGS: dict[str, list[tuple[PixelSet, str]]] = {
    "wr1": [
        (line([(56, 39), (56, 47)], 4), "b"),
        (line([(52, 39), (49, 45)], 4), "b"),
        (line([(31, 39), (31, 47)], 5), "b"),
        (line([(27, 39), (21, 46)], 4), "b"),
    ],
    "wr2": [
        (line([(55, 39), (55, 47)], 4), "b"),
        (line([(52, 40), (51, 46)], 3), "b"),
        (line([(32, 39), (32, 47)], 4), "b"),
        (line([(36, 40), (35, 46)], 3), "b"),
    ],
    "wr3": [
        (line([(52, 39), (52, 47)], 4), "b"),
        (line([(57, 39), (62, 45)], 4), "b"),
        (line([(28, 39), (28, 47)], 5), "b"),
        (line([(35, 39), (42, 46)], 4), "b"),
    ],
    "wr4": [
        (line([(55, 37), (63, 47)], 4), "b"),
        (line([(51, 38), (59, 47)], 3), "b"),
        (line([(30, 37), (19, 47)], 4), "b"),
        (line([(35, 37), (25, 47)], 4), "b"),
    ],
    "wr5": [
        (line([(52, 39), (52, 47)], 4), "b"),
        (line([(58, 39), (62, 45)], 3), "b"),
        (line([(28, 39), (28, 47)], 5), "b"),
        (line([(36, 39), (42, 46)], 4), "b"),
    ],
    "wr6": [
        (line([(54, 39), (54, 47)], 4), "b"),
        (line([(50, 40), (51, 46)], 3), "b"),
        (line([(31, 39), (31, 47)], 4), "b"),
        (line([(35, 40), (36, 46)], 3), "b"),
    ],
    "wr7": [
        (line([(56, 39), (56, 47)], 4), "b"),
        (line([(51, 39), (48, 45)], 4), "b"),
        (line([(32, 39), (32, 47)], 5), "b"),
        (line([(27, 39), (21, 46)], 4), "b"),
    ],
    "wr8": [
        (line([(55, 37), (63, 47)], 4), "b"),
        (line([(51, 38), (59, 47)], 3), "b"),
        (line([(30, 37), (19, 47)], 4), "b"),
        (line([(35, 37), (25, 47)], 4), "b"),
    ],
}

LEFT_LEGS: dict[str, list[tuple[PixelSet, str]]] = {
    "wl1": [
        (line([(24, 39), (24, 47)], 4), "b"),
        (line([(28, 40), (31, 45)], 3), "b"),
        (line([(49, 39), (49, 47)], 5), "b"),
        (line([(53, 39), (59, 46)], 4), "b"),
    ],
    "wl2": [
        (line([(25, 39), (25, 47)], 4), "b"),
        (line([(29, 40), (30, 46)], 3), "b"),
        (line([(48, 39), (48, 47)], 4), "b"),
        (line([(44, 40), (45, 46)], 3), "b"),
    ],
    "wl3": [
        (line([(28, 39), (28, 47)], 4), "b"),
        (line([(22, 39), (17, 45)], 4), "b"),
        (line([(52, 39), (52, 47)], 5), "b"),
        (line([(45, 39), (38, 46)], 4), "b"),
    ],
    "wl4": [
        (line([(25, 37), (17, 47)], 4), "b"),
        (line([(29, 38), (21, 47)], 3), "b"),
        (line([(50, 37), (61, 47)], 4), "b"),
        (line([(45, 37), (55, 47)], 4), "b"),
    ],
    "wl5": [
        (line([(28, 39), (28, 47)], 4), "b"),
        (line([(22, 39), (18, 45)], 3), "b"),
        (line([(52, 39), (52, 47)], 5), "b"),
        (line([(44, 39), (38, 46)], 4), "b"),
    ],
    "wl6": [
        (line([(26, 39), (26, 47)], 4), "b"),
        (line([(30, 40), (29, 46)], 3), "b"),
        (line([(49, 39), (49, 47)], 4), "b"),
        (line([(45, 40), (44, 46)], 3), "b"),
    ],
    "wl7": [
        (line([(24, 39), (24, 47)], 4), "b"),
        (line([(29, 39), (32, 45)], 4), "b"),
        (line([(48, 39), (48, 47)], 5), "b"),
        (line([(53, 39), (59, 46)], 4), "b"),
    ],
    "wl8": [
        (line([(25, 37), (17, 47)], 4), "b"),
        (line([(29, 38), (21, 47)], 3), "b"),
        (line([(50, 37), (61, 47)], 4), "b"),
        (line([(45, 37), (55, 47)], 4), "b"),
    ],
}


def draw_right_body(g: AsciiFrame, pose_key: str, tail_kind: str, body_dy: int) -> None:
    tail_pixels = right_tail(tail_kind, body_dy)
    body = ellipse((22, 26 + body_dy, 56, 43 + body_dy))
    head = ellipse((52, 19, 68, 35))
    legs = RIGHT_LEGS[pose_key]
    components: list[tuple[PixelSet, str]] = [(tail_pixels, "b"), (body, "b"), *legs, (head, "b")]
    silhouette = g.paint_outline_fill(components)

    g.paint(ellipse((27, 27 + body_dy, 51, 33 + body_dy)) & body, "l")
    g.paint(ellipse((55, 20, 66, 25)) & head, "l")
    g.paint(ellipse((61, 27, 68, 33)) & head, "w")
    g.paint(ellipse((37, 34 + body_dy, 54, 43 + body_dy)) & body, "w")
    g.paint(rect((52, 46, 57, 48)) & silhouette, "w")
    g.paint(rect((27, 46, 34, 48)) & silhouette, "w")
    g.paint(line([(33, 29 + body_dy), (31, 38 + body_dy)], 2) & body, "d")
    g.paint(line([(40, 28 + body_dy), (39, 39 + body_dy)], 2) & body, "d")
    g.paint(line([(47, 30 + body_dy), (49, 39 + body_dy)], 2) & body, "d")
    g.paint(line([(60, 22), (58, 27)], 1) & head, "d")
    g.paint(line([(64, 23), (62, 28)], 1) & head, "d")
    g.paint(line([(16, 26 + body_dy), (12, 24 + body_dy)], 2) & tail_pixels, "d")

    g.set(63, 26, "e")
    g.set(67, 29, "n")
    g.set(64, 31, "m")
    g.set(65, 31, "m")
    paint_ear_pair(g, 56, 63, 16)


def draw_left_body(g: AsciiFrame, pose_key: str, tail_kind: str, body_dy: int) -> None:
    tail_pixels = left_tail(tail_kind, body_dy)
    body = ellipse((24, 26 + body_dy, 58, 43 + body_dy))
    head = ellipse((12, 19, 28, 35))
    legs = LEFT_LEGS[pose_key]
    components: list[tuple[PixelSet, str]] = [(tail_pixels, "b"), (body, "b"), *legs, (head, "b")]
    silhouette = g.paint_outline_fill(components)

    g.paint(ellipse((30, 28 + body_dy, 54, 34 + body_dy)) & body, "l")
    g.paint(ellipse((14, 21, 25, 26)) & head, "l")
    g.paint(ellipse((12, 27, 19, 33)) & head, "w")
    g.paint(ellipse((25, 34 + body_dy, 43, 43 + body_dy)) & body, "w")
    g.paint(rect((23, 46, 30, 48)) & silhouette, "w")
    g.paint(rect((46, 46, 54, 48)) & silhouette, "w")
    g.paint(line([(48, 29 + body_dy), (50, 38 + body_dy)], 2) & body, "d")
    g.paint(line([(41, 28 + body_dy), (42, 39 + body_dy)], 2) & body, "d")
    g.paint(line([(34, 30 + body_dy), (31, 39 + body_dy)], 2) & body, "d")
    g.paint(line([(20, 22), (22, 27)], 1) & head, "d")
    g.paint(line([(16, 23), (18, 28)], 1) & head, "d")
    g.paint(line([(64, 26 + body_dy), (69, 25 + body_dy)], 2) & tail_pixels, "d")

    g.set(17, 26, "e")
    g.set(13, 29, "n")
    g.set(15, 31, "m")
    g.set(16, 31, "m")
    paint_ear_pair(g, 16, 23, 16)


def make_walk_right(name: str, pose_key: str, tail_kind: str, body_dy: int = 0) -> AsciiFrame:
    g = AsciiFrame(name)
    draw_right_body(g, pose_key, tail_kind, body_dy)
    return g


def make_walk_left(name: str, pose_key: str, tail_kind: str, body_dy: int = 0) -> AsciiFrame:
    g = AsciiFrame(name)
    draw_left_body(g, pose_key, tail_kind, body_dy)
    return g


def make_turn_t1() -> AsciiFrame:
    g = AsciiFrame("T1")
    tail = line([(33, 36), (25, 34), (18, 31), (14, 27)], 5) | rect((12, 26, 18, 30))
    body = ellipse((25, 23, 57, 45))
    haunch = ellipse((20, 29, 42, 47))
    head_back = ellipse((43, 20, 61, 36))
    leg = line([(34, 40), (32, 48)], 5) | line([(49, 39), (51, 48)], 4)
    silhouette = g.paint_outline_fill([(tail, "b"), (haunch, "b"), (body, "b"), (head_back, "b"), (leg, "b")])
    g.paint(ellipse((29, 24, 53, 33)) & body, "l")
    g.paint(line([(37, 25), (36, 37)], 2) & body, "d")
    g.paint(line([(47, 25), (48, 38)], 2) & body, "d")
    g.paint(rect((31, 46, 53, 48)) & silhouette, "w")
    g.paint(ellipse((49, 24, 59, 31)) & head_back, "l")
    g.set(56, 27, "e")
    g.paint(line([(17, 29), (14, 27)], 2) & tail, "d")
    return g


def make_turn_t2() -> AsciiFrame:
    g = AsciiFrame("T2")
    tail = line([(48, 37), (57, 39), (62, 43), (58, 45), (51, 44)], 5)
    body = ellipse((25, 22, 55, 46))
    head_back = ellipse((28, 14, 52, 33))
    paws = rect((31, 42, 49, 46))
    silhouette = g.paint_outline_fill([(tail, "b"), (body, "b"), (head_back, "b"), (paws, "w")])
    g.paint(ellipse((30, 22, 50, 30)) & head_back, "l")
    g.paint(ellipse((31, 25, 49, 42)) & body, "l")
    g.paint(line([(34, 26), (32, 39)], 2) & body, "d")
    g.paint(line([(40, 25), (40, 41)], 2) & body, "d")
    g.paint(line([(46, 26), (48, 39)], 2) & body, "d")
    g.paint(line([(58, 43), (62, 45)], 2) & tail, "d")
    return g


def make_turn_t3() -> AsciiFrame:
    g = AsciiFrame("T3")
    tail = line([(53, 37), (61, 40), (63, 44), (57, 45)], 5)
    body = ellipse((25, 23, 55, 46))
    head = ellipse((27, 14, 53, 36))
    paws = rect((31, 42, 49, 46))
    silhouette = g.paint_outline_fill([(tail, "b"), (body, "b"), (head, "b"), (paws, "w")])
    g.paint(ellipse((31, 15, 49, 23)) & head, "l")
    g.paint(ellipse((33, 33, 47, 46)) & body, "w")
    g.paint(rect((31, 42, 49, 46)) & silhouette, "w")
    g.paint(line([(34, 20), (32, 28)], 1) & head, "d")
    g.paint(line([(46, 20), (48, 28)], 1) & head, "d")
    g.paint(line([(36, 26), (34, 38)], 2) & body, "d")
    g.paint(line([(44, 26), (46, 38)], 2) & body, "d")
    g.set(35, 26, "e")
    g.set(45, 26, "e")
    g.set(40, 29, "n")
    g.set(39, 31, "m")
    g.set(40, 31, "m")
    paint_ear_pair(g, 34, 46, 10)
    return g


def make_turn_t4() -> AsciiFrame:
    g = AsciiFrame("T4")
    tail = line([(55, 34), (63, 31), (68, 27), (70, 24)], 5) | rect((64, 23, 70, 27))
    body = ellipse((24, 27, 58, 44))
    chest = ellipse((18, 25, 38, 45))
    head = ellipse((13, 19, 30, 36))
    legs = line([(27, 39), (22, 47)], 4) | line([(47, 39), (52, 47)], 4)
    silhouette = g.paint_outline_fill([(tail, "b"), (body, "b"), (chest, "w"), (head, "b"), (legs, "b")])
    g.paint(ellipse((31, 28, 53, 34)) & body, "l")
    g.paint(ellipse((16, 20, 27, 25)) & head, "l")
    g.paint(ellipse((13, 29, 21, 35)) & head, "w")
    g.paint(rect((21, 46, 54, 48)) & silhouette, "w")
    g.paint(line([(47, 30), (49, 39)], 2) & body, "d")
    g.paint(line([(39, 29), (39, 39)], 2) & body, "d")
    g.paint(line([(20, 22), (22, 28)], 1) & head, "d")
    g.set(17, 28, "e")
    g.set(14, 31, "n")
    g.set(16, 33, "m")
    g.set(17, 33, "m")
    return g


def make_sit1(name: str = "SIT1", tail_tip_up: bool = False) -> AsciiFrame:
    g = AsciiFrame(name)
    tail_points = [(35, 41), (28, 43), (34, 46), (46, 45), (55, 42)]
    if tail_tip_up:
        tail_points[-1] = (56, 40)
    tail = line(tail_points, 5)
    body = ellipse((27, 23, 54, 47))
    chest = ellipse((45, 29, 60, 46))
    head = ellipse((52, 18, 68, 34))
    paws = rect((47, 42, 60, 46))
    silhouette = g.paint_outline_fill([(tail, "b"), (body, "b"), (chest, "w"), (head, "b"), (paws, "w")])
    g.paint(ellipse((31, 24, 51, 32)) & body, "l")
    g.paint(ellipse((55, 19, 66, 24)) & head, "l")
    g.paint(ellipse((61, 26, 68, 32)) & head, "w")
    g.paint(rect((47, 42, 60, 46)) & silhouette, "w")
    g.paint(line([(35, 26), (33, 39)], 2) & body, "d")
    g.paint(line([(43, 25), (44, 38)], 2) & body, "d")
    g.paint(line([(60, 21), (58, 27)], 1) & head, "d")
    if tail_tip_up:
        g.paint(line([(54, 44), (56, 43)], 1) & tail, "d")
    else:
        g.paint(line([(52, 45), (55, 45)], 1) & tail, "d")
    g.set(63, 25, "e")
    g.set(67, 28, "n")
    g.set(64, 30, "m")
    g.set(65, 30, "m")
    paint_ear_pair(g, 56, 63, 15)
    return g


def make_sleep() -> AsciiFrame:
    g = AsciiFrame("SLEEP")
    tail = line([(27, 42), (22, 37), (25, 32), (33, 31)], 5)
    body = ellipse((22, 29, 58, 48))
    head = ellipse((45, 31, 63, 45))
    paws = ellipse((38, 39, 55, 48))
    silhouette = g.paint_outline_fill([(tail, "b"), (body, "b"), (head, "b"), (paws, "w")])
    g.paint(ellipse((29, 30, 53, 36)) & body, "l")
    g.paint(ellipse((42, 40, 56, 48)) & silhouette, "w")
    g.paint(line([(32, 32), (31, 42)], 2) & body, "d")
    g.paint(line([(40, 31), (41, 42)], 2) & body, "d")
    g.paint(line([(49, 37), (50, 37)], 1) & head, "o", overwrite_outline=True)
    g.paint(line([(55, 38), (56, 38)], 1) & head, "o", overwrite_outline=True)
    return g


def make_stretch() -> AsciiFrame:
    g = AsciiFrame("STRETCH")
    tail = line([(26, 35), (18, 31), (14, 29), (12, 30)], 5)
    body = polygon([(22, 38), (28, 32), (34, 27), (43, 26), (51, 30), (56, 34), (54, 43), (27, 45)])
    head = ellipse((56, 25, 70, 38))
    fore = line([(58, 42), (70, 47)], 3) | line([(55, 42), (66, 47)], 3)
    hind = line([(29, 40), (23, 47)], 5) | line([(36, 40), (31, 47)], 4)
    silhouette = g.paint_outline_fill([(tail, "b"), (body, "b"), (hind, "b"), (fore, "w"), (head, "b")])
    g.paint(ellipse((31, 25, 48, 31)) & body, "l")
    g.paint(ellipse((63, 31, 70, 36)) & head, "w")
    g.paint(rect((61, 45, 71, 47)) & silhouette, "w")
    g.paint(rect((23, 45, 34, 47)) & silhouette, "w")
    g.paint(line([(36, 27), (34, 38)], 2) & body, "d")
    g.paint(line([(44, 27), (46, 39)], 2) & body, "d")
    g.set(64, 30, "e")
    g.set(69, 32, "n")
    g.set(66, 34, "m")
    g.set(67, 34, "m")
    paint_ear_pair(g, 62, 68, 21)
    return g


def make_look_up() -> AsciiFrame:
    g = AsciiFrame("LOOK_UP")
    tail = line([(31, 40), (24, 43), (29, 46), (39, 44)], 5)
    body = ellipse((26, 24, 54, 46))
    chest = ellipse((42, 30, 59, 46))
    head = ellipse((49, 12, 68, 30))
    paws = rect((43, 42, 57, 46))
    silhouette = g.paint_outline_fill([(tail, "b"), (body, "b"), (chest, "w"), (head, "b"), (paws, "w")])
    g.paint(ellipse((30, 25, 50, 32)) & body, "l")
    g.paint(ellipse((53, 13, 65, 18)) & head, "l")
    g.paint(ellipse((57, 18, 66, 25)) & head, "w")
    g.paint(rect((43, 42, 57, 46)) & silhouette, "w")
    g.paint(line([(35, 27), (33, 39)], 2) & body, "d")
    g.paint(line([(44, 26), (44, 39)], 2) & body, "d")
    g.set(57, 20, "e")
    g.set(63, 18, "e")
    g.set(64, 18, "n")
    g.set(61, 20, "m")
    g.set(62, 20, "m")
    paint_ear_pair(g, 54, 63, 8)
    return g


def make_look_dn() -> AsciiFrame:
    g = AsciiFrame("LOOK_DN")
    tail = line([(24, 34), (16, 31), (11, 27), (10, 23)], 5) | rect((9, 24, 15, 28))
    body = ellipse((22, 27, 56, 43))
    head = ellipse((55, 34, 70, 46))
    legs = line([(31, 39), (30, 47)], 4) | line([(38, 39), (38, 47)], 3) | line([(52, 39), (54, 47)], 4) | line([(58, 41), (63, 47)], 3)
    silhouette = g.paint_outline_fill([(tail, "b"), (body, "b"), (legs, "b"), (head, "b")])
    g.paint(ellipse((28, 28, 52, 34)) & body, "l")
    g.paint(ellipse((37, 35, 55, 43)) & body, "w")
    g.paint(ellipse((62, 40, 70, 46)) & head, "w")
    g.paint(rect((29, 45, 64, 47)) & silhouette, "w")
    g.paint(line([(33, 30), (31, 39)], 2) & body, "d")
    g.paint(line([(41, 29), (41, 40)], 2) & body, "d")
    g.paint(line([(49, 30), (51, 39)], 2) & body, "d")
    g.set(63, 39, "e")
    g.set(69, 43, "n")
    g.set(66, 45, "m")
    g.set(67, 45, "m")
    return g


def make_empty(name: str) -> AsciiFrame:
    return AsciiFrame(name)


def build_frames() -> list[FrameSpec]:
    row0 = [
        ("WR1", make_walk_right("WR1", "wr1", "up30", 0)),
        ("WR2", make_walk_right("WR2", "wr2", "horizontal", 0)),
        ("WR3", make_walk_right("WR3", "wr3", "down10", 0)),
        ("WR4", make_walk_right("WR4", "wr4", "up45", -2)),
        ("WR5", make_walk_right("WR5", "wr5", "up30", 0)),
        ("WR6", make_walk_right("WR6", "wr6", "horizontal", 0)),
        ("WR7", make_walk_right("WR7", "wr7", "down10", 0)),
        ("WR8", make_walk_right("WR8", "wr8", "up45", -2)),
        ("EMPTY_R0C8", make_empty("EMPTY_R0C8")),
        ("EMPTY_R0C9", make_empty("EMPTY_R0C9")),
    ]
    row1 = [
        ("WL1", make_walk_left("WL1", "wl1", "up30", 0)),
        ("WL2", make_walk_left("WL2", "wl2", "horizontal", 0)),
        ("WL3", make_walk_left("WL3", "wl3", "down10", 0)),
        ("WL4", make_walk_left("WL4", "wl4", "up45", -2)),
        ("WL5", make_walk_left("WL5", "wl5", "up30", 0)),
        ("WL6", make_walk_left("WL6", "wl6", "horizontal", 0)),
        ("WL7", make_walk_left("WL7", "wl7", "down10", 0)),
        ("WL8", make_walk_left("WL8", "wl8", "up45", -2)),
        ("EMPTY_R1C8", make_empty("EMPTY_R1C8")),
        ("EMPTY_R1C9", make_empty("EMPTY_R1C9")),
    ]
    row2 = [
        ("T1", make_turn_t1()),
        ("T2", make_turn_t2()),
        ("T3", make_turn_t3()),
        ("T4", make_turn_t4()),
        ("SIT1", make_sit1("SIT1")),
        ("SIT2", make_sit1("SIT2", tail_tip_up=True)),
        ("SLEEP", make_sleep()),
        ("STRETCH", make_stretch()),
        ("LOOK_UP", make_look_up()),
        ("LOOK_DN", make_look_dn()),
    ]
    return [
        FrameSpec(name, row_idx, col_idx, grid)
        for row_idx, row in enumerate([row0, row1, row2])
        for col_idx, (name, grid) in enumerate(row)
    ]


def render_sheet(frames: list[FrameSpec]) -> Image.Image:
    sheet = Image.new("RGBA", (SHEET_W, SHEET_H), TRANSPARENT)
    for spec in frames:
        sheet.alpha_composite(spec.grid.crop_image(), (spec.col * FRAME_W, spec.row * FRAME_H))
    return sheet


def save_outputs(frames: list[FrameSpec], sheet: Image.Image) -> None:
    SHEET_PATH.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    for old in PREVIEW_DIR.glob("frame_*.png"):
        old.unlink()

    sheet.save(SHEET_PATH)
    for spec in frames:
        spec.grid.crop_image().save(PREVIEW_DIR / f"frame_{spec.name}.png")


def colors_in(img: Image.Image) -> set[tuple[int, int, int, int]]:
    colors = img.convert("RGBA").getcolors(maxcolors=256)
    if colors is None:
        raise AssertionError("image uses more than 256 colors")
    return {rgba for _, rgba in colors}


def nontransparent_bbox(img: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = img.getchannel("A")
    return alpha.getbbox()


VISIBLE_EAR_FRAMES = {
    "WR1",
    "WR2",
    "WR3",
    "WR4",
    "WR5",
    "WR6",
    "WR7",
    "WR8",
    "WL1",
    "WL2",
    "WL3",
    "WL4",
    "WL5",
    "WL6",
    "WL7",
    "WL8",
    "SIT1",
    "SIT2",
    "LOOK_UP",
    "T3",
    "STRETCH",
}
EXPECTED_EAR_PEAKS: dict[str, tuple[tuple[int, int], ...]] = {
    **{f"WR{idx}": ((56, 16), (63, 16)) for idx in range(1, 9)},
    **{f"WL{idx}": ((16, 16), (23, 16)) for idx in range(1, 9)},
    "SIT1": ((56, 15), (63, 15)),
    "SIT2": ((56, 15), (63, 15)),
    "LOOK_UP": ((54, 8), (63, 8)),
    "T3": ((34, 10), (46, 10)),
    "STRETCH": ((62, 21), (68, 21)),
}
RIGHT_FACE_BBOX = (55, 15, 74, 35)
WALK_TAIL_SPECS = {
    "WR1": ("right", "up30", 0),
    "WR2": ("right", "horizontal", 0),
    "WR3": ("right", "down10", 0),
    "WR4": ("right", "up45", -2),
    "WR5": ("right", "up30", 0),
    "WR6": ("right", "horizontal", 0),
    "WR7": ("right", "down10", 0),
    "WR8": ("right", "up45", -2),
    "WL1": ("left", "up30", 0),
    "WL2": ("left", "horizontal", 0),
    "WL3": ("left", "down10", 0),
    "WL4": ("left", "up45", -2),
    "WL5": ("left", "up30", 0),
    "WL6": ("left", "horizontal", 0),
    "WL7": ("left", "down10", 0),
    "WL8": ("left", "up45", -2),
}


def frame_from_sheet(sheet: Image.Image, spec: FrameSpec) -> Image.Image:
    return sheet.crop(
        (
            spec.col * FRAME_W,
            spec.row * FRAME_H,
            (spec.col + 1) * FRAME_W,
            (spec.row + 1) * FRAME_H,
        )
    )


def nontransparent_runs_on_row(img: Image.Image, y: int) -> list[tuple[int, int]]:
    px = img.convert("RGBA").load()
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for x in range(FRAME_W):
        filled = px[x, y][3] != 0
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            runs.append((start, x - 1))
            start = None
    if start is not None:
        runs.append((start, FRAME_W - 1))
    return runs


PeakCluster = tuple[int, int, int, tuple[int, ...]]


def top_contour(img: Image.Image) -> list[int | None]:
    px = img.convert("RGBA").load()
    contour: list[int | None] = []
    for x in range(FRAME_W):
        top_y: int | None = None
        for y in range(FRAME_H):
            if px[x, y][3] != 0:
                top_y = y
                break
        contour.append(top_y)
    return contour


def find_silhouette_peak_clusters(img: Image.Image) -> list[PeakCluster]:
    contour = top_contour(img)
    candidate_cols: list[tuple[int, int]] = []
    for x in range(4, FRAME_W - 4):
        top_y = contour[x]
        if top_y is None:
            continue
        left_y = contour[x - 4] if contour[x - 4] is not None else FRAME_H
        right_y = contour[x + 4] if contour[x + 4] is not None else FRAME_H
        if top_y <= left_y - 2 and top_y <= right_y - 2:
            candidate_cols.append((x, top_y))

    clusters: list[PeakCluster] = []
    current: list[tuple[int, int]] = []
    for x, top_y in candidate_cols:
        if current and x != current[-1][0] + 1:
            min_y = min(y for _, y in current)
            apex_xs = tuple(px for px, py in current if py == min_y)
            clusters.append((current[0][0], current[-1][0], min_y, apex_xs))
            current = []
        current.append((x, top_y))

    if current:
        min_y = min(y for _, y in current)
        apex_xs = tuple(px for px, py in current if py == min_y)
        clusters.append((current[0][0], current[-1][0], min_y, apex_xs))

    return clusters


def canonical_ear_stamp_matches(img: Image.Image, center_x: int, top_y: int) -> bool:
    if center_x - 1 < 0 or center_x + 1 >= FRAME_W or top_y < 0 or top_y + len(EAR_STAMP) > FRAME_H:
        return False

    expected = {
        ".": None,
        "o": PALETTE["o"],
        "b": PALETTE["b"],
    }
    px = img.convert("RGBA").load()
    for dy, row in enumerate(EAR_STAMP):
        for dx, ch in enumerate(row):
            rgba = px[center_x + dx - 1, top_y + dy]
            wanted = expected[ch]
            if wanted is None:
                if rgba[3] != 0:
                    return False
            elif rgba != wanted:
                return False
    return True


def describe_peak_cluster(cluster: PeakCluster) -> str:
    start_x, end_x, top_y, apex_xs = cluster
    return f"x={start_x}..{end_x}, y={top_y}, apex={list(apex_xs)}"


def validate_silhouette_anti_ambiguity(frames: list[FrameSpec], sheet: Image.Image) -> None:
    for spec in frames:
        frame = frame_from_sheet(sheet, spec)
        clusters = find_silhouette_peak_clusters(frame)
        expected_ears = EXPECTED_EAR_PEAKS.get(spec.name, ())
        matched_ears: set[tuple[int, int]] = set()
        non_ear_peaks: list[PeakCluster] = []

        for cluster in clusters:
            _start_x, _end_x, top_y, apex_xs = cluster
            matched: tuple[int, int] | None = None
            if len(apex_xs) == 1:
                apex_x = apex_xs[0]
                for center_x, expected_top_y in expected_ears:
                    if (
                        apex_x == center_x
                        and top_y == expected_top_y
                        and canonical_ear_stamp_matches(frame, center_x, expected_top_y)
                    ):
                        matched = (center_x, expected_top_y)
                        break

            if matched is None:
                non_ear_peaks.append(cluster)
            else:
                matched_ears.add(matched)

        missing_ears = [ear for ear in expected_ears if ear not in matched_ears]
        if non_ear_peaks or missing_ears or len(clusters) != len(expected_ears):
            peak_summary = ", ".join(describe_peak_cluster(cluster) for cluster in clusters) or "none"
            non_ear_summary = ", ".join(describe_peak_cluster(cluster) for cluster in non_ear_peaks) or "none"
            raise AssertionError(
                f"{spec.name} silhouette anti-ambiguity failed; "
                f"expected canonical ears={list(expected_ears)}, peaks={peak_summary}, "
                f"non-ear peaks={non_ear_summary}, missing ears={missing_ears}"
            )


def validate_ear_shapes(frames: list[FrameSpec], sheet: Image.Image) -> None:
    expected = {
        ".": None,
        "o": PALETTE["o"],
        "b": PALETTE["b"],
    }
    for spec in frames:
        if spec.name not in VISIBLE_EAR_FRAMES:
            continue

        frame = frame_from_sheet(sheet, spec)
        bbox = nontransparent_bbox(frame)
        if bbox is None:
            raise AssertionError(f"{spec.name} is empty; expected visible ears")

        top_y = bbox[1]
        if top_y + len(EAR_STAMP) >= FRAME_H:
            raise AssertionError(f"{spec.name} ear stamp is too close to frame bottom")

        px = frame.convert("RGBA").load()
        apex_runs = nontransparent_runs_on_row(frame, top_y)
        if len(apex_runs) != 2:
            raise AssertionError(f"{spec.name} ear apex row must have exactly two separated runs, found {apex_runs}")
        if any(start != end for start, end in apex_runs):
            raise AssertionError(f"{spec.name} ear apexes must be one outline pixel each, found {apex_runs}")

        left_center = apex_runs[0][0]
        right_center = apex_runs[1][0]
        if right_center - left_center - 1 < 2:
            raise AssertionError(f"{spec.name} ear apex gap is less than 2 transparent columns")
        if px[left_center, top_y] != PALETTE["o"] or px[right_center, top_y] != PALETTE["o"]:
            raise AssertionError(f"{spec.name} ear apex pixels must use outline color")

        for center_x in (left_center, right_center):
            for dy, row in enumerate(EAR_STAMP):
                for dx, ch in enumerate(row):
                    x = center_x + dx - 1
                    rgba = px[x, top_y + dy]
                    wanted = expected[ch]
                    if wanted is None:
                        if rgba[3] != 0:
                            raise AssertionError(f"{spec.name} ear stamp expected transparent at {(x, top_y + dy)}")
                    elif rgba != wanted:
                        raise AssertionError(f"{spec.name} ear stamp expected {ch!r} at {(x, top_y + dy)}, found {rgba}")
            if px[center_x, top_y + len(EAR_STAMP)] != PALETTE["o"]:
                raise AssertionError(f"{spec.name} head outline must sit immediately below ear base at x={center_x}")

        gap_cols = range(left_center + 2, right_center - 1)
        if not gap_cols:
            raise AssertionError(f"{spec.name} ear stamps do not leave a middle/base gap")
        for y in (top_y + 1, top_y + 2):
            if not any(px[x, y][3] == 0 for x in gap_cols):
                raise AssertionError(f"{spec.name} ear gap row y={y} has no transparent column")

        inter_ear_cols = range(left_center + 1, right_center)
        if not any(px[x, top_y + 3][3] == 0 or px[x, top_y + 3] == PALETTE["b"] for x in inter_ear_cols):
            raise AssertionError(f"{spec.name} head top is a flat outline bar between ears")


def validate_mouth_region(wr1: Image.Image) -> None:
    bbox = nontransparent_bbox(wr1)
    if bbox is None:
        raise AssertionError("WR1 is empty")
    x0, y0, x1, y1 = bbox
    region_top = max(y0, y1 - 24)
    nose_pixels: list[tuple[int, int]] = []
    mouth_pixels: list[tuple[int, int]] = []
    px = wr1.convert("RGBA").load()
    for y in range(region_top, y1 + 1):
        for x in range(x0, x1 + 1):
            rgb = px[x, y][:3]
            if rgb == NOSE_RGB:
                nose_pixels.append((x, y))
            elif rgb == MOUTH_RGB:
                mouth_pixels.append((x, y))
    if len(nose_pixels) + len(mouth_pixels) > 4:
        raise AssertionError(f"WR1 nose+mouth has {len(nose_pixels) + len(mouth_pixels)} pixels")
    if len(nose_pixels) != 1:
        raise AssertionError(f"WR1 must have exactly one nose pixel, found {len(nose_pixels)}")
    if len(mouth_pixels) not in {1, 2}:
        raise AssertionError(f"WR1 mouth must have 1-2 pixels, found {len(mouth_pixels)}")
    mouth_rows = {y for _, y in mouth_pixels}
    if len(mouth_rows) != 1:
        raise AssertionError("WR1 mouth pixels must be horizontal on one row")
    mouth_xs = sorted(x for x, _ in mouth_pixels)
    if mouth_xs != list(range(mouth_xs[0], mouth_xs[0] + len(mouth_xs))):
        raise AssertionError("WR1 mouth pixels must be horizontally adjacent")
    nose_y = nose_pixels[0][1]
    mouth_y = next(iter(mouth_rows))
    if mouth_y - nose_y < 2:
        raise AssertionError("WR1 nose and mouth must have at least one blank row between them")
    for x in range(min(mouth_xs[0], nose_pixels[0][0]), max(mouth_xs[-1], nose_pixels[0][0]) + 1):
        if px[x, nose_y + 1][:3] in {NOSE_RGB, MOUTH_RGB}:
            raise AssertionError("WR1 separator row contains nose or mouth pixels")


def validate_face_consistency(sheet: Image.Image) -> None:
    x0, y0, x1, y1 = RIGHT_FACE_BBOX
    base_region = sheet.crop((x0, y0, x1, y1)).tobytes()
    for col in range(1, 8):
        frame_region = sheet.crop((col * FRAME_W + x0, y0, col * FRAME_W + x1, y1)).tobytes()
        if frame_region != base_region:
            raise AssertionError(f"WR{col + 1} face region differs byte-for-byte from WR1")


def points_for_colors(img: Image.Image, colors: set[tuple[int, int, int, int]]) -> PixelSet:
    out: PixelSet = set()
    px = img.convert("RGBA").load()
    for y in range(img.height):
        for x in range(img.width):
            if px[x, y] in colors:
                out.add((x, y))
    return out


def validate_left_not_mirror(sheet: Image.Image) -> None:
    for idx in range(8):
        wr = sheet.crop((idx * FRAME_W, 0, (idx + 1) * FRAME_W, FRAME_H))
        wl = sheet.crop((idx * FRAME_W, FRAME_H, (idx + 1) * FRAME_W, FRAME_H * 2))
        if wr.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes() == wl.tobytes():
            raise AssertionError(f"WL{idx + 1} is a direct mirror of WR{idx + 1}")


def walk_body_back_pixels(side: str, body_dy: int) -> PixelSet:
    if side == "right":
        body = ellipse((22, 26 + body_dy, 56, 43 + body_dy))
    elif side == "left":
        body = ellipse((24, 26 + body_dy, 58, 43 + body_dy))
    else:
        raise ValueError(f"unknown walk side {side}")
    return dilate(body)


def walk_tail_render_pixels(side: str, tail_kind: str, body_dy: int) -> PixelSet:
    if side == "right":
        tail = right_tail(tail_kind, body_dy)
    elif side == "left":
        tail = left_tail(tail_kind, body_dy)
    else:
        raise ValueError(f"unknown walk side {side}")
    return dilate(tail)


def top_y_from_rendered_mask(frame: Image.Image, mask: PixelSet, label: str) -> int:
    px = frame.convert("RGBA").load()
    ys = [y for x, y in mask if px[x, y][3] != 0]
    if not ys:
        raise AssertionError(f"{label} mask has no rendered pixels")
    return min(ys)


def validate_tail_height_budget(frames: list[FrameSpec], sheet: Image.Image) -> None:
    frame_by_name = {spec.name: spec for spec in frames}
    for name, (side, tail_kind, body_dy) in WALK_TAIL_SPECS.items():
        spec = frame_by_name[name]
        frame = frame_from_sheet(sheet, spec)
        back_top_y = top_y_from_rendered_mask(frame, walk_body_back_pixels(side, body_dy), f"{name} back")
        tail_top_y = top_y_from_rendered_mask(frame, walk_tail_render_pixels(side, tail_kind, body_dy), f"{name} tail")
        relation = back_top_y - tail_top_y

        if relation > 3:
            raise AssertionError(f"{name} tail is {relation}px above back, max is 3px")

        step = int(name[-1])
        if step in {1, 5} and relation != 1:
            raise AssertionError(f"{name} tail should be +1px above back, got {relation}px")
        if step in {2, 6} and relation != 0:
            raise AssertionError(f"{name} tail should be level with back, got {relation}px")
        if step in {3, 7} and relation >= 0:
            raise AssertionError(f"{name} tail should be below back, got {relation}px")
        if step in {4, 8} and not (1 <= relation <= 3):
            raise AssertionError(f"{name} tail-up hop frame should be 1-3px above back, got {relation}px")


def validate_empty_cells(sheet: Image.Image) -> None:
    for row, col in [(0, 8), (0, 9), (1, 8), (1, 9)]:
        cell = sheet.crop((col * FRAME_W, row * FRAME_H, (col + 1) * FRAME_W, (row + 1) * FRAME_H))
        if any(cell.getchannel("A").tobytes()):
            raise AssertionError(f"empty cell r{row}c{col} is not transparent")


def validate_frame_geometry(frames: list[FrameSpec]) -> None:
    for spec in frames:
        bbox = spec.grid.nontransparent_bbox()
        if spec.name.startswith("EMPTY"):
            if bbox is not None:
                raise AssertionError(f"{spec.name} should be fully transparent")
            continue
        if bbox is None:
            raise AssertionError(f"{spec.name} is empty")
        _min_x, min_y, _max_x, max_y = bbox
        if min_y < 4:
            raise AssertionError(f"{spec.name} violates the 4 px sky margin")
        if max_y > 49:
            raise AssertionError(f"{spec.name} extends too far below the y=48 ground line")


def validate_outputs(frames: list[FrameSpec], sheet: Image.Image) -> None:
    if sheet.size != (SHEET_W, SHEET_H):
        raise AssertionError(f"sheet size is {sheet.size}, expected {(SHEET_W, SHEET_H)}")
    if sheet.mode != "RGBA":
        raise AssertionError(f"sheet mode is {sheet.mode}, expected RGBA")
    used = colors_in(sheet)
    if used != EXPECTED_RGBA:
        raise AssertionError(f"palette mismatch: {sorted(used)}")
    validate_empty_cells(sheet)
    validate_mouth_region(sheet.crop((0, 0, FRAME_W, FRAME_H)))
    validate_ear_shapes(frames, sheet)
    validate_silhouette_anti_ambiguity(frames, sheet)
    validate_tail_height_budget(frames, sheet)
    validate_face_consistency(sheet)
    validate_left_not_mirror(sheet)
    validate_frame_geometry(frames)
    previews = sorted(PREVIEW_DIR.glob("frame_*.png"))
    if len(previews) != len(frames):
        raise AssertionError(f"expected {len(frames)} previews, found {len(previews)}")
    for preview in previews:
        img = Image.open(preview)
        if img.size != (FRAME_W, FRAME_H) or img.mode != "RGBA":
            raise AssertionError(f"{preview} has invalid size/mode {img.size} {img.mode}")
        if not colors_in(img).issubset(EXPECTED_RGBA):
            raise AssertionError(f"{preview} uses colors outside the locked palette")


def main() -> None:
    frames = build_frames()
    if len(frames) != COLS * ROWS:
        raise AssertionError(f"expected {COLS * ROWS} grid cells, found {len(frames)}")
    sheet = render_sheet(frames)
    save_outputs(frames, sheet)
    saved = Image.open(SHEET_PATH).convert("RGBA")
    validate_outputs(frames, saved)
    print(f"wrote {SHEET_PATH.relative_to(ROOT)}")
    print(f"wrote {len(frames)} previews to {PREVIEW_DIR.relative_to(ROOT)}")
    print("validation passed")


if __name__ == "__main__":
    main()
