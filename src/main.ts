import { ItemView, Notice, Plugin, TFile, WorkspaceLeaf, getLanguage } from "obsidian";

const VIEW_TYPE = "kts-timeline-view";
/** 与 manifest.json 的 version 保持一致 */
const PLUGIN_VERSION = "1.0.0";
/** 命中笔记上限，避免超大仓库卡死 */
const MAX_DOCS = 500;
/** 单文件读取上限（跳过超大文件） */
const MAX_FILE_SIZE = 2 * 1024 * 1024;

const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const isZh = (): boolean => getLanguage().toLowerCase().startsWith("zh");

/** 界面文案：中文 / 英文两套，跟随 Obsidian 语言 */
function T() {
    if (isZh()) {
        return {
            viewName: "时间线搜索",
            placeholder: "搜索关键词，空格分词",
            sortByModified: "修改时间",
            sortByCreated: "创建时间",
            idle: "输入关键词，结果会按时间铺在时间线上",
            searching: "搜索中…",
            noResult: "没有找到包含该关键词的笔记",
            noResultInFilter: "该时间范围内没有内容",
            resultDocs: "篇笔记",
            resultBlocks: "处命中",
            today: "今天",
            yesterday: "昨天",
            unknownTime: "未知时间",
            untitled: "未命名笔记",
            moreHits: "还有",
            hitUnit: "处命中",
            searchFailed: "搜索失败：",
            chipAll: "全部",
            chip7: "7天",
            chip30: "30天",
            chip90: "90天",
            chip365: "1年",
            docUnit: () => "篇",
            open: "打开笔记",
            hint: "快捷键 Mod+Alt+F 可随时唤出",
        };
    }
    return {
        viewName: "Timeline Search",
        placeholder: "Search keywords, space-separated",
        sortByModified: "Modified",
        sortByCreated: "Created",
        idle: "Type a keyword — results land on the timeline",
        searching: "Searching…",
        noResult: "No notes contain that keyword",
        noResultInFilter: "Nothing in this time range",
        resultDocs: "notes",
        resultBlocks: "hits",
        today: "Today",
        yesterday: "Yesterday",
        unknownTime: "Unknown time",
        untitled: "Untitled",
        moreHits: "and",
        hitUnit: "more",
        searchFailed: "Search failed: ",
        chipAll: "All",
        chip7: "7 days",
        chip30: "30 days",
        chip90: "90 days",
        chip365: "1 year",
        docUnit: (n: number) => (n === 1 ? "note" : "notes"),
        open: "Open note",
        hint: "Press Mod+Alt+F to summon it anytime",
    };
}

const TYPE_LABELS: Record<string, { zh: string; en: string }> = {
    p: { zh: "段落", en: "Text" },
    h: { zh: "标题", en: "Heading" },
    c: { zh: "代码", en: "Code" },
    t: { zh: "表格", en: "Table" },
    b: { zh: "引述", en: "Quote" },
    l: { zh: "列表", en: "List" },
    m: { zh: "公式", en: "Math" },
    html: { zh: "HTML", en: "HTML" },
};

interface HitRow {
    line: number;
    type: string;
    content: string;
}

interface EntryHit {
    key: string;
    type: string;
    content: string;
    line: number;
}

interface DocEntry {
    path: string;
    title: string;
    /** YYYYMMDDHHmm，沿用思源版的时间字符串格式，便于复用同一套格式化函数 */
    time: string;
    hits: EntryHit[];
}

