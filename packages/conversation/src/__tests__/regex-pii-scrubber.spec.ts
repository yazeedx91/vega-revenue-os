import { RegexPIIScrubber } from '../infrastructure/regex-pii-scrubber';

describe('RegexPIIScrubber', () => {
  const scrubber = new RegexPIIScrubber();

  it('redacts email addresses', () => {
    const result = scrubber.scrub('Contact me at jane.doe@example.com for details.');
    expect(result).not.toContain('jane.doe@example.com');
    expect(result).toContain('[REDACTED_EMAIL]');
  });

  it('redacts phone numbers', () => {
    const result = scrubber.scrub('Call me at 555-123-4567 tomorrow.');
    expect(result).not.toContain('555-123-4567');
    expect(result).toContain('[REDACTED_PHONE]');
  });

  it('redacts SSN-shaped identifiers', () => {
    const result = scrubber.scrub('My SSN is 123-45-6789.');
    expect(result).not.toContain('123-45-6789');
    expect(result).toContain('[REDACTED_SSN]');
  });

  it('redacts payment-card-shaped identifiers', () => {
    const result = scrubber.scrub('Card number: 4111 1111 1111 1111');
    expect(result).not.toContain('4111 1111 1111 1111');
    expect(result).toContain('[REDACTED_CARD]');
  });

  it('does not redact short numbers that are not phone/card/SSN-shaped', () => {
    const result = scrubber.scrub('We spoke on step 12 of the sequence.');
    expect(result).toContain('step 12');
  });

  it('does not redact plain words containing no PII', () => {
    const result = scrubber.scrub('Sounds great, looking forward to it.');
    expect(result).toBe('Sounds great, looking forward to it.');
  });

  it('handles multiline content, redacting each occurrence', () => {
    const input = 'Line one: jane@example.com\nLine two: call 555-987-6543';
    const result = scrubber.scrub(input);
    expect(result).not.toContain('jane@example.com');
    expect(result).not.toContain('555-987-6543');
    expect(result.split('\n')).toHaveLength(2);
  });

  it('is idempotent — scrubbing already-scrubbed content changes nothing further', () => {
    const once = scrubber.scrub('Email me at jane@example.com or call 555-123-4567');
    const twice = scrubber.scrub(once);
    expect(twice).toBe(once);
  });

  it('handles empty content without throwing', () => {
    expect(scrubber.scrub('')).toBe('');
  });

  it('redacts multiple distinct PII items in the same string', () => {
    const result = scrubber.scrub('Email jane@example.com or call 555-123-4567, SSN 123-45-6789');
    expect(result).toContain('[REDACTED_EMAIL]');
    expect(result).toContain('[REDACTED_PHONE]');
    expect(result).toContain('[REDACTED_SSN]');
  });
});
