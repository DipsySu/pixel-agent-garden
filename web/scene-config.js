export const CONFIG = {
    // Pavilion size tier, by max single-project tokens
    pavilion: { full: 100_000_000, mid: 10_000_000 },           // anything below mid → 'small'

    // Cherry blossom state, by total recent_activity across projects
    cherry:   { petal: 100_000, bloom: 15_000 },                // below bloom → 'bud'

    // Willow becomes 'mature' when EITHER condition holds
    willow:   { mature_tokens: 10_000_000, mature_projects: 5 },

    // Guardian statue tier, by total sessions across projects.
    // (Previously called "shrine" — see addCourtyardObjects for the sprite
    // fallback so older shrine assets keep rendering until guardian sprites land.)
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
    // guardian statue. sleeping_cat keeps the 5e8 hidden-终极 role — it now
    // unlocks the live courtyard cat when the garden_cat spritesheet is
    // available.
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
    pavilionWidths: { small: 104, mid: 154, full: 212 },

    // Decorative wall stickers: language/tool-inspired pixel decals. They are
    // intentionally visual-only, not a data contract yet. `x` is flat-wall %
    // and `wall` is ratio down the wall band. `isoSlot` / `isoDown` tune the
    // same asset for the 2.5D wall faces.
    programmingStickers: [
      { id: 'go',         title: 'Go sticker',         file: 'programming_stickers/01_sticker_go_gopher.png',      x: 11, wall: 0.32, w: 18, rotate: -7, opacity: 0.78, isoSlot: 0.09, isoDown: 43, isoW: 10, isoOpacity: 0.70 },
      { id: 'rust',       title: 'Rust sticker',       file: 'programming_stickers/02_sticker_rust_ferris.png',    x: 22, wall: 0.43, w: 18, rotate: 6,  opacity: 0.78, isoSlot: 0.17, isoDown: 54, isoW: 10, isoOpacity: 0.72 },
      { id: 'mysql',      title: 'MySQL sticker',      file: 'programming_stickers/03_sticker_mysql_dolphin.png',  x: 34, wall: 0.29, w: 18, rotate: -4, opacity: 0.76, isoSlot: 0.25, isoDown: 30, isoW: 10, isoOpacity: 0.68 },
      { id: 'git',        title: 'Git sticker',        file: 'programming_stickers/04_sticker_git_branch.png',     x: 47, wall: 0.39, w: 17, rotate: 5,  opacity: 0.76, isoSlot: 0.33, isoDown: 50, isoW: 9,  isoOpacity: 0.68 },
      { id: 'terminal',   title: 'Terminal sticker',   file: 'programming_stickers/05_sticker_terminal.png',       x: 60, wall: 0.30, w: 20, rotate: -3, opacity: 0.80, isoSlot: 0.41, isoDown: 24, isoW: 11, isoOpacity: 0.74 },
      { id: 'python',     title: 'Python sticker',     file: 'programming_stickers/06_sticker_python.png',         x: 40, wall: 0.46, w: 18, rotate: 4,  opacity: 0.78, isoSlot: 0.49, isoDown: 44, isoW: 10, isoOpacity: 0.70 },
      { id: 'ruby',       title: 'Ruby sticker',       file: 'programming_stickers/07_sticker_ruby.png',           x: 5,  wall: 0.60, w: 17, rotate: -5, opacity: 0.74, isoSlot: 0.57, isoDown: 26, isoW: 9,  isoOpacity: 0.66 },
      { id: 'docker',     title: 'Docker sticker',     file: 'programming_stickers/08_sticker_docker.png',         x: 16, wall: 0.60, w: 19, rotate: 3,  opacity: 0.80, isoSlot: 0.65, isoDown: 50, isoW: 11, isoOpacity: 0.74 },
      { id: 'java',       title: 'Java sticker',       file: 'programming_stickers/09_sticker_java.png',           x: 29, wall: 0.71, w: 17, rotate: -4, opacity: 0.72, isoSlot: 0.73, isoDown: 31, isoW: 9,  isoOpacity: 0.64 },
      { id: 'javascript', title: 'JavaScript sticker', file: 'programming_stickers/10_sticker_javascript.png',     x: 43, wall: 0.58, w: 17, rotate: 4,  opacity: 0.74, isoSlot: 0.81, isoDown: 52, isoW: 9,  isoOpacity: 0.66 },
      { id: 'typescript', title: 'TypeScript sticker', file: 'programming_stickers/11_sticker_typescript.png',     x: 57, wall: 0.70, w: 17, rotate: -5, opacity: 0.74, isoSlot: 0.89, isoDown: 33, isoW: 9,  isoOpacity: 0.66 },
      { id: 'html5',      title: 'HTML5 sticker',      file: 'programming_stickers/12_sticker_html5.png',          x: 13, wall: 0.49, w: 16, rotate: 6,  opacity: 0.70, isoSlot: 0.96, isoDown: 51, isoW: 8,  isoOpacity: 0.62 },
      { id: 'css3',       title: 'CSS3 sticker',       file: 'programming_stickers/13_sticker_css3.png',           x: 27, wall: 0.59, w: 16, rotate: -4, opacity: 0.70, isoSlot: 0.12, isoDown: 22, isoW: 8,  isoOpacity: 0.62 },
      { id: 'linux',      title: 'Linux sticker',      file: 'programming_stickers/14_sticker_linux.png',          x: 9,  wall: 0.76, w: 17, rotate: 5,  opacity: 0.72, isoSlot: 0.21, isoDown: 21, isoW: 9,  isoOpacity: 0.64 },
      { id: 'database',   title: 'Database sticker',   file: 'programming_stickers/15_sticker_database.png',       x: 52, wall: 0.22, w: 17, rotate: -3, opacity: 0.72, isoSlot: 0.30, isoDown: 20, isoW: 9,  isoOpacity: 0.62 },
      { id: 'cloud',      title: 'Cloud sticker',      file: 'programming_stickers/16_sticker_cloud_devops.png',   x: 8,  wall: 0.22, w: 18, rotate: 4,  opacity: 0.72, isoSlot: 0.38, isoDown: 18, isoW: 9,  isoOpacity: 0.62 },
      { id: 'react',      title: 'React sticker',      file: 'programming_stickers/17_sticker_react.png',          x: 25, wall: 0.24, w: 17, rotate: -5, opacity: 0.72, isoSlot: 0.46, isoDown: 18, isoW: 9,  isoOpacity: 0.64 },
      { id: 'vue',        title: 'Vue sticker',        file: 'programming_stickers/18_sticker_vue.png',            x: 37, wall: 0.78, w: 17, rotate: 3,  opacity: 0.72, isoSlot: 0.54, isoDown: 18, isoW: 9,  isoOpacity: 0.64 },
      { id: 'nodejs',     title: 'Node.js sticker',    file: 'programming_stickers/19_sticker_nodejs.png',         x: 54, wall: 0.46, w: 17, rotate: -4, opacity: 0.72, isoSlot: 0.62, isoDown: 18, isoW: 9,  isoOpacity: 0.64 },
      { id: 'npm',        title: 'npm sticker',        file: 'programming_stickers/20_sticker_npm.png',            x: 20, wall: 0.51, w: 16, rotate: 5,  opacity: 0.68, isoSlot: 0.70, isoDown: 18, isoW: 8,  isoOpacity: 0.60 },
      { id: 'vite',       title: 'Vite sticker',       file: 'programming_stickers/21_sticker_vite.png',           x: 6,  wall: 0.47, w: 16, rotate: -5, opacity: 0.68, isoSlot: 0.78, isoDown: 18, isoW: 8,  isoOpacity: 0.60 },
      { id: 'nextjs',     title: 'Next.js sticker',    file: 'programming_stickers/22_sticker_nextjs.png',         x: 33, wall: 0.53, w: 16, rotate: 4,  opacity: 0.68, isoSlot: 0.86, isoDown: 18, isoW: 8,  isoOpacity: 0.60 },
      { id: 'tailwind',   title: 'Tailwind sticker',   file: 'programming_stickers/23_sticker_tailwind.png',       x: 66, wall: 0.50, w: 17, rotate: -3, opacity: 0.70, isoSlot: 0.94, isoDown: 18, isoW: 8,  isoOpacity: 0.60 },
      { id: 'kubernetes', title: 'Kubernetes sticker', file: 'programming_stickers/24_sticker_kubernetes.png',     x: 36, wall: 0.66, w: 17, rotate: 5,  opacity: 0.70, isoSlot: 0.06, isoDown: 32, isoW: 8,  isoOpacity: 0.60 },
      { id: 'redis',      title: 'Redis sticker',      file: 'programming_stickers/25_sticker_redis.png',          x: 18, wall: 0.20, w: 17, rotate: 4,  opacity: 0.70, isoSlot: 0.18, isoDown: 36, isoW: 8,  isoOpacity: 0.60 },
      { id: 'mongodb',    title: 'MongoDB sticker',    file: 'programming_stickers/26_sticker_mongodb.png',        x: 44, wall: 0.21, w: 16, rotate: -5, opacity: 0.66, isoSlot: 0.31, isoDown: 38, isoW: 8,  isoOpacity: 0.58 },
      { id: 'postgresql', title: 'PostgreSQL sticker', file: 'programming_stickers/27_sticker_postgresql.png',     x: 48, wall: 0.82, w: 17, rotate: 3,  opacity: 0.70, isoSlot: 0.64, isoDown: 34, isoW: 8,  isoOpacity: 0.60 },
      { id: 'aws_cloud',  title: 'AWS cloud sticker',  file: 'programming_stickers/28_sticker_aws_cloud.png',      x: 24, wall: 0.66, w: 17, rotate: -4, opacity: 0.68, isoSlot: 0.91, isoDown: 44, isoW: 8,  isoOpacity: 0.58 }
    ]
  };
