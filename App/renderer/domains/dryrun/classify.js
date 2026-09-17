const BLOCKED_RE = /(^|[;&|]\s*)(sudo|doas|su\s|rm\s+-rf\s+\/|rm\s+-rf\s+~|mkfs|dd\s+.*of=|shutdown|reboot|halt|:\(\)\s*\{)/i;
const GLOBAL_INSTALL_RE = /\bpip\s+install\b(?!.*--target\b)(?!.*--prefix\b)|\bnpm\s+(install|i)\s+-g\b|\bgem\s+install\b|\bcargo\s+install\b|\bapt(-get)?\s+install\b|\bbrew\s+install\b/i;
const PIPE_SHELL_RE = /\|\s*(sh|bash|zsh)\b/;
const SAFE_RUNNER_RE = /^(python|python3|node|npm|npx|pytest|pip|ls|cat|echo|pwd|git|make|cmake|go|cargo|dotnet)\b/i;

function classifyCommand(command) {
  if (typeof command !== 'string' || command.trim() === '') {
    return { verdict: 'blocked', reason: 'empty command' };
  }
  const cmd = command.trim();
  if (BLOCKED_RE.test(cmd)) return { verdict: 'blocked', reason: 'destructive or privileged command' };
  if (PIPE_SHELL_RE.test(cmd)) return { verdict: 'blocked', reason: 'piped shell execution' };
  if (GLOBAL_INSTALL_RE.test(cmd)) return { verdict: 'blocked', reason: 'global package install (not safely simulatable)' };
  if (SAFE_RUNNER_RE.test(cmd)) return { verdict: 'safe', reason: 'allowlisted runner' };
  return { verdict: 'needs-approval', reason: 'unknown command' };
}

export { classifyCommand };
export default { classifyCommand };
if (typeof window !== 'undefined') window.__dryrunClassify = { classifyCommand };
