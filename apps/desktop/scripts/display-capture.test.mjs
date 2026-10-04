import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });

let sources = [];
let menuTemplate;
let popupCallback;
let sourceCalls = 0;
globalThis.__displayCaptureTestElectron = {
  desktopCapturer: {
    getSources: async () => {
      sourceCalls++;
      return sources;
    }
  },
  Menu: {
    buildFromTemplate: (template) => {
      menuTemplate = template;
      return {
        popup: ({ callback }) => { popupCallback = callback; },
        closePopup: () => {}
      };
    }
  }
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { url: 'mock:electron', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'mock:electron') {
      return {
        format: 'module', shortCircuit: true,
        source: 'export const desktopCapturer = globalThis.__displayCaptureTestElectron.desktopCapturer; export const Menu = globalThis.__displayCaptureTestElectron.Menu;'
      };
    }
    return nextLoad(url, context);
  }
});
const { installDisplayCapture } = await import('../dist/display-capture.js');

function setup() {
  sources = [
    { id: 'screen:1:0', name: 'Screen 1' },
    { id: 'window:2:0', name: 'Private window' }
  ];
  menuTemplate = undefined;
  popupCallback = undefined;
  sourceCalls = 0;
  const listeners = new Map();
  const frame = {
    isDestroyed: () => false,
    origin: 'https://cubic.goma.ink',
    url: 'https://cubic.goma.ink/app'
  };
  frame.top = frame;
  const contents = {
    isDestroyed: () => false,
    mainFrame: frame,
    session: { setDisplayMediaRequestHandler: (handler) => { contents.handler = handler; } },
    on: (event, listener) => { listeners.set(event, listener); }
  };
  const window = {
    webContents: contents,
    isDestroyed: () => false,
    on: (event, listener) => { listeners.set(event, listener); }
  };
  installDisplayCapture(window);
  const request = {
    frame,
    securityOrigin: 'https://cubic.goma.ink/',
    userGesture: true,
    videoRequested: true,
    audioRequested: true
  };
  const results = [];
  const invoke = (overrides = {}) => contents.handler({ ...request, ...overrides }, (result) => results.push(result));
  return { frame, contents, request, results, invoke };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('display handler denies untrusted or ineligible requests before source enumeration', () => {
  for (const change of [
    ({ request }) => ({ securityOrigin: 'https://evil.example' }),
    ({ request }) => ({ securityOrigin: 'http://cubic.goma.ink' }),
    ({ request }) => ({ securityOrigin: 'https://cubic.goma.ink:444' }),
    ({ frame }) => ({ frame: { ...frame, top: frame } }),
    () => ({ userGesture: false }),
    () => ({ videoRequested: false })
  ]) {
    const state = setup();
    state.invoke(change(state));
    assert.deepEqual(state.results, [null]);
    assert.equal(sourceCalls, 0);
  }
});

test('display handler denies concurrent requests and cancel without selecting a source', async () => {
  const state = setup();
  state.invoke();
  state.invoke();
  assert.deepEqual(state.results, [null]);
  await flush();
  assert.equal(sourceCalls, 1);
  assert.ok(popupCallback);
  popupCallback();
  assert.deepEqual(state.results, [null, null]);
});

test('display handler returns only the explicitly selected source and no system audio', async () => {
  const state = setup();
  state.invoke();
  await flush();
  assert.deepEqual(state.results, []);
  const windows = menuTemplate.find((item) => item.label === 'Windows');
  windows.submenu[0].click();
  assert.deepEqual(state.results, [{ video: { id: 'window:2:0', name: 'Private window' } }]);
  popupCallback();
  assert.equal(state.results.length, 1);
});

test.after(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  delete globalThis.__displayCaptureTestElectron;
});
