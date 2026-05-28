# Rust + Tauri Workspace

> 设计 spec: [docs/11-tauri-rust-rewrite-spec.md](./docs/11-tauri-rust-rewrite-spec.md)

## 当前状态 · Status

| Phase | 范围 | 状态 |
|---|---|---|
| Phase 1 | core crate + CLI 完整 port + Python 兼容性 | ✅ 退出门禁过 |
| Phase 2 | Tauri shell + notify watcher + 前端 live updates | ✅ 完工 |
| Phase 3 | 系统集成 / 打包 / 签名 | 待办 |

## 仓库结构 · Layout

```
Cargo.toml                          ← workspace 根
crates/
├── core/                           ← 纯库, 无 UI/IPC 依赖
│   └── src/{event, adapter, error, registry, scan, aggregate, storage}.rs
│       + adapters/{claude_code, codex, manual_jsonl, util}.rs
├── cli/                            ← agent-garden 二进制
│   └── src/{main, ascii_wall}.rs
└── tauri-app/                      ← Local Agent Garden.app
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/{main, commands, watcher, events}.rs
web/                                ← 像素艺术前端 (HTML+CSS+JS)
├── index.html                      ← Tauri 检测 + 数据渲染
├── data/garden-summary.json        ← 浏览器 fallback 用
└── assets/                         ← build.rs 生成的 Tauri 资源副本 (不提交)
assets/sprites/                     ← 像素艺术原资产 (唯一源头)
local_agent_garden/                 ← Python 老树, 暂留作对照参考
```

## 上手 · Getting started

依赖 Rust 1.85+ + Tauri 2 CLI:
```bash
cargo install tauri-cli --version "^2.0" --locked
```

跑测试 / dev / 桌面 app:
```bash
# Library + CLI 测试 (34 个)
cargo test --workspace

# CLI 子命令 (Rust 端, 替代 python -m local_agent_garden ...)
cargo run --release -p local-agent-garden-cli -- adapters
cargo run --release -p local-agent-garden-cli -- scan --out /tmp/events.json
cargo run --release -p local-agent-garden-cli -- projects
cargo run --release -p local-agent-garden-cli -- inspect --project pay-module
cargo run --release -p local-agent-garden-cli -- garden        # ASCII vine wall
cargo run --release -p local-agent-garden-cli -- export-web    # 写 web/data/garden-summary.json

# 桌面 app (开发模式, hot reload)
cd crates/tauri-app && cargo tauri dev
```

`crates/tauri-app/build.rs` 会在 Tauri build/dev 前把根目录 `assets/`
同步到 `web/assets/`, 让桌面 shell 使用相对路径 `./assets/...`.
浏览器 fallback 仍然读取 `../assets/...`.

调试 watcher 时打开冗余日志:
```bash
AGENT_GARDEN_DEBUG=1 cargo tauri dev
```

## Phase 1 兼容性测试 (退出门禁)

Rust scan 和 Python scan 必须输出字节级一致:
```bash
python3 -m local_agent_garden scan --out /tmp/py-events.json
cargo run --release -p local-agent-garden-cli -- scan --out /tmp/rs-events.json
diff <(jq -S . /tmp/py-events.json) <(jq -S . /tmp/rs-events.json) | wc -l
# 0 行差 = 通过
```

export-web 输出同样要求字节级一致.

## Phase 2 实时数据链路

```
~/.claude/projects/*.jsonl 改变
  ↓
[notify::recommended_watcher] (~5ms)
  ↓
unbounded channel → debounce 窗口 800ms
  ↓
scan::collect_events + aggregate::summarize (~100-300ms)
  ↓
AppHandle.emit("garden:updated", &summary)
  ↓
window.__TAURI__.event.listen("garden:updated", ...)
  ↓
renderEverything(groups, summary) — 重画 sprite 层, base SVG 不动
```

watcher 在 `tauri-app/src/watcher.rs`, 完全不依赖 core 内部 — 只用 `Adapter::watch_paths()` trait 方法.

## 模块化铁律 (spec §10)

1. `core` 不准 import `tauri::`. CI lint: 禁止 core/Cargo.toml 出现 tauri / wry
2. Adapter 之间不互相调用. 跨 adapter 逻辑放 `scan.rs`
3. CLI command 处理器只是薄壳, 业务逻辑在 core
4. watcher 对 core 无知, 只看 `Vec<PathBuf>`
5. 前端只住 `web/`. crates/ 里不出现 JS/TS
6. 错误是类型化的. `core::Error` 是 enum, 公开 API 无 `Box<dyn Error>`

## 下一步 (Phase 3)

- 系统集成: 状态栏 token badge, 应用菜单, 自启选项
- 打包: macOS `.dmg` 含签名 + 公证, Windows `.msi`, Linux AppImage
- 真 icon set (现在 stone_cat 临时凑数)
- 视觉真生长: vine "长" 动画 / trinket 解锁掉落动画
- Python `local_agent_garden/` 树挪到 `legacy/` 或删除

## 测试状态

```
34 tests passed (0 failed)
├── adapters::claude_code    6 tests
├── adapters::codex          5 tests
├── adapters::util           4 tests
├── aggregate                7 tests
├── event                    6 tests
├── registry                 1 test
└── (others)                 5 tests
```

Run `cargo test --workspace` to verify.
