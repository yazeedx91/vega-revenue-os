import type { IPIIScrubber } from '../ports/pii-scrubber.interface';

/**
 * Heuristic, regex-based PII scrubber. This is **not** a comprehensive DLP
 * system — it redacts a small, deliberately-scoped set of high-confidence,
 * clearly-shaped identifiers. It exists so that real inbound email content
 * (untrusted external input) does not flow into logs, telemetry, AI
 * prompts, or analytics unscrubbed, replacing `NoOpPIIScrubber` as the
 * production binding for that boundary. `NoOpPIIScrubber` remains available
 * as a deterministic test double where scrubbing would otherwise obscure
 * test assertions.
 *
 * Redaction is idempotent (already-redacted `[REDACTED_*]` placeholders
 * contain no digits/`@` and match none of these patterns on a second pass).
 * Patterns are applied in a fixed order (email, SSN, card, phone) against
 * the progressively-scrubbed string so a card-shaped digit run is preferred
 * over a looser phone-shaped match on the same span.
 */
export class RegexPIIScrubber implements IPIIScrubber {
  private static readonly EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  // Loosely matches common phone formats: optional +country code, separators
  // of space/dot/dash/parentheses, 7-15 total digits. Intentionally broad
  // (heuristic) rather than locale-exact.
  private static readonly PHONE = /(?<!\d)(\+?\d{1,3}[\s.-]?)?(\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?!\d)/g;

  // US SSN-shaped: NNN-NN-NNNN.
  private static readonly SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

  // Payment-card-like: 13-19 digits, optionally grouped by spaces/dashes in
  // blocks of 4. Deliberately conservative (grouped or contiguous only) to
  // reduce false positives against unrelated long numbers.
  private static readonly CARD = /\b(?:\d[ -]?){13,19}\b/g;

  scrub(content: string): string {
    if (!content) return content;

    let scrubbed = content;
    scrubbed = scrubbed.replace(RegexPIIScrubber.EMAIL, '[REDACTED_EMAIL]');
    scrubbed = scrubbed.replace(RegexPIIScrubber.SSN, '[REDACTED_SSN]');
    scrubbed = scrubbed.replace(RegexPIIScrubber.CARD, (match) => (RegexPIIScrubber.digitCount(match) >= 13 ? '[REDACTED_CARD]' : match));
    scrubbed = scrubbed.replace(RegexPIIScrubber.PHONE, (match) => (RegexPIIScrubber.digitCount(match) >= 7 ? '[REDACTED_PHONE]' : match));
    return scrubbed;
  }

  private static digitCount(value: string): number {
    return (value.match(/\d/g) ?? []).length;
  }
}
