import { sanitizeInboundHtml } from '../graph-html-sanitizer';

describe('sanitizeInboundHtml', () => {
  it('strips <script> tags and their content entirely', () => {
    const result = sanitizeInboundHtml('<p>Hello</p><script>alert(1)</script>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('Hello');
  });

  it('strips on* event-handler attributes while preserving the element and its text', () => {
    const result = sanitizeInboundHtml('<div onclick="steal()">Click me</div>');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('steal');
    expect(result).toContain('Click me');
  });

  it('strips javascript: URLs from href attributes', () => {
    const result = sanitizeInboundHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('strips <iframe> tags entirely', () => {
    const result = sanitizeInboundHtml('<p>Body</p><iframe src="https://evil.example.com"></iframe>');
    expect(result).not.toContain('iframe');
    expect(result).toContain('Body');
  });

  it('strips <object> and <embed> tags', () => {
    const result = sanitizeInboundHtml('<object data="evil.swf"></object><embed src="evil.swf">');
    expect(result).not.toContain('object');
    expect(result).not.toContain('embed');
  });

  it('rejects malicious links pointing at data: URLs', () => {
    const result = sanitizeInboundHtml('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>');
    expect(result).not.toContain('data:');
  });

  it('handles malformed/unclosed HTML without throwing', () => {
    expect(() => sanitizeInboundHtml('<p>Unclosed <b>bold text')).not.toThrow();
  });

  it('handles nested malicious markup', () => {
    const result = sanitizeInboundHtml('<div><p><script>alert(1)</script>legit text</p></div>');
    expect(result).not.toContain('script');
    expect(result).toContain('legit text');
  });

  it('handles encoded/obfuscated dangerous values without executing them', () => {
    const result = sanitizeInboundHtml('<a href="&#106;avascript:alert(1)">click</a>');
    expect(result.toLowerCase()).not.toContain('javascript:');
  });

  it('preserves safe formatting (bold/italic/links/lists)', () => {
    const result = sanitizeInboundHtml('<p><b>Bold</b> and <i>italic</i>. <a href="https://example.com">link</a></p><ul><li>item</li></ul>');
    expect(result).toContain('<b>Bold</b>');
    expect(result).toContain('<i>italic</i>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('<li>item</li>');
  });

  it('returns empty/falsy input unchanged', () => {
    expect(sanitizeInboundHtml('')).toBe('');
  });
});
