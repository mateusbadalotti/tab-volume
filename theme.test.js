const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

test("Theme follows the system until a choice is saved, then persists across openings", () => {
  const storage = new Map();
  function open(systemDark) {
    let ready;
    let click;
    const root = { dataset: {} };
    const toggle = { setAttribute: (name, value) => { toggle[name] = value; }, addEventListener: (type, handler) => { click = handler; } };
    vm.runInNewContext(readFileSync(`${__dirname}/theme.js`, "utf8"), {
      localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
      matchMedia: () => ({ matches: systemDark }),
      document: { documentElement: root, getElementById: () => toggle, addEventListener: (type, handler) => { ready = handler; } }
    });
    return { root, toggle, ready: () => ready(), click: () => click() };
  }
  const dark = open(true);
  assert.equal(dark.root.dataset.theme, "dark");
  dark.ready();
  assert.equal(dark.toggle["aria-checked"], "true");
  dark.click();
  assert.equal(dark.root.dataset.theme, "light");
  assert.equal(dark.toggle["aria-checked"], "false");
  assert.equal(dark.toggle.title, "Switch to dark mode");
  assert.equal(storage.get("theme"), "light");
  const reopened = open(true);
  assert.equal(reopened.root.dataset.theme, "light");
  reopened.ready();
  reopened.click();
  assert.equal(storage.get("theme"), "dark");
  assert.equal(open(false).root.dataset.theme, "dark");
  storage.clear();
  assert.equal(open(false).root.dataset.theme, "light");
  storage.set("theme", "invalid");
  assert.equal(open(false).root.dataset.theme, "light");
  assert.equal(open(true).root.dataset.theme, "dark");
});
