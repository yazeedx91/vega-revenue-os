# Phase 14.8 — Entra Test Tenant & Graph Application Setup

**Scope:** Provision the dedicated Microsoft 365 / Entra tenant and application registration for the first controlled real email send, per ADR-131.

**Audience:** Platform Operations / Security Engineering with tenant administrator access.

---

## 1. Create a dedicated test tenant

1. Use the Microsoft 365 admin center or `Microsoft365DSC` to create a new test tenant.
2. Name it clearly, e.g. `projectx-phase14-test`.
3. Add a single shared mailbox that will act as the sender: `noreply-phase14@<tenant>.onmicrosoft.com`.
4. Do **not** place any customer data in this tenant.

---

## 2. Register the application

In Azure portal / Entra admin center:

1. App registrations → New registration.
2. Name: `ProjectX Phase 14 Graph Mail Sender`.
3. Supported account types: **Accounts in this organizational directory only**.
4. Redirect URI: **None** (do not add one).
5. Click Register.

Record:
- **Application (client) ID** → set as `GRAPH_CLIENT_ID`.
- **Directory (tenant) ID** → set as `GRAPH_TENANT_ID`.

---

## 3. Add and consent permissions

1. API permissions → Add permission → Microsoft Graph → Application permissions.
2. Select **Mail.Send** only.
3. Grant **admin consent** for the tenant.
4. Verify no other Graph permissions are granted.

---

## 4. Create a client secret

1. Certificates & secrets → New client secret.
2. Description: `Phase 14 first-send secret`.
3. Expiry: choose the shortest acceptable lifetime (e.g. 90 days).
4. Copy the secret value immediately.

Place the secret in your target secret store:
- Key Vault: `GRAPH_CLIENT_SECRET_REFERENCE`.
- Or direct environment variable: `GRAPH_CLIENT_SECRET` (not recommended for production).

Rotate before expiry; open a follow-up ticket to move to certificate-based auth in Phase 14.9.

---

## 5. Configure the shared sender mailbox

1. In Exchange admin center, create a shared mailbox or assign a mailbox license to a user.
2. Note the SMTP address (e.g. `noreply-phase14@<tenant>.onmicrosoft.com`).
3. Set `GRAPH_SENDER_ADDRESS` to this address.
4. Test that the application can send on behalf of this mailbox using the Graph explorer or a small `curl`.

---

## 6. Restrict token usage

1. In Entra, open the registered app → Authentication → disable all public flows.
2. Properties → set **Allow public client flows** = No.
3. Conditional Access (optional but recommended): restrict to the expected outbound IP ranges of the `temporal-worker` and `api` deployments.

---

## 7. Validation script

After the secrets are placed, run a minimal Graph token test from the target environment:

```powershell
$env:GRAPH_TENANT_ID="<tenant-id>"
$env:GRAPH_CLIENT_ID="<client-id>"
$env:GRAPH_CLIENT_SECRET="<secret>"
node scripts/validation/graph-token-test.js
```

The script should output:

```
Token acquired successfully
Mail.Send permission present
```

If it does not, verify admin consent and mailbox licensing before proceeding.

---

## 8. Teardown

After the first controlled send is proven:

1. Revoke all client secrets.
2. Delete the Graph application registration.
3. Decommission or restrict the test tenant.
4. Update `GRAPH_*` environment variables in the target deployment to the production tenant/app values per a follow-up ARB decision.

---

## 9. Evidence for ARB

Attach to the readiness review:
- Screenshot of app registration overview (client ID, tenant ID).
- Screenshot of API permissions showing only `Mail.Send` and admin-consented.
- Screenshot of Conditional Access policy (if configured).
- Output of `node scripts/validation/graph-token-test.js` from the target environment.
