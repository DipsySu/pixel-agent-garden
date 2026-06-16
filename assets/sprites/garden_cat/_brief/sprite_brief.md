# Garden cat spritesheet v2 — generation brief

> Target audience: Codex (gpt-5.5 xhigh). You will write a Python generator
> + run it + save a PNG. Be precise about pixel counts; pixel art has no
> room for "around 5 pixels".

## Goal

Produce a new pixel art spritesheet to replace the current
`assets/sprites/garden_cat/garden_cat_walk.png`, which is too small in
scope (right-walk only, 8 frames) and has a visually broken mouth that
reads as an awkward bulge on the cat's face.

ROOT CAUSE of the broken mouth in v1: too many pixels (~5-7) crowded into
the nose+mouth region; they blob together at the 80×56 frame size.

HARD CONSTRAINT for v2: nose ≤1 px, mouth 1-2 px **horizontally adjacent**,
with **at least 1 fully blank row of `outline` or `belly_white` between
the nose and the mouth**. No diagonal pixels on the mouth. Total
nose+mouth pixel count MUST be ≤ 4.

## Output file format

- Path: `assets/sprites/garden_cat/garden_cat.png`  (new file — do NOT overwrite v1)
- Size: **800 × 168 px**, RGBA, 8-bit color
- Background: fully transparent (alpha = 0)
- No antialiasing, no smoothing — every pixel either belongs to the
  palette or is fully transparent
- Saved with PIL's default PNG encoder is fine. Do not use lossy compression.

## Grid layout (10 columns × 3 rows, each cell exactly 80×56)

```
                col 0     col 1     col 2     col 3     col 4     col 5     col 6     col 7     col 8     col 9
row 0  y=  0    WR1       WR2       WR3       WR4       WR5       WR6       WR7       WR8       (empty)   (empty)
row 1  y= 56    WL1       WL2       WL3       WL4       WL5       WL6       WL7       WL8       (empty)   (empty)
row 2  y=112    T1        T2        T3        T4        SIT1      SIT2      SLEEP     STRETCH   LOOK_UP   LOOK_DN
```

Empty cells must be fully transparent (alpha 0 throughout).

## Palette (lock to these 8 colors — no in-betweens, no antialias halos)

| name         | hex      | role                                   |
|--------------|----------|----------------------------------------|
| coat_base    | #8b6a44  | main fur body (largest fill)           |
| coat_dark    | #3e2a18  | tabby stripes (3-4 per body)           |
| coat_light   | #c4a472  | back / head top highlight              |
| belly_white  | #e8dcc4  | belly + paws + chin underside          |
| eye_amber    | #d49a3a  | open eyes (1 px each)                  |
| nose         | #a8624c  | nose tip (1 px)                        |
| mouth        | #2a1c10  | mouth line (1-2 px, NOT diagonal)      |
| outline      | #1a1208  | full silhouette outline (1 px ring)    |

Validation: `PIL.Image.getcolors(maxcolors=256)` on the final image must
return exactly these 8 RGB tuples (plus the transparent background).

## Per-frame specifications

### Geometry conventions for all frames

- Frame size: 80 × 56 px
- Ground line (bottom of feet): y = 48 inside the frame
- Cat horizontal center: x ≈ 40 (varies slightly per pose)
- Sky/air margin (top of head to top of frame): ≥ 4 px (room for hop)
- Visible bbox per frame: roughly 60-72 px wide × 32-40 px tall

### Row 0 / walk_right (8 frames)

Cat profile facing **right** (head at higher x).
8-frame walk cycle. Faces are identical across all 8 frames (changes are
in legs/tail/body only). This lets us reuse face placement.

