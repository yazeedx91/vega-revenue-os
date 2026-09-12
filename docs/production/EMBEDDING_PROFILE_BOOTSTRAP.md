# Active Embedding Profile Bootstrap

## Invariant

Production startup remains fail-closed until exactly one `ACTIVE` embedding profile exists and a registered provider serves that exact vector-space identity.

## Steps

1. Confirm the external embedding provider details from the operator:
   - `provider` (e.g. `openai`)
   - `model` (e.g. `text-embedding-3-small`)
   - `model_version` (e.g. `1`)
   - `dimensions` (e.g. `1536`)
   - `distance_metric` (e.g. `cosine`)
   - `secret_name` in Key Vault (e.g. `openai/embedding-api-key`)

2. Create the profile in PostgreSQL:

   ```sql
   INSERT INTO embedding.profiles (
     provider,
     model,
     model_version,
     dimensions,
     distance_metric,
     secret_name,
     lifecycle,
     is_active
   ) VALUES (
     'openai',
     'text-embedding-3-small',
     '1',
     1536,
     'cosine',
     'openai/embedding-api-key',
     'ACTIVE',
     true
   )
   ON CONFLICT (provider, model, model_version, dimensions, distance_metric) DO UPDATE SET
     lifecycle = 'ACTIVE',
     is_active = true,
     secret_name = EXCLUDED.secret_name;
   ```

3. Deactivate any other active profiles:

   ```sql
   UPDATE embedding.profiles
   SET is_active = false, lifecycle = 'DEPRECATED'
   WHERE is_active = true
     AND NOT (provider = 'openai' AND model = 'text-embedding-3-small' AND model_version = '1' AND dimensions = 1536 AND distance_metric = 'cosine');
   ```

4. Restart the worker.
5. Confirm the worker log contains `EMBEDDING_RUNTIME_READY`.
6. Run a controlled non-sensitive smoke test:
   - Ingest one knowledge chunk.
   - Query memory with the same workspace.
   - Verify the returned dimension equals the profile dimension.

## Constraints

- Never use `DeterministicEmbeddingProvider` in production.
- Never have more than one `ACTIVE` profile.
- Do not change the profile version without re-embedding existing durable artifacts.
