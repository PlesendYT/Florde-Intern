// App/renderer/core/state.js — zentraler App-State (Renderer-intern)
import { createEventBus } from './events.js';

export function createState(initial = {}) {
  const data = { ...initial };
  const bus = createEventBus();
  return {
    get(key) { return key === undefined ? data : data[key]; },
    set(key, value) { data[key] = value; bus.emit('state:' + key, value); bus.emit('state:change', { key, value }); },
    subscribe(key, fn) { return bus.on('state:' + key, fn); },
  };
}

export const appState = createState();
export default appState;

if (typeof window !== 'undefined') {
  window.__coreState = appState;
}