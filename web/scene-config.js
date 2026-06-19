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

    // Low table / cushion, by max single-project stage (1..6)
    stool:    { min_stage: 3 },
    cushion:  { min_stage: 4 },

    // Lamp is 'lit' if anything happened today
    // (no threshold tuning — strictly today-activity > 0)

    // Pavilion trinkets. slot.x / slot.y are % inside the pavilion's INTERIOR
    // bounding box (defined below), so they follow pavilion size changes.
    // w is the trinket's diameter in 680-unit scene coordinates.
    // file: sprite path under assets/sprites/.
    //
    // Layout intent (also see render-garden.js low-table/cushion placement):
    //   Eave row (y≈12-18)    : scroll hangs center, wind_chime hangs right.
    //   Table row (y≈84)      : tea_set + incense use bottom anchors so their
    //                           bases land on the wooden tabletop.
    //   Floor row (y≈92-96)   : sleeping_cat no longer renders as a static
    //                           trinket when the live garden cat asset exists.
    //
    // lucky_cat (招财猫) was removed: visually duplicated the courtyard's
    // stone_cat statue (both read as "seated cat statue"). sleeping_cat
    // keeps the 5e8 hidden-终极 role — it now unlocks the live courtyard cat
    // when the garden_cat spritesheet is available.
    pavilionTrinkets: [
      { id: 'scroll',       threshold:   1_000_000, slot: { x: 50, y: 12 }, w: 11, name: '挂卷',     hint: '百万 token · 檐下挂卷',     file: 'pavilion_trinkets/trinket_scroll.png' },
      { id: 'tea_set',      threshold:  10_000_000, slot: { x: 38, y: 84 }, w: 18, anchor: 'bottom', name: '茶具',     hint: '千万 token · 桌上茶具',     file: 'pavilion_trinkets/trinket_tea_set.png' },
      { id: 'wind_chime',   threshold:  50_000_000, slot: { x: 86, y: 14 }, w: 10, name: '风铃',     hint: '5 千万 token · 檐下风铃',   file: 'pavilion_trinkets/trinket_wind_chime.png' },
      { id: 'incense',      threshold: 100_000_000, slot: { x: 62, y: 84 }, w: 15, anchor: 'bottom', name: '香炉',     hint: '亿 token · 桌上香炉',       file: 'pavilion_trinkets/trinket_incense.png' },
      { id: 'sleeping_cat', threshold: 500_000_000, slot: { x: 80, y: 94 }, w: 18, name: '睡猫',     hint: '五亿 token · 隐藏终极',     file: 'pavilion_trinkets/trinket_sleeping_cat.png' }
    ],

    // The pavilion sprite is a roof + columns + base; the "displayable" interior
    // is a sub-rectangle of the sprite. Fractions of pavilion bbox.
    pavilionInterior: { left: 0.15, right: 0.85, top: 0.30, bottom: 0.86 },

    // Aspect ratio per pavilion tier (height / width) — used to compute interior
    // bbox in scene coords. Pulled from manifest sprite sizes.
    pavilionAspect: { small: 223 / 152, mid: 257 / 289, full: 324 / 383 },

    // Pavilion placement on scene. bottom_pct lifted 91 → 86 so the pavilion
    // sits ON the deepened 2.5D floor (mid plane) instead of glued to the very
    // bottom edge; trinket / low-table / cushion interior math reads this anchor,
    // so they ride up with it. (Kept near full size — it's the hero structure —
    // rather than depth-scaled like the smaller objects.)
    pavilionAnchor: { cx_pct: 81.0, bottom_pct: 86.0 },
    pavilionWidths: { small: 104, mid: 154, full: 212 }
  };
