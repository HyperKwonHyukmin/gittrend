const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function createPage() {
  let source = fs.readFileSync(path.join(__dirname, "../docs/app.js"), "utf8");
  // Keep the real rendering code and replace network startup with controlled data.
  const startup = source.lastIndexOf('  Promise.all([getJson("data/index.json")');
  assert.ok(startup >= 0);
  source = source.slice(0, startup) + `
    data = { repos: {
      "a/one": { full_name: "a/one", slug: "a__one" },
      "b/two": { full_name: "b/two", slug: "b__two" }
    }, ai_enabled: false };
    catalog = {};
    spark = { days: [], stars: {} };
    globalThis.render = renderDetail;
  })();`;
  const app = { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
  const element = { addEventListener() {}, textContent: "" };
  const pending = {};
  const context = {
    document: {
      getElementById: id => id === "app" ? app : element,
      addEventListener() {}, querySelectorAll: () => [],
    },
    localStorage: { getItem: () => null },
    window: { scrollTo() {}, addEventListener() {} },
    location: { hash: "#/r/a__one", hostname: "localhost", pathname: "/" },
    fetch: url => new Promise(resolve => { pending[url] = resolve; }),
    setTimeout, clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { app, context, finish(slug) {
    pending[`data/repos/${slug}.json`]({ ok: true, json: async () => ({}) });
  } };
}

test("a slow previous detail request cannot overwrite the current repository", async () => {
  const page = createPage();
  const first = page.context.render("a__one");
  page.context.location.hash = "#/r/b__two";
  const second = page.context.render("b__two");
  page.finish("b__two");
  await second;
  const current = page.app.innerHTML;
  assert.ok(current.includes('href="https://github.com/b/two"'));
  page.finish("a__one");
  await first;
  assert.equal(page.app.innerHTML, current);
});

test("a detail request cannot overwrite a list opened while it was loading", async () => {
  const page = createPage();
  const first = page.context.render("a__one");
  page.context.location.hash = "#/t/hot";
  page.app.innerHTML = "current list";
  page.finish("a__one");
  await first;
  assert.equal(page.app.innerHTML, "current list");
});

test("a detail request still renders when its repository is current", async () => {
  const page = createPage();
  const first = page.context.render("a__one");
  page.finish("a__one");
  await first;
  assert.ok(page.app.innerHTML.includes('href="https://github.com/a/one"'));
});
