import sanitizeHtml from 'sanitize-html';

/**
 * Strict allowlist HTML sanitizer for inbound (untrusted) email content.
 * Blocks `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, all
 * `on*` event-handler attributes, and `javascript:`/unjustified `data:`
 * URLs. This is a heuristic allowlist (via the well-maintained
 * `sanitize-html` library), not a formal proof of safety — do not treat its
 * output as safe for contexts requiring stricter guarantees than
 * "reasonable rendering of prospect-authored HTML email."
 */
const ALLOWED_TAGS = [
  'a', 'b', 'i', 'u', 'strong', 'em', 'p', 'br', 'ul', 'ol', 'li',
  'blockquote', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code',
];

// Deliberately no `style` attribute allowance — inline CSS is unnecessary
// residual attack surface for untrusted inbound email and is not needed for
// intent classification or plain rendering.
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title'],
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

export function sanitizeInboundHtml(rawHtml: string): string {
  if (!rawHtml) return rawHtml;
  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    // `allowedAttributes` omitting any `on*` entry means sanitize-html
    // strips those attributes from the output while preserving the tag and
    // its legitimate content/children.
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesByTag: {},
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    // Strips <script>/<style>/<iframe>/<object>/<embed> content entirely
    // (not just the tags) so injected payloads can't leak through as text.
    nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'noscript'],
  });
}
