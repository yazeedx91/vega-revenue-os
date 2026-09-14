#!/usr/bin/env python3
"""
Operator bootstrap script for ProjectX shadow deployment.

Runs inside the private VNet operator bootstrap container and:
  1. Generates a JWT HMAC signing key and stores it in Key Vault.
  2. Generates an RSA key pair and stores the public JWKS in Key Vault.
  3. Stores placeholder OpenAI/embedding API key secrets (shadow-only).
  4. Inserts exactly one ACTIVE embedding profile into PostgreSQL.
  5. Verifies the ACTIVE embedding profile invariant.

No secret values are printed. Status codes and names only are emitted to stdout.
"""
import json
import os
import secrets
import subprocess
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


VAULT = os.environ["KEY_VAULT_NAME"]
PGHOST = os.environ["POSTGRES_HOST"]
PGUSER = os.environ["POSTGRES_ADMIN_USER"]
PGPASSWORD = os.environ.get("POSTGRES_ADMIN_PASSWORD", "")
PGDB = os.environ["POSTGRES_DB"]

EMBEDDING_PROFILE_ID = "openai-text-embedding-3-small-2024-01-25"
PROVIDER_ID = "openai"
MODEL_ID = "text-embedding-3-small"
MODEL_VERSION = "2024-01-25"
DIMENSIONS = 1536
DISTANCE_METRIC = "cosine"
VECTOR_SPACE = f"{PROVIDER_ID}:{MODEL_ID}:{MODEL_VERSION}:{DIMENSIONS}:{DISTANCE_METRIC}"


def az(*args: str, check: bool = True) -> str:
    # The container runs with a user-assigned managed identity. Login once.
    env = os.environ.copy()
    if "AZURE_ACCESS_TOKEN" not in env:
        login = subprocess.run(
            ["az", "login", "--identity", "--client-id", os.environ["AZURE_CLIENT_ID"], "--output", "none"],
            capture_output=True,
            text=True,
        )
        if login.returncode != 0:
            print(f"ERROR az login: {login.stderr}", file=sys.stderr)
            sys.exit(1)
        env["AZURE_ACCESS_TOKEN"] = "1"
    cmd = ["az", *args, "--output", "none"]
    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if check and result.returncode != 0:
        print(f"ERROR running {' '.join(args)}: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def set_secret(name: str, value: str, description: str) -> None:
    az(
        "keyvault",
        "secret",
        "set",
        "--vault-name",
        VAULT,
        "--name",
        name,
        "--value",
        value,
        "--tags",
        f"purpose={description}",
        "owner=operator-bootstrap",
    )
    print(f"SET_SECRET {name}")


def b64uint(n: int) -> str:
    # Base64URL encode an unsigned integer with minimal padding removed.
    length = (n.bit_length() + 7) // 8
    bytes_ = n.to_bytes(length, "big")
    # Strip leading zero bytes.
    idx = 0
    while idx < len(bytes_) and bytes_[idx] == 0:
        idx += 1
    data = bytes_[idx:]
    return (
        __import__("base64")
        .urlsafe_b64encode(data)
        .rstrip(b"=")
        .decode("ascii")
    )


def generate_jwks(kid: str) -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_numbers = private_key.public_key().public_numbers()
    jwk = {
        "kty": "RSA",
        "use": "sig",
        "kid": kid,
        "n": b64uint(public_numbers.n),
        "e": b64uint(public_numbers.e),
    }
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")
    return json.dumps({"keys": [jwk]}), private_pem


def pg_url() -> str:
    from urllib.parse import quote_plus
    return (
        f"postgresql://{PGUSER}:{quote_plus(PGPASSWORD)}@{PGHOST}:5432/{PGDB}?sslmode=require"
    )


def run_sql(sql: str) -> str:
    result = subprocess.run(
        ["psql", pg_url(), "-c", sql],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"ERROR running SQL: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def main() -> None:
    print("BOOTSTRAP_START")

    # 1. JWT HMAC signing key (256 bits).
    hmac_key = secrets.token_urlsafe(32)
    set_secret(
        "jwt-active-signing-key",
        hmac_key,
        "Active JWT HMAC signing key for API tokens",
    )

    # 2. OIDC JWKS (RSA public key set).
    jwks_kid = "shadow-active-kid-001"
    jwks_json, _private_pem = generate_jwks(jwks_kid)
    set_secret("entra-jwks", jwks_json, "OIDC JWKS public key set for token validation")

    # 3. Placeholder OpenAI keys (shadow-only; not real provider credentials).
    set_secret(
        "openai-embedding-api-key",
        "shadow-not-a-real-key",
        "Shadow OpenAI embedding API key placeholder",
    )
    set_secret(
        "openai-api-key",
        "shadow-not-a-real-key",
        "Shadow OpenAI LLM API key placeholder",
    )

    # 4. Insert exactly one ACTIVE embedding profile.
    deactivate_sql = "UPDATE embedding.embedding_profiles SET lifecycle = 'RETIRED' WHERE lifecycle = 'ACTIVE';"
    insert_sql = f"""
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
      '{EMBEDDING_PROFILE_ID}',
      '{PROVIDER_ID}',
      '{MODEL_ID}',
      '{MODEL_VERSION}',
      {DIMENSIONS},
      '{DISTANCE_METRIC}',
      '{VECTOR_SPACE}',
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
    """
    run_sql(deactivate_sql)
    run_sql(insert_sql)
    print("INSERTED_EMBEDDING_PROFILE")

    # 5. Verify exactly one ACTIVE row.
    verify_sql = (
        "SELECT COUNT(*) AS active_count FROM embedding.embedding_profiles "
        "WHERE is_active = true AND lifecycle = 'ACTIVE';"
    )
    output = run_sql(verify_sql)
    # psql output contains the count on a line like ' 1 '.
    count_lines = [line.strip() for line in output.splitlines() if line.strip().isdigit()]
    if not count_lines or count_lines[-1] != "1":
        print(f"ERROR: expected exactly one ACTIVE profile, got: {output}", file=sys.stderr)
        sys.exit(1)
    print("VERIFIED_EXACTLY_ONE_ACTIVE_PROFILE")

    print("BOOTSTRAP_COMPLETE")


if __name__ == "__main__":
    main()
