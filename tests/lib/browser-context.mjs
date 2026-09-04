// Loads the browser-side line-item / AS400 JS into a headless V8 context so tests
// can call the real preview builders without a browser.
//
// The app's JS files are plain <script> globals (no modules), so we eval them
// one after another into a single shared vm context, exactly like the browser
// would. DOM and network access is stubbed - the preview builders only touch
// localStorage and a handful of module-level state variables.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Order matches index.html: app.js (constants), line-items.js (editor + state),
// line-item-catalog.js (option lookups), line-item-bulk.js (bulk defaults),
// line-item-as400.js (preview logic), document-generation.js
// (mapLineItemForAs400Automation), as400-format.js (row plan).
const FILES = [
  'static/js/app.js',
  'static/js/line-item-fields.js',
  'static/js/field-config.js',
  'static/js/line-item-options.js',
  'static/js/line-item-groups.js',
  'static/js/line-item-geometry.js',
  'static/js/line-items.js',
  'static/js/line-item-render.js',
  'static/js/line-item-catalog.js',
  'static/js/line-item-bulk.js',
  'static/js/line-item-as400.js',
  'static/js/document-generation.js',
  'static/js/as400-format.js',
];

// A DOM element that captures innerHTML and stubs everything else.
function makeElement(tag = 'div') {
  const slots = { innerHTML: '', textContent: '', value: '', checked: false, tagName: tag.toUpperCase() };
  const noop = () => {};
  const backing = {
    ...slots,
    style: new Proxy({}, { get: () => '', set: () => true }),
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    dataset: {},
    addEventListener: noop, removeEventListener: noop,
    appendChild: (x) => x, removeChild: (x) => x, insertBefore: (x) => x, remove: noop,
    setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus: noop, blur: noop, click: noop,
    scrollIntoView: noop, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    contains: () => false, matches: () => false,
    getElementsByClassName: () => [], getElementsByTagName: () => [],
  };
  return new Proxy(backing, {
    get: (t, p) => (p in t ? t[p] : undefined),
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

function makeDocument(elementsById) {
  const noop = () => {};
  const generic = makeElement();
  return {
    getElementById: (id) => elementsById[id] || makeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeElement(tag),
    createTextNode: (t) => ({ textContent: t }),
    createDocumentFragment: () => makeElement('fragment'),
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false,
    body: generic, documentElement: generic, head: generic,
    getElementsByClassName: () => [], getElementsByTagName: () => [],
  };
}

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

export function createBrowserContext() {
  const storage = makeLocalStorage();
  const lineItemsListEl = makeElement('div');
  const domStub = makeDocument({ lineItemsList: lineItemsListEl });

  // window: real object for the bits the app reads, permissive Proxy for the rest
  // (addEventListener, matchMedia, dispatchEvent, ... all become noops).
  const windowTarget = {
    localStorage: storage,
    location: { pathname: '/', search: '' },
    navigator: { userAgent: 'snapshot-harness' },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
    getComputedStyle() { return {}; },
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    scrollTo() {},
    alert() {},
    confirm() { return false; },
    prompt() { return null; },
  };
  const windowStub = new Proxy(windowTarget, {
    get: (t, p) => (p in t ? t[p] : (typeof p === 'string' ? () => undefined : undefined)),
    set: (t, p, v) => { t[p] = v; return true; },
    has: () => true,
  });

  const sandbox = {
    console,
    window: windowStub,
    document: domStub,
    navigator: windowTarget.navigator,
    location: windowTarget.location,
    localStorage: storage,
    fetch: () => Promise.reject(new Error('network disabled in snapshot harness')),
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    // App globals referenced at load / by the preview path:
    API_BASE: '/api',
    vendorSkuByName: {},
    currentOrder: null,
    currentLineItems: [],
    selectedOrderId: null,
    lineItemsList: null,
    getSelectedOrder: () => sandbox.currentOrder,
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);

  for (const rel of FILES) {
    const abs = path.join(ROOT, rel);
    const code = fs.readFileSync(abs, 'utf8');
    try {
      vm.runInContext(code, context, { filename: rel });
    } catch (err) {
      throw new Error(`Failed loading ${rel} into snapshot context: ${err.message}`);
    }
  }

  // app.js declares currentOrder / currentLineItems / getSelectedOrder as
  // top-level `let`/`function`, which live in the context's lexical scope - not
  // as sandbox properties. So the "open order" state has to be assigned by code
  // *running inside* the context, and getSelectedOrder redefined there too.
  vm.runInContext(
    'getSelectedOrder = function () { return currentOrder; };' +
    // app.js's escapeHtml round-trips through a real <div>; our DOM stub can't,
    // so give the context a faithful text-escape (matches textContent->innerHTML:
    // & < > only, quotes pass through).
    'escapeHtml = function (t) { return String(t == null ? "" : t)' +
    '.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };',
    context,
  );

  // field-config.js declares LINE_ITEM_FIELD_CONFIG as a top-level `let`. In the
  // running app loadFieldConfig() fetches it; the harness has no network, so seed
  // it from the committed factory defaults (the DB seed source) so managed
  // dropdowns resolve their options exactly as production does after first run.
  {
    const defaults = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'data/line_item_field_defaults.json'), 'utf8'),
    );
    const options = {};
    for (const [key, spec] of Object.entries(defaults.options || {})) {
      const scope = spec.scope || '*';
      options[key] = (spec.items || []).map((opt, i) => ({
        id: i + 1,
        field_key: key,
        scope,
        vendor: opt.vendor || '',
        value: opt.value,
        label: opt.label || opt.value,
        as400_text: opt.as400_text || null,
        sort_order: i * 10,
        active: opt.active === false ? false : true,
      }));
    }
    // labels: {} - the server returns only user overrides here, not the seeded
    // defaults, so fieldLabel() falls back to the registry label (unchanged).
    sandbox.__fieldConfig = { options, labels: {} };
    vm.runInContext('LINE_ITEM_FIELD_CONFIG = globalThis.__fieldConfig;', context);
  }

  return {
    /** Set the "open order" state the preview builders read from. */
    setOrder(order) {
      sandbox.__order = order || null;
      sandbox.__items = Array.isArray(order?.line_items) ? order.line_items : [];
      vm.runInContext(
        'currentOrder = globalThis.__order;' +
        'currentLineItems = globalThis.__items;' +
        'selectedOrderId = (currentOrder && currentOrder.id) || null;',
        context,
      );
    },
    /** Full AS400 preview text for one line item (comment block + Ctrl+Alt+S). */
    previewForItem(item) {
      return String(context.buildAs400CommentPreview(item) ?? '');
    },
    /** The normalized automation payload the launch call would send for one item. */
    mappedItem(item) {
      return context.mapLineItemForAs400Automation(item);
    },
    /** The full AS400 row plan (single source of truth) for an order's line items. */
    rowPlanForOrder(order) {
      this.setOrder(order);
      const items = Array.isArray(order?.line_items) ? order.line_items : [];
      return context.buildAs400RowPlan(order, items);
    },
    /** The HTML renderLineItemsEditor() would put in the editor for this order. */
    editorHtmlForOrder(order) {
      this.setOrder(order);
      lineItemsListEl.innerHTML = '';
      vm.runInContext('renderLineItemsEditor();', context);
      return String(lineItemsListEl.innerHTML || '');
    },
    /** A fresh line item of the given type (createLineItemTemplate). */
    freshItem(type) {
      sandbox.__t = type;
      return vm.runInContext('createLineItemTemplate(globalThis.__t)', context);
    },
    raw: context,
  };
}
