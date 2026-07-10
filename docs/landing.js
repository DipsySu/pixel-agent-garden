const THEME_KEY = "pag.theme";
const LANG_KEY = "pag.lang";
const THEMES = ["auto", "dark", "light"];
const LANGS = ["en", "zh_cn", "zh_tw"];
const LANG_TAGS = { en: "en", zh_cn: "zh-CN", zh_tw: "zh-TW" };

const root = document.documentElement;
const description = document.querySelector('meta[name="description"]');
const themeColor = document.querySelector('meta[name="theme-color"]');
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

const textNodes = [...document.querySelectorAll("[data-i18n]")];
const altNodes = [...document.querySelectorAll("[data-i18n-alt]")];
const ariaNodes = [...document.querySelectorAll("[data-i18n-aria-label]")];

const baseCopy = Object.fromEntries(textNodes.map((node) => [node.dataset.i18n, node.textContent.trim()]));
const baseAlt = Object.fromEntries(altNodes.map((node) => [node.dataset.i18nAlt, node.getAttribute("alt") || ""]));
const baseAria = Object.fromEntries(ariaNodes.map((node) => [node.dataset.i18nAriaLabel, node.getAttribute("aria-label") || ""]));

const copy = {
  en: {
    "meta.description": "Pixel Agent Garden turns local Claude Code, Claude Cowork, Codex, and other AI agent activity into a private desktop pixel garden.",
  },
  zh_cn: {
    "meta.description": "Pixel Agent Garden 把本机 Claude Code、Claude Cowork、Codex 和其他 AI agent 活动变成一座私有的桌面像素花园。",
    "a11y.skip": "跳到正文",
    "brand.home": "Pixel Agent Garden 首页",
    "nav.aria": "主导航",
    "nav.growth": "如何生长",
    "nav.views": "双重视图",
    "nav.privacy": "隐私",
    "nav.install": "安装",
    "theme.aria": "主题",
    "theme.auto": "自动",
    "theme.light": "纸张",
    "theme.dark": "夜色",
    "lang.aria": "语言",
    "hero.eyebrow": "一座属于 AI 开发者的私有桌面花园",
    "hero.title": "Pixel Agent Garden",
    "hero.subtitle1": "把 AI Agent 的",
    "hero.subtitle2": "工作，种成一座",
    "hero.subtitle3": "像素花园。",
    "hero.copy": "Pixel Agent Garden 读取 Claude Code、Claude Cowork 与 Codex 留在本机的活动，把项目、Token、Session 与近期活跃度变成藤蔓、灯光、季节与庭院里的小小变化。",
    "hero.agentsAria": "支持的本地 Agent 来源",
    "hero.download": "下载最新版",
    "hero.explore": "看看它如何生长",
    "hero.imageAlt": "Pixel Agent Garden 的 2.5D 像素庭院，包含亭子、锦鲤池、树木、项目藤蔓和小猫",
    "hero.caption": "项目正在生长，数据仍留在原地。",
    "trust.aria": "项目承诺",
    "trust.localTitle": "100% 本地",
    "trust.localCopy": "扫描与渲染不联网",
    "trust.telemetryTitle": "零遥测",
    "trust.telemetryCopy": "无 analytics 与远程日志",
    "trust.readonlyTitle": "源目录只读",
    "trust.readonlyCopy": "只写应用自己的缓存",
    "trust.openTitle": "MIT 开源",
    "trust.openCopy": "实现与隐私边界可核验",
    "growth.titleLead": "工作留下的痕迹，",
    "growth.titleTail": "不该只剩一串日志。",
    "growth.copy": "花园不是另一个催促你的仪表盘。它安静地待在桌面上，先让你看见什么正在生长；需要数字时，再打开本地数据抽屉。",
    "growth.1.title": "项目成为藤蔓",
    "growth.1.copy": "每个项目有自己的生长轨迹；即使目录同名，也能被分别看见。",
    "growth.2.title": "Token 塑造庭院",
    "growth.2.copy": "使用量、缓存活动与模型构成，逐渐改变庭院的丰盛程度。",
    "growth.3.title": "Session 留下足迹",
    "growth.3.copy": "一次次构建与思考，变成石阶、猫、树木与亭中的陈设。",
    "growth.4.title": "近期活动点亮灯笼",
    "growth.4.copy": "时间、季节与最近的工作，让花园在每次打开时都略有不同。",
    "views.titleLead": "一座庭院，",
    "views.titleTail": "两种观看方式。",
    "views.copy": "同一份本地摘要，同时驱动沉浸式 2.5D 庭院与更直接的 Wall 项目活动地图。",
    "views.courtyardAlt": "Pixel Agent Garden 的 2.5D 庭院视图",
    "views.courtyardCopy": "亭子、池塘、树木与季节细节，随活动慢慢出现。",
    "views.wallAlt": "Pixel Agent Garden Wall 视图，墙上有项目藤蔓与编程贴纸",
    "views.wallCopy": "每个项目成为一根藤蔓，编程贴纸标记花园里的技术生态。",
    "features.titleLead": "安静地看见，",
    "features.titleTail": "需要时再深入。",
    "feature.1.title": "本地 Insight",
    "feature.1.copy": "查看项目排名、模型构成、每日活动、缓存比例与本地成本估算。",
    "feature.2.title": "Agent 苗圃",
    "feature.2.copy": "Claude Code、Claude Cowork 与 Codex，都在同一座花园里留下照料痕迹。",
    "feature.3.title": "安静的托盘助手",
    "feature.3.copy": "Watcher、立即扫描、显示隐藏与可配置快捷键，都留在随手可及的位置。",
    "feature.4.title": "只在本地的分享卡",
    "feature.4.copy": "导出庭院、周报、时令卡与年度回顾 PNG；不会自动上传。",
    "feature.5.title": "桌面与 CLI",
    "feature.5.copy": "常驻 Tauri 庭院，也可以在终端查看 usage、adapter、cost 与 doctor。",
    "feature.6.title": "值得告诉你的变化",
    "feature.6.copy": "只有花园真的成长过，回来时才用一小段文字告诉你发生了什么。",
    "pipeline.titleLead": "活动变成风景，",
    "pipeline.titleTail": "数据仍留在原地。",
    "pipeline.1.title": "读取本机记录",
    "pipeline.2.title": "Adapter 统一格式",
    "pipeline.3.title": "Rust Core 汇总",
    "pipeline.4.title": "渲染到本地表面",
    "privacy.titleLead": "花园会生长。",
    "privacy.titleTail": "你的数据不会离开电脑。",
    "privacy.1": "扫描、渲染与报告均在本地完成",
    "privacy.2": "无 analytics、telemetry 或远程崩溃报告",
    "privacy.3": "Agent 来源目录始终只读",
    "privacy.4": "Postcard 与回顾卡只导出为本地 PNG",
    "privacy.policy": "阅读隐私与安全说明",
    "privacy.architecture": "查看本地架构",
    "install.titleLead": "三步，",
    "install.titleTail": "让花园开始生长。",
    "install.release": "前往官方 Releases",
    "install.1.title": "选择平台",
    "install.1.copy": "macOS 下载 DMG；Windows 下载 setup.exe；Linux 选择 AppImage 或 deb。",
    "install.2.title": "从官方 Release 安装",
    "install.2.copy": "当前 macOS 与 Windows 社区构建尚未签名；首次打开请按照项目说明操作。",
    "install.3.title": "完成首次本地扫描",
    "install.3.copy": "应用读取已有 Agent 的本地活动，花园随即开始生长；托盘 watcher 会继续自动更新。",
    "install.sourceSummary": "想从源码运行？",
    "install.sourceCopy": "需要 Rust 1.85+ 与 Tauri 2 CLI。",
    "faq.title": "第一次来花园？",
    "faq.1.q": "支持哪些 AI Agent？",
    "faq.1.a": "目前原生适配 Claude Code、Claude Cowork 与 Codex。其他来源可以使用文档中的 manual JSONL 格式。",
    "faq.2.q": "它会上传我的代码或会话记录吗？",
    "faq.2.a": "不会。扫描与渲染都在本机完成，没有 analytics、telemetry、远程日志或远程崩溃报告。",
    "faq.3.q": "它会修改 Claude 或 Codex 的文件吗？",
    "faq.3.a": "不会。来源目录始终作为只读输入；应用只在 ~/.local-agent-garden/ 写自己的状态。",
    "faq.4.q": "支持哪些操作系统？",
    "faq.4.a": "官方 Releases 提供 macOS、Windows 与 Linux 构建；Linux 可选择 AppImage 或 deb。",
    "faq.5.q": "为什么安装时可能出现安全提示？",
    "faq.5.a": "当前 macOS 与 Windows 社区构建尚未签名。请只从官方 Releases 下载，并按照首次启动说明操作。",
    "faq.6.q": "本地成本估算等于实际账单吗？",
    "faq.6.a": "不等于。它依据本地 Token 汇总与内置价格表估算趋势；无法定价的模型会明确标示。",
    "closing.titleLead": "让下一次 Agent 会话，",
    "closing.titleTail": "也长成风景。",
    "closing.copy": "不增加一个云端账户，也不把工作记录交给另一个服务。只需打开花园。",
    "closing.download": "下载最新版",
    "closing.github": "在 GitHub 查看",
    "closing.note": "100% 本地 · 零遥测 · MIT 开源",
    "footer.copy": "一个由本机 AI Agent 活动长出来的私有桌面花园。",
    "footer.install": "安装说明",
  },
  zh_tw: {
    "meta.description": "Pixel Agent Garden 把本機 Claude Code、Claude Cowork、Codex 和其他 AI agent 活動變成一座私有的桌面像素花園。",
    "a11y.skip": "跳到正文",
    "brand.home": "Pixel Agent Garden 首頁",
    "nav.aria": "主導覽",
    "nav.growth": "如何生長",
    "nav.views": "雙重視圖",
    "nav.privacy": "隱私",
    "nav.install": "安裝",
    "theme.aria": "主題",
    "theme.auto": "自動",
    "theme.light": "紙張",
    "theme.dark": "夜色",
    "lang.aria": "語言",
    "hero.eyebrow": "一座屬於 AI 開發者的私有桌面花園",
    "hero.title": "Pixel Agent Garden",
    "hero.subtitle1": "把 AI Agent 的",
    "hero.subtitle2": "工作，種成一座",
    "hero.subtitle3": "像素花園。",
    "hero.copy": "Pixel Agent Garden 讀取 Claude Code、Claude Cowork 與 Codex 留在本機的活動，把專案、Token、Session 與近期活躍度變成藤蔓、燈光、季節與庭院裡的小小變化。",
    "hero.agentsAria": "支援的本地 Agent 來源",
    "hero.download": "下載最新版",
    "hero.explore": "看看它如何生長",
    "hero.imageAlt": "Pixel Agent Garden 的 2.5D 像素庭院，包含亭子、錦鯉池、樹木、專案藤蔓和小貓",
    "hero.caption": "專案正在生長，資料仍留在原地。",
    "trust.aria": "專案承諾",
    "trust.localTitle": "100% 本地",
    "trust.localCopy": "掃描與渲染不連網",
    "trust.telemetryTitle": "零遙測",
    "trust.telemetryCopy": "無 analytics 與遠端日誌",
    "trust.readonlyTitle": "來源目錄唯讀",
    "trust.readonlyCopy": "只寫應用自己的快取",
    "trust.openTitle": "MIT 開源",
    "trust.openCopy": "實作與隱私邊界可核驗",
    "growth.titleLead": "工作留下的痕跡，",
    "growth.titleTail": "不該只剩一串日誌。",
    "growth.copy": "花園不是另一個催促你的儀表板。它安靜地待在桌面上，先讓你看見什麼正在生長；需要數字時，再打開本地資料抽屜。",
    "growth.1.title": "專案成為藤蔓",
    "growth.1.copy": "每個專案有自己的生長軌跡；即使目錄同名，也能被分別看見。",
    "growth.2.title": "Token 塑造庭院",
    "growth.2.copy": "使用量、快取活動與模型構成，逐漸改變庭院的豐盛程度。",
    "growth.3.title": "Session 留下足跡",
    "growth.3.copy": "一次次建置與思考，變成石階、貓、樹木與亭中的陳設。",
    "growth.4.title": "近期活動點亮燈籠",
    "growth.4.copy": "時間、季節與最近的工作，讓花園在每次打開時都略有不同。",
    "views.titleLead": "一座庭院，",
    "views.titleTail": "兩種觀看方式。",
    "views.copy": "同一份本地摘要，同時驅動沉浸式 2.5D 庭院與更直接的 Wall 專案活動地圖。",
    "views.courtyardAlt": "Pixel Agent Garden 的 2.5D 庭院視圖",
    "views.courtyardCopy": "亭子、池塘、樹木與季節細節，隨活動慢慢出現。",
    "views.wallAlt": "Pixel Agent Garden Wall 視圖，牆上有專案藤蔓與程式貼紙",
    "views.wallCopy": "每個專案成為一根藤蔓，程式貼紙標記花園裡的技術生態。",
    "features.titleLead": "安靜地看見，",
    "features.titleTail": "需要時再深入。",
    "feature.1.title": "本地 Insight",
    "feature.1.copy": "查看專案排名、模型構成、每日活動、快取比例與本地成本估算。",
    "feature.2.title": "Agent 苗圃",
    "feature.2.copy": "Claude Code、Claude Cowork 與 Codex，都在同一座花園裡留下照料痕跡。",
    "feature.3.title": "安靜的系統匣助手",
    "feature.3.copy": "Watcher、立即掃描、顯示隱藏與可設定快速鍵，都留在隨手可及的位置。",
    "feature.4.title": "只在本地的分享卡",
    "feature.4.copy": "匯出庭院、週報、時令卡與年度回顧 PNG；不會自動上傳。",
    "feature.5.title": "桌面與 CLI",
    "feature.5.copy": "常駐 Tauri 庭院，也可以在終端查看 usage、adapter、cost 與 doctor。",
    "feature.6.title": "值得告訴你的變化",
    "feature.6.copy": "只有花園真的成長過，回來時才用一小段文字告訴你發生了什麼。",
    "pipeline.titleLead": "活動變成風景，",
    "pipeline.titleTail": "資料仍留在原地。",
    "pipeline.1.title": "讀取本機記錄",
    "pipeline.2.title": "Adapter 統一格式",
    "pipeline.3.title": "Rust Core 彙整",
    "pipeline.4.title": "渲染到本地表面",
    "privacy.titleLead": "花園會生長。",
    "privacy.titleTail": "你的資料不會離開電腦。",
    "privacy.1": "掃描、渲染與報告均在本地完成",
    "privacy.2": "無 analytics、telemetry 或遠端崩潰報告",
    "privacy.3": "Agent 來源目錄始終唯讀",
    "privacy.4": "Postcard 與回顧卡只匯出為本地 PNG",
    "privacy.policy": "閱讀隱私與安全說明",
    "privacy.architecture": "查看本地架構",
    "install.titleLead": "三步，",
    "install.titleTail": "讓花園開始生長。",
    "install.release": "前往官方 Releases",
    "install.1.title": "選擇平台",
    "install.1.copy": "macOS 下載 DMG；Windows 下載 setup.exe；Linux 選擇 AppImage 或 deb。",
    "install.2.title": "從官方 Release 安裝",
    "install.2.copy": "目前 macOS 與 Windows 社群建置尚未簽名；首次打開請依照專案說明操作。",
    "install.3.title": "完成首次本地掃描",
    "install.3.copy": "應用讀取既有 Agent 的本地活動，花園隨即開始生長；系統匣 watcher 會繼續自動更新。",
    "install.sourceSummary": "想從原始碼執行？",
    "install.sourceCopy": "需要 Rust 1.85+ 與 Tauri 2 CLI。",
    "faq.title": "第一次來花園？",
    "faq.1.q": "支援哪些 AI Agent？",
    "faq.1.a": "目前原生適配 Claude Code、Claude Cowork 與 Codex。其他來源可以使用文件中的 manual JSONL 格式。",
    "faq.2.q": "它會上傳我的程式碼或會話記錄嗎？",
    "faq.2.a": "不會。掃描與渲染都在本機完成，沒有 analytics、telemetry、遠端日誌或遠端崩潰報告。",
    "faq.3.q": "它會修改 Claude 或 Codex 的檔案嗎？",
    "faq.3.a": "不會。來源目錄始終作為唯讀輸入；應用只在 ~/.local-agent-garden/ 寫自己的狀態。",
    "faq.4.q": "支援哪些作業系統？",
    "faq.4.a": "官方 Releases 提供 macOS、Windows 與 Linux 建置；Linux 可選擇 AppImage 或 deb。",
    "faq.5.q": "為什麼安裝時可能出現安全提示？",
    "faq.5.a": "目前 macOS 與 Windows 社群建置尚未簽名。請只從官方 Releases 下載，並依照首次啟動說明操作。",
    "faq.6.q": "本地成本估算等於實際帳單嗎？",
    "faq.6.a": "不等於。它依據本地 Token 彙整與內建價格表估算趨勢；無法定價的模型會明確標示。",
    "closing.titleLead": "讓下一次 Agent 會話，",
    "closing.titleTail": "也長成風景。",
    "closing.copy": "不增加一個雲端帳戶，也不把工作記錄交給另一個服務。只需打開花園。",
    "closing.download": "下載最新版",
    "closing.github": "在 GitHub 查看",
    "closing.note": "100% 本地 · 零遙測 · MIT 開源",
    "footer.copy": "一個由本機 AI Agent 活動長出來的私有桌面花園。",
    "footer.install": "安裝說明",
  },
};

