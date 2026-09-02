export function createPermissionRules({ mcpTools = [] } = {}) {
  const _rules = {};

  function resolveGroup(toolName) {
    if (toolName.startsWith('browser_')) return 'browser';
    if (toolName.startsWith('git_')) return 'git';
    if (toolName === 'exec_command') return 'terminal';
    if (mcpTools.includes(toolName)) return 'mcp';
    return null;
  }

  function get(toolName) {
    if (_rules[toolName] !== undefined) return _rules[toolName];
    const group = resolveGroup(toolName);
    if (group && _rules[group] !== undefined) return _rules[group];
    return 'allow';
  }

  function set(toolName, level) {
    _rules[toolName] = level;
  }

  function isExcepted(toolName, args, autoExceptions) {
    const ex = autoExceptions || {};
    if (ex.shell && toolName === 'exec_command') return true;
    if (ex.outside && args && (args.path || '').startsWith('..')) return true;
    if (ex.git && toolName === 'exec_command' && /git\b/i.test(args?.command || '')) return true;
    if (ex.terminal && toolName === 'exec_command') return true;
    return false;
  }

  function seed(toolNames) {
    toolNames.forEach(t => { if (_rules[t] === undefined) _rules[t] = 'ask'; });
  }

  return {
    get,
    resolveGroup,
    set,
    isExcepted,
    seed,
    get rules() { return { ..._rules }; },
    get size() { return Object.keys(_rules).length; },
  };
}

export default { createPermissionRules };

if (typeof window !== 'undefined') {
  window.__permissionRules = { createPermissionRules };
}
