/**
 * Deterministic Date rehydration for values that have round-tripped through
 * JSON/JSONB persistence (where `Date` becomes an ISO-8601 string, or the
 * pg driver may already parse a `TIMESTAMPTZ` column into a native `Date`).
 *
 * Deliberately explicit and field-scoped (called on known date fields by
 * name in each repository's `fromSnapshot`) rather than a generic recursive
 * ISO-string scanner, to avoid ever mis-converting a non-date string that
 * happens to look like a timestamp.
 */
export function toDate(value: string | Date | undefined | null): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Cannot rehydrate invalid date value: ${JSON.stringify(value)}`);
  }
  return parsed;
}

/**
 * Same as toDate, but throws if the value is missing — for required date
 * fields where `undefined` would violate the aggregate's invariants.
 */
export function toRequiredDate(value: string | Date | undefined | null): Date {
  const result = toDate(value);
  if (!result) {
    throw new Error('Missing required date value during rehydration');
  }
  return result;
}
