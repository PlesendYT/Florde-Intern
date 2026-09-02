// Domain: DYNAMIC TOOLS registry core (pure, no DOM / no electronAPI / no storage)
// Extracted verbatim from renderer/script.js (DYNAMIC TOOLS section, classic JS).

export function getBaseTools() {
  return [
    { type: 'function', function: { name: 'read_file', description: 'Read a file from the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file in the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, content: { type: 'string', description: 'Full file content' }, description: { type: 'string', description: 'Brief 2-5 word summary of what this file is (e.g. "Creates React component")' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'delete_file', description: 'Delete a file from the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, description: { type: 'string', description: 'Brief 2-5 word summary of why' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_files', description: 'List all files in the project', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'search_files', description: 'Search for text across all project files', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Text to search for' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'exec_command', description: 'Execute a shell command in the project sandbox directory', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' }, description: { type: 'string', description: 'Brief 2-5 word summary of what this command does' } }, required: ['command'] } } },
    { type: 'function', function: { name: 'ask_question', description: 'Ask the user a question when you need clarification, confirmation, or a decision. Always provide clear choices. One choice must always be a custom free-text option.', parameters: { type: 'object', properties: { question: { type: 'string', description: 'The question to ask the user' }, choices: { type: 'array', items: { type: 'string' }, description: 'List of answer choices. Always include a free-text option like "Custom answer..."' } }, required: ['question', 'choices'] } } },
    { type: 'function', function: { name: 'rename_file', description: 'Rename a file and optionally update all imports/references across the project', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Current file path relative to project root' }, new_path: { type: 'string', description: 'New file path relative to project root' }, update_imports: { type: 'boolean', description: 'Whether to auto-update imports referencing the old path in all project files' } }, required: ['path', 'new_path'] } } },
    { type: 'function', function: { name: 'edit_file', description: 'Make a surgical text replacement in an existing file. Use this for small changes instead of rewriting the whole file with write_file.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path relative to project root' }, oldString: { type: 'string', description: 'Exact text to find and replace. Must match the file content exactly.' }, newString: { type: 'string', description: 'Replacement text' }, replaceAll: { type: 'boolean', description: 'If true, replace all occurrences of oldString. If false (default), only replace the first occurrence.' }, description: { type: 'string', description: 'Brief 2-5 word summary of the edit' } }, required: ['path', 'oldString', 'newString'] } } },
    { type: 'function', function: { name: 'take_screenshot', description: 'Capture a screenshot of your screen or a specific window. Useful for visual debugging of web apps. The screenshot becomes visible to vision-capable AI models.', parameters: { type: 'object', properties: { description: { type: 'string', description: 'What to capture (optional hint for the user)' } }, required: [] } } },
    { type: 'function', function: { name: 'schedule_task', description: 'Schedule a background task plan that the AI will continue in the next conversation turn. Use when a task is too large to complete in one round and requires multiple conversation turns.', parameters: { type: 'object', properties: { plan: { type: 'string', description: 'Overall plan for the task' }, steps: { type: 'array', items: { type: 'string' }, description: 'Step-by-step breakdown of remaining work' }, context: { type: 'string', description: 'Key context the AI needs to remember when resuming' } }, required: ['plan', 'steps'] } } },
    { type: 'function', function: { name: 'browser_open', description: 'Open a URL in the embedded browser panel. The browser panel will appear automatically.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'The URL to open' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'browser_click', description: 'Click an element on the current browser page by CSS selector.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector for the element' } }, required: ['selector'] } } },
    { type: 'function', function: { name: 'browser_type', description: 'Type text into an input field on the current browser page.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector for the input element' }, text: { type: 'string', description: 'Text to type' } }, required: ['selector', 'text'] } } },
    { type: 'function', function: { name: 'browser_screenshot', description: 'Take a screenshot of the current browser page and attach it to the chat as an image.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser_back', description: 'Go back to the previous page in browser history.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser_forward', description: 'Go forward to the next page in browser history.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser_reload', description: 'Reload the current browser page.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'browser_evaluate', description: 'Execute custom JavaScript code in the browser page context and return the result.', parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript code to execute' } }, required: ['code'] } } },
    { type: 'function', function: { name: 'spawn_subagent', description: 'Delegate a subtask to a subagent that works autonomously. The subagent has its own AI conversation and tool access, but cannot spawn further subagents. Returns the subagent ID for status tracking.', parameters: { type: 'object', properties: { goal: { type: 'string', description: 'Clear, detailed description of what the subagent should accomplish' }, context: { type: 'string', description: 'Context from the parent task that the subagent needs to know (files, state, decisions, etc.)' } }, required: ['goal', 'context'] } } },
  ];
}

// Shell risk assessment (pure regex risk table)
export function assessShellRisk(command) {
    const patterns = {
    critical: [
      /\brm\s+-rf\s+\/\s*$/mi, /\bformat\b/i, /\bdd\s+if=\/dev\/zero/i,
      /\bmkfs\b/i, /grub-install|fdisk|mbr/i, /:\(\)\s*\{|fork\s+bomb/i,
      /chmod\s+777\s+\//i, /mv\s+\/\s+\/dev\/null/i,
    ],
    high: [
      /\bsudo\b/i, /\brm\s+-rf\b/i, /\bcurl\b.*\|\s*(?:bash|sh)\b/i,
      /\bwget\b.*\|\s*(?:bash|sh)\b/i, /\bchmod\s+-R\s+777\b/i,
      /\bnmap\b/i, /\bapt\s+(?:install|remove|purge)\b/i,
      /\bpip\s+install\b/i, /\bnpm\s+(?:install|publish|delete)\s+-g\b/i,
    ],
    medium: [
      /\bnpm\s+(?:install|publish)\b/i, /\bgit\s+push\b/i,
      /\bpip\s+install\b/i, /\bchmod\b/i, /\bkill\b/i,
      /\bsystemctl\b/i, /\bservice\b/i,
    ],
    low: [
      /\bmkdir\b/i, /\btouch\b/i, /\becho\s+>/, /\bmv\b/i, /\bcp\b/i,
      /\bcd\b/i, /\bnano\b/i, /\bvi\b/i, /\bcode\b/i,
    ],
    safe: [
      /\bls\b/i, /\bpwd\b/i, /\bcat\b/i, /\bhead\b/i, /\btail\b/i,
      /\bgrep\b/i, /\bfind\b/i, /\bwhich\b/i, /\bwhoami\b/i, /\bdate\b/i,
      /\bwc\b/i, /\bsort\b/i, /\buniq\b/i, /\bless\b/i, /\bmore\b/i,
      /\bps\b/i, /\bdf\b/i, /\bdu\b/i,
    ],
  };
  for (const [level, regexps] of Object.entries(patterns)) {
    for (const re of regexps) {
      if (re.test(command)) return level;
    }
  }
  return 'safe';
}

// 429 backoff
export function getBackoffDelay(step) {
  return Math.min(1000 * Math.pow(2, step), 60000);
}

const toolsRegistry = { getBaseTools, assessShellRisk, getBackoffDelay };

export default toolsRegistry;

if (typeof window !== 'undefined') {
  window.__toolsRegistry = toolsRegistry;
}
