import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractReasoningContent, REASONING_BLOCK_REGEX } from '../domains/project/history.js';

describe('extractReasoningContent', () => {
  it('extracts reasoning from a message with >>| ... ||< block', () => {
    const messages = [
      { role: 'assistant', content: 'foo >>|\n  <thinking>\n  ||< bar' }
    ];
    const result = extractReasoningContent(messages);
    assert.equal(result, messages);
    assert.equal(messages[0].reasoning_content, '<thinking>');
  });

  it('does NOT touch a message with existing reasoning_content', () => {
    const messages = [
      { role: 'assistant', reasoning_content: 'existing', content: 'foo >>| replaced ||< bar' }
    ];
    extractReasoningContent(messages);
    assert.equal(messages[0].reasoning_content, 'existing');
  });

  it('does NOT touch a non-assistant message even if content has a block', () => {
    const messages = [
      { role: 'user', content: 'foo >>| ignored ||< bar' }
    ];
    extractReasoningContent(messages);
    assert.equal(messages[0].reasoning_content, undefined);
  });

  it('returns null/undefined/non-array as-is without throwing', () => {
    assert.equal(extractReasoningContent(null), null);
    assert.equal(extractReasoningContent(undefined), undefined);
    assert.equal(extractReasoningContent('string'), 'string');
    assert.equal(extractReasoningContent(42), 42);
  });

  it('REASONING_BLOCK_REGEX captures content with whitespace/newline collapse', () => {
    const m = '>>|\n  <p>a</p>\n  ||<'.match(REASONING_BLOCK_REGEX);
    assert.ok(m);
    assert.equal(m[1], '<p>a</p>');
  });

  it('is idempotent: second pass does nothing', () => {
    const messages = [
      { role: 'assistant', content: 'foo >>| reasoning ||< bar' }
    ];
    extractReasoningContent(messages);
    const first = messages[0].reasoning_content;
    extractReasoningContent(messages);
    assert.equal(messages[0].reasoning_content, first);
  });

  it('empty string content is left untouched', () => {
    const messages = [
      { role: 'assistant', content: '' }
    ];
    extractReasoningContent(messages);
    assert.equal(messages[0].reasoning_content, undefined);
  });
});