type TimeFilter = { type: "all" } | { type: "days"; days: number };

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** 毫秒时间戳 → YYYYMMDDHHmm */
function tsToStamp(ms: number): string {
    const d = new Date(ms);
    const p = (n: number, len = 2) => String(n).padStart(len, "0");
    return `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function parseTime(s: string | null): Date | null {
    if (!s || s.length < 14) return null;
    return new Date(
        parseInt(s.slice(0, 4), 10),
        parseInt(s.slice(4, 6), 10) - 1,
        parseInt(s.slice(6, 8), 10),
        parseInt(s.slice(8, 10), 10),
        parseInt(s.slice(10, 12), 10)
    );
}

function formatFullTime(s: string | null): string {
    if (!s || s.length < 12) return s || "";
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
}

function hhmm(s: string): string {
    return s.length >= 12 ? `${s.slice(8, 10)}:${s.slice(10, 12)}` : "";
}

function dayLabel(s: string, todayLabel: string, yesterdayLabel: string): string {
    const d = parseTime(s);
    if (!d) return "";
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
    if (diff === 0) return todayLabel;
    if (diff === 1) return yesterdayLabel;
    if (isZh()) {
        const base = `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS_ZH[d.getDay()]}`;
        return d.getFullYear() === now.getFullYear() ? base : `${d.getFullYear()}年${base}`;
    }
    const base = `${d.toLocaleString("en", { month: "short" })} ${d.getDate()} ${WEEKDAYS_EN[d.getDay()]}`;
    return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

function monthLabel(s: string): string {
    const d = parseTime(s);
    if (!d) return "";
    return isZh() ? `${d.getFullYear()}年${d.getMonth() + 1}月` : `${d.toLocaleString("en", { month: "long" })} ${d.getFullYear()}`;
}

/** 去掉 markdown 标记，只留可读文本（用于片段展示；展示前统一 HTML 转义） */
function stripMd(line: string): string {
    return line
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|\*|_|~~|`)/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/** 根据行首特征判断块类型 */
function lineType(line: string): string {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) return "c";
    if (/^#{1,6}\s/.test(t)) return "h";
    if (/^>/.test(t)) return "b";
    if (/^\|.*\|/.test(t)) return "t";
    if (/^\$\$/.test(t)) return "m";
    if (/^([-*+]|\d+[.)])\s/.test(t)) return "l";
    if (/^<[a-z]/i.test(t)) return "html";
    return "p";
}

/** 围绕关键词位置截取上下文片段 */
function snippetAround(content: string, keywords: string[], radius = 55): string {
    const compact = content.replace(/\s+/g, " ").trim();
    let idx = -1;
    for (const kw of keywords) {
        const i = compact.toLowerCase().indexOf(kw.toLowerCase());
        if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    }
    if (idx < 0) {
        return compact.length > radius * 2 ? compact.slice(0, radius * 2) + "…" : compact;
    }
    const start = Math.max(0, idx - radius);
    const end = Math.min(compact.length, idx + keywords[0].length + radius);
    return (start > 0 ? "…" : "") + compact.slice(start, end) + (end < compact.length ? "…" : "");
}

/** 关键词高亮（入参已 HTML 转义） */
function highlight(escaped: string, keywords: string[]): string {
    let result = escaped;
    for (const kw of keywords) {
        const pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try {
            result = result.replace(new RegExp(pattern, "gi"), (m) => `<mark>${m}</mark>`);
        } catch (e) {
            // 忽略非法正则
        }
    }
    return result;
}

