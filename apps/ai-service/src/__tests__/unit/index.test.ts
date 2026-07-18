import { createAiServiceApp } from '../../app';
import {
  DEFAULT_CLAUDE_MODEL,
  extractJsonObject,
  extractTextContent,
} from '../../infrastructure/claude-client';

describe('AI service module exports', () => {
  it('exposes createAiServiceApp factory', () => {
    expect(typeof createAiServiceApp).toBe('function');
  });

  it('parses bare JSON objects', () => {
    expect(
      extractJsonObject('{"patchedCode":"a","confidenceScore":1}')
    ).toEqual({
      patchedCode: 'a',
      confidenceScore: 1,
    });
  });

  it('uses a Messages-era default model id', () => {
    expect(DEFAULT_CLAUDE_MODEL).toContain('claude');
    expect(DEFAULT_CLAUDE_MODEL).not.toBe('claude-2.1');
  });

  it('extracts text blocks from Messages API content', () => {
    expect(
      extractTextContent([
        { type: 'text', text: 'hello' },
        { type: 'tool_use' },
        { type: 'text', text: 'world' },
      ])
    ).toBe('hello\nworld');
  });
});
