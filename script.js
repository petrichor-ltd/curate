(function () {
  "use strict";

  const FALLBACK_ENTRIES = [
    {
      id: "2026-06-28",
      date: "2026-06-28",
      title: "在孤獨的底線上，過加法的生活",
      summary: "如果把人生從孤獨開始計算，每一段願意靠近、理解與同行的關係，都會成為生命多給的一份禮物。",
      themes: ["孤獨", "知足", "關係"],
      readingMinutes: 6,
      path: "entries/2026-06-28.md",
    },
    {
      id: "2026-06-27",
      date: "2026-06-27",
      title: "替那些還沒長大的念頭，留一個地方",
      summary: "有些念頭只停留幾秒。每天寫下兩百字，不求完整，只替今天最有重量的感受留一個位置。",
      themes: ["記憶", "書寫", "聲音"],
      readingMinutes: 6,
      path: "entries/2026-06-27.md",
    },
  ];

  const MONTH_PAGE_SIZE = 6;
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
  const VERSION_SECTIONS = {
    original: "1",
    polished: "2",
    video: "3",
    article: "4",
  };
  const VALID_VERSIONS = Object.keys(VERSION_SECTIONS);

  const dom = {
    header: document.querySelector("[data-site-header]"),
    page: document.querySelector("[data-page]"),
    footer: document.querySelector("[data-page-footer]"),
    pageProgress: document.querySelector(".page-progress span"),
    menuToggle: document.querySelector("[data-menu-toggle]"),
    menuLabel: document.querySelector("[data-menu-toggle] .sr-only"),
    nav: document.querySelector("[data-nav]"),
    latestButtons: document.querySelectorAll("[data-open-latest]"),
    latestDate: document.querySelector("[data-latest-date]"),
    latestWeekday: document.querySelector("[data-latest-weekday]"),
    latestTitle: document.querySelector("[data-latest-title]"),
    latestSummary: document.querySelector("[data-latest-summary]"),
    latestThemes: document.querySelector("[data-latest-themes]"),
    latestTime: document.querySelector("[data-latest-time]"),
    entryCount: document.querySelector("[data-entry-count]"),
    archiveGroups: document.querySelector("[data-archive-groups]"),
    emptyState: document.querySelector("[data-empty-state]"),
    loadMore: document.querySelector("[data-load-more]"),
    search: document.querySelector("[data-search]"),
    yearFilter: document.querySelector("[data-year-filter]"),
    themeFilter: document.querySelector("[data-theme-filter]"),
    clearFilters: document.querySelector("[data-clear-filters]"),
    filterToggle: document.querySelector("[data-filter-toggle]"),
    filterPanel: document.querySelector("[data-filter-panel]"),
    reader: document.querySelector("[data-reader]"),
    readerClose: document.querySelector("[data-reader-close]"),
    readerVersion: document.querySelector("[data-reader-version]"),
    readerDate: document.querySelector("[data-reader-date]"),
    readerTitle: document.querySelector("[data-reader-title]"),
    readerThemes: document.querySelector("[data-reader-themes]"),
    readerTime: document.querySelector("[data-reader-time]"),
    readerContent: document.querySelector("[data-reader-content]"),
    readerProgress: document.querySelector("[data-reader-progress]"),
    readerPrev: document.querySelector("[data-reader-prev]"),
    readerNext: document.querySelector("[data-reader-next]"),
  };

  let entries = [];
  let visibleMonthLimit = MONTH_PAGE_SIZE;
  let currentEntryId = null;
  let lastReaderTrigger = null;
  let archiveScrollPosition = 0;
  let currentSections = null;
  const markdownCache = new Map();

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function inlineMarkdown(value) {
    let html = escapeHtml(value);
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
    html = html.replace(
      /(^|[\s>])(https?:\/\/[^\s<]+)/g,
      '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>',
    );
    return html;
  }

  function renderMarkdown(source) {
    const lines = source.replace(/\r\n/g, "\n").trim().split("\n");
    const output = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line) {
        index += 1;
        continue;
      }

      if (/^###\s+/.test(line)) {
        output.push(`<h3>${inlineMarkdown(line.replace(/^###\s+/, ""))}</h3>`);
        index += 1;
        continue;
      }

      if (/^-\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^-\s+/.test(lines[index].trim())) {
          items.push(`<li>${inlineMarkdown(lines[index].trim().replace(/^-\s+/, ""))}</li>`);
          index += 1;
        }
        output.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
          let item = lines[index].trim().replace(/^\d+\.\s+/, "");
          index += 1;
          while (
            index < lines.length &&
            lines[index].trim() &&
            !/^(?:###\s+|-\s+|\d+\.\s+)/.test(lines[index].trim())
          ) {
            item += ` ${lines[index].trim()}`;
            index += 1;
          }
          items.push(`<li>${inlineMarkdown(item)}</li>`);
        }
        output.push(`<ol>${items.join("")}</ol>`);
        continue;
      }

      const paragraph = [line];
      index += 1;
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^(?:###\s+|-\s+|\d+\.\s+)/.test(lines[index].trim())
      ) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    }

    return output.join("");
  }

  function parseSections(markdown) {
    const normalized = markdown.replace(/\r\n/g, "\n");
    const sections = {};
    const markers = [...normalized.matchAll(/^##\s+([1-4])\.[^\n]*\n/gm)];
    markers.forEach((marker, index) => {
      const start = marker.index + marker[0].length;
      const end = markers[index + 1]?.index ?? normalized.length;
      sections[marker[1]] = normalized.slice(start, end).trim();
    });
    return sections;
  }

  function formatDate(date, short = false) {
    const [year, month, day] = date.split("-");
    return short ? `${month}.${day}` : `${year}.${month}.${day}`;
  }

  function weekdayFor(date, full = false) {
    const [year, month, day] = date.split("-").map(Number);
    const weekday = WEEKDAYS[new Date(year, month - 1, day, 12).getDay()];
    return full ? `星期${weekday}` : weekday;
  }

  function formatMonth(month) {
    const [year, number] = month.split("-");
    return `${year} 年 ${Number(number)} 月`;
  }

  function entryHash(id, version) {
    return `#entry/${encodeURIComponent(id)}/${version}`;
  }

  function readHash() {
    const match = window.location.hash.match(/^#entry\/([^/]+)\/(original|polished|video|article)$/);
    return match ? { id: decodeURIComponent(match[1]), version: match[2] } : null;
  }

  function updateLatest() {
    const latest = entries[0];
    if (!latest) return;
    dom.latestDate.dateTime = latest.date;
    dom.latestDate.textContent = formatDate(latest.date);
    dom.latestWeekday.textContent = weekdayFor(latest.date, true);
    dom.latestTitle.textContent = latest.title;
    dom.latestSummary.textContent = latest.summary;
    if (dom.latestThemes) dom.latestThemes.textContent = latest.themes.join(" · ");
    if (dom.latestTime) dom.latestTime.textContent = `約 ${latest.readingMinutes} 分鐘`;
  }

  function createOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function populateFilters() {
    const years = [...new Set(entries.map((entry) => entry.date.slice(0, 4)))].sort().reverse();
    const themes = [...new Set(entries.flatMap((entry) => entry.themes))].sort((a, b) =>
      a.localeCompare(b, "zh-Hant"),
    );
    dom.yearFilter.replaceChildren(createOption("all", "全部年份"));
    dom.themeFilter.replaceChildren(createOption("all", "全部標籤"));
    years.forEach((year) => dom.yearFilter.append(createOption(year, `${year} 年`)));
    themes.forEach((theme) => dom.themeFilter.append(createOption(theme, theme)));
  }

  function currentFilteredEntries() {
    const query = dom.search.value.trim().toLocaleLowerCase("zh-Hant");
    const year = dom.yearFilter.value;
    const theme = dom.themeFilter.value;
    return entries.filter((entry) => {
      const searchable = [entry.title, entry.summary, ...entry.themes]
        .join(" ")
        .toLocaleLowerCase("zh-Hant");
      return (
        (!query || searchable.includes(query)) &&
        (year === "all" || entry.date.startsWith(year)) &&
        (theme === "all" || entry.themes.includes(theme))
      );
    });
  }

  function createArchiveDay(entry) {
    const button = document.createElement("button");
    const day = Number(entry.date.slice(8, 10));
    const weekday = weekdayFor(entry.date);
    button.className = "archive-day";
    button.type = "button";
    button.title = entry.title;
    button.setAttribute("aria-label", `閱讀 ${formatDate(entry.date)}：${entry.title}`);

    const dayNumber = document.createElement("span");
    dayNumber.textContent = String(day);
    const weekdayLabel = document.createElement("span");
    weekdayLabel.textContent = weekday;
    weekdayLabel.className = weekday === "六" || weekday === "日" ? "is-weekend" : "";
    button.append(dayNumber, weekdayLabel);
    button.addEventListener("click", () => openReader(entry.id, "article", "push", button));
    return button;
  }

  function createArchiveMonth(month, monthEntries) {
    const row = document.createElement("section");
    row.className = "archive-row";
    row.dataset.year = month.slice(0, 4);

    const monthBlock = document.createElement("div");
    monthBlock.className = "archive-month";
    const label = document.createElement("strong");
    label.textContent = formatMonth(month);
    const count = document.createElement("span");
    count.textContent = `${monthEntries.length} 篇`;
    monthBlock.append(label, count);

    const days = document.createElement("div");
    days.className = "archive-days";
    monthEntries.forEach((entry, index) => {
      if (index > 0) {
        const separator = document.createElement("i");
        separator.textContent = "·";
        separator.setAttribute("aria-hidden", "true");
        days.append(separator);
      }
      days.append(createArchiveDay(entry));
    });

    const archiveWindow = document.createElement("div");
    archiveWindow.className = "archive-window";
    const viewport = document.createElement("div");
    viewport.className = "archive-day-viewport";
    viewport.setAttribute("tabindex", "0");
    viewport.setAttribute("aria-label", `${formatMonth(month)}文章日期，可左右滑動`);
    viewport.append(days);
    archiveWindow.append(viewport);

    const controls = document.createElement("div");
    controls.className = "archive-scroll-controls";
    controls.setAttribute("aria-label", `${formatMonth(month)}日期導覽`);
    const previous = document.createElement("button");
    previous.className = "archive-scroll-button";
    previous.type = "button";
    previous.textContent = "←";
    previous.setAttribute("aria-label", "查看較新的日期");
    const next = document.createElement("button");
    next.className = "archive-scroll-button";
    next.type = "button";
    next.textContent = "→";
    next.setAttribute("aria-label", "查看更多日期");
    controls.append(previous, next);

    const updateControls = () => {
      const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      controls.hidden = maximum < 2;
      previous.disabled = viewport.scrollLeft <= 2;
      next.disabled = viewport.scrollLeft >= maximum - 2;
    };
    const slide = (direction) => {
      viewport.scrollBy({
        left: direction * Math.max(240, viewport.clientWidth * 0.78),
        behavior: "smooth",
      });
    };
    previous.addEventListener("click", () => slide(-1));
    next.addEventListener("click", () => slide(1));
    viewport.addEventListener("scroll", updateControls, { passive: true });
    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(updateControls);
      resizeObserver.observe(viewport);
    } else {
      window.addEventListener("resize", updateControls, { passive: true });
    }
    window.requestAnimationFrame(updateControls);

    row.append(monthBlock, archiveWindow, controls);
    return row;
  }

  function renderArchive(resetLimit = false) {
    if (resetLimit) visibleMonthLimit = MONTH_PAGE_SIZE;
    const filtered = currentFilteredEntries();
    const groups = new Map();

    filtered.forEach((entry) => {
      const month = entry.date.slice(0, 7);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(entry);
    });

    dom.archiveGroups.replaceChildren();
    const monthKeys = [...groups.keys()];
    monthKeys.slice(0, visibleMonthLimit).forEach((month) => {
      dom.archiveGroups.append(createArchiveMonth(month, groups.get(month)));
    });

    const filtering =
      Boolean(dom.search.value.trim()) ||
      dom.yearFilter.value !== "all" ||
      dom.themeFilter.value !== "all";
    dom.entryCount.textContent = filtering
      ? `找到 ${filtered.length} 篇` 
      : `目前收錄 ${entries.length} 篇`;
    dom.emptyState.hidden = filtered.length > 0;
    dom.archiveGroups.hidden = filtered.length === 0;
    dom.loadMore.hidden = visibleMonthLimit >= monthKeys.length;
    dom.loadMore.textContent = `顯示更多月份（尚有 ${Math.max(0, monthKeys.length - visibleMonthLimit)} 個月）`;
  }

  async function loadMarkdown(entry) {
    if (markdownCache.has(entry.path)) return markdownCache.get(entry.path);
    const response = await fetch(entry.path);
    if (!response.ok) throw new Error(`無法載入 ${entry.path}`);
    const markdown = await response.text();
    markdownCache.set(entry.path, markdown);
    return markdown;
  }

  function renderReaderVersion(version) {
    if (!currentSections) return;
    const section = VERSION_SECTIONS[version] || VERSION_SECTIONS.article;
    let content = currentSections[section] || "這個版本尚未完成。";
    if (version === "article") content = content.replace(/^###\s+[^\n]+\n+/, "");
    dom.readerContent.innerHTML = renderMarkdown(content);
    dom.readerVersion.value = version;
    dom.reader.scrollTop = 0;
    updateReaderProgress();
  }

  function updateAdjacent(entry) {
    const index = entries.findIndex((item) => item.id === entry.id);
    const older = entries[index + 1];
    const newer = entries[index - 1];

    [
      [dom.readerPrev, older],
      [dom.readerNext, newer],
    ].forEach(([button, target]) => {
      button.hidden = !target;
      button.dataset.entryId = target?.id || "";
      button.querySelector("strong").textContent = target?.title || "";
    });
  }

  function setPageInert(isInert) {
    [dom.header, dom.page, dom.footer].forEach((element) => {
      if (element) element.inert = isInert;
    });
  }

  async function openReader(id, version = "article", historyMode = "push", trigger = null) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    const safeVersion = VALID_VERSIONS.includes(version) ? version : "article";

    if (trigger) lastReaderTrigger = trigger;
    if (!currentEntryId) archiveScrollPosition = window.scrollY;
    currentEntryId = entry.id;
    currentSections = null;

    closeMenu(false);
    dom.reader.hidden = false;
    dom.reader.setAttribute("aria-hidden", "false");
    document.body.classList.add("reader-open");
    setPageInert(true);
    dom.readerDate.dateTime = entry.date;
    dom.readerDate.textContent = formatDate(entry.date);
    dom.readerTitle.textContent = entry.title;
    dom.readerThemes.textContent = entry.themes.join(" · ");
    dom.readerTime.textContent = `約 ${entry.readingMinutes} 分鐘`;
    dom.readerVersion.value = safeVersion;
    dom.readerContent.innerHTML = '<p class="reader-loading">正在打開這一天⋯</p>';
    updateAdjacent(entry);
    dom.reader.scrollTop = 0;
    document.title = `${entry.title}｜細思漫想`;

    if (historyMode === "push") {
      window.history.pushState({ reader: true }, "", entryHash(entry.id, safeVersion));
    } else if (historyMode === "replace") {
      window.history.replaceState({ reader: true }, "", entryHash(entry.id, safeVersion));
    }

    dom.readerClose.focus({ preventScroll: true });

    try {
      const markdown = await loadMarkdown(entry);
      if (currentEntryId !== entry.id) return;
      currentSections = parseSections(markdown);
      renderReaderVersion(safeVersion);
    } catch (error) {
      if (currentEntryId !== entry.id) return;
      dom.readerContent.innerHTML =
        '<p class="reader-error">文章暫時沒有打開。請確認網站是透過伺服器預覽，再重新整理一次。</p>';
      console.error(error);
    }
  }

  function closeReader({ restoreFocus = true, restoreScroll = true } = {}) {
    if (!currentEntryId) return;
    currentEntryId = null;
    currentSections = null;
    dom.reader.hidden = true;
    dom.reader.setAttribute("aria-hidden", "true");
    document.body.classList.remove("reader-open");
    setPageInert(false);
    document.title = "細思漫想｜記錄碎片";
    if (restoreScroll) window.scrollTo({ top: archiveScrollPosition, behavior: "auto" });
    if (restoreFocus && lastReaderTrigger?.isConnected) lastReaderTrigger.focus({ preventScroll: true });
  }

  function requestReaderClose() {
    if (window.history.state?.reader) {
      window.history.back();
    } else {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#articles`);
      closeReader();
    }
  }

  function syncReaderToHash() {
    const route = readHash();
    if (route) {
      openReader(route.id, route.version, "none");
    } else if (currentEntryId) {
      closeReader();
    }
  }

  function updatePageProgress() {
    if (document.body.classList.contains("reader-open")) return;
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    const progress = maximum > 0 ? window.scrollY / maximum : 0;
    dom.pageProgress.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
  }

  function updateReaderProgress() {
    const maximum = dom.reader.scrollHeight - dom.reader.clientHeight;
    const progress = maximum > 0 ? dom.reader.scrollTop / maximum : 0;
    dom.readerProgress.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
  }

  function closeMenu(returnFocus = true) {
    const wasOpen = dom.menuToggle.getAttribute("aria-expanded") === "true";
    dom.menuToggle.setAttribute("aria-expanded", "false");
    dom.menuLabel.textContent = "開啟選單";
    dom.nav.classList.remove("is-open");
    document.body.classList.remove("menu-open");
    if (returnFocus && wasOpen) dom.menuToggle.focus();
  }

  function toggleMenu() {
    const willOpen = dom.menuToggle.getAttribute("aria-expanded") !== "true";
    dom.menuToggle.setAttribute("aria-expanded", String(willOpen));
    dom.menuLabel.textContent = willOpen ? "關閉選單" : "開啟選單";
    dom.nav.classList.toggle("is-open", willOpen);
    document.body.classList.toggle("menu-open", willOpen);
    if (willOpen) dom.nav.querySelector("a")?.focus();
  }

  function trapReaderFocus(event) {
    if (event.key !== "Tab" || !currentEntryId) return;
    const focusable = [...dom.reader.querySelectorAll('button:not([hidden]), select, a[href], [tabindex="0"]')]
      .filter((element) => !element.disabled && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function initReveal() {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-visible"));
      return;
    }
    const observer = new IntersectionObserver(
      (observations) => {
        observations.forEach((observation) => {
          if (observation.isIntersecting) {
            observation.target.classList.add("is-visible");
            observer.unobserve(observation.target);
          }
        });
      },
      { threshold: 0.08 },
    );
    items.forEach((item) => observer.observe(item));
  }

  function initActiveNavigation() {
    if (!("IntersectionObserver" in window)) return;
    const links = [...dom.nav.querySelectorAll("a")];
    const sections = ["articles", "method", "about"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const observer = new IntersectionObserver(
      (observations) => {
        const visible = observations
          .filter((observation) => observation.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        links.forEach((link) => link.classList.toggle("is-active", link.hash === `#${visible.target.id}`));
      },
      { rootMargin: "-35% 0px -55%", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
  }

  function bindEvents() {
    dom.latestButtons.forEach((button) => {
      button.addEventListener("click", () => entries[0] && openReader(entries[0].id, "article", "push", button));
    });

    [dom.search, dom.yearFilter, dom.themeFilter].forEach((control) => {
      control.addEventListener(control === dom.search ? "input" : "change", () => renderArchive(true));
    });

    dom.clearFilters.addEventListener("click", () => {
      dom.search.value = "";
      dom.yearFilter.value = "all";
      dom.themeFilter.value = "all";
      renderArchive(true);
      dom.search.focus();
    });

    dom.loadMore?.addEventListener("click", () => {
      visibleMonthLimit += MONTH_PAGE_SIZE;
      renderArchive();
    });

    dom.filterToggle.addEventListener("click", () => {
      const isOpen = dom.filterToggle.getAttribute("aria-expanded") === "true";
      dom.filterToggle.setAttribute("aria-expanded", String(!isOpen));
      dom.filterPanel.classList.toggle("is-open", !isOpen);
    });

    dom.menuToggle.addEventListener("click", toggleMenu);
    dom.nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => closeMenu(false)));
    dom.readerClose.addEventListener("click", requestReaderClose);
    dom.reader.addEventListener("scroll", updateReaderProgress, { passive: true });
    window.addEventListener("scroll", updatePageProgress, { passive: true });
    window.addEventListener("hashchange", syncReaderToHash);

    dom.readerVersion.addEventListener("change", () => {
      if (!currentEntryId) return;
      const version = dom.readerVersion.value;
      renderReaderVersion(version);
      window.history.replaceState({ reader: true }, "", entryHash(currentEntryId, version));
    });

    [dom.readerPrev, dom.readerNext].forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.entryId) openReader(button.dataset.entryId, dom.readerVersion.value, "replace", button);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (currentEntryId) requestReaderClose();
        else closeMenu();
      }
      trapReaderFocus(event);
    });
  }

  async function init() {
    try {
      const response = await fetch("entries.json", { cache: "no-cache" });
      if (!response.ok) throw new Error("無法載入文章索引");
      entries = await response.json();
    } catch (error) {
      entries = [...FALLBACK_ENTRIES];
      console.warn("文章索引載入失敗，已改用內建索引。", error);
    }

    entries.sort((a, b) => b.date.localeCompare(a.date));
    updateLatest();
    populateFilters();
    renderArchive(true);
    bindEvents();
    initReveal();
    initActiveNavigation();
    updatePageProgress();
    syncReaderToHash();
  }

  init();
})();
