# Operator bootstrap utility container.
# Runs inside the existing ACA environment on the private VNet and provides
# the Azure CLI (for Key Vault secret management) and the PostgreSQL client
# (for embedding profile bootstrap). The container is started on demand by the
# operator, who attaches interactively; no secret values are baked in, logged,
# or passed as command-line arguments.
FROM mcr.microsoft.com/azure-cli:cbl-mariner2.0

# Install the PostgreSQL client for VNet-local database access.
RUN tdnf install -y postgresql && tdnf clean all

WORKDIR /workspace

# Keep the container alive so the operator can az containerapp exec into it.
CMD ["sleep", "infinity"]
