# Keyword Time Search for Obsidian

Type a keyword and see **every note that contains it, laid out on a vertical timeline**, newest first. One click jumps to any hit — straight to the line.

Obsidian's search answers *"which notes match?"*. This plugin answers *"when did I write about this?"* — the time axis is the point, not a setting.

![Timeline interface](screenshot.png)

## What you get

- **Search bar** — pill-shaped input, space-separated keywords (all must appear on the same line). Toggle the time basis between **modified** and **created**.
- **Filter chips** — `All / 7 / 30 / 90 days / 1 year`, each with a live count, one click to narrow.
- **Vertical timeline** — a center axis with one node per note (dot + card), grouped by day (`Today` / `Yesterday` / `Nov 18 Wed`), month dividers when you cross a month, sticky date headers while scrolling.
- **Snippets** — each card lists up to 3 hits with a block-type tag (Text / Heading / List / Code / …), keyword highlighted. The rest collapse into "and N more".
- **Jump anywhere** — click a title to open the note, click a snippet to open at that exact line.

The stats line shows the current scope: `5 notes · 9 hits · 2026-11-18 — 2026-11-22`, plus the running version so you can confirm which build is loaded.

## Usage

- Click the magnifier in the left ribbon, or
- Command palette → **Search keywords on a timeline**, or
- Press `Ctrl+Alt+F` (`Cmd+Alt+F` on macOS)

The view opens as its own tab, so it sits next to your notes instead of floating on top. The UI follows your Obsidian language (Chinese or English).

## How it differs from core search

| | Core search | This plugin |
|---|---|---|
| Result shape | Flat list of matches | Notes **on a time axis** |
| Time sorting | A setting you must remember | Time-first, always |
| Time exploration | None | Timeline + 7/30/90-day & 1-year filters with counts |
| Interaction | Full retrieval tool | Lightweight recall, type-and-go |

## Compatibility

- Obsidian 1.4.0 or later
- Desktop and mobile
- Colors use Obsidian theme variables — light and dark adapt automatically

## How it works

No indexing, no background process. On search it walks your markdown files via the vault cache, keeps notes where every keyword appears, then groups matching lines into notes and renders them on the timeline. Files larger than 2 MB are skipped, and the result set is capped at 500 notes so a huge vault never locks the UI.

## Support

The plugin is free, with nothing locked. If it helped you dig up notes you had long forgotten, you can buy me a coffee — entirely optional.

<img src="https://raw.githubusercontent.com/shuishuishui018/obsidian-keyword-time-search/main/funding-qr.png" alt="WeChat tip QR" width="240">

Scan with WeChat. Thanks!

---

## 中文说明

输入一个关键词，把所有包含它的笔记按时间倒序铺成一条垂直时间线——每篇笔记是线上的一个节点，卡片里直接列出命中片段，点一下跳到对应行。

- 快捷键 `Ctrl+Alt+F`（macOS 为 `Cmd+Alt+F`），或点左侧边栏的放大镜图标
- 支持空格分词（需同时命中）、`全部 / 7天 / 30天 / 90天 / 1年` 时间筛选
- 界面跟随 Obsidian 语言，深色主题自动适配
- 纯前端实现，无索引、无后台进程，不联网
