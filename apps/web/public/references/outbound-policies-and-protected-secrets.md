<!-- Generated from backend/API.md; edit the source and run docs:package. -->
## Outbound policies and protected secrets

These features require a qualified deployment and report `networking.egressPolicies` and `secrets.vault` in `/capabilities`. They default off in the checked-in rollout configuration. They are distinct from the existing boolean internet switch.

Create a restricted machine with:

```json
{"catalogId":"node","networkPolicy":{"allow":["api.example.com","*.packages.example.com"],"deny":["blocked.packages.example.com"]},"secretBindings":["sec_d688d42a-25ef-4c13-9b28-21a0fde6e163"]}
```

`allow` is required and may be empty; `deny` defaults to empty. Each accepts up to 64 rules: exact hostname, `*.domain`, IPv4/IPv6 CIDR, or `*`. Deny wins. Rules are normalized, immutable for the generation and part of the creation fingerprint. Admission returns `409 network_policy_capacity_exceeded` before reserving a start when account policy metadata would exceed its storage budget. The policy implies `internet:false` and rejects explicit `internet:true`. Only HTTP on 80 and HTTPS on 443 are mediated; raw TCP, UDP, alternate ports, redirects, private/reserved IPs and mixed public/private DNS answers are denied. A hostname must match a domain allow rule before any DNS lookup; CIDR-only grants apply to literal IP requests. CIDR denies also apply to allowed hostnames' resolved addresses. A trusted relay validates every resolved address and pins the connection to a validated address with normal TLS hostname verification. HTTPS clients must trust the provider interception CA; removing trust causes failure rather than an internet bypass. Private Services remain a separate explicitly registered, account-scoped route.

| Endpoint | Request and response |
| --- | --- |
| `GET /secrets` | `{secrets:[...]}` containing metadata only; available during billing outages. |
| `POST /secrets` | `{name,value,hostname,header,prefix?}`; returns 201 metadata including `id`. |
| `PUT /secrets/{secretId}` | `{value}` rotates the credential without changing its scope; returns metadata. |
| `DELETE /secrets/{secretId}` | Revokes subsequent use; returns `{deleted:true}`. Available with issuance disabled. |

Values are write-only, encrypted in account storage, and limited to 4,096 printable ASCII characters without spaces. `hostname` is one exact public DNS hostname. `header` is `authorization`, `x-api-key` or `api-key`; `prefix` is at most 32 printable ASCII characters, such as `Bearer `. Metadata includes `id,name,hostname,header,prefix,createdAt,updatedAt` and never the credential. Up to 16 owned IDs can be bound to a machine, with no duplicate host/header scope. Injection occurs only for HTTPS requests to the credential's exact host, after policy validation. Values do not enter guest files, environment, launch metadata or snapshots. Rotation/deletion and runtime replacement are checked again before returning mediated responses; requests already accepted upstream may complete.

Use a trusted upstream and scoped, revocable tokens. Literal and common encoded credential reflection is blocked, but a malicious upstream can transform credentials into other response content. Mediation cannot make credentials unextractable against such an upstream. See `docs/network-policy.md` for the relay setup and required provider qualification.
