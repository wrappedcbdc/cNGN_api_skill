# cNGN error reference

Errors return an HTTP status code and a message, with no `data` field:

```json
{ "status": 400, "message": "Decryption failed" }
```

Permission failures use a different shape, with a boolean in the `status` field:

```json
{ "status": false, "message": "Permission denied" }
```

Never branch on `status === 200` alone. Treat any non-200 `status`, or a `status` that is
`false`, as a failure.

## Contents

- [Authentication and access](#authentication-and-access)
- [Encryption](#encryption)
- [Validation](#validation)
- [Rate limiting](#rate-limiting)
- [Service availability](#service-availability)
- [Business logic](#business-logic)
- [Retry policy](#retry-policy)

## Authentication and access

| HTTP | Message | Cause | Fix |
| --- | --- | --- | --- |
| 400 | `No token provided` | Missing `Authorization` header | Send `Authorization: Bearer <api key>` |
| 400 | `Invalid token prefix` | Key does not start with `cngn_test`/`cngn_live` | Check the full key was copied |
| 400 | `Merchant not found` | API key not recognised | Regenerate the key in the dashboard |
| 400 | `No Test SSH Key found` / `No Live SSH Key found` | No Ed25519 public key uploaded for this environment | Upload the public key in the dashboard |
| 403 | `IP address not whitelisted` | Request came from a non-whitelisted IP | Add the server IP in dashboard security settings |
| 403 | `Could not determine client IP address` | Source IP could not be resolved | Check proxy configuration (`X-Forwarded-For`) |
| 403 | `Permission denied` | Role lacks the required permission | See the permission map in [endpoints.md](endpoints.md#permissions-summary) |
| 404 | `Merchant not found` | Business role could not be resolved | Contact support |

Whitelist **every** egress IP: load balancers, NAT gateways, and serverless egress ranges,
not just the application server.

## Encryption

| HTTP | Message | Cause | Fix |
| --- | --- | --- | --- |
| 400 | `Missing encryption data, key, or IV` | Body sent as plain JSON instead of `{content, iv}` | Encrypt the body; see [encryption.md](encryption.md) |
| 400 | `Decryption failed` | Wrong AES key, key used raw instead of SHA-256 hashed, malformed base64, or a corrupted IV | Verify the encryption key and IV generation |

## Validation

Bodies are validated after decryption. Failures return `400` with a `field: message`
string:

```json
{ "status": 400, "message": "amount: Number must be greater than or equal to 1" }
```

Parse the field name off the prefix before the colon when mapping errors back to form
fields. Common ones: `amount: Minimum amount is 100 NGN` (temporary virtual account),
`amount: Number must be greater than or equal to 1` (redeem).

## Rate limiting

| HTTP | Message | Fix |
| --- | --- | --- |
| 429 | `Too many requests. Please try again later.` | Wait 60 seconds |

The limit is 20 requests per 60 seconds **per API key**, so every server sharing a key
shares one budget. Once blocked, all requests with that key are rejected for 60 seconds;
retrying sooner does not shorten the block.

Mitigations: cache `GET /banks` and `GET /networks` for hours, page `GET /transactions`
with a higher `limit` instead of many small pages, and use webhooks instead of polling.

## Service availability

| HTTP | Message | Cause |
| --- | --- | --- |
| 400 | `Service is currently unavailable. Please try again later.` | Redeem or withdrawal service temporarily disabled platform-wide |

This is transient and applies to `POST /redeemAsset` and `POST /withdraw`. It is safe to
retry later, since nothing was initiated.

## Business logic

Endpoint-specific failures return `400` with a descriptive message, for example
`Could not resolve account details` or `Transaction not found`. Treat any unrecognised
`400` as non-retryable without changing the request.

## Retry policy

| Response | Action |
| --- | --- |
| `429` | Retry after at least 60 seconds |
| `5xx` | Retry with exponential backoff |
| `400` on a read endpoint | Fix the request; do not retry unchanged |
| `400` on `/redeemAsset`, `/withdraw`, `/bridge` | **Do not blindly retry** |
| Network timeout on a money-moving endpoint | **Do not blindly retry** |

A timeout does not mean the request was not processed. Before retrying anything that moves
money, confirm state with `GET /withdraw/verify/{tnxRef}` or `GET /transactions`, or you
risk sending twice.
