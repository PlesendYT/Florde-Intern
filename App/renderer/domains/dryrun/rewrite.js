import { resolveInRoot } from './paths.js';
import { classifyCommand as defaultClassify } from './classify.js';

function rewriteForSession(sessionRoot, toolName, args, classify) {
  const classifyFn = classify || defaultClassify;
  const FILE_TOOLS = ['read_file', 'write_file', 'edit_file', 'delete_file', 'list_files', 'search_files', 'rename_file'];
  if (toolName === 'exec_command') {
    const command = args && args.command;
    const verdict = classifyFn(typeof command === 'string' ? command : '');
    if (verdict.verdict === 'blocked') return { denied: true, reason: verdict.reason };
    if (verdict.verdict === 'needs-approval') return { denied: true, reason: 'needs approval: ' + verdict.reason, approval: true };
    return { args, cwd: sessionRoot };
  }
  if (FILE_TOOLS.includes(toolName)) {
    const out = { ...(args || {}) };
    if (out.path !== undefined) {
      const resolved = resolveInRoot(sessionRoot, out.path);
      if (resolved === null) return { denied: true, reason: 'path escapes session root' };
      out.path = resolved;
    }
    return { args: out };
  }
  return { args };
}

export { rewriteForSession };
export default { rewriteForSession };
if (typeof window !== 'undefined') window.__dryrunRewrite = { rewriteForSession };
