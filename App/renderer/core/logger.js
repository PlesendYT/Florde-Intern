import eventBus from './events.js';

function emitLog(message, type) {
  eventBus.emit('state:log', { message, type });
}

export const logger = {
  logToTerminal(message, type = 'info') { emitLog(message, type); },
  info: (message) => emitLog(message, 'info'),
  warn: (message) => emitLog(message, 'warn'),
  error: (message) => emitLog(message, 'error'),
  debug: (message) => emitLog(message, 'debug'),
};

export default logger;

if (typeof window !== 'undefined') {
  window.__coreLogger = logger;
}