| frame | front legs               | back legs               | tail height (px above back-line) | body Δy |
|-------|--------------------------|-------------------------|---------------------------------|---------|
| WR1   | L-fore lifted, R-fore on ground | R-hind on ground, L-hind back   | **+1 px** (subtle lift) | 0       |
| WR2   | passing (both legs close, body forward) | passing            | **0 px** (level)        | 0       |
| WR3   | R-fore lifted, L-fore on ground | L-hind on ground, R-hind back   | **-1 px** (subtle drop) | 0       |
| WR4   | both fore stretched forward    | both hind pushed back  | **+3 px** (visible up)  | **-2**  |
| WR5   | mirror of WR1 leg cycle  | (continued cycle)       | **+1 px**                | 0       |
| WR6   | passing                  | passing                 | **0 px**                 | 0       |
| WR7   | mirror of WR3 leg cycle  | (continued cycle)       | **-1 px**                | 0       |
| WR8   | extended push-off (= WR4 again) | extended back legs  | **+3 px**                | -2      |

CRITICAL — tail height budget: the **topmost tail pixel** in any frame
must be at most **3 px above** the topmost back-line pixel (the back's
silhouette at its highest point in that frame, EXCLUDING the head and
ears). The current v1 sprite violates this: WR1's tail-tip sits 4 px
above the back, which makes the tail read as a SECOND PAIR OF EARS
sticking up from the cat's rump. Verify this in the validator.

### Ear shape — MANDATORY ASCII spec (this overrides any prior "3×3" or
"4×4" wording elsewhere in this brief)

The current v1 sprite drew the ears as a single 1-row strip of outline
pixels that merged into the head-top — they were unrecognizable as
ears. The fix: each ear must be a **3 wide × 3 tall** filled triangle
that visibly protrudes above the head silhouette.

For walk_right / walk_left / sit / look_up / turn-T3 frames, each ear
must render EXACTLY as this 3×3 stamp (`.` = transparent, `o` = outline,
`b` = coat_base):

```
ear row 0 (top, apex)    : . o .
ear row 1 (middle)       : o b o
ear row 2 (base on head) : o b o
```

Placement rules:

1. **Both ears sit on the same `ear_top` y-coordinate**, with their
   3-row vertical extent fully ABOVE the curve of the head outline.
2. **Between the two ears** there must be at least **2 columns** of
   `.` (transparent) at the apex row, and at least **1 column** of
   `.` at the middle and base rows. So the inner edges of the two
   3×3 triangles never touch.
