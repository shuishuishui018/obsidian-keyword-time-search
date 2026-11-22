import { ItemView, Notice, Plugin, TFile, WorkspaceLeaf, getLanguage, setIcon } from "obsidian";

const VIEW_TYPE = "kts-timeline-view";
/** 与 manifest.json 的 version 保持一致 */
const PLUGIN_VERSION = "1.0.0";
/** 命中笔记上限，避免超大仓库卡死 */
const MAX_DOCS = 500;
/** 单文件读取上限（跳过超大文件） */
const MAX_FILE_SIZE = 2 * 1024 * 1024;

const WEEKDAYS_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const isZh = (): boolean => getLanguage().toLowerCase().startsWith("zh");

/** 界面文案：中文 / 英文两套，跟随 Obsidian 语言 */
function T() {
    if (isZh()) {
        return {
            viewName: "时间线搜索",
            commandName: "按时间线搜索关键词",
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
            moreHits: "还有",
            hitUnit: "处命中",
            searchFailed: "搜索失败：",
            missingFile: "文件不存在：",
            chipAll: "全部",
            chip7: "7天",
            chip30: "30天",
            chip90: "90天",
            chip365: "1年",
            docUnit: (_n: number) => "篇",
            open: "打开笔记",
        };
    }
    return {
        viewName: "Timeline Search",
        commandName: "Search keywords on a timeline",
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
        moreHits: "and",
        hitUnit: "more",
        searchFailed: "Search failed: ",
        missingFile: "File not found: ",
        chipAll: "All",
        chip7: "7 days",
        chip30: "30 days",
        chip90: "90 days",
        chip365: "1 year",
        docUnit: (n: number) => (n === 1 ? "note" : "notes"),
        open: "Open note",
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

interface EntryHit {
    key: string;
    type: string;
    content: string;
}

interface DocEntry {
    path: string;
    title: string;
    /** YYYYMMDDHHmmss，14 位时间串，便于统一格式化 */
    time: string;
    hits: EntryHit[];
}

type TimeFilter = { type: "all" } | { type: "days"; days: number };

/** 毫秒时间戳 → YYYYMMDDHHmmss */
function tsToStamp(ms: number): string {
    const d = new Date(ms);
    const p = (n: number, len = 2) => String(n).padStart(len, "0");
    return `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(
        d.getSeconds()
    )}`;
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

/** 去掉 markdown 标记，只留可读文本 */
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

/**
 * 把文本按关键词切分后写入元素，命中部分用 <mark> 包裹。
 * 全程走 DOM 节点，不拼接 HTML 字符串。
 */
function appendHighlighted(parent: HTMLElement, text: string, keywords: string[]) {
    const kws = keywords.filter((k) => k.length > 0);
    if (kws.length === 0 || !text) {
        if (text) parent.appendText(text);
        return;
    }
    const pattern = kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    let re: RegExp;
    try {
        re = new RegExp(pattern, "gi");
    } catch {
        parent.appendText(text);
        return;
    }
    let last = 0;
    let m = re.exec(text);
    while (m !== null) {
        if (m.index > last) parent.appendText(text.slice(last, m.index));
        if (m[0].length === 0) {
            re.lastIndex++;
        } else {
            parent.createEl("mark", { text: m[0] });
            last = m.index + m[0].length;
        }
        m = re.exec(text);
    }
    if (last < text.length) parent.appendText(text.slice(last));
}

export class TimelineView extends ItemView {
    private plugin: KeywordTimeSearchPlugin;
    private inputEl: HTMLInputElement | null = null;
    private metaEl: HTMLElement | null = null;
    private chipsEl: HTMLElement | null = null;
    private timelineEl: HTMLElement | null = null;
    private keywords: string[] = [];
    private sortMode: "updated" | "created" = "updated";
    private timeFilter: TimeFilter = { type: "all" };
    private expanded = new Set<string>();
    private entries: DocEntry[] = [];
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

        const wrap = root.createDiv({ cls: "kts-wrap" });

        const head = wrap.createDiv({ cls: "kts-head" });
        const searchBox = head.createEl("label", { cls: "kts-search" });
        const iconEl = searchBox.createSpan({ cls: "kts-search-icon" });
        setIcon(iconEl, "search");
        this.inputEl = searchBox.createEl("input", {
            cls: "kts-input",
            attr: { type: "text", placeholder: t.placeholder },
        });

        const seg = head.createDiv({ cls: "kts-seg" });
        const segButtons: { mode: "updated" | "created"; label: string }[] = [
            { mode: "updated", label: t.sortByModified },
            { mode: "created", label: t.sortByCreated },
        ];
        for (const item of segButtons) {
            const btn = seg.createEl("button", {
                cls: item.mode === this.sortMode ? "kts-seg-btn kts-on" : "kts-seg-btn",
                text: item.label,
            });
            btn.setAttr("data-sort", item.mode);
            this.registerDomEvent(btn, "click", () => {
                if (item.mode === this.sortMode) return;
                this.sortMode = item.mode;
                for (const b of Array.from(seg.children)) {
                    b.removeClass("kts-on");
                }
                btn.addClass("kts-on");
                if (this.entries.length > 0) void this.search();
            });
        }

        this.metaEl = wrap.createDiv({ cls: "kts-meta" });
        this.chipsEl = wrap.createDiv({ cls: "kts-chips" });
        const scroll = wrap.createDiv({ cls: "kts-scroll" });
        this.timelineEl = scroll.createDiv({ cls: "kts-timeline" });
        this.timelineEl.createDiv({ cls: "kts-hint", text: t.idle });

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

        this.registerDomEvent(this.chipsEl, "click", (e: MouseEvent) => {
            const chip = (e.target as HTMLElement).closest("[data-days]");
            if (!chip) return;
            const days = parseInt(chip.getAttribute("data-days") || "0", 10);
            this.timeFilter = days > 0 ? { type: "days", days } : { type: "all" };
            this.renderAll();
        });

        this.registerDomEvent(scroll, "click", (e: MouseEvent) => {
            const target = e.target as HTMLElement;

            const moreBtn = target.closest("[data-more]");
            if (moreBtn) {
                const idx = parseInt(moreBtn.getAttribute("data-more") || "-1", 10);
                const entry = this.entries[idx];
                const box = scroll.querySelector<HTMLElement>(`[data-snips="${idx}"]`);
                if (entry && box) {
                    box.empty();
                    for (const hit of entry.hits) this.buildSnippet(hit, box);
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

        window.setTimeout(() => this.focusInput(), 60);
    }

    async onClose() {
        this.seq++;
        if (this.timer !== null) window.clearTimeout(this.timer);
    }

    private async openAt(path: string, line: number) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
            new Notice(T().missingFile + path);
            return;
        }
        const leaf = this.plugin.app.workspace.getLeaf(false);
        await leaf.openFile(file);
        if (line > 0) leaf.setEphemeralState({ line });
        this.plugin.app.workspace.revealLeaf(leaf);
    }

    private timeOf(file: TFile): number {
        return this.sortMode === "created" ? file.stat.ctime : file.stat.mtime;
    }

    private buildSnippet(hit: EntryHit, parent: HTMLElement) {
        const zh = isZh();
        const label = TYPE_LABELS[hit.type] || TYPE_LABELS.p;
        const row = parent.createDiv({ cls: "kts-snip" });
        row.setAttr("data-hit", hit.key);
        row.createSpan({ cls: "kts-tag", text: zh ? label.zh : label.en });
        const textEl = row.createSpan({ cls: "kts-text" });
        appendHighlighted(textEl, snippetAround(hit.content, this.keywords), this.keywords);
    }

    private renderChips(entries: DocEntry[]) {
        const el = this.chipsEl;
        if (!el) return;
        el.empty();
        if (entries.length === 0) return;

        const t = T();
        const now = Date.now();
        const chips: { days: number; label: string }[] = [
            { days: 0, label: t.chipAll },
            { days: 7, label: t.chip7 },
            { days: 30, label: t.chip30 },
            { days: 90, label: t.chip90 },
            { days: 365, label: t.chip365 },
        ];
        for (const c of chips) {
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
            const btn = el.createEl("button", { cls: active ? "kts-chip kts-chip-on" : "kts-chip" });
            btn.setAttr("data-days", String(c.days));
            btn.appendText(c.label);
            btn.createEl("em", { text: String(count) });
        }
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

    /** 空状态：可选图标 + 文案，全部走 DOM 构建 */
    private renderEmpty(text: string, withIcon: boolean) {
        const el = this.timelineEl;
        if (!el) return;
        el.empty();
        const box = el.createDiv({ cls: "kts-empty" });
        if (withIcon) {
            const iconEl = box.createDiv({ cls: "kts-empty-icon" });
            setIcon(iconEl, "search");
        }
        box.createDiv({ cls: "kts-empty-text", text });
    }

    private renderMeta(shown: DocEntry[], hitCount: number, span: string) {
        const el = this.metaEl;
        if (!el) return;
        const t = T();
        el.empty();
        el.createEl("b", { text: String(shown.length) });
        el.appendText(` ${t.resultDocs} · `);
        el.createEl("b", { text: String(hitCount) });
        el.appendText(` ${t.resultBlocks}`);
        if (span) {
            el.appendText(" · ");
            el.createSpan({ cls: "kts-span", text: span });
        }
        el.createSpan({ cls: "kts-ver", text: `v${PLUGIN_VERSION}` });
    }

    private renderAll() {
        const t = T();
        const timelineEl = this.timelineEl;
        if (!timelineEl || !this.metaEl) return;

        const shown = this.filterEntries(this.entries);
        this.renderChips(this.entries);

        let hitCount = 0;
        for (const e of shown) hitCount += e.hits.length;

        if (shown.length === 0) {
            this.metaEl.empty();
            this.renderEmpty(this.entries.length === 0 ? t.noResult : t.noResultInFilter, true);
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
        this.renderMeta(shown, hitCount, span);

        const dayCount = new Map<string, number>();
        for (const e of shown) {
            const key = (e.time || "").slice(0, 8) || "unknown";
            dayCount.set(key, (dayCount.get(key) || 0) + 1);
        }

        const indexOf = new Map<string, number>();
        shown.forEach((e, i) => indexOf.set(e.path, i));

        timelineEl.empty();
        let lastMonth = "";
        let lastDay = "";

        for (const entry of shown) {
            const idx = indexOf.get(entry.path) ?? 0;
            const month = entry.time.slice(0, 6);
            if (month && month !== lastMonth) {
                lastMonth = month;
                timelineEl.createDiv({ cls: "kts-month" }).createSpan({ text: monthLabel(entry.time) });
            }
            const day = entry.time.slice(0, 8) || "unknown";
            if (day !== lastDay) {
                lastDay = day;
                const label = day === "unknown" ? t.unknownTime : dayLabel(entry.time, t.today, t.yesterday);
                const cnt = dayCount.get(day) || 0;
                const dayEl = timelineEl.createDiv({ cls: "kts-day" });
                dayEl.createSpan({ cls: "kts-day-label", text: label });
                dayEl.createSpan({ cls: "kts-day-count", text: `${cnt} ${t.docUnit(cnt)}` });
            }

            const showAll = this.expanded.has(entry.path);
            const limit = showAll ? entry.hits.length : 3;
            const rest = entry.hits.length - limit;

            const node = timelineEl.createDiv({ cls: "kts-node" });
            node.createSpan({ cls: "kts-dot" });
            const card = node.createDiv({ cls: "kts-card" });
            const cardHead = card.createDiv({ cls: "kts-card-head" });

            const titleEl = cardHead.createSpan({ cls: "kts-title" });
            titleEl.setAttr("data-open", String(idx));
            titleEl.setAttr("title", t.open);
            appendHighlighted(titleEl, entry.title, this.keywords);
            cardHead.createSpan({ cls: "kts-time", text: hhmm(entry.time) });

            const snips = card.createDiv({ cls: "kts-snips" });
            snips.setAttr("data-snips", String(idx));
            for (const hit of entry.hits.slice(0, limit)) this.buildSnippet(hit, snips);

            if (rest > 0) {
                const moreBtn = card.createEl("button", { cls: "kts-more" });
                moreBtn.setAttr("data-more", String(idx));
                moreBtn.appendText(`${t.moreHits} ${rest} ${t.hitUnit}`);
            }
        }
    }

    private async search() {
        const t = T();
        const timelineEl = this.timelineEl;
        if (!timelineEl || !this.metaEl || !this.chipsEl) return;

        const raw = this.inputEl?.value || "";
        const keywords = raw.trim().split(/\s+/).filter((k) => k.length > 0);
        if (keywords.length === 0) {
            this.keywords = [];
            this.entries = [];
            this.hitMap.clear();
            this.metaEl.empty();
            this.chipsEl.empty();
            timelineEl.empty();
            timelineEl.createDiv({ cls: "kts-hint", text: t.idle });
            return;
        }
        this.keywords = keywords;

        const seq = ++this.seq;
        this.metaEl.setText(t.searching);
        this.chipsEl.empty();
        timelineEl.empty();

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
                    hits.push({ key, type: lineType(lines[i]), content });
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
            this.metaEl.empty();
            this.renderEmpty(t.searchFailed + msg, false);
            new Notice(t.searchFailed + msg);
            return;
        }

        if (seq !== this.seq) return;

        this.entries = entries;
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
            name: T().commandName,
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
