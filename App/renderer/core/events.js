export function createEventBus() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => this.off(event, fn);
    },
    off(event, fn) {
      const set = listeners.get(event);
      if (set) set.delete(fn);
    },
    emit(event, ...args) {
      const set = listeners.get(event);
      if (set) for (const fn of [...set]) { try { fn(...args); } catch (e) { console.error(e); } }
    },
    clear() { listeners.clear(); },
  };
}

export const eventBus = createEventBus();
export default eventBus;

if (typeof window !== 'undefined') {
  window.__coreEvents = eventBus;
}
