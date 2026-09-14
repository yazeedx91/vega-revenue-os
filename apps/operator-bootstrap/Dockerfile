# Operator bootstrap utility container.
# Runs inside the existing ACA environment on the private VNet and provides
# the Azure CLI, PostgreSQL client, and Python cryptography tooling needed to
# generate runtime OIDC/JWT key material without leaving the private network.
# The container is started on demand by the operator, who attaches
# interactively; no secret values are baked in, logged, or passed as
# command-line arguments.
FROM mcr.microsoft.com/azure-cli:cbl-mariner2.0

# Install PostgreSQL client for VNet-local database access and Python/pip so
# the operator can generate JWT/OIDC key material inside the container.
RUN tdnf install -y postgresql python3 python3-pip && \
    pip3 install --no-cache-dir cryptography && \
    tdnf clean all

COPY operator-bootstrap-script.py /workspace/operator-bootstrap-script.py
WORKDIR /workspace

# Keep the container alive so the operator can az containerapp exec into it.
CMD ["sleep", "infinity"]
