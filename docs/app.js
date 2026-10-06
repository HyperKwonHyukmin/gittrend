(() => {
  "use strict";

  const TABS = [
    { id: "hot", label: "종합 주목", desc: "아래 목록을 모두 합쳐서, 여러 곳에서 동시에 뜨는 저장소일수록 위로 올렸어요." },
    { id: "saved", label: "★ 관심", desc: "☆를 눌러 저장한 라이브러리와, 그와 비슷한 라이브러리 추천이에요. 이 기기에만 저장돼요." },
    { id: "daily", label: "오늘", desc: "GitHub Trending 기준, 오늘 하루 star를 많이 받은 저장소예요." },
    { id: "weekly", label: "이번 주", desc: "GitHub Trending 기준, 이번 주에 star를 많이 받은 저장소예요." },
    { id: "monthly", label: "이번 달", desc: "GitHub Trending 기준, 이번 달에 star를 많이 받은 저장소예요." },
    { id: "new7", label: "새로 뜬 (7일)", desc: "최근 7일 안에 만들어졌는데 벌써 star가 많이 쌓인 저장소예요." },
    { id: "new30", label: "새로 뜬 (30일)", desc: "최근 30일 안에 만들어진 저장소 중 star가 많은 순서예요." },
    { id: "hn", label: "HN 화제", desc: "개발자 커뮤니티 Hacker News에서 이번 주 추천과 댓글을 많이 받은 GitHub 저장소예요." },
    { id: "rising", label: "급상승", desc: "매일 star 수를 기록해서, 어제보다 star가 가장 많이 늘어난 저장소예요. 기록이 이틀 이상 쌓이면 나타나요." },
  ];
  const TAB_IDS = new Set(TABS.map(t => t.id));
  const SRC_LABEL = { daily: "오늘", weekly: "이번 주", monthly: "이번 달", new7: "신규 7일", new30: "신규 30일", hn: "HN", rising: "급상승" };
  const LANG_COLORS = {
    TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", Go: "#00ADD8", Rust: "#dea584",
    Java: "#b07219", Kotlin: "#A97BFF", Swift: "#F05138", "C++": "#f34b7d", C: "#555555", "C#": "#178600",
    Ruby: "#701516", PHP: "#4F5D95", Shell: "#89e051", Dart: "#00B4AB", Zig: "#ec915c", Lua: "#000080",
    HTML: "#e34c26", CSS: "#563d7c", Vue: "#41b883", Svelte: "#ff3e00", "Jupyter Notebook": "#DA5B0B",
    Elixir: "#6e4a7e", Scala: "#c22d40", Haskell: "#5e5086", Nix: "#7e7eff", MDX: "#fcb32c",
  };
  const SORTS = [
    { id: "rank", label: "기본 순서" },
    { id: "gain", label: "star 증가 순" },
    { id: "stars", label: "전체 star 순" },
    { id: "created", label: "최근 생성 순" },
  ];

  const $app = document.getElementById("app");
  const $q = document.getElementById("q");
  let data = null;       // index.json: 오늘의 목록
  let catalog = {};      // catalog.json: 지금까지 본 모든 저장소
  let spark = null;      // spark.json: star 변화 (상세 화면에서 처음 쓸 때 불러옴)
  const detailCache = {};
  const state = { tab: "hot", lang: "", cat: "", sort: "rank", onlyNew: false, q: "" };

  // ------------------------------------------------------------ 저장 (브라우저)

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 저장을 못 쓰는 환경 */ }
    },
  };
  let saved = store.get("gittrend:saved", {});
  if (!saved || typeof saved !== "object") saved = {};
  const prefTab = store.get("gittrend:view", {}).tab;

  // ------------------------------------------------------------ 도우미

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => n == null ? "-" : n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "k" : n.toLocaleString("ko-KR");
  const full = n => n == null ? "-" : n.toLocaleString("ko-KR");
  const ago = iso => {
    if (!iso) return "";
    const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
    if (d === 0) return "오늘";
    if (d < 30) return `${d}일 전`;
    if (d < 365) return `${Math.floor(d / 30)}개월 전`;
    return `${Math.floor(d / 365)}년 전`;
  };
  const nameHtml = fn => {
    const [o, n] = String(fn).split("/");
    return `<span class="owner">${esc(o)} / </span>${esc(n)}`;
  };
  // http(s) 주소만 링크로 쓴다. 'example.com'처럼 scheme이 빠지면 https를 붙인다.
  const safeUrl = u => {
    u = String(u || "").trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u)) return "https://" + u;
    return "";
  };
  const langDot = (lang, size = 10) =>
    `<i class="dot" style="background:${LANG_COLORS[lang] || "var(--ink-3)"};width:${size}px;height:${size}px"></i>`;

  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // 오늘 목록 → 카탈로그 → 관심 저장본 순서로 저장소 정보를 찾는다
  const repoOf = key => data.repos[key] || catalog[key] || saved[key] || null;
  // 추천 계산용 프로필: 카탈로그에는 AI가 꼽은 비슷한 도구(alts)까지 들어 있다
  const profileOf = key => catalog[key] || saved[key] || data.repos[key] || null;
  const keyOfSlug = slug => {
    for (const src of [data.repos, catalog, saved]) {
      for (const k in src) if (src[k].slug === slug) return k;
    }
    return null;
  };

  // ------------------------------------------------------------ 관심 목록

  const isSaved = key => Object.prototype.hasOwnProperty.call(saved, key);

  function snapshot(key) {
    const r = profileOf(key) || {};
    return {
      full_name: r.full_name || key, slug: r.slug || key.replace("/", "__"),
      description: r.description || "", one_liner: r.one_liner || "", language: r.language || "",
      category: r.category || "", tags: r.tags || [], topics: r.topics || [], alts: r.alts || [],
      stars: r.stars ?? null, saved_at: Date.now(),
    };
  }

  function toggleSave(key) {
    if (isSaved(key)) {
      delete saved[key];
      toast("관심 목록에서 뺐어요");
    } else {
      saved[key] = snapshot(key);
      toast("관심 목록에 저장했어요. ★ 관심 탭에서 비슷한 라이브러리를 추천해 드려요");
    }
    store.set("gittrend:saved", saved);
    document.querySelectorAll(`[data-save="${CSS.escape(key)}"]`).forEach(b => paintSave(b, key));
    const tabCount = document.querySelector('.tab[data-tab="saved"] .n');
    if (tabCount) tabCount.textContent = Object.keys(saved).length;
  }

  function paintSave(btn, key) {
    const on = isSaved(key);
    btn.setAttribute("aria-pressed", on);
    btn.title = on ? "관심 목록에서 빼기" : "관심 목록에 저장";
    if (btn.classList.contains("btn")) btn.innerHTML = on ? "★ 저장됨" : "☆ 관심 저장";
    else btn.textContent = on ? "★" : "☆";
  }

  // ------------------------------------------------------------ 비슷한 라이브러리 찾기

  const STOP = new Set(("the and for with that this from your you are into using use used based open source tool tools " +
    "library framework app apps simple fast easy make makes built build any all can more one new via like what when " +
    "its not but out also than over just our has have was will who how why get got way best free lets let run runs " +
    "code project projects github repo repository support supports written powered").split(" "));

  // 저장소 객체에 직접 붙이면 관심 목록을 저장할 때 같이 저장되므로 따로 둔다
  const featureCache = new WeakMap();
  function features(r) {
    if (featureCache.has(r)) return featureCache.get(r);
    const m = new Map();
    const add = (k, w) => m.set(k, Math.max(m.get(k) || 0, w));
    const norm = t => String(t).toLowerCase().trim().replace(/[\s_]+/g, "-");
    if (r.category) add("c:" + r.category, 2.5);
    if (r.language) add("l:" + r.language, 0.8);
    for (const t of [...(r.tags || []), ...(r.topics || [])]) add("t:" + norm(t), 2);
    const text = `${r.description || ""} ${r.one_liner || ""} ${(r.full_name || "").split("/")[1] || ""}`.toLowerCase();
    for (let w of text.match(/[a-z][a-z0-9+#]{2,}|[가-힣]{2,}/g) || []) {
      if (!STOP.has(w)) add("w:" + w, 0.6);
    }
    let n = 0;
    for (const v of m.values()) n += v * v;
    const f = { m, n: Math.sqrt(n) || 1 };
    featureCache.set(r, f);
    return f;
  }

  // a가 꼽은 비슷한 도구 목록에 b가 들어 있는지
  function altHit(a, b) {
    const fullName = (b.full_name || "").toLowerCase();
    const name = fullName.split("/")[1];
    if (!name || name.length < 3) return false;
    return (a.alts || []).some(x => {
      x = String(x).toLowerCase().trim();
      return x === fullName || x === name || x.endsWith("/" + name) || x.split(/[\s(]/)[0] === name;
    });
  }

  function similarity(a, b) {
    const A = features(a), B = features(b);
    let dot = 0;
    const shared = [];
    for (const [k, v] of A.m) {
      const w = B.m.get(k);
      if (w) { dot += v * w; shared.push([k, v * w]); }
    }
    const alt = altHit(a, b) || altHit(b, a);
    return { s: dot / (A.n * B.n) + (alt ? 0.35 : 0), shared, alt };
  }

  function reasonText(sim) {
    const tags = sim.shared.filter(([k]) => k.startsWith("t:")).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => "#" + k.slice(2));
    if (sim.alt) return ["AI가 꼽은 비슷한 도구", ...tags].join(" · ");
    if (tags.length) return tags.join(" ");
    const cat = sim.shared.find(([k]) => k.startsWith("c:"));
    if (cat) return `같은 분류: ${cat[0].slice(2)}`;
    const words = sim.shared.filter(([k]) => k.startsWith("w:")).slice(0, 3).map(([k]) => k.slice(2));
    return words.length ? `비슷한 키워드: ${words.join(", ")}` : "";
  }

  function candidateKeys() {
    const keys = new Set(Object.keys(catalog));
    for (const k in data.repos) keys.add(k);
    return [...keys];
  }

  // 여러 기준 저장소와 비슷한 순서로 후보를 고른다
  function recommend(baseKeys, limit) {
    const bases = baseKeys.map(k => [k, profileOf(k)]).filter(([, p]) => p);
    if (!bases.length) return [];
    const exclude = new Set(baseKeys);
    const out = [];
    for (const key of candidateKeys()) {
      if (exclude.has(key)) continue;
      const c = profileOf(key);
      if (!c) continue;
      let best = null, bestKey = null, hits = 0;
      for (const [bk, b] of bases) {
        const sim = similarity(b, c);
        if (sim.s > 0.25) hits++;
        if (!best || sim.s > best.s) { best = sim; bestKey = bk; }
      }
      if (!best || best.s < 0.18) continue;
      const score = best.s + 0.08 * Math.max(0, hits - 1) + Math.log10((c.stars || 0) + 1) * 0.01;
      out.push({ key, score, sim: best, baseKey: bestKey });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ------------------------------------------------------------ 카드

  function gainOf(r, tab) {
    const p = r.period || {};
    if (tab === "daily" || tab === "weekly" || tab === "monthly") return p[tab] ?? -1;
    return p.weekly ?? (p.daily != null ? p.daily * 7 : null) ?? (p.monthly != null ? p.monthly / 4 : null) ?? r.growth?.d1 ?? -1;
  }

  function metricFor(r, tab) {
    const p = r.period || {};
    switch (tab) {
      case "daily": case "weekly": case "monthly": {
        const label = { daily: "오늘", weekly: "이번 주", monthly: "이번 달" }[tab];
        return p[tab] != null ? `+${fmt(p[tab])}<small>${label} ★</small>` : "";
      }
      case "new7": case "new30": return `${fmt(r.stars)}<small>${ago(r.created_at)} 생성</small>`;
      case "hn": return r.hn ? `${fmt(r.hn.points)}점<small>댓글 ${fmt(r.hn.comments)}</small>` : "";
      case "rising": return r.growth?.d1 != null ? `+${fmt(r.growth.d1)}<small>어제보다 ★</small>` : "";
      case "saved": return r.stars != null ? `${fmt(r.stars)}<small>★ 전체</small>` : "";
      default:
        if (p.weekly != null) return `+${fmt(p.weekly)}<small>이번 주 ★</small>`;
        if (p.daily != null) return `+${fmt(p.daily)}<small>오늘 ★</small>`;
        if (p.monthly != null) return `+${fmt(p.monthly)}<small>이번 달 ★</small>`;
        if (r.hn) return `${fmt(r.hn.points)}점<small>HN</small>`;
        return `${fmt(r.stars)}<small>★ 전체</small>`;
    }
  }

  function cardHtml(key, { rank = null, tab = state.tab, reason = "" } = {}) {
    const r = repoOf(key);
    if (!r) return "";
    const headline = r.one_liner || r.description || "설명이 없어요";
    const srcs = (r.sources || []).filter(s => s !== tab).map(s => `<span class="chip src">${SRC_LABEL[s] || s}</span>`).join("");
    const inToday = !!data.repos[key];
    return `
      <article class="card">
        <a class="card-link" href="#/r/${encodeURIComponent(r.slug)}" aria-label="${esc(r.full_name)} 자세히 보기"></a>
        <div class="card-head">
          ${rank != null ? `<div class="rank">${rank}</div>` : ""}
          <div class="title-block">
            <div class="repo-name">${nameHtml(r.full_name)}${r.is_new ? ' <span class="new">NEW</span>' : ""}</div>
          </div>
          <div class="metric ${tab === "hn" ? "hn" : ""}">${metricFor(r, tab)}</div>
        </div>
        ${reason ? `<p class="reason">${esc(reason)}</p>` : ""}
        <p class="headline ${r.one_liner ? "ai" : ""}">${esc(headline)}</p>
        <div class="meta">
          ${r.language ? `<span>${langDot(r.language)}${esc(r.language)}</span>` : ""}
          ${tab !== "saved" && r.stars != null ? `<span>★ ${fmt(r.stars)}</span>` : ""}
          ${r.created_at ? `<span>${ago(r.created_at)} 생성</span>` : ""}
          ${r.hn && tab !== "hn" ? `<span class="hn-text">HN ${fmt(r.hn.points)}점</span>` : ""}
          ${r.archived ? `<span class="warn-text">보관됨</span>` : ""}
          ${tab === "saved" && !inToday && catalog[key]?.last_seen ? `<span>${esc(catalog[key].last_seen.slice(5).replace("-", "/"))} 순위</span>` : ""}
        </div>
        <div class="card-foot">
          <div class="chips">
            ${r.has_deep ? '<span class="chip deep-chip">심층 분석</span>' : ""}
            ${r.category ? `<span class="chip cat">${esc(r.category)}</span>` : ""}
            ${srcs}
          </div>
          <button class="save" type="button" data-save="${esc(key)}" aria-pressed="${isSaved(key)}"
            title="${isSaved(key) ? "관심 목록에서 빼기" : "관심 목록에 저장"}">${isSaved(key) ? "★" : "☆"}</button>
        </div>
      </article>`;
  }

  function bindCards(root) {
    root.querySelectorAll("[data-save]").forEach(b => b.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      toggleSave(b.dataset.save);
    }));
  }

  // ------------------------------------------------------------ 목록 화면

  function listKeys(tab) {
    if (tab === "saved") return Object.keys(saved).sort((a, b) => (saved[b].saved_at || 0) - (saved[a].saved_at || 0));
    return (data.lists[tab] || []).filter(k => data.repos[k]);
  }

  function applyFilters(keys) {
    const q = state.q.trim().toLowerCase();
    let rows = keys.filter(k => {
      const r = repoOf(k);
      if (!r) return false;
      if (state.lang && r.language !== state.lang) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.onlyNew && !r.is_new) return false;
      if (!q) return true;
      return [r.full_name, r.description, r.one_liner, r.category, ...(r.tags || []), ...(r.topics || [])]
        .join(" ").toLowerCase().includes(q);
    });
    const by = {
      gain: (a, b) => gainOf(repoOf(b), state.tab) - gainOf(repoOf(a), state.tab),
      stars: (a, b) => (repoOf(b).stars || 0) - (repoOf(a).stars || 0),
      created: (a, b) => String(repoOf(b).created_at || "").localeCompare(String(repoOf(a).created_at || "")),
    }[state.sort];
    if (by) rows = [...rows].sort(by);
    return rows;
  }

  function optionCounts(keys, field) {
    const counts = {};
    for (const k of keys) {
      const v = repoOf(k)?.[field];
      if (v) counts[v] = (counts[v] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }

  function digestHtml() {
    const d = data.digest;
    if (!d || state.tab !== "hot" || state.q || state.lang || state.cat || state.onlyNew) return "";
    return `
      <section class="digest">
        <div class="digest-k">요즘 흐름 한눈에 · AI 요약</div>
        <h2>${esc(d.headline)}</h2>
        ${d.summary ? `<p>${esc(d.summary)}</p>` : ""}
        ${(d.themes || []).length ? `<div class="themes">${d.themes.map(t => `
          <div class="theme">
            <b>${esc(t.title)}</b>
            ${t.desc ? `<span>${esc(t.desc)}</span>` : ""}
            <div class="theme-repos">${(t.repos || []).map(k => repoOf(k)).filter(Boolean)
              .map(r => `<a href="#/r/${encodeURIComponent(r.slug)}">${esc(r.full_name.split("/")[1])}</a>`).join("")}</div>
          </div>`).join("")}</div>` : ""}
      </section>`;
  }

  function savedExtrasHtml(savedKeys) {
    if (!savedKeys.length) {
      return `<div class="guide">
        <b>관심 라이브러리를 저장해 보세요</b>
        <p>카드 오른쪽 아래의 ☆를 누르면 여기에 모여요. 저장한 라이브러리와 분류, 태그, 설명이 비슷한 라이브러리를 찾아서 추천해 드려요.</p>
      </div>`;
    }
    const recs = recommend(savedKeys, 12);
    const link = `${location.origin}${location.pathname}#/import/${encodeURIComponent(savedKeys.join(","))}`;
    return `
      <section class="recs">
        <h2 class="sub-title">관심 목록과 비슷한 라이브러리</h2>
        <p class="tab-desc">저장한 라이브러리와 분류·태그·설명이 겹치거나, AI가 비슷한 도구로 꼽은 라이브러리예요.</p>
        ${recs.length
          ? `<div class="grid">${recs.map(x => cardHtml(x.key, {
              tab: "saved",
              reason: `${repoOf(x.baseKey)?.full_name.split("/")[1] || ""}와(과) 비슷 · ${reasonText(x.sim)}`,
            })).join("")}</div>`
          : `<p class="empty small">아직 비슷한 라이브러리를 찾지 못했어요. 데이터가 쌓이면 추천이 늘어나요.</p>`}
      </section>
      <section class="transfer">
        <b>다른 기기로 옮기기</b>
        <p>관심 목록은 이 기기의 브라우저에만 저장돼요. 아래 링크를 폰이나 다른 PC에서 열면 같은 목록을 가져올 수 있어요.</p>
        <div class="transfer-row">
          <input type="text" readonly value="${esc(link)}" aria-label="관심 목록 옮기기 링크">
          <button class="btn" type="button" id="copy-link">링크 복사</button>
        </div>
      </section>`;
  }

  function renderList() {
    const tab = TABS.find(t => t.id === state.tab);
    const base = listKeys(state.tab);
    const langs = optionCounts(base, "language");
    const cats = optionCounts(base, "category");
    if (state.lang && !langs.some(([v]) => v === state.lang)) state.lang = "";
    if (state.cat && !cats.some(([v]) => v === state.cat)) state.cat = "";
    const anyNew = base.some(k => repoOf(k)?.is_new);
    if (!anyNew) state.onlyNew = false;
    const rows = applyFilters(base);
    const showRank = state.tab !== "saved" && state.sort === "rank";
    const count = id => id === "saved" ? Object.keys(saved).length : listKeys(id).length;

    let body;
    if (rows.length) {
      body = `<div class="grid">${rows.map((k, i) => cardHtml(k, { rank: showRank ? i + 1 : null })).join("")}</div>`;
    } else if (state.tab === "saved") {
      body = "";
    } else if (state.tab === "rising" && !base.length) {
      body = `<p class="empty">아직 기록이 하루치뿐이라 비교할 수 없어요. 내일 다시 확인해 주세요.</p>`;
    } else {
      body = `<p class="empty">조건에 맞는 저장소가 없어요.</p>`;
    }

    $app.innerHTML = `
      <nav class="tabs" role="tablist">
        ${TABS.map(t => `
          <a class="tab" role="tab" href="#/t/${t.id}" data-tab="${t.id}" aria-selected="${t.id === state.tab}">
            ${t.label}<span class="n">${count(t.id)}</span>
          </a>`).join("")}
      </nav>
      <p class="tab-desc">${tab.desc}</p>
      ${digestHtml()}
      ${base.length ? `
      <div class="filters">
        <select id="lang" aria-label="언어">
          <option value="">모든 언어</option>
          ${langs.map(([v, n]) => `<option value="${esc(v)}" ${v === state.lang ? "selected" : ""}>${esc(v)} (${n})</option>`).join("")}
        </select>
        ${cats.length ? `
        <select id="cat" aria-label="분류">
          <option value="">모든 분류</option>
          ${cats.map(([v, n]) => `<option value="${esc(v)}" ${v === state.cat ? "selected" : ""}>${esc(v)} (${n})</option>`).join("")}
        </select>` : ""}
        <select id="sort" aria-label="정렬">
          ${SORTS.map(s => `<option value="${s.id}" ${s.id === state.sort ? "selected" : ""}>${s.id === "rank" && state.tab === "saved" ? "저장한 순서" : s.label}</option>`).join("")}
        </select>
        ${anyNew ? `<button type="button" class="toggle" id="only-new" aria-pressed="${state.onlyNew}">NEW만 보기</button>` : ""}
        <span class="count">${rows.length}개</span>
      </div>` : ""}
      ${body}
      ${state.tab === "saved" ? savedExtrasHtml(base) : ""}
    `;

    bindCards($app);
    $app.querySelector("#lang")?.addEventListener("change", e => { state.lang = e.target.value; renderList(); });
    $app.querySelector("#cat")?.addEventListener("change", e => { state.cat = e.target.value; renderList(); });
    $app.querySelector("#sort")?.addEventListener("change", e => { state.sort = e.target.value; renderList(); });
    $app.querySelector("#only-new")?.addEventListener("click", () => { state.onlyNew = !state.onlyNew; renderList(); });
    $app.querySelector("#copy-link")?.addEventListener("click", async e => {
      const input = $app.querySelector(".transfer input");
      try { await navigator.clipboard.writeText(input.value); e.target.textContent = "복사됨"; }
      catch (_) { input.select(); e.target.textContent = "직접 복사해 주세요"; }
      setTimeout(() => { e.target.textContent = "링크 복사"; }, 1800);
    });
    $app.querySelector('.tab[aria-selected="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  // ------------------------------------------------------------ 상세 화면

  async function loadSpark() {
    if (spark) return spark;
    try {
      const res = await fetch("data/spark.json", { cache: "no-cache" });
      spark = res.ok ? await res.json() : { days: [], stars: {} };
    } catch (_) { spark = { days: [], stars: {} }; }
    return spark;
  }

  function sparkHtml(key) {
    const vals = spark?.stars?.[key];
    if (!vals) return "";
    const pts0 = vals.map((v, i) => [spark.days[i], v]).filter(([, v]) => v != null);
    if (pts0.length < 2) return "";
    const w = 600, h = 64, pad = 4;
    const ys = pts0.map(p => p[1]);
    const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
    const n = vals.length - 1 || 1;
    const pts = vals.map((v, i) => v == null ? null : [pad + (i / n) * (w - pad * 2), h - pad - ((v - min) / span) * (h - pad * 2)]).filter(Boolean);
    const line = pts.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ");
    const area = `${pts[0][0].toFixed(1)},${h} ${line} ${pts[pts.length - 1][0].toFixed(1)},${h}`;
    const gain = ys[ys.length - 1] - ys[0];
    return `
      <div class="spark">
        <div class="k"><span>star 변화 (${pts0[0][0].slice(5).replace("-", "/")} ~ ${pts0[pts0.length - 1][0].slice(5).replace("-", "/")})</span>
          <b class="good-text">${gain >= 0 ? "+" : ""}${full(gain)}</b></div>
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
          <polygon points="${area}" fill="var(--accent-soft)"/>
          <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
        </svg>
      </div>`;
  }

  function codeBlock(label, lang, code) {
    if (!code || !String(code).trim()) return "";
    return `
      <div class="code">
        <div class="code-label">${esc(label)}${lang ? ` · ${esc(lang)}` : ""}</div>
        <pre><code>${esc(String(code).trim())}</code></pre>
        <button class="copy" type="button">복사</button>
      </div>`;
  }

  const listHtml = (arr, ordered = false, cls = "plain") => (arr && arr.length)
    ? `<${ordered ? "ol" : "ul"} class="${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`
    : "";

  function summaryHtml(s, r) {
    if (!s) {
      return `<div class="no-ai">아직 AI 정리가 없어요. ${data.ai_enabled
        ? "다음 업데이트 때 정리될 예정이에요."
        : "OpenAI API 키를 설정하면 사용법과 특징을 정리해 드려요."}
        <br>그동안은 <a href="https://github.com/${esc(r.full_name)}#readme" target="_blank" rel="noopener">GitHub README</a>를 확인해 주세요.</div>`;
    }
    const qs = s.quickstart || {};
    const usage = codeBlock("설치", "", s.install) + codeBlock("빠른 시작", qs.lang, qs.code) + listHtml(s.usage_steps, true, "steps");
    return `
      <section class="section">
        <h2><span class="ico">💡</span>한눈에 보기</h2>
        ${s.one_liner ? `<p class="lead">${esc(s.one_liner)}</p>` : ""}
        ${s.what ? `<p>${esc(s.what)}</p>` : ""}
        ${s.why_hot ? `<p class="why"><b>왜 주목받나요?</b> ${esc(s.why_hot)}</p>` : ""}
      </section>
      ${s.features?.length ? `
      <section class="section">
        <h2><span class="ico">✨</span>주요 특징</h2>
        <div class="features">
          ${s.features.map(f => `<div class="feature"><b>${esc(f.title)}</b><span>${esc(f.desc)}</span></div>`).join("")}
        </div>
      </section>` : ""}
      ${usage.trim() ? `
      <section class="section">
        <h2><span class="ico">🛠️</span>사용법</h2>
        ${usage}
      </section>` : ""}
      ${s.use_cases?.length ? `
      <section class="section">
        <h2><span class="ico">🎯</span>이럴 때 쓰면 좋아요</h2>
        ${listHtml(s.use_cases)}
      </section>` : ""}
      ${s.alternatives?.length ? `
      <section class="section">
        <h2><span class="ico">🔁</span>AI가 꼽은 비슷한 도구</h2>
        <div class="alts">${s.alternatives.map(a => `<div class="alt"><b>${esc(a.name)}</b><span>${esc(a.diff)}</span></div>`).join("")}</div>
      </section>` : ""}
      ${s.caveats?.length ? `
      <section class="section">
        <h2><span class="ico">⚠️</span>알아둘 점</h2>
        ${listHtml(s.caveats, false, "plain caveats")}
      </section>` : ""}
      ${s.tags?.length ? `<div class="chips tags">${s.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join("")}</div>` : ""}
    `;
  }

  // ------------------------------------------------------------ 심층 분석

  // 이 사이트의 GitHub 저장소 주소 (심층 분석 요청 이슈를 여는 데 쓴다)
  function repoUrl() {
    if (data.repo_url) return data.repo_url;
    const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return m && seg ? `https://github.com/${m[1]}/${seg}` : "";
  }

  function requestHtml(r) {
    const base = repoUrl();
    if (!base) return "";
    const body = "이 라이브러리를 심층 분석해 주세요.\n\n" +
      "제목을 바꾸지 말고 그대로 [Create] 버튼을 누르면 됩니다.\n" +
      "몇 분 뒤 분석이 끝나면 이 이슈에 댓글이 달리고 자동으로 닫혀요.";
    const url = `${base}/issues/new?title=${encodeURIComponent("deep: " + r.full_name)}&body=${encodeURIComponent(body)}`;
    return `
      <div class="deep-cta">
        <div>
          <b>더 깊이 알고 싶다면</b>
          <p>주요 API·메서드, 동작 원리, 사람들이 실제로 쓰는 방식, 커뮤니티 반응, 내 작업에 맞는지까지 더 높은 AI 모델로 분석해요.
            GitHub 로그인 후 열리는 화면에서 [Create]를 누르면 몇 분 안에 반영돼요.</p>
        </div>
        <a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">심층 분석 요청 ↗</a>
      </div>`;
  }

  const LEVEL_CLASS = { "높음": "lv-high", "보통": "lv-mid", "낮음": "lv-low" };

  function deepHtml(d) {
    const x = d.deep;
    const sec = (ico, title, inner) => inner && inner.trim() ? `
      <section class="section"><h2><span class="ico">${ico}</span>${title}</h2>${inner}</section>` : "";
    const fit = x.fit || {};
    const com = x.community || {};
    const mat = x.maturity || {};
    const gs = x.getting_started || {};

    const apis = (x.key_apis || []).map(a => `
      <div class="api">
        <div class="api-head"><code class="api-name">${esc(a.name)}</code>${a.kind ? `<span class="chip">${esc(a.kind)}</span>` : ""}</div>
        ${a.signature && a.signature !== a.name ? `<pre class="api-sig"><code>${esc(a.signature)}</code></pre>` : ""}
        ${a.desc ? `<p>${esc(a.desc)}</p>` : ""}
        ${a.example ? codeBlock("예시", "", a.example) : ""}
      </div>`).join("");

    const patterns = (x.usage_patterns || []).map(p => `
      <div class="pattern">
        <b>${esc(p.title)}</b>
        ${p.desc ? `<p>${esc(p.desc)}</p>` : ""}
        ${p.evidence ? `<p class="evidence">근거: ${esc(p.evidence)}</p>` : ""}
      </div>`).join("");

    const comCol = (title, arr) => arr && arr.length ? `<div class="com-col"><b>${title}</b>${listHtml(arr)}</div>` : "";
    const community = `
      ${com.sentiment ? `<p><span class="pill">${esc(com.sentiment)}</span></p>` : ""}
      <div class="com-grid">
        ${comCol("👍 좋다는 평가", com.praise)}
        ${comCol("👎 불만·문제", com.complaints)}
        ${comCol("❓ 자주 묻는 질문", com.common_questions)}
      </div>`;

    return `
      <section class="deep-top">
        <div class="deep-k"><span class="deep-badge">심층 분석</span>${esc(d.deep_model || "")} · ${esc(d.deep_at || "")}</div>
        ${x.verdict ? `<p class="lead">${esc(x.verdict)}</p>` : ""}
        ${fit.level || fit.reason ? `
        <div class="fit">
          <div class="fit-head">
            <b>내 작업에 맞을까?</b>
            ${fit.level ? `<span class="fit-level ${LEVEL_CLASS[fit.level] || ""}">${esc(fit.level)}</span>` : ""}
            <small>${d.deep_profile ? "profile.md 기준" : "일반 개발자 기준"}</small>
          </div>
          ${fit.reason ? `<p>${esc(fit.reason)}</p>` : ""}
          <div class="fit-grid">
            ${fit.use_in_my_work?.length ? `<div><b>이렇게 쓸 수 있어요</b>${listHtml(fit.use_in_my_work)}</div>` : ""}
            ${fit.skip_if?.length ? `<div><b>이럴 땐 맞지 않아요</b>${listHtml(fit.skip_if)}</div>` : ""}
          </div>
        </div>` : ""}
      </section>
      ${sec("🧠", "동작 원리", x.how_it_works ? `<p>${esc(x.how_it_works)}</p>` : "")}
      ${sec("🔧", "주요 API · 메서드", apis ? `<div class="apis">${apis}</div>` : "")}
      ${sec("✨", "할 수 있는 것", (x.capabilities || []).length
        ? `<div class="features">${x.capabilities.map(f => `<div class="feature"><b>${esc(f.title)}</b><span>${esc(f.desc)}</span></div>`).join("")}</div>` : "")}
      ${sec("👥", "사람들은 이렇게 써요", patterns ? `<div class="patterns">${patterns}</div>` : "")}
      ${sec("💬", "커뮤니티 반응", (com.praise?.length || com.complaints?.length || com.common_questions?.length || com.sentiment) ? community : "")}
      ${sec("📈", "성숙도", mat.stage || mat.notes ? `${mat.stage ? `<p><span class="pill">${esc(mat.stage)}</span></p>` : ""}${mat.notes ? `<p>${esc(mat.notes)}</p>` : ""}` : "")}
      ${sec("🔁", "대안과 비교", (x.alternatives || []).length
        ? `<div class="alts">${x.alternatives.map(a => `<div class="alt"><b>${esc(a.name)}</b><span>${esc(a.choose_when)}</span></div>`).join("")}</div>` : "")}
      ${sec("🚀", "시작하기", codeBlock("설치", "", gs.install) + codeBlock("처음 돌려보기", gs.code_lang, gs.code) + listHtml(gs.steps, true, "steps"))}
      ${sec("⚠️", "도입 전 확인할 점", listHtml(x.watch_out, false, "plain caveats"))}
      <p class="ai-note">심층 분석 · README, 소스 일부, 문서, 이슈, HN 댓글을 바탕으로 AI가 쓴 글이라 틀린 내용이 있을 수 있어요</p>`;
  }

  function similarHtml(key) {
    const recs = recommend([key], 6);
    if (!recs.length) return "";
    return `
      <section class="similar">
        <h2 class="sub-title">이 사이트에서 찾은 비슷한 라이브러리</h2>
        <div class="grid">${recs.map(x => cardHtml(x.key, { tab: "saved", reason: reasonText(x.sim) })).join("")}</div>
      </section>`;
  }

  async function renderDetail(slug) {
    const key = keyOfSlug(slug);
    const base = key && repoOf(key);
    window.scrollTo(0, 0);
    if (!base) {
      $app.innerHTML = `<div class="detail"><button class="back" data-back>← 목록으로</button><p class="empty">저장소를 찾을 수 없어요.</p></div>`;
      bindBack();
      return;
    }
    $app.innerHTML = `<div class="detail"><p class="loading">불러오는 중…</p></div>`;
    let d = detailCache[slug];
    const known = data.repos[key] || catalog[key];
    if (!d && known && known.has_summary === false && !known.has_deep) d = {};  // 정리 파일이 아직 없는 저장소
    if (!d) {
      try {
        const res = await fetch(`data/repos/${encodeURIComponent(slug)}.json`, { cache: "no-cache" });
        d = res.ok ? await res.json() : {};
      } catch (_) { d = {}; }
      detailCache[slug] = d;
    }
    await loadSpark();
    if (location.hash !== `#/r/${encodeURIComponent(slug)}`) return; // 기다리는 사이 다른 저장소나 화면으로 이동함

    const r = base;
    const s = d.summary;
    const p = r.period || {};
    const inToday = !!data.repos[key];
    const homepage = safeUrl(r.homepage);
    const stat = (k, v, cls = "") => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}" title="${esc(String(v).replace(/<[^>]+>/g, ""))}">${v}</div></div>`;
    const stats = [
      r.stars != null ? stat(inToday ? "전체 star" : "전체 star (마지막 기록)", full(r.stars)) : "",
      p.daily != null ? stat("오늘 받은 star", "+" + full(p.daily), "good") : "",
      p.weekly != null ? stat("이번 주 star", "+" + full(p.weekly), "good") : "",
      p.monthly != null ? stat("이번 달 star", "+" + full(p.monthly), "good") : "",
      r.growth?.d1 != null && p.daily == null ? stat("어제보다", "+" + full(r.growth.d1), "good") : "",
      r.forks != null ? stat("fork", full(r.forks)) : "",
      r.hn ? stat("Hacker News", `${full(r.hn.points)}점`) : "",
      r.pushed_at ? stat("마지막 커밋", ago(r.pushed_at)) : "",
      r.release?.tag ? stat("최신 릴리스", `${esc(r.release.tag)}${r.release.date ? ` <small>${ago(r.release.date)}</small>` : ""}`) : "",
      r.created_at ? stat("만든 지", ago(r.created_at)) : "",
      r.license && r.license !== "NOASSERTION" ? stat("라이선스", esc(r.license)) : "",
      s?.level ? stat("난이도", esc(s.level)) : "",
    ].join("");
    const category = s?.category || r.category;

    $app.innerHTML = `
      <article class="detail">
        <button class="back" data-back>← 목록으로</button>
        <div class="d-head">
          <div class="chips">
            ${category ? `<span class="chip cat">${esc(category)}</span>` : ""}
            ${r.language ? `<span class="chip">${langDot(r.language, 8)} ${esc(r.language)}</span>` : ""}
            ${(r.sources || []).map(x => `<span class="chip src">${SRC_LABEL[x] || x}</span>`).join("")}
            ${r.is_new ? '<span class="new">NEW</span>' : ""}
          </div>
          <h1>${nameHtml(r.full_name)}</h1>
          ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ""}
        </div>
        ${r.archived ? `<div class="banner warn">이 저장소는 보관(archived) 상태라 더 이상 업데이트되지 않아요.</div>` : ""}
        ${!inToday ? `<div class="banner">오늘 순위에는 없는 저장소예요. ${catalog[key]?.last_seen ? `마지막으로 순위에 보인 날은 ${esc(catalog[key].last_seen)}이에요.` : ""}</div>` : ""}
        <div class="links">
          <a class="btn primary" href="https://github.com/${esc(r.full_name)}" target="_blank" rel="noopener">GitHub에서 보기 ↗</a>
          <button class="btn save-btn" type="button" data-save="${esc(key)}" aria-pressed="${isSaved(key)}">${isSaved(key) ? "★ 저장됨" : "☆ 관심 저장"}</button>
          ${homepage ? `<a class="btn" href="${esc(homepage)}" target="_blank" rel="noopener">홈페이지 ↗</a>` : ""}
          ${r.hn ? `<a class="btn" href="${esc(safeUrl(r.hn.hn_url))}" target="_blank" rel="noopener">HN 토론 ↗</a>` : ""}
        </div>
        <div class="stats">${stats}</div>
        ${sparkHtml(key)}
        ${d.deep ? deepHtml(d) : ""}
        ${d.deep && s ? `<details class="basic"><summary>간단 정리 보기 (${esc(d.model || "")})</summary>${summaryHtml(s, r)}</details>` : summaryHtml(s, r)}
        ${s && !d.deep ? `<p class="ai-note">AI 정리 · ${esc(d.model || "")} · ${esc(d.summarized_at || "")} · README 기준이라 틀린 내용이 있을 수 있어요</p>` : ""}
        ${d.deep ? "" : requestHtml(r)}
        ${similarHtml(key)}
      </article>`;
    bindBack();
    bindCards($app);
    $app.querySelectorAll(".copy").forEach(b => b.addEventListener("click", async () => {
      const text = b.parentElement.querySelector("code").textContent;
      try { await navigator.clipboard.writeText(text); b.textContent = "복사됨"; }
      catch (_) { b.textContent = "복사 실패"; }
      setTimeout(() => { b.textContent = "복사"; }, 1500);
    }));
  }

  function bindBack() {
    $app.querySelector("[data-back]")?.addEventListener("click", () => {
      if (cameFromList) history.back();
      else location.hash = `#/t/${state.tab}`;
    });
  }

  // ------------------------------------------------------------ 관심 목록 가져오기 (#/import/키,키)

  function importSaved(csv) {
    let n = 0;
    for (const raw of decodeURIComponent(csv).split(",")) {
      const key = raw.trim().toLowerCase();
      if (!/^[\w.-]+\/[\w.-]+$/.test(key) || isSaved(key)) continue;
      saved[key] = snapshot(key);
      n++;
    }
    store.set("gittrend:saved", saved);
    state.tab = "saved";
    store.set("gittrend:view", { tab: "saved" });
    history.replaceState(null, "", "#/t/saved");
    route();
    toast(n ? `관심 라이브러리 ${n}개를 가져왔어요` : "새로 가져올 라이브러리가 없어요");
  }

  // ------------------------------------------------------------ AI 뉴스 (#/news)

  const NEWS_PAGE = 60;
  const REGIONS = [
    { id: "", label: "모든 출처" },
    { id: "kr", label: "국내 기사" },
    { id: "global", label: "해외 기사" },
    { id: "community", label: "커뮤니티·논문" },
  ];
  const COMMUNITY = new Set(["Hacker News", "Hugging Face 논문", "GeekNews", "Threads"]);
  let news = null;
  const newsState = { topic: "", region: "", sort: "latest", important: false, shown: NEWS_PAGE };
  const readNews = new Set(store.get("gittrend:read", []));
  // 영어 기사: 기본은 원문, 설정을 켜면 처음부터 한국어. 기사마다 버튼으로 바꾼 것은 이 화면에서만 기억한다.
  let enKo = store.get("gittrend:enko", false) === true;
  const flipped = new Set();

  const regionOf = a => COMMUNITY.has(a.origin) ? "community" : /[가-힣]/.test(a.title) ? "kr" : "global";
  const newsTitle = a => a.title_ko || a.title;
  const isEnglish = a => !/[가-힣]/.test(a.title);
  const hasKo = a => !!(a.title_ko || a.summary);
  const showsKo = a => enKo !== flipped.has(a.id);

  function timeText(iso) {
    const t = new Date(iso);
    const mins = Math.floor((Date.now() - t.getTime()) / 60000);
    if (mins < 60) return `${Math.max(1, mins)}분 전`;
    if (mins < 60 * 24) return `${Math.floor(mins / 60)}시간 전`;
    return t.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    const md = d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
    if (d.toDateString() === new Date().toDateString()) return `오늘 · ${md}`;
    if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return `어제 · ${md}`;
    return md;
  }

  function filteredNews() {
    const q = state.q.trim().toLowerCase();
    let rows = (news.articles || []).filter(a => {
      if (newsState.topic && a.topic !== newsState.topic) return false;
      if (newsState.region && regionOf(a) !== newsState.region) return false;
      if (newsState.important && !(a.importance >= 4)) return false;
      if (!q) return true;
      return [a.title, a.title_ko, a.summary, a.snippet, a.source, a.topic].join(" ").toLowerCase().includes(q);
    });
    if (newsState.sort === "important") {
      rows = [...rows].sort((a, b) => (b.importance || 0) - (a.importance || 0) || b.published.localeCompare(a.published));
    }
    return rows;
  }

  function newsItemHtml(a) {
    const imp = a.importance || 0;
    const link = esc(safeUrl(a.link));
    const en = isEnglish(a) && hasKo(a);
    let titleHtml, bodyHtml;
    if (en) {
      // 영어 기사: 원문과 한국어를 둘 다 그려 두고 버튼으로 바꿔 보여준다
      titleHtml = `<span class="v-orig" lang="en">${esc(a.title)}</span><span class="v-ko">${esc(a.title_ko || a.title)}</span>`;
      bodyHtml = `${a.snippet ? `<p class="news-sum v-orig" lang="en">${esc(a.snippet)}${a.snippet.length >= 300 ? "…" : ""}</p>` : ""}
        ${a.summary ? `<p class="news-sum v-ko">${esc(a.summary)}</p>` : ""}`;
    } else {
      const retitled = a.title_ko && a.title_ko !== a.title;
      titleHtml = esc(newsTitle(a));
      bodyHtml = `${retitled ? `<p class="news-orig">${esc(a.title)}</p>` : ""}
        ${a.summary ? `<p class="news-sum">${esc(a.summary)}</p>` : ""}`;
    }
    return `
      <article class="news-item ${readNews.has(a.id) ? "read" : ""} ${en ? "en" : ""} ${en && showsKo(a) ? "show-ko" : ""}" id="n-${esc(a.id)}">
        <div class="news-meta">
          ${imp >= 4 ? '<span class="badge-hot">주요</span>' : ""}
          ${a.topic ? `<span class="chip cat">${esc(a.topic)}</span>` : ""}
          <span class="news-src">${esc(a.source)}</span>
          <span>${timeText(a.published)}</span>
          ${a.ai ? `<span class="imp" title="중요도 ${imp}/5">${"●".repeat(imp)}<i>${"●".repeat(5 - imp)}</i></span>` : ""}
          ${en ? `<button type="button" class="tr-btn" data-tr="${esc(a.id)}" aria-pressed="${showsKo(a)}">${showsKo(a) ? "원문 보기" : "한국어로 보기"}</button>` : ""}
        </div>
        <h3><a href="${link}" target="_blank" rel="noopener" data-read="${esc(a.id)}">${titleHtml}</a></h3>
        ${bodyHtml}
        ${a.hn_url || a.upvotes ? `<p class="news-extra">
          ${a.hn_url ? `<a href="${esc(safeUrl(a.hn_url))}" target="_blank" rel="noopener">HN ${fmt(a.hn_points)}점 · 토론 보기</a>` : ""}
          ${a.upvotes ? `<span>추천 ${fmt(a.upvotes)}</span>` : ""}</p>` : ""}
        ${(a.related || []).length ? `
        <details class="related">
          <summary>같은 소식 ${a.related.length}건 더</summary>
          <ul>${a.related.map(r => `<li><a href="${esc(safeUrl(r.link))}" target="_blank" rel="noopener">${esc(r.title)}</a> <span>${esc(r.source)}</span></li>`).join("")}</ul>
        </details>` : ""}
      </article>`;
  }

  function briefHtml() {
    const b = news.brief;
    if (!b || state.q || newsState.topic || newsState.region || newsState.important) return "";
    const byId = Object.fromEntries((news.articles || []).map(a => [a.id, a]));
    const short = a => { const t = newsTitle(a); return t.length > 22 ? t.slice(0, 22) + "…" : t; };
    return `
      <section class="digest">
        <div class="digest-k">오늘의 AI 브리핑 · AI 요약</div>
        <h2>${esc(b.headline)}</h2>
        ${b.summary ? `<p>${esc(b.summary)}</p>` : ""}
        ${(b.themes || []).length ? `<div class="themes">${b.themes.map(t => `
          <div class="theme">
            <b>${esc(t.title)}</b>
            ${t.desc ? `<span>${esc(t.desc)}</span>` : ""}
            <div class="theme-repos">${(t.ids || []).map(i => byId[i]).filter(Boolean)
              .map(a => `<a href="#n-${esc(a.id)}" data-jump="${esc(a.id)}">${esc(short(a))}</a>`).join("")}</div>
          </div>`).join("")}</div>` : ""}
      </section>`;
  }

  async function renderNews() {
    if (!news) {
      $app.innerHTML = `<p class="loading">불러오는 중…</p>`;
      try { news = await getJson("data/news.json"); } catch (_) { news = { articles: [], sources: {} }; }
      if (!location.hash.startsWith("#/news")) return;
    }
    const all = news.articles || [];
    const rows = filteredNews();
    const topicCounts = {};
    for (const a of all) if (a.topic) topicCounts[a.topic] = (topicCounts[a.topic] || 0) + 1;
    const topics = (news.topics || []).filter(t => topicCounts[t]);
    const page = rows.slice(0, newsState.shown);

    let body;
    if (!rows.length) {
      body = `<p class="empty">${all.length ? "조건에 맞는 기사가 없어요." : "아직 모은 기사가 없어요. 수집기(collect.py)를 실행해 주세요."}</p>`;
    } else if (newsState.sort === "important") {
      body = `<div class="news-list">${page.map(newsItemHtml).join("")}</div>`;
    } else {
      // 최신순일 때는 날짜별로 묶는다
      const groups = [];
      for (const a of page) {
        const label = dayLabel(a.published);
        if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
        groups[groups.length - 1].items.push(a);
      }
      body = groups.map(g => `<h2 class="day">${esc(g.label)}</h2><div class="news-list">${g.items.map(newsItemHtml).join("")}</div>`).join("");
    }
    const off = Object.entries(news.sources || {}).filter(([, v]) => v === "키 없음").map(([k]) => k);

    $app.innerHTML = `
      <p class="tab-desc news-desc">Google 뉴스, AI 전문 매체, 개발자 커뮤니티에서 AI 소식을 모아 AI가 한국어로 정리했어요.
        새 기사만 한 번 정리하고, 원문은 각 언론사 사이트에서 읽어요.</p>
      ${briefHtml()}
      <div class="topic-chips">
        <button type="button" class="tchip" data-topic="" aria-pressed="${!newsState.topic}">전체 <span>${all.length}</span></button>
        ${topics.map(t => `<button type="button" class="tchip" data-topic="${esc(t)}" aria-pressed="${newsState.topic === t}">${esc(t)} <span>${topicCounts[t]}</span></button>`).join("")}
      </div>
      <div class="filters">
        <select id="region" aria-label="출처">
          ${REGIONS.map(r => `<option value="${r.id}" ${r.id === newsState.region ? "selected" : ""}>${r.label}</option>`).join("")}
        </select>
        <select id="nsort" aria-label="정렬">
          <option value="latest" ${newsState.sort === "latest" ? "selected" : ""}>최신순</option>
          <option value="important" ${newsState.sort === "important" ? "selected" : ""}>중요도순</option>
        </select>
        ${all.some(a => a.ai) ? `<button type="button" class="toggle" id="important" aria-pressed="${newsState.important}">주요 뉴스만</button>` : ""}
        ${all.some(a => isEnglish(a) && hasKo(a)) ? `<button type="button" class="toggle" id="en-ko" aria-pressed="${enKo}" title="영어 기사를 처음부터 한국어 번역으로 보여줘요">영어 기사 한국어로</button>` : ""}
        <span class="count">${rows.length}건</span>
      </div>
      ${body}
      ${rows.length > newsState.shown ? `<button type="button" class="more" id="more">더 보기 (${rows.length - newsState.shown}건 남음)</button>` : ""}
      <p class="news-foot">
        ${news.ai_enabled ? "" : "AI 정리가 꺼져 있어 원문 제목만 보여요. "}
        ${off.length ? `${esc(off.join(", "))}은(는) 키를 설정하면 함께 모아요. ` : ""}
        AI 요약은 제목과 요약문을 바탕으로 해서 틀릴 수 있으니, 중요한 내용은 원문을 확인해 주세요.
      </p>`;

    const rerender = () => { newsState.shown = NEWS_PAGE; renderNews(); };
    $app.querySelectorAll(".tchip").forEach(b => b.addEventListener("click", () => { newsState.topic = b.dataset.topic; rerender(); }));
    $app.querySelector("#region")?.addEventListener("change", e => { newsState.region = e.target.value; rerender(); });
    $app.querySelector("#nsort")?.addEventListener("change", e => { newsState.sort = e.target.value; rerender(); });
    $app.querySelector("#important")?.addEventListener("click", () => { newsState.important = !newsState.important; rerender(); });
    $app.querySelector("#more")?.addEventListener("click", () => {
      const y = window.scrollY;
      newsState.shown += NEWS_PAGE;
      renderNews().then(() => window.scrollTo(0, y));
    });
    $app.querySelector("#en-ko")?.addEventListener("click", () => {
      enKo = !enKo;
      flipped.clear();
      store.set("gittrend:enko", enKo);
      const y = window.scrollY;
      renderNews().then(() => window.scrollTo(0, y));
    });
    $app.querySelectorAll("[data-tr]").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.tr;
      if (flipped.has(id)) flipped.delete(id); else flipped.add(id);
      const on = enKo !== flipped.has(id);
      b.closest(".news-item").classList.toggle("show-ko", on);
      b.setAttribute("aria-pressed", on);
      b.textContent = on ? "원문 보기" : "한국어로 보기";
    }));
    $app.querySelectorAll("[data-read]").forEach(a => a.addEventListener("click", () => {
      readNews.add(a.dataset.read);
      store.set("gittrend:read", [...readNews].slice(-1500));
      a.closest(".news-item")?.classList.add("read");
    }));
    $app.querySelectorAll("[data-jump]").forEach(a => a.addEventListener("click", async e => {
      e.preventDefault();
      const id = a.dataset.jump;
      if (!document.getElementById("n-" + id)) {
        // 아직 펼치지 않은 뒤쪽 기사면 거기까지 펼친다
        const idx = filteredNews().findIndex(x => x.id === id);
        if (idx < 0) return;
        newsState.shown = Math.ceil((idx + 1) / NEWS_PAGE) * NEWS_PAGE;
        await renderNews();
      }
      const el = document.getElementById("n-" + id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }));
  }

  // ------------------------------------------------------------ 라우팅
  //   #/            처음 화면 (마지막에 본 탭)
  //   #/t/<탭>      라이브러리 목록
  //   #/r/<저장소>  라이브러리 상세
  //   #/news        AI 뉴스
  //   #/import/...  관심 목록 가져오기

  let listScroll = 0;
  let cameFromList = false;
  let onList = false;
  let lastListTab = null;

  function setSection(name) {
    document.querySelectorAll(".sec").forEach(a => a.setAttribute("aria-current", a.dataset.sec === name ? "page" : "false"));
    $q.placeholder = name === "news" ? "기사 제목, 내용, 언론사로 찾기" : "이름, 설명, 태그로 찾기";
    document.getElementById("sources").textContent = name === "news"
      ? "출처: Google 뉴스 · AI타임스 · GeekNews · TechCrunch · The Verge · Hacker News · Hugging Face 논문"
      : "출처: GitHub Trending · GitHub 검색 · Hacker News · 자체 star 기록";
  }

  function route() {
    const h = location.hash;
    let m;
    if (h.startsWith("#/news")) {
      setSection("news");
      onList = false;
      cameFromList = false;
      renderNews();
      window.scrollTo(0, 0);
      return;
    }
    setSection("lib");
    if ((m = h.match(/^#\/r\/(.+)$/))) {
      cameFromList = onList;
      onList = false;
      renderDetail(decodeURIComponent(m[1]));
      return;
    }
    if ((m = h.match(/^#\/import\/(.*)$/))) {
      importSaved(m[1]);
      return;
    }
    if ((m = h.match(/^#\/t\/([\w]+)$/)) && TAB_IDS.has(m[1])) {
      state.tab = m[1];
    } else {
      // 주소에 탭이 없으면: 처음 열 때는 마지막에 본 탭(비어 있으면 종합 주목), 그 밖에는 종합 주목.
      // 주소에 탭을 적어 둬야 브라우저 뒤로가기로 탭을 오갈 수 있다.
      let t = "hot";
      if (!lastListTab && TAB_IDS.has(prefTab)) t = prefTab;
      if (t !== "saved" && !listKeys(t).length) t = "hot";
      state.tab = t;
      history.replaceState(null, "", `#/t/${t}`);
    }
    const backFromDetail = cameFromList && !onList && lastListTab === state.tab;
    if (lastListTab !== state.tab) Object.assign(state, { lang: "", cat: "", sort: "rank", onlyNew: false });
    onList = true;
    lastListTab = state.tab;
    store.set("gittrend:view", { tab: state.tab });
    renderList();
    window.scrollTo(0, backFromDetail ? listScroll : 0);
  }

  window.addEventListener("hashchange", route);
  document.addEventListener("click", e => {
    if (e.target.closest(".card-link") || e.target.closest(".theme-repos a")) listScroll = window.scrollY;
  });

  let qTimer;
  $q.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = $q.value;
      if (location.hash.startsWith("#/news")) { newsState.shown = NEWS_PAGE; renderNews(); }
      else if (location.hash.startsWith("#/r/")) location.hash = `#/t/${state.tab}`;
      else renderList();
    }, 150);
  });

  // ------------------------------------------------------------ 시작

  const getJson = url => fetch(url, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

  Promise.all([getJson("data/index.json"), getJson("data/catalog.json").catch(() => ({}))])
    .then(([d, c]) => {
      data = d;
      catalog = c || {};
      // 저장해 둔 관심 라이브러리 정보를 최신 값으로 갱신
      let changed = false;
      for (const k in saved) {
        if (catalog[k]) { saved[k] = { ...snapshot(k), saved_at: saved[k].saved_at }; changed = true; }
      }
      if (changed) store.set("gittrend:saved", saved);
      const t = new Date(d.generated_at);
      document.getElementById("updated").textContent =
        `마지막 업데이트 ${t.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      route();
    })
    .catch(() => {
      $app.innerHTML = `<p class="empty">데이터를 불러오지 못했어요. 수집기(collect.py)를 먼저 실행해 주세요.</p>`;
    });
})();
