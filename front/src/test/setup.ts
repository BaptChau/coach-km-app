// Vitest global setup (jsdom). Vuetify relies on a few browser APIs jsdom lacks.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom only logs "Not implemented" (the router's scrollBehavior calls it).
window.scrollTo = () => {}

// Vuetify overlays (snackbar, menu) position themselves against the visual viewport.
if (!window.visualViewport) {
  const viewport = Object.assign(new EventTarget(), {
    width: 1024,
    height: 768,
    offsetLeft: 0,
    offsetTop: 0,
    pageLeft: 0,
    pageTop: 0,
    scale: 1,
    onresize: null,
    onscroll: null,
    onscrollend: null,
  })
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
}
