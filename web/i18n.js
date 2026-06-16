const STORAGE_KEY = 'pg6.locale';
const SUPPORTED = new Set(['en', 'zh']);

const MESSAGES = {
  en: {
    'document.title': 'Local Agent Garden',
    'sr.description': 'Pixel garden: local AI agent activity grows into project vines hanging from the wall or climbing from the ground. Use Tab to enter the vine list, then Left and Right arrows to move between vines.',
    'app.initial': 'Pixel Garden · Your local agent courtyard',
    'app.tokens': 'Pixel Garden · {total} local tokens',
    'footer.privacy': 'Reads local agent data only · zero network requests',

    'fresh.scanning': '· Scanning...',
    'fresh.scanningTitle': 'Reading local agent data',
    'fresh.cached': '· Scanned · live refresh off',
    'fresh.cachedTitle': 'Cache updated. Turn live refresh back on, or change view settings, to repaint the garden.',
    'fresh.updated': '· Updated {when}',
    'fresh.justNow': 'just now',
    'fresh.minutesAgo': '{count} min ago',
    'fresh.hoursAgo': '{count} hr ago',
    'fresh.daysAgo': '{count} days ago',
    'fresh.monthPlusAgo': 'over a month ago',
    'fresh.staleTitle': 'Use the tray menu to scan again',

    'time.day': 'Day',
    'time.dusk': 'Dusk',
    'time.night': 'Night',
    'season.spring': 'Spring',
    'season.summer': 'Summer',
    'season.autumn': 'Autumn',
    'season.winter': 'Winter',

    'term.minorCold': 'Minor Cold',
    'term.majorCold': 'Major Cold',
    'term.startSpring': 'Start of Spring',
    'term.rainWater': 'Rain Water',
    'term.awakeningInsects': 'Awakening of Insects',
    'term.springEquinox': 'Spring Equinox',
    'term.pureBrightness': 'Pure Brightness',
    'term.grainRain': 'Grain Rain',
    'term.startSummer': 'Start of Summer',
    'term.lesserFullness': 'Lesser Fullness',
    'term.grainInEar': 'Grain in Ear',
    'term.summerSolstice': 'Summer Solstice',
    'term.minorHeat': 'Minor Heat',
    'term.majorHeat': 'Major Heat',
    'term.startAutumn': 'Start of Autumn',
    'term.endHeat': 'End of Heat',
    'term.whiteDew': 'White Dew',
    'term.autumnEquinox': 'Autumn Equinox',
    'term.coldDew': 'Cold Dew',
    'term.frostDescent': 'Frost Descent',
    'term.startWinter': 'Start of Winter',
    'term.minorSnow': 'Minor Snow',
    'term.majorSnow': 'Major Snow',
    'term.winterSolstice': 'Winter Solstice',

    'svg.title': 'Pixel Garden · {time}',
    'svg.desc': 'Local agent activity grows into project vines hanging from the wall and climbing from the ground.',

    'empty.title': 'No local agent activity yet',
    'empty.hint': 'Open Claude Code, Codex, or Claude Cowork and projects will start growing here.',

    'card.project.label': 'Project vine · selected',
    'card.project.defaultName': 'Local Agent Garden',
    'card.total': 'Total {total}',
    'card.stage': 'Stage {stage} / 6',
    'card.trinket.label': 'Pavilion display',
    'card.threshold': 'Threshold {threshold}',
    'card.cat.label': 'Stone cat · garden guardian',
    'card.cat.smallTitle': 'Standing guard',
    'card.cat.fullTitle': 'Standing guard · bell collar',
    'card.cat.sessions': '{count} sessions',
    'card.cat.fullStage': 'Full',
    'card.cat.smallStage': 'Early',
    'card.today': 'Today',
    'card.cacheHit': 'Cache hit',
    'card.activity': 'Activity',
    'card.sessionsShort': '{count} sessions',
    'card.toolsShort': '{count} tools',
    'card.topModel': 'Top model',
    'card.sources': 'Sources',
    'card.lastActive': 'Last active',
    'source.manual': 'Manual',

    'settings.aria': 'Settings',
    'settings.readOnly': 'Read-only mode · open the desktop app to save settings',
    'settings.appearance': 'Appearance',
    'settings.time': 'Time',
    'settings.season': 'Season',
    'settings.motion': 'Motion',
    'settings.data': 'Data',
    'settings.autoRescan': 'Live watcher updates',
    'settings.autoRescanHint': 'When off, new activity appears after a manual scan or view refresh.',
    'choice.system': 'System',
    'choice.date': 'Date',
    'choice.day': 'Day',
    'choice.dusk': 'Dusk',
    'choice.night': 'Night',
    'choice.spring': 'Spring',
    'choice.summer': 'Summer',
    'choice.autumn': 'Autumn',
    'choice.winter': 'Winter',
    'choice.reduced': 'Reduced',
    'choice.off': 'Off',

    'insight.openAria': 'Open Token Insight',
    'insight.dialogAria': 'Token Insight',
    'insight.sparkLabel': 'Last {days} days token total: {total}',
    'insight.empty': 'Waiting for local agent activity',
    'insight.label': 'Token Insight',
    'insight.title': 'Project token overview',
    'insight.closeAria': 'Close Insight panel',
    'insight.total': 'Total',
    'insight.recent': 'Last {days} days',
    'insight.projects': 'Projects',
    'insight.searchPlaceholder': 'Search projects…',
    'insight.noResults': 'No projects match',
    'insight.showAll': 'Show all ({count} more)',
    'insight.showTop': 'Show top {count}',
    'insight.openTerminalTitle': 'Open in terminal',
    'insight.openTerminalAria': 'Open {name} in terminal',
    'insight.approxBadge': '≈ inferred path',
    'insight.approxTitle': 'Path inferred from Claude directory name; it may be inaccurate.',
    'insight.inferredTooltip': '≈ {path} (inferred path; may be inaccurate)',
    'insight.rowRecent': 'Last {days} days {total}',

    'postcard.openAria': 'Open postcard export',
    'postcard.dialogAria': 'Garden postcard export',
    'postcard.button': 'Postcard',
    'postcard.panelTitle': 'Export postcard',
    'postcard.includeBusiest': 'Include busiest project',
    'postcard.export': 'Export',
    'postcard.exporting': 'Exporting...',
    'postcard.saved': 'Saved',
    'postcard.cancelled': 'Cancelled',
    'postcard.error': 'Export failed',
    'postcard.vines': '{count} vines',
    'postcard.tokens': '{total} tokens',
    'postcard.busiest': 'busiest: {name}',

    'return.label': 'Garden diff',
    'return.title': 'While you were away',
    'return.tokenDelta': '+{total} tokens',
    'return.sessionDelta': '+{count} sessions',
    'return.newVines': '{count} new vines',
    'return.changedProjects': '{count} projects grew',
    'return.topProject': 'Most changed: {name}',
    'return.closeAria': 'Close return summary',

    'trinket.scroll.name': 'Scroll',
    'trinket.scroll.hint': '1M tokens · eave scroll',
    'trinket.tea_set.name': 'Tea set',
    'trinket.tea_set.hint': '10M tokens · tea set on the table',
    'trinket.wind_chime.name': 'Wind chime',
    'trinket.wind_chime.hint': '50M tokens · eave wind chime',
    'trinket.incense.name': 'Incense burner',
    'trinket.incense.hint': '100M tokens · incense burner on the table',
    'trinket.sleeping_cat.name': 'Sleeping cat',
    'trinket.sleeping_cat.hint': '500M tokens · hidden final trinket'
  },

  zh: {
    'document.title': 'Local Agent Garden',
    'sr.description': '像素花园:本机 AI agent 活动化作墙沿垂落或墙根攀爬的项目藤。使用 Tab 进入项目藤列表,左右方向键在藤之间切换。',
    'app.initial': '像素花园 · 你的数字庭院',
    'app.tokens': '像素花园 · {total} local tokens',
    'footer.privacy': '仅读取本机 agent 数据 · 零网络请求',

    'fresh.scanning': '· 正在扫描...',
    'fresh.scanningTitle': '正在读取本机 agent 数据',
    'fresh.cached': '· 已扫描 · 自动刷新已关闭',
    'fresh.cachedTitle': '缓存已更新，打开自动刷新或手动切换视图后会重绘花园',
    'fresh.updated': '· 更新于 {when}',
    'fresh.justNow': '刚刚',
    'fresh.minutesAgo': '{count} 分钟前',
    'fresh.hoursAgo': '{count} 小时前',
    'fresh.daysAgo': '{count} 天前',
    'fresh.monthPlusAgo': '一个月以上之前',
    'fresh.staleTitle': '可从托盘点击扫描刷新',

    'time.day': '白日',
    'time.dusk': '傍晚',
    'time.night': '夜晚',
    'season.spring': '春',
    'season.summer': '夏',
    'season.autumn': '秋',
    'season.winter': '冬',

    'term.minorCold': '小寒',
    'term.majorCold': '大寒',
    'term.startSpring': '立春',
    'term.rainWater': '雨水',
    'term.awakeningInsects': '惊蛰',
    'term.springEquinox': '春分',
    'term.pureBrightness': '清明',
    'term.grainRain': '谷雨',
    'term.startSummer': '立夏',
    'term.lesserFullness': '小满',
    'term.grainInEar': '芒种',
    'term.summerSolstice': '夏至',
    'term.minorHeat': '小暑',
    'term.majorHeat': '大暑',
    'term.startAutumn': '立秋',
    'term.endHeat': '处暑',
    'term.whiteDew': '白露',
    'term.autumnEquinox': '秋分',
    'term.coldDew': '寒露',
    'term.frostDescent': '霜降',
    'term.startWinter': '立冬',
    'term.minorSnow': '小雪',
    'term.majorSnow': '大雪',
    'term.winterSolstice': '冬至',

    'svg.title': '像素花园·{time}',
    'svg.desc': '本地 agent 活动化作墙沿垂落和墙根攀爬的项目藤',

    'empty.title': '还没有本地 agent 活动',
    'empty.hint': '打开 Claude Code、Codex 或 Claude Cowork 后，花园会自动长出项目。',

    'card.project.label': '项目藤 · 当前选中',
    'card.project.defaultName': '本地智能体花园',
    'card.total': '累计 {total}',
    'card.stage': '阶段 {stage} / 6',
    'card.trinket.label': '亭子陈列',
    'card.threshold': '阈值 {threshold}',
    'card.cat.label': '石猫 · 镇园守护',
    'card.cat.smallTitle': '坐镇',
    'card.cat.fullTitle': '坐镇 · 戴铃',
    'card.cat.sessions': '累计 {count} 次会话',
    'card.cat.fullStage': '满级',
    'card.cat.smallStage': '初阶',
    'card.today': '今日',
    'card.cacheHit': '缓存命中',
    'card.activity': '活动',
    'card.sessionsShort': '{count} 会话',
    'card.toolsShort': '{count} 工具',
    'card.topModel': '主力模型',
    'card.sources': '来源',
    'card.lastActive': '最近活动',
    'source.manual': '手动',

    'settings.aria': '设置',
    'settings.readOnly': '只读模式 · 在桌面 App 中打开以保存设置',
    'settings.appearance': '外观',
    'settings.time': '时间',
    'settings.season': '季节',
    'settings.motion': '动画',
    'settings.data': '数据',
    'settings.autoRescan': 'watcher 实时更新',
    'settings.autoRescanHint': '关闭后,需要点 footer 刷新才会看到新的活动',
    'choice.system': '跟随系统',
    'choice.date': '跟随日期',
    'choice.day': '白日',
    'choice.dusk': '傍晚',
    'choice.night': '夜晚',
    'choice.spring': '春',
    'choice.summer': '夏',
    'choice.autumn': '秋',
    'choice.winter': '冬',
    'choice.reduced': '减弱',
    'choice.off': '关闭',

    'insight.openAria': '打开 Token Insight',
    'insight.dialogAria': 'Token Insight',
    'insight.sparkLabel': '近 {days} 天 token：合计 {total}',
    'insight.empty': '等待本地 agent 活动',
    'insight.label': 'Token Insight',
    'insight.title': '项目消耗概览',
    'insight.closeAria': '关闭 Insight 面板',
    'insight.total': '累计',
    'insight.recent': '近 {days} 天',
    'insight.projects': '项目',
    'insight.searchPlaceholder': '搜索项目…',
    'insight.noResults': '没有匹配的项目',
    'insight.showAll': '显示全部(还有 {count} 个)',
    'insight.showTop': '只看前 {count}',
    'insight.openTerminalTitle': '在终端打开',
    'insight.openTerminalAria': '在终端打开 {name}',
    'insight.approxBadge': '≈ 推测路径',
    'insight.approxTitle': '路径由 Claude 目录名反推,可能不准确',
    'insight.inferredTooltip': '≈ {path}(推测路径,可能不准)',
    'insight.rowRecent': '近 {days} 天 {total}',

    'postcard.openAria': '打开花园明信片导出',
    'postcard.dialogAria': '花园明信片导出',
    'postcard.button': '明信片',
    'postcard.panelTitle': '导出明信片',
    'postcard.includeBusiest': '包含最忙项目',
    'postcard.export': '导出',
    'postcard.exporting': '正在导出...',
    'postcard.saved': '已保存',
    'postcard.cancelled': '已取消',
    'postcard.error': '导出失败',
    'postcard.vines': '{count} 条藤',
    'postcard.tokens': '{total} tokens',
    'postcard.busiest': '最忙: {name}',

    'return.label': '花园变化',
    'return.title': '你不在的时候',
    'return.tokenDelta': '+{total} tokens',
    'return.sessionDelta': '+{count} 次会话',
    'return.newVines': '{count} 条新藤',
    'return.changedProjects': '{count} 个项目长高了',
    'return.topProject': '变化最多: {name}',
    'return.closeAria': '关闭回来摘要',

    'trinket.scroll.name': '挂卷',
    'trinket.scroll.hint': '百万 token · 檐下挂卷',
    'trinket.tea_set.name': '茶具',
    'trinket.tea_set.hint': '千万 token · 桌上茶具',
    'trinket.wind_chime.name': '风铃',
    'trinket.wind_chime.hint': '5 千万 token · 檐下风铃',
    'trinket.incense.name': '香炉',
    'trinket.incense.hint': '亿 token · 桌上香炉',
    'trinket.sleeping_cat.name': '睡猫',
    'trinket.sleeping_cat.hint': '五亿 token · 隐藏终极'
  }
};

export function currentLocale() {
  const queryLocale = queryLang();
  if (queryLocale) return queryLocale;

  try {
    const stored = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.has(stored)) return stored;
  } catch (_) {
    // localStorage may be blocked in some embedded/browser fallback contexts.
  }

  const languages = (typeof navigator !== 'undefined' && navigator.languages?.length)
    ? navigator.languages
    : [typeof navigator !== 'undefined' ? navigator.language : ''];
  return languages.some((lang) => String(lang || '').toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

export function t(key, vars = {}) {
  const locale = currentLocale();
  const raw = MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? MESSAGES.zh[key] ?? key;
  return String(raw).replace(/\{(\w+)\}/g, (_, name) => {
    return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '';
  });
}

export function applyStaticTranslations(root = document) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLocale() === 'zh' ? 'zh-CN' : 'en';
    document.title = t('document.title');
  }
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
}

function queryLang() {
  if (typeof window === 'undefined') return null;
  try {
    const value = new URLSearchParams(window.location.search).get('lang');
    const normalized = value === 'zh-CN' || value === 'zh-TW' ? 'zh' : value;
    return SUPPORTED.has(normalized) ? normalized : null;
  } catch (_) {
    return null;
  }
}