class TimelineView extends ItemView {
    private plugin: KeywordTimeSearchPlugin;
    private inputEl: HTMLInputElement | null = null;
    private keywords: string[] = [];
    private sortMode: "updated" | "created" = "updated";
    private timeFilter: TimeFilter = { type: "all" };
    private expanded = new Set<string>();
    private entries: DocEntry[] = [];
    private entryCache = new Map<string, DocEntry>();
    private hitMap = new Map<string, { path: string; line: number }>();
    private seq = 0;
    private timer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: KeywordTimeSearchPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return T().viewName;
    }

    getIcon(): string {
        return "search";
    }

    focusInput() {
        this.inputEl?.focus();
        this.inputEl?.select();
    }

    async onOpen() {
        const t = T();
        const root = this.contentEl;
        root.empty();
        root.addClass("kts-view-root");
        root.innerHTML = `<div class="kts-wrap">
  <div class="kts-head">
    <label class="kts-search">
      <span class="kts-search-icon">${SEARCH_ICON}</span>
      <input class="kts-input" type="text" placeholder="${escapeHtml(t.placeholder)}" />
    </label>
    <div class="kts-seg">
      <button class="kts-seg-btn kts-on" data-sort="updated">${escapeHtml(t.sortByModified)}</button>
      <button class="kts-seg-btn" data-sort="created">${escapeHtml(t.sortByCreated)}</button>
    </div>
  </div>
  <div class="kts-meta"></div>
  <div class="kts-chips"></div>
  <div class="kts-scroll">
    <div class="kts-timeline">
      <div class="kts-hint">${escapeHtml(t.idle)}</div>
    </div>
  </div>
</div>`;

        this.inputEl = root.querySelector<HTMLInputElement>(".kts-input");

        root.querySelectorAll<HTMLButtonElement>(".kts-seg-btn").forEach((btn) => {
            this.registerDomEvent(btn, "click", () => {
                const mode = btn.getAttribute("data-sort") === "created" ? "created" : "updated";
                if (mode === this.sortMode) return;
                this.sortMode = mode;
                root.querySelectorAll(".kts-seg-btn").forEach((b) => b.classList.remove("kts-on"));
                btn.classList.add("kts-on");
                if (this.entries.length > 0) void this.search();
            });
        });

        const input = this.inputEl;
        if (input) {
            this.registerDomEvent(input, "input", () => {
                if (this.timer !== null) window.clearTimeout(this.timer);
                this.timer = window.setTimeout(() => void this.search(), 400);
            });
            this.registerDomEvent(input, "keydown", (e: KeyboardEvent) => {
                if (e.key === "Enter") {
                    if (this.timer !== null) window.clearTimeout(this.timer);
                    void this.search();
                }
            });
        }

        const chips = root.querySelector<HTMLElement>(".kts-chips");
        if (chips) {
            this.registerDomEvent(chips, "click", (e: MouseEvent) => {
                const chip = (e.target as HTMLElement).closest("[data-days]");
                if (!chip) return;
                const days = parseInt(chip.getAttribute("data-days") || "0", 10);
                this.timeFilter = days > 0 ? { type: "days", days } : { type: "all" };
                this.renderAll();
            });
        }

        const scroll = root.querySelector<HTMLElement>(".kts-scroll");
        if (scroll) {
            this.registerDomEvent(scroll, "click", (e: MouseEvent) => {
                const target = e.target as HTMLElement;

                const moreBtn = target.closest("[data-more]");
                if (moreBtn) {
                    const idx = parseInt(moreBtn.getAttribute("data-more") || "-1", 10);
                    const entry = this.entries[idx];
                    const box = scroll.querySelector<HTMLElement>(`[data-snips="${idx}"]`);
                    if (entry && box) {
                        box.innerHTML = this.renderSnippets(entry.hits, entry.hits.length);
                        this.expanded.add(entry.path);
                    }
                    moreBtn.remove();
                    return;
                }

                const hitEl = target.closest("[data-hit]");
                if (hitEl) {
                    const hit = this.hitMap.get(hitEl.getAttribute("data-hit") || "");
                    if (hit) void this.openAt(hit.path, hit.line);
                    return;
                }

                const openEl = target.closest("[data-open]");
                if (openEl) {
                    const idx = parseInt(openEl.getAttribute("data-open") || "-1", 10);
                    const entry = this.entries[idx];
                    if (entry) void this.openAt(entry.path, 0);
                }
            });
        }

        window.setTimeout(() => this.focusInput(), 60);
    }

    async onClose() {
        this.seq++;
        if (this.timer !== null) window.clearTimeout(this.timer);
    }

    private async openAt(path: string, line: number) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            new Notice(`文件不存在：${path}`);
            return;
        }
        const leaf = this.plugin.app.workspace.getLeaf(false);
        await leaf.openFile(file, { eState: { line } });
        this.plugin.app.workspace.revealLeaf(leaf);
    }

    private timeOf(file: TFile): number {
        return this.sortMode === "created" ? file.stat.ctime : file.stat.mtime;
    }

    private renderSnippets(hits: EntryHit[], limit: number): string {
        const zh = isZh();
        return hits
            .slice(0, limit)
            .map((hit) => {
                const label = TYPE_LABELS[hit.type] || TYPE_LABELS.p;
                const typeLabel = zh ? label.zh : label.en;
                return `<div class="kts-snip" data-hit="${hit.key}">
  <span class="kts-tag">${escapeHtml(typeLabel)}</span>
  <span class="kts-text">${highlight(escapeHtml(snippetAround(hit.content, this.keywords)), this.keywords)}</span>
</div>`;
            })
            .join("");
    }

    private renderChips(entries: DocEntry[]): string {
        if (entries.length === 0) return "";
        const t = T();
        const now = Date.now();
        const chips: { days: number; label: string }[] = [
            { days: 0, label: t.chipAll },
            { days: 7, label: t.chip7 },
            { days: 30, label: t.chip30 },
            { days: 90, label: t.chip90 },
            { days: 365, label: t.chip365 },
        ];
        return chips
            .map((c) => {
                const count =
                    c.days === 0
                        ? entries.length
                        : entries.filter((e) => {
                              const d = parseTime(e.time);
                              return d !== null && now - d.getTime() <= c.days * 86400000;
                          }).length;
                const active =
                    (c.days === 0 && this.timeFilter.type === "all") ||
                    (this.timeFilter.type === "days" && this.timeFilter.days === c.days);
                return `<button class="kts-chip${active ? " kts-chip-on" : ""}" data-days="${c.days}">${escapeHtml(c.label)}<em>${count}</em></button>`;
            })
            .join("");
    }

    private filterEntries(entries: DocEntry[]): DocEntry[] {
        if (this.timeFilter.type === "all") return entries;
        const now = Date.now();
        const limit = this.timeFilter.days * 86400000;
        return entries.filter((e) => {
            const d = parseTime(e.time);
            return d !== null && now - d.getTime() <= limit;
        });
    }

    private renderAll() {
        const t = T();
        const root = this.contentEl;
        const metaEl = root.querySelector<HTMLElement>(".kts-meta");
        const chipsEl = root.querySelector<HTMLElement>(".kts-chips");
        const timelineEl = root.querySelector<HTMLElement>(".kts-timeline");
        if (!metaEl || !chipsEl || !timelineEl) return;

        const shown = this.filterEntries(this.entries);
        chipsEl.innerHTML = this.renderChips(this.entries);

        let hitCount = 0;
        for (const e of shown) hitCount += e.hits.length;

        if (shown.length === 0) {
            metaEl.textContent = "";
            timelineEl.innerHTML = `<div class="kts-empty">
  <div class="kts-empty-icon">${SEARCH_ICON}</div>
  <div class="kts-empty-text">${escapeHtml(this.entries.length === 0 ? t.noResult : t.noResultInFilter)}</div>
</div>`;
            return;
        }

        const times = shown
            .map((e) => e.time)
            .filter((x) => x.length >= 12)
            .sort();
        const span =
            times.length > 1
                ? `${formatFullTime(times[0]).slice(0, 10)} — ${formatFullTime(times[times.length - 1]).slice(0, 10)}`
                : formatFullTime(times[0] || "").slice(0, 10);
        metaEl.innerHTML = `<b>${shown.length}</b> ${escapeHtml(t.resultDocs)} · <b>${hitCount}</b> ${escapeHtml(
            t.resultBlocks
        )}${span ? ` · <span class="kts-span">${escapeHtml(span)}</span>` : ""}<span class="kts-ver">v${PLUGIN_VERSION}</span>`;

        const dayCount = new Map<string, number>();
        for (const e of shown) {
            const key = (e.time || "").slice(0, 8) || "unknown";
            dayCount.set(key, (dayCount.get(key) || 0) + 1);
        }

        const parts: string[] = [];
        let lastMonth = "";
        let lastDay = "";
        const indexOf = new Map<string, number>();
        shown.forEach((e, i) => indexOf.set(e.path, i));

        for (const entry of shown) {
            const idx = indexOf.get(entry.path) ?? 0;
            const month = entry.time.slice(0, 6);
            if (month && month !== lastMonth) {
                lastMonth = month;
                parts.push(`<div class="kts-month"><span>${escapeHtml(monthLabel(entry.time))}</span></div>`);
            }
            const day = entry.time.slice(0, 8) || "unknown";
            if (day !== lastDay) {
                lastDay = day;
                const label = day === "unknown" ? t.unknownTime : dayLabel(entry.time, t.today, t.yesterday);
                const cnt = dayCount.get(day) || 0;
                parts.push(
                    `<div class="kts-day"><span class="kts-day-label">${escapeHtml(label)}</span><span class="kts-day-count">${cnt} ${escapeHtml(
                        t.docUnit(cnt)
                    )}</span></div>`
                );
            }

            const showAll = this.expanded.has(entry.path);
            const limit = showAll ? entry.hits.length : 3;
            const rest = entry.hits.length - limit;
            parts.push(`<div class="kts-node">
  <span class="kts-dot"></span>
  <div class="kts-card">
    <div class="kts-card-head">
      <span class="kts-title" data-open="${idx}" title="${escapeHtml(t.open)}">${highlight(
                escapeHtml(entry.title),
                this.keywords
            )}</span>
      <span class="kts-time">${hhmm(entry.time)}</span>
    </div>
    <div class="kts-snips" data-snips="${idx}">${this.renderSnippets(entry.hits, limit)}</div>
    ${rest > 0 ? `<button class="kts-more" data-more="${idx}">${escapeHtml(t.moreHits)} ${rest} ${escapeHtml(t.hitUnit)}</button>` : ""}
  </div>
</div>`);
        }

        timelineEl.innerHTML = parts.join("");
    }

    private async search() {
        const t = T();
        const root = this.contentEl;
        const timelineEl = root.querySelector<HTMLElement>(".kts-timeline");
        const metaEl = root.querySelector<HTMLElement>(".kts-meta");
        const chipsEl = root.querySelector<HTMLElement>(".kts-chips");
        if (!timelineEl || !metaEl || !chipsEl) return;

        const raw = this.inputEl?.value || "";
        const keywords = raw.trim().split(/\s+/).filter((k) => k.length > 0);
        if (keywords.length === 0) {
            this.keywords = [];
            this.entries = [];
            this.hitMap.clear();
            metaEl.textContent = "";
            chipsEl.innerHTML = "";
            timelineEl.innerHTML = `<div class="kts-hint">${escapeHtml(t.idle)}</div>`;
            return;
        }
        this.keywords = keywords;

        const seq = ++this.seq;
        metaEl.textContent = t.searching;
        chipsEl.innerHTML = "";
        timelineEl.innerHTML = "";

        const lower = keywords.map((k) => k.toLowerCase());
        const files = this.plugin.app.vault.getMarkdownFiles().slice();
        files.sort((a, b) => this.timeOf(b) - this.timeOf(a));

        const entries: DocEntry[] = [];
        this.hitMap.clear();
        let hitSeq = 0;

        try {
            for (const file of files) {
                if (entries.length >= MAX_DOCS) break;
                if (file.stat.size > MAX_FILE_SIZE) continue;

                const text = await this.plugin.app.vault.cachedRead(file);
                const lowerText = text.toLowerCase();
                if (!lower.every((k) => lowerText.includes(k))) continue;

                const lines = text.split("\n");
                const hits: EntryHit[] = [];
                for (let i = 0; i < lines.length; i++) {
                    const lineLower = lines[i].toLowerCase();
                    if (!lower.every((k) => lineLower.includes(k))) continue;
                    const content = stripMd(lines[i]);
                    if (!content) continue;
                    const key = `h${hitSeq++}`;
                    this.hitMap.set(key, { path: file.path, line: i });
                    hits.push({ key, type: lineType(lines[i]), content, line: i });
                }
                if (hits.length === 0) continue;

                entries.push({
                    path: file.path,
                    title: file.basename,
                    time: tsToStamp(this.timeOf(file)),
                    hits,
                });

                // 每 40 篇让出主线程，避免大仓库搜索时界面卡住
                if (entries.length % 40 === 0) await new Promise((r) => setTimeout(r, 0));
                if (seq !== this.seq) return;
            }
        } catch (err) {
            if (seq !== this.seq) return;
            const msg = err instanceof Error ? err.message : String(err);
            metaEl.textContent = "";
            timelineEl.innerHTML = `<div class="kts-empty"><div class="kts-empty-text">${escapeHtml(
                t.searchFailed + msg
            )}</div></div>`;
            new Notice(t.searchFailed + msg);
            return;
        }

        if (seq !== this.seq) return;

        this.entries = entries;
        this.entryCache = new Map(entries.map((e) => [e.path, e]));
        this.timeFilter = { type: "all" };
        this.expanded.clear();
        this.renderAll();
    }
}

export default class KeywordTimeSearchPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE, (leaf) => new TimelineView(leaf, this));

        this.addRibbonIcon("search", T().viewName, () => void this.activateView());

        this.addCommand({
            id: "open-timeline-search",
            name: "按时间搜索关键词 / Search keywords on a timeline",
            hotkeys: [{ modifiers: ["Mod", "Alt"], key: "F" }],
            callback: () => void this.activateView(),
        });
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    }

    async activateView() {
        let leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
        if (leaves.length === 0) {
            const leaf = this.app.workspace.getLeaf("tab");
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
            leaves = [leaf];
        }
        const leaf = leaves[0];
        await this.app.workspace.revealLeaf(leaf);
        const view = leaf.view;
        if (view instanceof TimelineView) view.focusInput();
    }
}
