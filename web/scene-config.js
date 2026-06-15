export const CONFIG = {
    // Pavilion size tier, by max single-project tokens
    pavilion: { full: 100_000_000, mid: 10_000_000 },           // anything below mid → 'small'

    // Cherry blossom state, by total recent_activity across projects
    cherry:   { petal: 100_000, bloom: 15_000 },                // below bloom → 'bud'

    // Willow becomes 'mature' when EITHER condition holds
    willow:   { mature_tokens: 10_000_000, mature_projects: 5 },

    // Stone-cat statue tier, by total sessions across projects.
    // (Previously called "shrine" — see addCourtyardObjects for the sprite
    // fallback so older shrine assets keep rendering until cat sprites land.)
    stone_cat: { full: 20, small: 4 },                           // below small → 'hidden'

    // Stool / cushion, by max single-project stage (1..6)
    stool:    { min_stage: 3 },
    cushion:  { min_stage: 4 },

    // Lamp is 'lit' if anything happened today
    // (no threshold tuning — strictly today-activity > 0)

    // Pavilion trinkets. slot.x / slot.y are % inside the pavilion's INTERIOR
    // bounding box (defined below), so they follow pavilion size changes.
    // w is the trinket's diameter in 680-unit scene coordinates.
    // file: sprite path under assets/sprites/.
    // Slots re-tuned (2026-06) after an adversarial layout review: the old
    // center/seat slots collided with the stool+cushion (incense/sleeping_cat
    // sat ON the seat; scroll dropped onto the cushion in the short small/mid
    // interiors; tea_set hit the stool at mid). New layout keeps the seat
    // (interior center, ~x50 y96) clear and arranges trinkets around it:
    //   rear wall: scroll (high center)        eave: wind_chime (high right)
    //   left shelf/floor: tea_set, incense     right: lucky_cat, sleeping_cat
    // Widths bumped ~1.35× for legibility at 1× scale (a larger bump was
    // rejected — it re-introduced overlaps). Verified collision-free against
    // the stool/cushion and pairwise across small/mid/full and 1..6 unlocks.
    pavilionTrinkets: [
      { id: 'scroll',       threshold:   1_000_000, slot: { x: 50, y: 12 }, w: 11, name: '挂卷',     hint: '百万 token · 后墙挂卷',     file: 'pavilion_trinkets/trinket_scroll.png' },
      { id: 'tea_set',      threshold:  10_000_000, slot: { x: 16, y: 72 }, w: 18, name: '茶具',     hint: '千万 token · 案前茶具',     file: 'pavilion_trinkets/trinket_tea_set.png' },
      { id: 'lucky_cat',    threshold:  50_000_000, slot: { x: 88, y: 62 }, w: 14, name: '招财猫',   hint: '5 千万 token · 角落石猫',   file: 'pavilion_trinkets/trinket_lucky_cat.png' },
      { id: 'wind_chime',   threshold: 100_000_000, slot: { x: 86, y: 14 }, w: 10, name: '风铃',     hint: '亿 token · 檐下风铃',       file: 'pavilion_trinkets/trinket_wind_chime.png' },
      { id: 'incense',      threshold: 200_000_000, slot: { x: 14, y: 92 }, w: 14, name: '香炉',     hint: '两亿 token · 案上香炉',     file: 'pavilion_trinkets/trinket_incense.png' },
      { id: 'sleeping_cat', threshold: 500_000_000, slot: { x: 80, y: 94 }, w: 18, name: '睡猫',     hint: '五亿 token · 隐藏终极',     file: 'pavilion_trinkets/trinket_sleeping_cat.png' }
    ],

    // The pavilion sprite is a roof + columns + base; the "displayable" interior
    // is a sub-rectangle of the sprite. Fractions of pavilion bbox.
    pavilionInterior: { left: 0.16, right: 0.84, top: 0.30, bottom: 0.86 },

    // Aspect ratio per pavilion tier (height / width) — used to compute interior
    // bbox in scene coords. Pulled from manifest sprite sizes.
    pavilionAspect: { small: 223 / 152, mid: 257 / 289, full: 324 / 383 },

    // Pavilion placement on scene
    pavilionAnchor: { cx_pct: 82.5, bottom_pct: 90.5 },
    pavilionWidths: { small: 84, mid: 122, full: 160 }
  };
