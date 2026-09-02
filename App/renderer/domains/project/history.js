/* eslint-disable no-console */
export const REASONING_BLOCK_REGEX = />>\|\s*([\s\S]*?)\s*\|\|</;

export function extractReasoningContent(messages) {
  if (!Array.isArray(messages)) return messages;
  for (const msg of messages) {
    if (msg && msg.role === 'assistant' && !msg.reasoning_content && msg.content) {
      const m = msg.content.match(REASONING_BLOCK_REGEX);
      if (m) msg.reasoning_content = m[1].trim();
    }
  }
  return messages;
}

if (typeof window !== 'undefined') {
  window.__projectHistory = { extractReasoningContent };
}
export default { extractReasoningContent };
