(() => {
  "use strict";

  // 탭 하나에 기간이 여러 개면 views에 목록 id를 두고, 탭 아래 기간 선택으로 고른다.
  // 주소는 예전처럼 목록 id(#/t/daily, #/t/new7 …)를 그대로 써서 예전 링크도 열린다.
  const TABS = [
    { id: "hot", label: "종합 주목", desc: "아래 목록을 모두 합쳐서, 여러 곳에서 동시에 뜨는 저장소일수록 위로 올렸어요." },
    { id: "saved", label: "★ 관심", desc: "☆를 눌러 저장한 라이브러리와, 그와 비슷한 라이브러리 추천이에요. 이 기기에만 저장돼요." },
    { id: "trend", label: "트렌딩", views: ["daily", "weekly", "monthly"], desc: "GitHub Trending 기준, 고른 기간(오늘·이번 주·이번 달) 동안 star를 많이 받은 저장소예요." },
    { id: "new", label: "새로 뜬", views: ["new7", "new30"], desc: "고른 기간(7일·30일) 안에 만들어졌는데 벌써 star가 많이 쌓인 저장소예요." },
    { id: "hn", label: "HN 화제", desc: "개발자 커뮤니티 Hacker News에서 이번 주 추천과 댓글을 많이 받은 GitHub 저장소예요." },
    { id: "rising", label: "급상승", desc: "매일 star 수를 기록해서, 어제보다 star가 가장 많이 늘어난 저장소예요. 기록이 이틀 이상 쌓이면 나타나요." },
  ];
  const VIEW_LABEL = { daily: "오늘", weekly: "이번 주", monthly: "이번 달", new7: "7일", new30: "30일" };
  // 목록 id → 탭 (기간이 없는 탭은 목록 id가 곧 탭 id)
  const tabOf = view => TABS.find(t => t.id === view || (t.views || []).includes(view));
  const TAB_IDS = new Set(TABS.flatMap(t => t.views || [t.id]));
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
  let catalog = {};      // catalog.json: 지금까지 본 모든 저장소 (관심 탭·상세·가져오기에서 처음 쓸 때 불러옴)
  let catalogLoad = null; // 불러오는 중이거나 끝난 Promise
  let catalogReady = false;
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
  const prefView = store.get("gittrend:view", {}) || {};
  const prefTab = prefView.tab;
  // 기간 탭마다 마지막으로 고른 기간 (트렌딩 → weekly 등)
  const lastView = (prefView.periods && typeof prefView.periods === "object") ? { ...prefView.periods } : {};
  if (tabOf(prefTab)?.views) lastView[tabOf(prefTab).id] = prefTab;
  const viewOfTab = t => (t.views ? (t.views.includes(lastView[t.id]) ? lastView[t.id] : t.views[0]) : t.id);

  // 처음 보는 사람을 위한 설명 문단: '닫기'를 누르면 이 기기에서는 다시 보이지 않는다
  const hiddenDesc = new Set(store.get("gittrend:hideDesc", []));
  const descHtml = (key, text, cls = "") => hiddenDesc.has(key) ? "" : `
      <p class="tab-desc ${cls}" data-desc="${esc(key)}">${text}
        <button type="button" class="desc-close" data-desc-close="${esc(key)}" aria-label="이 설명 닫기" title="이 설명 닫기">닫기</button></p>`;
  function bindDesc(root) {
    root.querySelectorAll("[data-desc-close]").forEach(b => b.addEventListener("click", () => {
      hiddenDesc.add(b.dataset.descClose);
      store.set("gittrend:hideDesc", [...hiddenDesc]);
      b.closest("[data-desc]")?.remove();
    }));
  }

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

  const saveLabel = (key, on) => `${(repoOf(key)?.full_name || key).split("/")[1] || key} ${on ? "즐겨찾기 해제" : "즐겨찾기 추가"}`;

  function paintSave(btn, key) {
    const on = isSaved(key);
    btn.setAttribute("aria-pressed", on);
    btn.title = on ? "관심 목록에서 빼기" : "관심 목록에 저장";
    if (btn.classList.contains("btn")) btn.innerHTML = on ? "★ 저장됨" : "☆ 관심 저장";
    else { btn.textContent = on ? "★" : "☆"; btn.setAttribute("aria-label", saveLabel(key, on)); }
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
            aria-label="${esc(saveLabel(key, isSaved(key)))}"
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

  // 다른 기기로 옮기기: 관심 라이브러리 + 즐겨찾기한 AI 소식(id만. 받는 쪽 news.json에 아직 남아 있는 소식만 옮겨짐)
  //   #/import/<라이브러리,…>&n=<소식 id,…>   (&n= 부분이 없는 예전 링크도 그대로 열림)
  function transferHtml() {
    const repoKeys = Object.keys(saved);
    const newsIds = Object.keys(savedNews).filter(id => /^[0-9a-f]{6,40}$/.test(id));
    if (!repoKeys.length && !newsIds.length) return "";
    const link = `${location.origin}${location.pathname}#/import/${encodeURIComponent(repoKeys.join(","))}` +
      (newsIds.length ? `&n=${newsIds.join(",")}` : "");
    const what = [repoKeys.length ? `관심 라이브러리 ${repoKeys.length}개` : "", newsIds.length ? `즐겨찾기한 AI 소식 ${newsIds.length}건` : ""]
      .filter(Boolean).join("와 ");
    return `
      <section class="transfer">
        <b>다른 기기로 옮기기</b>
        <p>${what}은(는) 이 기기의 브라우저에만 저장돼요. 아래 링크를 폰이나 다른 PC에서 열면 같은 목록을 가져올 수 있어요.
          ${newsIds.length ? "AI 소식은 최근 30일 목록에 아직 남아 있는 것만 옮겨져요." : ""}</p>
        <div class="transfer-row">
          <input type="text" readonly value="${esc(link)}" aria-label="관심 목록 옮기기 링크">
          <button class="btn" type="button" id="copy-link">링크 복사</button>
        </div>
      </section>`;
  }

  function bindTransfer(root) {
    root.querySelector("#copy-link")?.addEventListener("click", async e => {
      const input = root.querySelector(".transfer input");
      try { await navigator.clipboard.writeText(input.value); e.target.textContent = "복사됨"; }
      catch (_) { input.select(); e.target.textContent = "직접 복사해 주세요"; }
      setTimeout(() => { e.target.textContent = "링크 복사"; }, 1800);
    });
  }

  function savedExtrasHtml(savedKeys) {
    if (!savedKeys.length) {
      return `<div class="guide">
        <b>관심 라이브러리를 저장해 보세요</b>
        <p>카드 오른쪽 아래의 ☆를 누르면 여기에 모여요. 저장한 라이브러리와 분류, 태그, 설명이 비슷한 라이브러리를 찾아서 추천해 드려요.</p>
      </div>${transferHtml()}`;
    }
    const recs = recommend(savedKeys, 12);
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
      ${transferHtml()}`;
  }

  function renderList() {
    const tab = tabOf(state.tab);
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
    const period = tab.views ? `
      <div class="period" role="group" aria-label="기간">
        ${tab.views.map(v => `<a class="pchip" href="#/t/${v}" aria-current="${v === state.tab ? "page" : "false"}">${VIEW_LABEL[v]}<span class="n">${count(v)}</span></a>`).join("")}
      </div>` : "";

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
        ${TABS.map(t => {
          const v = t === tab ? state.tab : viewOfTab(t);
          return `
          <a class="tab" role="tab" href="#/t/${v}" data-tab="${t.id}" aria-selected="${t === tab}">
            ${t.label}<span class="n">${count(v)}</span>
          </a>`;
        }).join("")}
      </nav>
      ${period}
      ${descHtml("tab:" + tab.id, tab.desc)}
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
    bindDesc($app);
    bindTransfer($app);
    $app.querySelector("#lang")?.addEventListener("change", e => { state.lang = e.target.value; renderList(); });
    $app.querySelector("#cat")?.addEventListener("change", e => { state.cat = e.target.value; renderList(); });
    $app.querySelector("#sort")?.addEventListener("change", e => { state.sort = e.target.value; renderList(); });
    $app.querySelector("#only-new")?.addEventListener("click", () => { state.onlyNew = !state.onlyNew; renderList(); });
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
        <div class="code-label">${esc(label)}${lang ? `${label ? " · " : ""}${esc(lang)}` : ""}</div>
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
    const hash = `#/r/${encodeURIComponent(slug)}`;
    // AI 홈에서 들어왔으면 돌아가는 곳도 AI 홈
    const backLabel = backToNews ? "← AI 소식으로" : "← 목록으로";
    window.scrollTo(0, 0);
    if (!catalogReady) {
      // 오늘 목록에 없는 저장소와 비슷한 라이브러리 추천은 카탈로그가 있어야 찾는다
      $app.innerHTML = `<div class="detail"><p class="loading">불러오는 중…</p></div>`;
      await loadCatalog();
      if (location.hash !== hash) return;
    }
    const key = keyOfSlug(slug);
    const base = key && repoOf(key);
    if (!base) {
      $app.innerHTML = `<div class="detail"><button class="back" data-back>${backLabel}</button><p class="empty">저장소를 찾을 수 없어요.</p></div>`;
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
    if (location.hash !== hash) return; // 기다리는 사이 다른 저장소나 화면으로 이동함

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
        <button class="back" data-back>${backLabel}</button>
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
    bindCopy($app);
  }

  function bindCopy(root) {
    root.querySelectorAll(".copy").forEach(b => b.addEventListener("click", async e => {
      e.preventDefault();
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

  async function importSaved(arg) {
    const [repoPart, newsPart = ""] = arg.split("&n=");
    $app.innerHTML = `<p class="loading">가져오는 중…</p>`;
    await loadCatalog();  // 저장본에 분류·태그·비슷한 도구까지 담으려고
    let n = 0;
    let csv = "";
    try { csv = decodeURIComponent(repoPart); } catch (_) { /* 깨진 링크 */ }
    for (const raw of csv.split(",")) {
      const key = raw.trim().toLowerCase();
      if (!/^[\w.-]+\/[\w.-]+$/.test(key) || isSaved(key)) continue;
      saved[key] = snapshot(key);
      n++;
    }
    store.set("gittrend:saved", saved);
    // 즐겨찾기한 AI 소식: 이쪽 news.json에 아직 있는 기사만 저장본을 만들 수 있다
    let nNews = 0, missing = 0;
    const ids = newsPart.split(",").map(x => x.trim()).filter(x => /^[0-9a-f]{6,40}$/.test(x));
    if (ids.length) {
      await loadNews();
      for (const id of ids) {
        if (isNewsSaved(id)) continue;
        if (toggleNewsSave(id, true)) nNews++; else missing++;
      }
    }
    if (!location.hash.startsWith("#/import/")) return;
    history.replaceState(null, "", "#/t/saved");
    route();
    const parts = [n ? `관심 라이브러리 ${n}개` : "", nNews ? `AI 소식 ${nNews}건` : ""].filter(Boolean);
    toast((parts.length ? `${parts.join(", ")}을(를) 가져왔어요` : "새로 가져올 항목이 없어요") +
      (missing ? ` (지난 소식 ${missing}건은 목록에서 빠져 가져오지 못했어요)` : ""));
  }

  // ------------------------------------------------------------ AI 레이더 (#/news)

  const NEWS_PAGE = 50;
  const KIND_ICON = { "새 모델": "🆕", "도구·라이브러리": "📦", "사용법·팁": "💡", "업계 흐름": "📈" };
  let news = null;
  // home: 구역별로 추린 AI 홈 화면 / false면 kind로 거른 전체 목록
  // saved: 즐겨찾기한 기사만 보기
  // unread: 안 읽은 것만 보기 (이 기기에 기억) / article: #/n/<id> 기사 하나 보기
  const newsState = { home: true, saved: false, kind: "", sort: "latest", important: false, unread: !!store.get("gittrend:newsUnread", false), article: "", shown: NEWS_PAGE };
  const readNews = new Set(store.get("gittrend:read", []));
  // 주소에 쓰는 짧은 이름: #/news/models 등 (목록에 없는 종류는 이름을 그대로 인코딩)
  const KIND_SLUG = { "새 모델": "models", "도구·라이브러리": "tools", "사용법·팁": "tips", "업계 흐름": "trends" };
  const kindHash = kind => kind ? `#/news/${KIND_SLUG[kind] || encodeURIComponent(kind)}` : "#/news/all";
  function kindOfSlug(slug) {
    const hit = Object.entries(KIND_SLUG).find(([, v]) => v === slug);
    if (hit) return hit[0];
    try { return decodeURIComponent(slug); } catch (_) { return ""; }
  }
  // 마지막으로 펼친 기사 (IdeaBox 버튼이 그 기사 주소를 보내도록)
  let openArticle = "";
  // 즐겨찾기한 기사: id -> 저장 당시의 기사 전체 (30일이 지나 목록에서 빠져도 카드까지 그대로 볼 수 있게)
  let savedNews = store.get("gittrend:newsSaved", {});
  if (!savedNews || typeof savedNews !== "object") savedNews = {};
  const isNewsSaved = id => Object.prototype.hasOwnProperty.call(savedNews, id);

  function toggleNewsSave(id, quiet = false) {
    if (isNewsSaved(id)) {
      delete savedNews[id];
      if (!quiet) toast("즐겨찾기에서 뺐어요");
    } else {
      const a = (news.articles || []).find(x => x.id === id);
      if (!a) return false;
      savedNews[id] = { ...a, saved_at: Date.now() };
      if (!quiet) toast("★ 즐겨찾기에 저장했어요");
    }
    store.set("gittrend:newsSaved", savedNews);
    return isNewsSaved(id);
  }

  // 즐겨찾기 목록: 아직 목록에 있는 기사는 최신 내용(새로 만든 카드 등)을 쓰고, 빠진 기사는 저장본을 쓴다
  function savedNewsRows() {
    const live = Object.fromEntries((news.articles || []).map(a => [a.id, a]));
    return Object.values(savedNews)
      .map(s => ({ ...s, ...(live[s.id] || {}), saved_at: s.saved_at }))
      .sort((a, b) => (b.saved_at || 0) - (a.saved_at || 0));
  }
  let newsScroll = 0;

  const newsTitle = a => a.title_ko || a.title;
  const DAY = 86400000;
  const FIT_RANK = { "높음": 2, "보통": 1, "": 1, "낮음": 0 };
  // 라이브러리 목록에서 AI 관련 저장소 골라내기 (분류·태그·토픽·설명). 하이픈은 단어 경계로 보지 않는다 (photoshop-ai 같은 토픽 제외)
  const AI_REPO = /(^|[^a-z-])(ai|llm|llms|gpt|agent|agents|agentic|mcp|rag|claude|codex|openai|anthropic|gemini|copilot|inference|embedding|prompt|diffusion|transformer|voice-ai|tts|stt)([^a-z-]|$)|에이전트|인공지능|언어 ?모델/i;
  const isAiRepo = r => !!r && AI_REPO.test([r.category, ...(r.tags || []), ...(r.topics || []), r.description, r.one_liner].join(" "));

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
    let rows = (newsState.saved ? savedNewsRows() : news.articles || []).filter(a => {
      if (newsState.kind && a.kind !== newsState.kind) return false;
      if (newsState.important && !(a.importance >= 4)) return false;
      if (newsState.unread && !newsState.saved && readNews.has(a.id)) return false;
      if (!q) return true;
      const c = a.card || {};
      return [a.title, a.title_ko, a.summary, a.snippet, a.source, a.kind, c.what, c.why, ...(c.points || [])]
        .join(" ").toLowerCase().includes(q);
    });
    if (newsState.sort === "important" && !newsState.saved) {  // 즐겨찾기는 저장한 순서 그대로
      rows = [...rows].sort((a, b) => (b.importance || 0) - (a.importance || 0) || b.published.localeCompare(a.published));
    }
    return rows;
  }

  // 새 모델: 컨텍스트 길이와 가격 (OpenRouter 기준, 100만 토큰당 달러)
  function modelFacts(m) {
    if (!m) return "";
    const ctx = m.context >= 1e6 ? `${+(m.context / 1e6).toFixed(1)}M` : m.context >= 1000 ? `${Math.round(m.context / 1000)}K` : m.context;
    const price = v => v == null ? "?" : v === 0 ? "무료" : `$${v}`;
    return `<div class="model-facts">
      ${m.context ? `<span>컨텍스트 <b>${esc(String(ctx))}</b></span>` : ""}
      ${m.price_in != null ? `<span>입력 <b>${price(m.price_in)}</b> · 출력 <b>${price(m.price_out)}</b> <small>/ 100만 토큰</small></span>` : ""}
    </div>`;
  }

  function radarCardHtml(c) {
    const t = c.try || {};
    return `
      <div class="radar-card">
        <p class="rc-what">${esc(c.what)}</p>
        ${c.why ? `<p class="why">${esc(c.why)}</p>` : ""}
        ${(c.points || []).length ? `<div class="rc-block"><b>핵심</b>${listHtml(c.points)}</div>` : ""}
        ${t.desc || t.code ? `<div class="rc-block"><b>바로 써 보기</b>${t.desc ? `<p>${esc(t.desc)}</p>` : ""}${codeBlock("", t.lang, t.code)}</div>` : ""}
        ${(c.caveats || []).length ? `<div class="rc-block"><b>주의점</b>${listHtml(c.caveats)}</div>` : ""}
        ${c.fit ? `<div class="rc-fit"><b>내 작업에 맞을까?</b><p>${esc(c.fit)}</p></div>` : ""}
        <p class="rc-note">${c.from_body ? "원문을 읽고 AI가 정리했어요." : "원문을 읽지 못해 제목과 요약문만으로 정리했어요."} 틀린 내용이 있을 수 있어요.</p>
      </div>`;
  }

  function newsItemHtml(a, { showFit = false, open = false } = {}) {
    const imp = a.importance || 0;
    const link = esc(safeUrl(a.link));
    const retitled = a.title_ko && a.title_ko !== a.title;
    const head = `
      <div class="news-meta">
        ${imp >= 4 ? '<span class="badge-hot">주요</span>' : ""}
        ${a.kind ? `<span class="chip cat">${KIND_ICON[a.kind] || ""} ${esc(a.kind)}</span>` : ""}
        ${a.card?.fit_level === "높음" ? '<span class="fit-chip">내 작업에 딱</span>' : ""}
        <span class="news-src">${esc(a.source)}</span>
        <span>${timeText(a.published)}</span>
        ${a.ai ? `<span class="imp" title="중요도 ${imp}/5">${"●".repeat(imp)}<i>${"●".repeat(5 - imp)}</i></span>` : ""}
        <button class="nsave" type="button" data-nsave="${esc(a.id)}" aria-pressed="${isNewsSaved(a.id)}"
          aria-label="${isNewsSaved(a.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}"
          title="${isNewsSaved(a.id) ? "즐겨찾기에서 빼기" : "즐겨찾기에 저장"}">${isNewsSaved(a.id) ? "★" : "☆"}</button>
      </div>`;
    const titles = `
      <h3>${esc(newsTitle(a))}</h3>
      ${retitled ? `<p class="news-orig">${esc(a.title)}</p>` : ""}
      ${a.summary ? `<p class="news-sum">${esc(a.summary)}</p>` : !a.ai && a.snippet ? `<p class="news-sum">${esc(a.snippet)}</p>` : ""}
      ${showFit && a.card?.fit ? `<p class="fy-fit">${esc(a.card.fit)}</p>` : ""}`;
    const foot = `
      <p class="news-extra">
        <a href="${link}" target="_blank" rel="noopener" data-read="${esc(a.id)}">원문 ↗</a>
        ${a.hn_url ? `<a href="${esc(safeUrl(a.hn_url))}" target="_blank" rel="noopener">HN ${fmt(a.hn_points)}점 · 토론</a>` : ""}
      </p>
      ${(a.related || []).length ? `
      <details class="related">
        <summary>같은 소식 ${a.related.length}건 더</summary>
        <ul>${a.related.map(r => `<li><a href="${esc(safeUrl(r.link))}" target="_blank" rel="noopener">${esc(r.title)}</a> <span>${esc(r.source)}</span></li>`).join("")}</ul>
      </details>` : ""}`;
    // 카드가 있으면 제목을 눌러 페이지 안에서 펼쳐 읽는다. 원문은 아래 작은 링크로만.
    const body = a.card ? `
      <details class="radar" data-open="${esc(a.id)}" ${open ? "open" : ""}>
        <summary>${head}${titles}<span class="rc-toggle">${open ? "접기" : "자세히 보기"}</span></summary>
        ${radarCardHtml(a.card)}
      </details>` : `${head}${titles}`;
    return `
      <article class="news-item ${readNews.has(a.id) ? "read" : ""}" id="n-${esc(a.id)}">
        ${body}
        ${modelFacts(a.model)}
        ${foot}
      </article>`;
  }

  function briefHtml() {
    const b = news.brief;
    if (!b || state.q || newsState.kind || newsState.important) return "";
    const byId = Object.fromEntries((news.articles || []).map(a => [a.id, a]));
    const short = a => { const t = newsTitle(a); return t.length > 22 ? t.slice(0, 22) + "…" : t; };
    return `
      <section class="digest">
        <div class="digest-k">오늘의 AI 레이더 · AI 요약</div>
        <h2>${esc(b.headline)}</h2>
        ${b.summary ? `<p>${esc(b.summary)}</p>` : ""}
        ${(b.themes || []).length ? `
        <details class="brief-themes" ${matchMedia("(min-width: 641px)").matches ? "open" : ""}>
          <summary>오늘의 흐름 ${b.themes.length}개</summary>
          <div class="themes">${b.themes.map(t => `
          <div class="theme">
            <b>${esc(t.title)}</b>
            ${t.desc ? `<span>${esc(t.desc)}</span>` : ""}
            <div class="theme-repos">${(t.ids || []).map(i => byId[i]).filter(Boolean)
              .map(a => `<a href="#n-${esc(a.id)}" data-jump="${esc(a.id)}">${esc(short(a))}</a>`).join("")}</div>
          </div>`).join("")}</div>
        </details>` : ""}
      </section>`;
  }

  // ---- AI 홈: 구역마다 몇 개씩만 추려서 한 화면에 보여준다. 한 항목은 한 구역에만 나온다.

  // 최근 days일 안에서 중요도 높은 순으로 n개. 모자라면 기간을 넘겨 채운다.
  function pickTop(rows, n, used, days = 7) {
    const cut = Date.now() - days * DAY;
    const left = rows.filter(a => !used.has(a.id));
    const fresh = left.filter(a => new Date(a.published) >= cut);
    const pool = fresh.length >= n ? fresh : left;
    const out = [...pool].sort((a, b) => (b.importance || 0) - (a.importance || 0) || b.published.localeCompare(a.published)).slice(0, n);
    out.forEach(a => used.add(a.id));
    return out;
  }

  // 나를 위한 추천: 카드가 있고 profile.md 기준 적합도가 높은 것, 아직 안 읽은 것
  function forYou(all, n, used) {
    const cut = Date.now() - 7 * DAY;
    const out = all.filter(a => a.card && a.card.fit_level !== "낮음" && !readNews.has(a.id) && new Date(a.published) >= cut)
      .sort((a, b) => FIT_RANK[b.card.fit_level || ""] - FIT_RANK[a.card.fit_level || ""]
        || (b.importance || 0) - (a.importance || 0) || b.published.localeCompare(a.published))
      .slice(0, n);
    out.forEach(a => used.add(a.id));
    return out;
  }

  // 내 도구 업데이트: 도구마다 가장 최근 릴리스 하나 (articles는 최신순)
  function toolUpdates(all, n, used) {
    const latest = new Map();
    for (const a of all) if (a.repo && !used.has(a.id) && !latest.has(a.repo)) latest.set(a.repo, a);
    const out = [...latest.values()].slice(0, n);
    out.forEach(a => used.add(a.id));
    return out;
  }

  function libMiniHtml(r) {
    const p = r.period || {};
    const grow = p.daily ? `+${fmt(p.daily)}★ 오늘` : p.weekly ? `+${fmt(p.weekly)}★ 이번 주` : r.growth?.d1 ? `+${fmt(r.growth.d1)}★ 하루` : `★ ${fmt(r.stars)}`;
    return `
      <a class="lib-mini" href="#/r/${encodeURIComponent(r.slug)}">
        <div class="lm-top"><b>${esc(r.full_name)}</b><span class="lm-grow">${grow}</span></div>
        <p>${esc(r.one_liner || r.description || "")}</p>
        <div class="lm-meta">
          ${r.is_new ? '<span class="new">NEW</span>' : ""}
          ${r.category ? `<span>${esc(r.category)}</span>` : ""}
          ${r.language ? `<span>${esc(r.language)}</span>` : ""}
          ${r.has_deep ? '<span class="lm-deep">심층 분석</span>' : ""}
        </div>
      </a>`;
  }

  function homeSec(title, sub, inner, more) {
    if (!inner) return "";
    return `
      <section class="home-sec">
        <div class="home-head">
          <h2>${title}</h2>
          ${more ? `<a class="home-more" href="${esc(more.href || (more.kind != null ? kindHash(more.kind) : "#/news"))}">${esc(more.label || "더 보기")} →</a>` : ""}
        </div>
        ${sub ? `<p class="home-sub">${sub}</p>` : ""}
        ${inner}
      </section>`;
  }

  function homeHtml(all) {
    const used = new Set();
    const list = (rows, opts) => rows.length ? `<div class="news-list">${rows.map(a => newsItemHtml(a, opts)).join("")}</div>` : "";
    const mine = forYou(all, 3, used);
    const libs = data ? listKeys("hot").map(k => data.repos[k]).filter(isAiRepo).slice(0, 6) : [];
    const of = kind => all.filter(a => a.kind === kind);
    const models = pickTop(of("새 모델"), 4, used);
    const usage = pickTop(of("사용법·팁"), 5, used);
    const tools = toolUpdates(all, 6, used);
    const trends = pickTop(of("업계 흐름"), 3, used);
    return `
      ${homeSec("⭐ 나를 위한 추천", "profile.md에 적어 둔 작업 기준으로 지금 쓸 만한 것 (읽으면 다음 것으로 바뀌어요)", list(mine, { showFit: true }))}
      ${homeSec("🔥 요즘 뜨는 AI 라이브러리", "GitHub Trending · HN · star 급상승에서 AI 관련만 골랐어요",
        libs.length ? `<div class="lib-grid">${libs.map(libMiniHtml).join("")}</div>` : "", { label: "라이브러리 전체", href: "#/t/hot" })}
      ${homeSec("🆕 새 모델", "", list(models), { kind: "새 모델" })}
      ${homeSec("💡 사람들은 이렇게 써요", "Reddit · Hacker News · GeekNews · 블로그의 실제 사용기와 팁", list(usage), { kind: "사용법·팁" })}
      ${homeSec("📦 내 도구 업데이트", "Claude Code, Codex, Vite, Playwright 등 쓰는 도구의 새 버전", list(tools), { kind: "도구·라이브러리" })}
      ${homeSec("📈 업계 흐름", "", list(trends), { kind: "업계 흐름" })}`;
  }

  function markRead(id, el) {
    readNews.add(id);
    store.set("gittrend:read", [...readNews].slice(-1500));
    el?.classList.add("read");
  }

  // news.json의 출처별 수집 결과(새 항목 수 / "실패" / "키 없음") 중 문제 있는 것만 한 줄로
  function sourceIssuesHtml() {
    const st = news.sources || {};
    const failed = Object.keys(st).filter(k => st[k] === "실패");
    const noKey = Object.keys(st).filter(k => st[k] === "키 없음");
    if (!failed.length && !noKey.length) return "";
    return `
      <p class="news-foot src-issues">
        ${failed.length ? `<span class="warn-text">이번 수집에서 가져오지 못한 출처: ${failed.map(esc).join(", ")}</span>` : ""}
        ${noKey.length ? `<span>키가 없어 건너뛴 출처: ${noKey.map(esc).join(", ")}</span>` : ""}
      </p>`;
  }

  const newsFootHtml = () => `
      <p class="news-foot">
        ${news.ai_enabled ? "" : "AI 정리가 꺼져 있어 원문 제목만 보여요. "}
        AI 정리는 틀릴 수 있으니, 중요한 내용은 원문을 확인해 주세요.
      </p>
      ${sourceIssuesHtml()}`;

  // 기사 카드의 즐겨찾기·펼치기·원문 링크·복사 버튼 연결 (목록과 기사 하나 보기가 같이 씀)
  function bindNewsItems(root) {
    root.querySelectorAll("[data-nsave]").forEach(b => b.addEventListener("click", e => {
      e.preventDefault();   // 카드 제목 영역(summary) 안에 있어서, 누를 때 카드가 펼쳐지지 않게
      e.stopPropagation();
      const id = b.dataset.nsave;
      const on = toggleNewsSave(id);
      if (newsState.saved && !newsState.article && !newsState.home) {  // 즐겨찾기 화면에서 빼면 바로 목록에서 없앤다
        const y = window.scrollY;
        renderNews().then(() => window.scrollTo(0, y));
        return;
      }
      root.querySelectorAll(`[data-nsave="${CSS.escape(id)}"]`).forEach(x => {
        x.setAttribute("aria-pressed", on);
        x.setAttribute("aria-label", on ? "즐겨찾기 해제" : "즐겨찾기 추가");
        x.textContent = on ? "★" : "☆";
        x.title = on ? "즐겨찾기에서 빼기" : "즐겨찾기에 저장";
      });
      const n = root.querySelector(".nsaved-n");
      if (n) n.textContent = Object.keys(savedNews).length;
    }));
    root.querySelectorAll("details.radar").forEach(d => d.addEventListener("toggle", () => {
      d.querySelector(".rc-toggle").textContent = d.open ? "접기" : "자세히 보기";
      if (d.open) { openArticle = d.dataset.open; markRead(d.dataset.open, d.closest(".news-item")); }
      else if (openArticle === d.dataset.open) openArticle = "";
    }));
    root.querySelectorAll("[data-read]").forEach(a => a.addEventListener("click", () => markRead(a.dataset.read, a.closest(".news-item"))));
    bindCopy(root);
  }

  // #/n/<id>: 기사 하나를 펼친 채로 보여준다 (새로고침·공유·IdeaBox용 주소)
  function renderArticle(id) {
    const a = (news.articles || []).find(x => x.id === id) || savedNews[id];
    $app.innerHTML = `
      <div class="detail news-one">
        <button class="back" data-back>← AI 소식으로</button>
        ${a ? `<div class="news-list">${newsItemHtml(a, { showFit: true, open: true })}</div>${newsFootHtml()}`
          : `<p class="empty">이 소식을 찾을 수 없어요. 30일이 지나 목록에서 빠졌을 수 있어요.</p>`}
      </div>`;
    $app.querySelector("[data-back]").addEventListener("click", () => {
      if (newsBackable) history.back();
      else location.hash = "#/news";
    });
    if (!a) return;
    openArticle = id;
    markRead(id, $app.querySelector(".news-item"));
    bindNewsItems($app);
  }

  async function renderNews() {
    if (!news) {
      $app.innerHTML = `<p class="loading">불러오는 중…</p>`;
      await loadNews();
      if (!isNewsHash(location.hash)) return;
    }
    if (newsState.article) { renderArticle(newsState.article); return; }
    openArticle = "";
    const all = news.articles || [];
    const rows = filteredNews();
    const kindCounts = {};
    for (const a of all) if (a.kind) kindCounts[a.kind] = (kindCounts[a.kind] || 0) + 1;
    const kinds = (news.kinds || []).filter(k => kindCounts[k]);
    const page = rows.slice(0, newsState.shown);

    let body;
    if (!rows.length) {
      body = `<p class="empty">${newsState.saved
        ? (Object.keys(savedNews).length ? "조건에 맞는 즐겨찾기가 없어요." : "아직 즐겨찾기한 기사가 없어요. 기사 오른쪽 위의 ☆를 누르면 여기에 모여요.")
        : newsState.unread && all.length ? "안 읽은 소식이 없어요. '안 읽은 것만'을 끄면 읽은 소식도 보여요."
        : all.length ? "조건에 맞는 소식이 없어요." : "아직 모은 소식이 없어요. 수집기(collect.py)를 실행해 주세요."}</p>`;
    } else if (newsState.saved || newsState.sort === "important") {
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

    // 검색 중에는 홈 대신 전체 목록에서 찾는다
    const showHome = newsState.home && !state.q.trim() && all.length > 0;
    const chips = `
      <div class="topic-chips">
        <button type="button" class="tchip" data-href="#/news" aria-pressed="${showHome}">🏠 홈</button>
        <button type="button" class="tchip" data-href="#/news/saved" aria-pressed="${!showHome && newsState.saved}">★ 즐겨찾기 <span class="nsaved-n">${Object.keys(savedNews).length}</span></button>
        <button type="button" class="tchip" data-href="#/news/all" aria-pressed="${!showHome && !newsState.saved && !newsState.kind}">전체 <span>${all.length}</span></button>
        ${kinds.map(k => `<button type="button" class="tchip" data-href="${esc(kindHash(k))}" aria-pressed="${!showHome && !newsState.saved && newsState.kind === k}">${KIND_ICON[k] || ""} ${esc(k)} <span>${kindCounts[k]}</span></button>`).join("")}
      </div>`;
    const more = rows.length > newsState.shown ? `<button type="button" class="more" id="more">더 보기 (${rows.length - newsState.shown}건 남음)</button>` : "";
    const feed = newsState.saved ? `
      ${descHtml("news:saved", "☆를 눌러 저장한 기사예요. 저장한 순서로 보여주고, 목록에서 빠진 오래된 기사도 카드까지 그대로 남아요. 이 기기 브라우저에만 저장돼요.")}
      ${body}
      ${more}
      ${transferHtml()}` : `
      <div class="filters">
        <select id="nsort" aria-label="정렬">
          <option value="latest" ${newsState.sort === "latest" ? "selected" : ""}>최신순</option>
          <option value="important" ${newsState.sort === "important" ? "selected" : ""}>중요도순</option>
        </select>
        ${all.some(a => a.ai) ? `<button type="button" class="toggle" id="important" aria-pressed="${newsState.important}">주요 소식만</button>` : ""}
        <button type="button" class="toggle" id="unread" aria-pressed="${newsState.unread}">안 읽은 것만</button>
        <span class="count">${rows.length}건</span>
      </div>
      ${body}
      ${more}`;

    $app.innerHTML = `
      ${descHtml("news:intro", `나를 위한 AI 홈이에요. 새 모델, 뜨는 AI 라이브러리, 사람들의 활용법, 쓰는 도구의 새 버전을 한곳에 모았어요.
        주요 소식은 AI가 원문을 읽고 정리해 두어서, 제목을 누르면 이 화면에서 바로 읽을 수 있어요.`, "news-desc")}
      ${showHome ? briefHtml() + chips + homeHtml(all) : chips + feed}
      ${newsFootHtml()}`;

    const rerender = () => { newsState.shown = NEWS_PAGE; renderNews(); };
    bindDesc($app);
    bindTransfer($app);
    bindNewsItems($app);
    $app.querySelectorAll(".tchip").forEach(b => b.addEventListener("click", () => {
      if (location.hash === b.dataset.href) { window.scrollTo(0, 0); return; }
      location.hash = b.dataset.href;
    }));
    $app.querySelector("#nsort")?.addEventListener("change", e => { newsState.sort = e.target.value; rerender(); });
    $app.querySelector("#important")?.addEventListener("click", () => { newsState.important = !newsState.important; rerender(); });
    $app.querySelector("#unread")?.addEventListener("click", () => {
      newsState.unread = !newsState.unread;
      store.set("gittrend:newsUnread", newsState.unread);
      rerender();
    });
    $app.querySelector("#more")?.addEventListener("click", () => {
      const y = window.scrollY;
      newsState.shown += NEWS_PAGE;
      renderNews().then(() => window.scrollTo(0, y));
    });
    $app.querySelectorAll("[data-jump]").forEach(a => a.addEventListener("click", e => {
      e.preventDefault();
      const id = a.dataset.jump;
      const el = document.getElementById("n-" + id);
      // 홈에 없는 항목이면 그 기사 하나 보기로 간다
      if (!el) { location.hash = `#/n/${id}`; return; }
      const card = el.querySelector("details.radar");
      if (card) card.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }));
  }

  // ------------------------------------------------------------ 라우팅
  //   #/            처음 화면 = AI 홈
  //   #/t/<목록>    라이브러리 목록 (hot, saved, daily·weekly·monthly = 트렌딩, new7·new30 = 새로 뜬, hn, rising)
  //                 #/t/trend, #/t/new 는 마지막으로 고른 기간으로 바꿔 연다
  //   #/r/<저장소>  라이브러리 상세
  //   #/news        AI 홈 (추천 · 뜨는 AI 라이브러리 · 새 모델 · 활용법 · 도구 업데이트)
  //   #/news/all    AI 소식 전체 목록, #/news/<models|tools|tips|trends> 종류별, #/news/saved 즐겨찾기
  //   #/n/<id>      AI 소식 하나 (펼친 카드)
  //   #/import/...  관심 목록 가져오기

  let listScroll = 0;
  let cameFromList = false;
  let onList = false;
  let lastListTab = null;
  let onNews = false;
  let onNewsList = false;
  let backToNews = false;
  let newsBackable = false;  // 기사 하나 보기에서 '뒤로'가 AI 소식 목록으로 돌아가는지

  const isNewsHash = h => h.startsWith("#/news") || h.startsWith("#/n/");

  function setSection(name) {
    document.querySelectorAll(".sec").forEach(a => a.setAttribute("aria-current", a.dataset.sec === name ? "page" : "false"));
    $q.placeholder = name === "news" ? "모델, 도구, 내용으로 찾기" : "이름, 설명, 태그로 찾기";
    document.getElementById("sources").textContent = name === "news"
      ? "출처: OpenRouter · Hugging Face · OpenAI · Google DeepMind · Google AI · GitHub 릴리스 · Simon Willison · Latent Space · GeekNews · Hacker News · Reddit · dev.to · Lobsters · GitTrend 라이브러리"
      : "출처: GitHub Trending · GitHub 검색 · Hacker News · 자체 star 기록";
  }

  // 주소 → AI 소식 화면 상태
  function newsStateOf(h) {
    let m;
    if ((m = h.match(/^#\/n\/([0-9a-f]{6,40})$/))) return { article: m[1] };
    const sub = (h.match(/^#\/news\/([^/?#]+)/) || [])[1] || "";
    if (!sub) return { article: "", home: true, saved: false, kind: "" };
    if (sub === "saved") return { article: "", home: false, saved: true, kind: "" };
    if (sub === "all") return { article: "", home: false, saved: false, kind: "" };
    return { article: "", home: false, saved: false, kind: kindOfSlug(sub) };
  }

  function route() {
    const h = location.hash;
    let m;
    if (!h || h === "#" || h === "#/") {
      history.replaceState(null, "", "#/news");
      route();
      return;
    }
    // 화면을 바꾸기 전에 보던 AI 소식 목록의 스크롤 위치를 기억 (돌아오면 그 자리로)
    if (onNewsList) newsScroll = window.scrollY;
    if (isNewsHash(h)) {
      setSection("news");
      const next = newsStateOf(h);
      if (next.article) {
        newsBackable = onNews;
        backToNews = backToNews || onNewsList;
      } else {
        const changed = next.home !== newsState.home || next.saved !== newsState.saved || next.kind !== newsState.kind;
        if (changed) newsState.shown = NEWS_PAGE;
      }
      Object.assign(newsState, next);
      onList = false;
      cameFromList = false;
      const back = !next.article && backToNews;
      if (!next.article) backToNews = false;
      onNews = true;
      onNewsList = !next.article;
      // 홈에서 라이브러리나 기사 하나를 보고 돌아오면 보던 자리로
      renderNews().then(() => window.scrollTo(0, back ? newsScroll : 0));
      if (!back) window.scrollTo(0, 0);
      return;
    }
    setSection("lib");
    onNewsList = false;
    if ((m = h.match(/^#\/r\/(.+)$/))) {
      cameFromList = onList || onNews;
      backToNews = onNews;
      onList = false;
      onNews = false;
      renderDetail(decodeURIComponent(m[1]));
      return;
    }
    onNews = false;
    backToNews = false;
    if ((m = h.match(/^#\/import\/(.*)$/))) {
      importSaved(m[1]);
      return;
    }
    const group = (m = h.match(/^#\/t\/([\w]+)$/)) && TABS.find(t => t.id === m[1] && t.views);
    if (group) {
      // #/t/trend, #/t/new → 마지막으로 고른 기간
      state.tab = viewOfTab(group);
      history.replaceState(null, "", `#/t/${state.tab}`);
    } else if (m && TAB_IDS.has(m[1])) {
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
    // 같은 탭 안에서 기간만 바꾸면 언어·분류 필터는 그대로 둔다
    if (tabOf(lastListTab) !== tabOf(state.tab)) Object.assign(state, { lang: "", cat: "", sort: "rank", onlyNew: false });
    onList = true;
    lastListTab = state.tab;
    const tab = tabOf(state.tab);
    if (tab.views) lastView[tab.id] = state.tab;
    store.set("gittrend:view", { tab: state.tab, periods: lastView });
    const show = () => { renderList(); window.scrollTo(0, backFromDetail ? listScroll : 0); };
    if (state.tab === "saved" && !catalogReady) {
      // 관심 탭의 추천·마지막 순위는 카탈로그가 있어야 계산된다
      $app.innerHTML = `<p class="loading">불러오는 중…</p>`;
      const want = location.hash;
      loadCatalog().then(() => { if (location.hash === want) show(); });
    } else {
      show();
    }
  }

  window.addEventListener("hashchange", route);
  document.addEventListener("click", e => {
    if (e.target.closest(".card-link") || e.target.closest(".theme-repos a")) listScroll = window.scrollY;
    if (e.target.closest(".lib-mini")) newsScroll = window.scrollY;
  });

  let qTimer;
  $q.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = $q.value;
      if (isNewsHash(location.hash)) {
        if (newsState.article) location.hash = "#/news/all";  // 기사 하나 보기에서는 전체 목록에서 찾는다
        else { newsState.shown = NEWS_PAGE; renderNews(); }
      }
      else if (location.hash.startsWith("#/r/")) location.hash = `#/t/${state.tab}`;
      else renderList();
    }, 150);
  });

  // ------------------------------------------------------------ 데이터 불러오기

  const getJson = url => fetch(url, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

  // catalog.json은 크고 첫 화면에는 필요 없어서, 관심 탭·상세·가져오기에서 처음 쓸 때 받는다
  function loadCatalog() {
    if (!catalogLoad) {
      catalogLoad = getJson("data/catalog.json").catch(() => ({})).then(c => {
        catalog = c || {};
        catalogReady = true;
        // 저장해 둔 관심 라이브러리 정보를 최신 값으로 갱신
        let changed = false;
        for (const k in saved) {
          if (catalog[k]) { saved[k] = { ...snapshot(k), saved_at: saved[k].saved_at }; changed = true; }
        }
        if (changed) store.set("gittrend:saved", saved);
      });
    }
    return catalogLoad;
  }

  let newsLoad = null;
  function loadNews() {
    if (!newsLoad) {
      newsLoad = getJson("data/news.json")
        .catch(() => ({ articles: [], sources: {}, load_failed: true }))
        .then(n => { news = n || { articles: [], sources: {} }; return news; });
    }
    return newsLoad;
  }

  // 수집은 하루 두 번(07·18시). 16시간 넘게 새 데이터가 없거나 AI 정리가 실패했으면 화면 위에 알린다.
  const STALE_HOURS = 16;
  const statusNotes = {};
  function setStatusNote(key, text) {
    statusNotes[key] = text;
    const note = document.getElementById("status-note");
    if (!note) return;
    const all = Object.values(statusNotes).filter(Boolean);
    note.textContent = all.join(" ");
    note.hidden = !all.length;
  }
  const hoursSince = iso => (Date.now() - new Date(iso).getTime()) / 3600_000;

  // 첫 화면 시작: index.json과 news.json을 동시에 받는다 (이 줄부터는 테스트가 잘라 내고 대신 넣음)
  loadNews().then(n => {
    if (n.load_failed) setStatusNote("news", "AI 소식 데이터(news.json)를 불러오지 못했어요.");
    else if (n.generated_at && hoursSince(n.generated_at) > STALE_HOURS) {
      setStatusNote("news", `AI 소식이 ${Math.floor(hoursSince(n.generated_at))}시간 동안 갱신되지 않았어요. GitHub Actions의 Update trends 실행 기록을 확인해 주세요.`);
    }
  });
  getJson("data/index.json")
    .then(d => {
      data = d;
      const t = new Date(d.generated_at);
      document.getElementById("updated").textContent =
        `마지막 업데이트 ${t.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      const notes = [];
      if (d.ai_error) notes.push("이번 수집에서 AI 정리가 일부 실패했어요(OpenAI 한도·오류 가능성). 요약이 빠진 항목이 있을 수 있어요.");
      if (hoursSince(d.generated_at) > STALE_HOURS) notes.push(`라이브러리 데이터가 ${Math.floor(hoursSince(d.generated_at))}시간 동안 갱신되지 않았어요. GitHub Actions의 Update trends 실행 기록을 확인해 주세요.`);
      setStatusNote("index", notes.join(" "));
      route();
    })
    .catch(() => {
      $app.innerHTML = `<p class="empty">데이터를 불러오지 못했어요. 수집기(collect.py)를 먼저 실행해 주세요.</p>`;
    });

  // ---------- IdeaBox로 아이디어 보내기
  // 누르는 순간의 화면(주소·제목)을 담아 IdeaBox 빠른 입력 창을 엽니다. 저장은 IdeaBox 창에서 버튼을 눌러야 됩니다.
  // AI 소식 카드를 펼쳐 둔 상태면 그 기사 주소(#/n/<id>)와 제목을 보냅니다.
  const ideaBtn = document.getElementById("idea-btn");
  if (ideaBtn) {
    const ideaUrl = () => {
      let url = location.href;
      let heading = document.querySelector("#app h1, #app h2")?.textContent?.trim();
      const a = openArticle && isNewsHash(location.hash) && news
        ? (news.articles || []).find(x => x.id === openArticle) || savedNews[openArticle] : null;
      if (a) {
        url = `${location.origin}${location.pathname}#/n/${openArticle}`;
        heading = newsTitle(a);
      }
      const title = heading ? `${heading} · GitTrend` : document.title;
      return `https://idea.hyperkwon.com/new?src=GitTrend&url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
    };
    // 가운데 클릭·새 탭으로 열기에도 지금 화면 주소가 담기도록 가리킬 때마다 갱신
    ["pointerenter", "focus", "touchstart"].forEach((ev) => ideaBtn.addEventListener(ev, () => { ideaBtn.href = ideaUrl(); }, { passive: true }));
    ideaBtn.addEventListener("click", (e) => {
      const w = window.open(ideaUrl(), "ideabox", "width=520,height=680");
      if (w) e.preventDefault(); // 팝업이 막히면 링크(새 탭)로 그대로 엽니다
    });
  }
})();
