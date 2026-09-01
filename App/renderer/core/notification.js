// App/renderer/core/notification.js — Benutzer-Benachrichtigungen (rein, kein DOM)
import eventBus from './events.js';

function emitNotify(type, text) {
  eventBus.emit('state:notify', { type, text });
}

export const notify = {
  success: (text) => emitNotify('success', text),
  error: (text) => emitNotify('error', text),
  info: (text) => emitNotify('info', text),
  warn: (text) => emitNotify('warn', text),
};

export default notify;

if (typeof window !== 'undefined') {
  window.__coreNotify = notify;
}
