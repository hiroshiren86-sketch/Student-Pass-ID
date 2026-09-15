/**
 * R69 — Arnés de DOM local (jsdom) para pruebas de UI SIN navegador descargable.
 *
 * Por qué existe: el sandbox de ejecución puede no tener egreso a cdn.playwright.dev
 * (los binarios de Chromium no se descargan), pero el registro npm sí es alcanzable.
 * jsdom es JavaScript puro → permite montar los componentes REALES de la app
 * (React 19 + react-dom/client) y afirmar sobre el DOM que ve el usuario, con las
 * mismas rutas de código que producción (AttendanceStorageService, utilidades, etc.).
 *
 * Uso: `import './harness/domEnv';` ANTES de importar cualquier componente/servicio.
 * No toca la red: Firebase/Worker sólo se invocarían si el test los llama.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://student-pass-id.pages.dev/',
  pretendToBeVisual: true,
});

const win = dom.window as any;

// ── Canvas: jsdom no implementa 2D/webgl. La app lo usa para códigos de barras,
// compresión de fotos y QR. Un Proxy no-op + toDataURL determinista evita que esas
// ramas revienten el montaje (no son objeto de estas pruebas).
const noopCtx = new Proxy({} as any, {
  get: (_t, prop) => {
    if (prop === 'canvas') return { width: 300, height: 100 };
    if (prop === 'measureText') return () => ({ width: 10 });
    if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (prop === 'createImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return () => undefined;
  },
  set: () => true,
});
win.HTMLCanvasElement.prototype.getContext = () => noopCtx;
win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';

// ── APIs de navegador que la app toca y jsdom no trae ──
win.matchMedia = win.matchMedia || ((q: string) => ({
  matches: false, media: q, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
}));
win.ResizeObserver = win.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
win.IntersectionObserver = win.IntersectionObserver || class {
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
};
win.scrollTo = win.scrollTo || (() => {});
if (!win.navigator.mediaDevices) {
  Object.defineProperty(win.navigator, 'mediaDevices', { value: { getUserMedia: () => Promise.reject(new Error('sin cámara en jsdom')), enumerateDevices: () => Promise.resolve([]) }, configurable: true });
}
// WebCrypto real (Node 20+): crypto.ts firma HMAC con subtle.
if (!win.crypto?.subtle && (globalThis as any).crypto?.subtle) {
  Object.defineProperty(win, 'crypto', { value: (globalThis as any).crypto, configurable: true });
}
win.Notification = win.Notification || class { static permission = 'denied'; static requestPermission() { return Promise.resolve('denied'); } };

// ── Publicar globales (los módulos de la app leen window/document/localStorage) ──
// Node 22 expone `navigator` como un getter de sólo lectura (y otros globales pueden
// venir congelados según el runtime: bun los permite asignar, node no). Por eso cada
// global se publica con defineProperty configurable y se tolera el fallo: si el
// runtime ya trae una implementación suficiente, la prueba sigue igual.
const g = globalThis as any;
function defineGlobal(name: string, value: unknown): void {
  try {
    Object.defineProperty(g, name, { value, writable: true, configurable: true, enumerable: true });
  } catch {
    try { g[name] = value; } catch { /* runtime sin permiso: se usa el global nativo */ }
  }
}
defineGlobal('window', win);
defineGlobal('document', win.document);
defineGlobal('navigator', win.navigator);
defineGlobal('localStorage', win.localStorage);
defineGlobal('sessionStorage', win.sessionStorage);
defineGlobal('HTMLElement', win.HTMLElement);
defineGlobal('Element', win.Element);
defineGlobal('Node', win.Node);
defineGlobal('Event', win.Event);
defineGlobal('CustomEvent', win.CustomEvent);
defineGlobal('MouseEvent', win.MouseEvent);
defineGlobal('KeyboardEvent', win.KeyboardEvent);
defineGlobal('getComputedStyle', win.getComputedStyle);
defineGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
defineGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);

export const jsdomWindow = win;
export const jsdomDocument = win.document;

/** Limpia el almacenamiento y los caches de lectura del servicio (contexto limpio). */
export function resetBrowserStorage(): void {
  try { win.localStorage.clear(); win.sessionStorage.clear(); } catch {}
}