3. The pixel **immediately below each ear's base** (at y = ear_top+3)
   should be `outline` (the head's top silhouette) — meaning the
   head's top curves DOWNWARD between the two ears, creating a
   visible "head dip" between them. If the row at y = ear_top+3
   reads as a flat `############` across the inter-ear gap, the
   ears are not protruding enough — fix it.

This is non-negotiable. The validator must enforce it (see "Self-validation"
below for the exact check).

### Face details (consistent across WR1..WR8)

- Two ears as specified above
- Single amber pixel for the (right-facing) visible eye
- Nose: 1 px `nose`-colored pixel at the snout tip
- Mouth: 1-2 px horizontal `mouth` line, **placed 2 rows below the nose**,
  separated by at least 1 row of `outline` or `belly_white`
- Optional 1-px whiskers (×2 each side of the nose) using `outline`,
  but only if they don't crowd the mouth

### Row 1 / walk_left (8 frames)

Cat profile facing **left**. Hand-draw — DO NOT programmatically flip
Row 0. Reasons:
1. Tabby stripes should flow leftward on left-facing frames (the dark
   bands run from the back down the body in the direction of motion).
2. The visible eye is now on the left side of the face.
3. The shadow / belly-white asymmetry should subtly differ.

Frame poses correspond 1:1 to WR1..WR8 but mirrored about the body's
vertical axis.

### Row 2 / cols 0-3 / turn sequence (4 frames)

Used when the cat changes direction (right → left). Replaces the
unfortunate `scaleX(-1)` mirror flip we currently rely on.

| frame | pose                                                                                 |
|-------|--------------------------------------------------------------------------------------|
| T1    | **3/4 view from rear-right**. Cat seen from behind-right. Tail visible curving left. One eye visible peeking back. |
| T2    | **Full rear / seated**. Back of cat fully facing camera. Both ears visible from behind, tail curled to one side. NO face shown. |
| T3    | **Front view, seated**. Cat facing camera, both eyes + nose + 2-px mouth visible. THIS IS THE MOST DETAILED FACE frame in the sheet. Also used for hover state. |
| T4    | **3/4 view from front-left**. Front-left 3/4 view, cat half-rising, preparing to walk left. One eye visible (left side). |

### Row 2 / cols 4-9 / idle poses (6 frames)

| frame    | description                                                                   |
|----------|-------------------------------------------------------------------------------|
| SIT1     | Seated profile, facing right, tail wrapped around front paws like a curled ribbon. |
| SIT2     | Same body/pose as SIT1, **only the tail tip 1-2 px is raised** (used to alternate with SIT1 for a tail flick). |
| SLEEP    | Curled prone, side-lying, head tucked into front paws. Eyes closed = 1 px `outline` horizontal line each. |
| STRETCH  | Classic "play-bow": front paws stretched **forward** on the ground (low, in line with the cat's facing direction), rear-end raised. The raised rump must NOT be a sharp triangle — see "Silhouette anti-ambiguity" below. |
| LOOK_UP  | Seated, head tilted upward (chin raised), both ears alert (slightly forward). Both eyes visible. |
| LOOK_DN  | Standing 4-legged, head LOW (nose near ground sniffing). Body silhouette mostly horizontal. |

## Generator script

Save to `tools/gen_cat_sprite.py`. Approach:

1. Define each frame as either:
   - an **ASCII grid** of single characters mapping to palette indices
     (e.g. `'.'` = transparent, `'o'` = outline, `'b'` = coat_base, etc.)
     so a human can audit the pose by reading the ASCII
   - or a Python data structure listing pixel coordinates per color
2. Render each cell into the master 800×168 canvas using PIL.
3. Save the final PNG.
4. Also save per-frame previews (each 80×56 PNG) into `tools/out/` so
   reviewers can spot-check individual poses without slicing the master.

The script must be **idempotent**: running it twice produces identical output.

## Self-validation (run inside the script, fail loudly if violated)

All checks below MUST run on the final saved sheet. The generator should
assert each one and exit non-zero on any violation.

### 1. Format checks
```python
img = Image.open('assets/sprites/garden_cat/garden_cat.png')
assert img.size == (800, 168)
assert img.mode == 'RGBA'
```

### 2. Palette lock
Only the 8 listed RGBs (plus fully-transparent) may appear:
```python
allowed = {COAT_BASE, COAT_DARK, COAT_LIGHT, BELLY_WHITE,
           EYE_AMBER, NOSE, MOUTH, OUTLINE}
for r, c in img.convert('RGBA').getcolors(maxcolors=2**16):
    if c[3] == 0:
        continue  # transparent ok
    assert c[:3] in allowed, f"forbidden color {c}"
```

### 3. Mouth pixel budget (WR1)
WR1 nose + mouth combined ≤ 4 px in the face region.

### 4. Ear-shape check — MANDATORY (new for v2)

For every frame that is supposed to have visible ears (WR1..WR8,
WL1..WL8, SIT1, SIT2, LOOK_UP, T3, STRETCH — but NOT T2 rear-view,
SLEEP, LOOK_DN), the validator must:

```python
# Find the topmost non-transparent y in the frame's bbox.
# At that y, scan the row left-to-right. There MUST be:
#   - a run of 1 outline pixel (apex of left ear)
#   - then ≥2 transparent columns
#   - then a run of 1 outline pixel (apex of right ear)
# At y = top + 3 (the row right below the ear bases), there MUST be
# at least 1 transparent OR coat-base pixel in the inter-ear column
# range — meaning the head dips between the ears, not flat.
```

If the topmost row of a frame contains a single continuous run of
non-transparent pixels (no gap between the two ear apexes), the ears
have not protruded enough and the check FAILS. This is exactly the
failure mode of v1.

### 5. Tail height budget — MANDATORY (new for v2)

For every walk frame (WR1..WR8, WL1..WL8):

```python
# 'back_top_y' = lowest y (i.e. highest point) of the back silhouette,
#   measured from the body region only (exclude head and ears, which
#   are above and to one side; exclude tail).
# 'tail_top_y' = lowest y of the tail tip.
# REQUIRED: back_top_y - tail_top_y <= 3
#   (tail tip sits at most 3 px above the back-line)
```

For WR4 / WR8 / WL4 / WL8 (the "+3 px tail-up hop frames"), this is the
maximum (exactly +3 is OK). For WR1 / WR5 / WL1 / WL5, it should be +1.
For WR3 / WR7 / WL3 / WL7, the tail should be BELOW the back-line
(tail_top_y >= back_top_y + 1).

### 6. Face consistency across WR1..WR8
The face region (head 80%) should be **byte-identical** across all 8
walk_right frames — body/legs/tail change, face does not.

### 7. Silhouette anti-ambiguity — MANDATORY (new for v2.3)

A body part (tail tip, raised rump, extended paw) MUST NOT be drawn
with a silhouette confusable with the ear stamp. The ear stamp is a
3-wide × 3-tall isolated triangle with a 1-px apex (`.o./obo/obo`).
The validator below rejects any other "ear-shaped peak" in the frame:

```python
# For each frame in (WR1..WR8, WL1..WL8, T1, T2, T4, SIT1, SIT2,
# SLEEP, STRETCH, LOOK_UP, LOOK_DN — i.e. ALL non-T3 frames):
#
# 1. Compute the top-contour: for each x in the frame, the smallest
#    y where alpha > 0.
# 2. Find every "peak" — a column whose top y is at least 2 less than
#    BOTH the column 4 to its left AND the column 4 to its right
#    (i.e. an isolated bump rising at least 2 px above the surrounding
#    silhouette over a 9-px window).
# 3. For each peak:
#    - If the frame is one of the ear-bearing frames (WR1..WR8,
#      WL1..WL8, SIT1, SIT2, LOOK_UP, T3, STRETCH), then EXACTLY
#      TWO peaks are allowed, and they must be the head's two ears
#      (matched against the canonical 3×3 ear stamp using exact
#      pixel-match within the frame's expected head x-range).
#    - If the frame is one of (T1, T2, T4, SLEEP, LOOK_DN), then
#      ZERO ear-shaped peaks are allowed.
# 4. Any peak that is NOT a canonical ear stamp at the head's
#    position is a violation. STRETCH's raised rump in v2 was
#    flagged here — it had an isolated 3-wide × 3-tall bump on the
#    rear that read as a second pair of ears. The fix is to draw
#    raised body parts as a wide gentle curve (top-contour bump
#    spanning ≥5 px horizontally with ≤1 px vertical rise per column).
```

In short: only the head may have ear-shaped peaks. Any other lifted
body element must rise gently (≤1 px per column of contour) over
≥5 columns, not in a sharp 3-px-wide spike.

If any check fails, fix the generator and re-run. Do not ship a sheet
that fails its own validator.

## What you must NOT touch

- ❌ Any `.js`, `.html`, `.css`, `.rs` file. UI integration is Claude's job.
- ❌ `assets/sprites/ivy_courtyard_manifest.json` (Claude will register the
  new sprite after review).
- ❌ The v1 file `garden_cat_walk.png` — leave it for safety/comparison.
- ❌ Git commits — leave everything in working tree for human review.

## Deliverables checklist (mark done in your final report)

- [ ] `tools/gen_cat_sprite.py` (idempotent generator)
- [ ] `assets/sprites/garden_cat/garden_cat.png` (800×168 RGBA, palette-locked)
- [ ] `tools/out/frame_*.png` (28 per-frame previews: 8 WR + 8 WL + 12 row 2)
- [ ] `assets/sprites/garden_cat/_brief/report.md` (your final report:
      what you generated, any deviations from spec with reasons, and how
      to re-run the generator)
- [ ] Self-validation passed (mouth pixel budget, palette lock, image size)
