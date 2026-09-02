# Slice 1 – JWT signing-key rotation runbook

## Scope
This runbook covers the operational rotation of the symmetric HMAC signing keys used by `@projectx/identity/src/infrastructure/hmac-token-issuer.ts`.

## Key design points
- Secrets are **never** committed to source or ordinary `.env` files.
- Key bytes are retrieved from `ISecretsProvider` (`AzureKeyVaultSecretsProvider` in production, `EnvironmentSecretsProvider` in local dev).
- The issuer keeps an **active** key and an optional **previous** key with a versioned `kid` (key id) header.
- A 60-second in-memory refresh window allows graceful rotation without dropping in-flight tokens.
- The issuer **fails closed**: startup fails if the active key is missing or < 32 bytes, and a stale ring refuses to issue new tokens.

## Required environment variables
- `JWT_SIGNING_KEY_ACTIVE_REFERENCE` – reference to the active key in the configured secrets provider.
- `JWT_SIGNING_KEY_ACTIVE_KID` – public key identifier written into every issued JWT header.
- `JWT_SIGNING_KEY_PREVIOUS_REFERENCE` – reference to the previous key (only during a rotation window).
- `JWT_SIGNING_KEY_PREVIOUS_KID` – previous `kid`.
- `JWT_SIGNING_KEY_PREVIOUS_VALID_UNTIL` – ISO 8601 timestamp after which the previous key is no longer accepted.
- `IDENTITY_TOKEN_ISSUER` and `IDENTITY_TOKEN_AUDIENCE` – token `iss` / `aud` claims.

## Secret material format
- 256-bit (32-byte) or stronger HMAC key.
- Stored as a base64url-encoded string (44 characters).
- For local dev the `EnvironmentSecretsProvider` reads the value from the env var named by the reference (e.g., `JWT_SIGNING_KEY_ACTIVE_REFERENCE=JWT_SIGNING_KEY_ACTIVE` and `JWT_SIGNING_KEY_ACTIVE=<base64url>`).

## Rotation procedure
1. **Generate** a new 32-byte key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. **Upload** the new key to the production secret store under a new reference (e.g., `jwt-signing-key-2024-01`) with a new `kid` (e.g., `jwt-2024-01`).
3. **Promote the current active to previous**:
   - Set `JWT_SIGNING_KEY_PREVIOUS_REFERENCE` to the old active reference.
   - Set `JWT_SIGNING_KEY_PREVIOUS_KID` to the old active `kid`.
   - Set `JWT_SIGNING_KEY_PREVIOUS_VALID_UNTIL` to a short future time (recommended 5–15 minutes).
   - Keep `JWT_SIGNING_KEY_ACTIVE_*` unchanged.
   - Deploy this configuration. Old tokens continue to verify as "previous" while new tokens are still issued with the old active.
4. **Switch active**:
   - Set `JWT_SIGNING_KEY_ACTIVE_REFERENCE` and `JWT_SIGNING_KEY_ACTIVE_KID` to the new key.
   - Keep the previous env vars pointing to the old key for the grace window.
   - Deploy. New tokens are issued with the new `kid`; tokens signed with the old `kid` still verify until `PREVIOUS_VALID_UNTIL`.
5. **Wait** for the previous-key grace window (`PREVIOUS_VALID_UNTIL`) to pass or for all outstanding old tokens to expire, whichever is longer.
6. **Remove previous** by clearing `JWT_SIGNING_KEY_PREVIOUS_*` env vars and re-deploy. The issuer now only accepts tokens signed with the active key.

## Rollback
If the new active key is bad, the issuer will fail startup (fail-fast). Revert `JWT_SIGNING_KEY_ACTIVE_*` to the old reference/ `kid` before the previous window expires and clear the previous-key config, or set the new key as previous and the old key as active.

## Verification
- Unit tests: `corepack pnpm --filter @projectx/identity test`.
- Negative tests: `hmac-token-issuer.spec.ts` covers algorithm substitution, unknown `kid`, expired tokens, wrong `iss`/`aud`, tampered tokens, missing/short keys, and last-known-good ring behavior.
- Issued JWT header must contain the correct `kid`; the key material must never appear in the token or logs.