const stored = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const persist = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The control still works for this page when storage is unavailable.
  }
};

const normalizeTheme = (value) => (THEMES.includes(value) ? value : "auto");
const normalizeLang = (value) => (LANGS.includes(value) ? value : "en");

const resolvedThemeColor = (theme) => {
  const dark = theme === "dark" || (theme === "auto" && prefersDark.matches);
  return dark ? "#171a13" : "#f1e8cd";
};

function applyTheme(nextTheme, shouldPersist = true) {
  const theme = normalizeTheme(nextTheme);
  root.dataset.theme = theme;
  themeColor?.setAttribute("content", resolvedThemeColor(theme));
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
  });
  if (shouldPersist) persist(THEME_KEY, theme);
}

function applyLang(nextLang, shouldPersist = true) {
  const lang = normalizeLang(nextLang);
  const translated = copy[lang] || copy.en;
  root.dataset.lang = lang;
  root.lang = LANG_TAGS[lang];

  textNodes.forEach((node) => {
    node.textContent = translated[node.dataset.i18n] || baseCopy[node.dataset.i18n] || node.dataset.i18n;
  });
  altNodes.forEach((node) => {
    node.setAttribute("alt", translated[node.dataset.i18nAlt] || baseAlt[node.dataset.i18nAlt] || "");
  });
  ariaNodes.forEach((node) => {
    node.setAttribute("aria-label", translated[node.dataset.i18nAriaLabel] || baseAria[node.dataset.i18nAriaLabel] || "");
  });

  const metaDescription = translated["meta.description"] || copy.en["meta.description"];
  description?.setAttribute("content", metaDescription);
  document.querySelectorAll("[data-lang-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.langChoice === lang));
  });
  if (shouldPersist) persist(LANG_KEY, lang);
}

document.querySelectorAll("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
});

document.querySelectorAll("[data-lang-choice]").forEach((button) => {
  button.addEventListener("click", () => applyLang(button.dataset.langChoice));
});

prefersDark.addEventListener("change", () => {
  if (root.dataset.theme === "auto") applyTheme("auto", false);
});

applyTheme(normalizeTheme(root.dataset.theme || stored(THEME_KEY)), false);
applyLang(normalizeLang(root.dataset.lang || stored(LANG_KEY)), false);
