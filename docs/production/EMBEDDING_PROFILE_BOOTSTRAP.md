# Active Embedding Profile Bootstrap

## Invariant

Production startup remains fail-closed until exactly one `ACTIVE` embedding profile exists and a registered provider serves that exact vector-space identity.

## Actual table shape

The canonical migration creates:

```text
embedding.embedding_profiles
```

Columns:

- `embedding_profile_id` (TEXT PRIMARY KEY)
- `provider_id` (TEXT NOT NULL)
- `model_id` (TEXT NOT NULL)
- `model_version` (TEXT NOT NULL)
- `dimensions` (INTEGER NOT NULL)
- `distance_metric` (TEXT NOT NULL DEFAULT 'cosine')
- `vector_space` (TEXT NOT NULL, UNIQUE)
- `lifecycle` (TEXT NOT NULL DEFAULT 'DRAFT')
- `is_active` (BOOLEAN NOT NULL DEFAULT FALSE)
- `created_at`, `promoted_at`, `retired_at`

At most one row may be `is_active = true` (`embedding_profiles_single_active`).
The `vector_space` column is the canonical identity:

```text
provider:model:version:dimensions:distance_metric
```

Example:

```text
openai:text-embedding-3-small:2024-01-25:1536:cosine
```

## Steps

1. Confirm the external embedding provider details from the operator:
   - `provider_id` (e.g. `openai`)
   - `model_id` (e.g. `text-embedding-3-small`)
   - `model_version` (e.g. `2024-01-25`)
   - `dimensions` (e.g. `1536`)
   - `distance_metric` (e.g. `cosine`)
   - Key Vault secret name consumed by the worker (the worker's default is
     `openai/api-key`; set `OPENAI_EMBEDDING_SECRET_NAME=openai/embedding-api-key`
     to override, matching the runtime Terraform default)

2. Deactivate any existing active profile:

   ```sql
   UPDATE embedding.embedding_profiles
   SET lifecycle = 'RETIRED'
   WHERE lifecycle = 'ACTIVE';
   ```

   Note: `RETIRED` profiles keep their row and vector-space identity for audit
   purposes. A new profile must use a new `embedding_profile_id` if a retired
   profile already owns the same vector space.

3. Insert or update the single `ACTIVE` profile:

   ```sql
   INSERT INTO embedding.embedding_profiles (
     embedding_profile_id,
     provider_id,
     model_id,
     model_version,
     dimensions,
     distance_metric,
     vector_space,
     lifecycle,
     is_active
   ) VALUES (
     'openai-text-embedding-3-small-2024-01-25',
     'openai',
     'text-embedding-3-small',
     '2024-01-25',
     1536,
     'cosine',
     'openai:text-embedding-3-small:2024-01-25:1536:cosine',
     'ACTIVE',
     true
   )
   ON CONFLICT (embedding_profile_id) DO UPDATE SET
     provider_id = EXCLUDED.provider_id,
     model_id = EXCLUDED.model_id,
     model_version = EXCLUDED.model_version,
     dimensions = EXCLUDED.dimensions,
     distance_metric = EXCLUDED.distance_metric,
     vector_space = EXCLUDED.vector_space,
     lifecycle = 'ACTIVE',
     is_active = true;
   ```

4. Ensure the worker Key Vault secret exists and the managed identity can read it.
5. Restart the worker.
6. Confirm the worker log contains `EMBEDDING_RUNTIME_READY`.
7. Run a controlled non-sensitive smoke test:
   - Ingest one knowledge chunk.
   - Query memory with the same workspace.
   - Verify the returned dimension equals the profile dimension.

## Constraints

- Never use `DeterministicEmbeddingProvider` in production.
- Never have more than one `ACTIVE` profile.
- Do not change the profile version without re-embedding existing durable artifacts.
- The worker's default `OPENAI_EMBEDDING_SECRET_NAME` value is `openai/api-key`.
  The runtime Terraform configuration sets it to `openai/embedding-api-key`; if
  the operator stores the embedding key under a different name, set the
  `OPENAI_EMBEDDING_SECRET_NAME` environment variable to that secret name.
