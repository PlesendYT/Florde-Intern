// App/renderer/__tests__/symbols.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { extractSymbols } = require('../symbols');

describe('extractSymbols javascript', () => {
  const code = [
    'function add(a, b) { return a + b; }',
    'const PI = 3.14;',
    'class Greeter {',
    '  greet() {}',
    '}',
    'export default function main() {}',
    'const obj = { method() {} };',
    '// function notAReal() {}',
    'const s = "function inString() {}";'
  ].join('\n');

  it('extracts named functions', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(syms.some(s => s.name === 'add' && s.kind === 'function' && s.line === 1));
  });
  it('extracts const variables', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(syms.some(s => s.name === 'PI' && s.kind === 'variable'));
  });
  it('extracts classes', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(syms.some(s => s.name === 'Greeter' && s.kind === 'class'));
  });
  it('extracts class methods', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(syms.some(s => s.name === 'greet' && s.kind === 'method'));
  });
  it('ignores commented functions', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(!syms.some(s => s.name === 'notAReal'));
  });
  it('ignores strings containing function keywords', () => {
    const syms = extractSymbols(code, 'javascript');
    assert.ok(!syms.some(s => s.name === 'functionInString'));
  });
});

describe('extractSymbols python', () => {
  const code = [
    'import os',
    'def main():',
    '    pass',
    'class User:',
    '    def __init__(self):',
    '        pass',
    '# def ghost(): pass'
  ].join('\n');

  it('extracts def and class', () => {
    const syms = extractSymbols(code, 'python');
    assert.ok(syms.some(s => s.name === 'main' && s.kind === 'function' && s.line === 2));
    assert.ok(syms.some(s => s.name === 'User' && s.kind === 'class' && s.line === 4));
  });
  it('ignores comments', () => {
    const syms = extractSymbols(code, 'python');
    assert.ok(!syms.some(s => s.name === 'ghost'));
  });
});

describe('extractSymbols html/css', () => {
  it('extracts ids and classes from html', () => {
    const syms = extractSymbols('<div id="login-btn" class="btn primary">x</div>', 'html');
    assert.ok(syms.some(s => s.name === 'login-btn' && s.kind === 'id'));
    assert.ok(syms.some(s => s.name === 'btn' && s.kind === 'class'));
  });
  it('extracts css selectors', () => {
    const syms = extractSymbols('.login-btn { color: red; }\n#main { }', 'css');
    assert.ok(syms.some(s => s.name === '.login-btn' && s.kind === 'class'));
    assert.ok(syms.some(s => s.name === '#main' && s.kind === 'id'));
  });
});

describe('extractSymbols unknown', () => {
  it('extracts generic identifiers as fallback', () => {
    const syms = extractSymbols('hello world\nSomeIdentifier = 1', 'unknown');
    assert.ok(Array.isArray(syms));
    assert.ok(syms.some(s => s.name === 'SomeIdentifier'));
  });
});
