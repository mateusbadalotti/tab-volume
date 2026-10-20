const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

test("Custom-volume tabs stay listed while silent, muted and across popup openings until reset or closed", async () => {
  let tabs = [0, 60, 150, 100, 100].map((volume, id) => ({
    id, title: `Tab ${id}`, url: "https://example.com", audible: id === 3,
    mutedInfo: { muted: id === 2 }
  }));
  const volumes = { 0: 0, 1: 60, 2: 150 };
  function element() {
    const children = new Map();
    return {
      dataset: {}, style: { setProperty() {} }, max: 200,
      setAttribute(name, value) { this[name] = value; },
      addEventListener() {},
      querySelector(selector) {
        if (!children.has(selector)) children.set(selector, element());
        return children.get(selector);
      },
      querySelectorAll() { return [this.querySelector(".volume-slider"), this.querySelector(".volume-value")]; }
    };
  }
  async function open() {
    const elements = new Map();
    const rendered = [];
    const list = element();
    list.append = row => rendered.push(row);
    elements.set("tabs", list);
    const template = { content: { firstElementChild: { cloneNode() {
      const row = element();
      row.remove = () => rendered.splice(rendered.indexOf(row), 1);
      return row;
    } } } };
    elements.set("tab-template", template);
    const event = { addListener() {} };
    const context = vm.createContext({
      URL,
      document: { getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      } },
      chrome: {
        runtime: { sendMessage: async () => ({ tabs, volumes }) },
        tabs: { query: async () => [], onUpdated: event, onCreated: event, onRemoved: event, onActivated: event },
        tabCapture: { onStatusChanged: event }
      }
    });
    vm.runInContext(readFileSync(`${__dirname}/popup.js`, "utf8"), context);
    await new Promise(resolve => setImmediate(resolve));
    return { elements, rendered, refresh: () => vm.runInContext("refresh()", context) };
  }
  for (let opening = 0; opening < 2; opening++) {
    const { elements, rendered } = await open();
    assert.deepEqual(rendered.map(row => row.hidden), [false, false, false, false, true]);
    assert.equal(elements.get("count").textContent, "4 tabs");
    assert.equal(elements.get("playing").textContent, "1 playing");
  }
  const { elements, rendered, refresh } = await open();
  tabs[4].mutedInfo.muted = true;
  await refresh();
  assert.equal(rendered[4].hidden, false);
  assert.equal(rendered[4].querySelector(".status").textContent, "Muted");
  assert.equal(elements.get("count").textContent, "5 tabs");
  assert.equal(elements.get("playing").textContent, "1 playing");
  assert.equal((await open()).rendered[4].hidden, false);
  tabs[4].mutedInfo.muted = false;
  await refresh();
  assert.equal(rendered[4].hidden, true);
  tabs[3].audible = false;
  await refresh();
  assert.equal(rendered[3].hidden, true);
  assert.equal(elements.get("count").textContent, "3 tabs");
  assert.equal(elements.get("playing").textContent, "No audio");
  assert.equal(elements.get("empty").hidden, true);
  delete volumes[1];
  await refresh();
  assert.equal(rendered[1].hidden, true);
  tabs = tabs.filter(tab => tab.id !== 0 && tab.id !== 2);
  await refresh();
  assert.equal(rendered.length, 3);
  assert.equal(elements.get("count").textContent, "0 tabs");
  assert.equal(elements.get("empty").hidden, false);
});
