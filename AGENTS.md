# cNGN API integration instructions

This file is the entry point for any coding agent that reads `AGENTS.md` (OpenAI Codex,
Cursor, Gemini CLI, Aider, Jules, and others). It carries the same guidance as the Claude
skill; the detail lives in the same shared Markdown files, so there is one source of
truth.

**Read [`skills/cngn-api/SKILL.md`](skills/cngn-api/SKILL.md) first.** It is plain
Markdown with a short YAML header and is safe to read in any tool.

## When this applies

Apply these instructions whenever the task involves the cNGN stablecoin API: writing or
reviewing code that calls `https://api.cngn.co/v1/api`, handling cNGN webhook deliveries,
or debugging `cngn_test` / `cngn_live` credentials, encryption, or payouts.

## Non-negotiables

- **Both directions are encrypted.** `POST`/`PUT` bodies are AES-256-CBC encrypted and
  sent as `{content, iv}`; the `data` field of a success response is sealed to the
  merchant's Ed25519 public key and must be decrypted locally. Plain JSON bodies fail with
  `400 Missing encryption data, key, or IV`.
- **The AES key is the SHA-256 hash of the dashboard encryption key**, not the key string
  itself. Using it raw is the usual cause of `400 Decryption failed`.
- **Never hard-code a `networkId`.** Resolve it from `GET /networks` per environment and
  skip entries where `isDisabled` is `true`.
- **Never put an API key, encryption key, or Ed25519 private key in client-side code**, a
  mobile app, or source control. All cNGN credentials are server-side only.
- **Never blindly retry a `400` or a timeout on `/redeemAsset`, `/withdraw`, or
  `/bridge`.** Confirm state with `GET /withdraw/verify/{tnxRef}` or `GET /transactions`
  first, or you risk moving money twice.
- **Never branch on `status === 200` alone.** Permission failures return
  `{"status": false, "message": "Permission denied"}`.
- **Never credit a customer on `deposit.received`.** Wait for `deposit.completed`.
- **Never trust an unverified webhook.** Check `X-cNGN-Signature` (HMAC-SHA256 of the raw
  body) with a constant-time comparison before acting.
- **Respect the rate limit:** 20 requests per 60 seconds per API key. Cache `GET /banks`
  and `GET /networks` for hours.

## Vocabulary

- **Redeem** converts cNGN to Naira, settled to a bank account. Not "withdraw to bank".
- **Withdraw** is always an on-chain transfer of cNGN to an external wallet.
- **Bridge** moves cNGN between networks. The backend calls it "swap" internally and some
  API messages say "Swap"; user-facing text says "bridge".
- **Virtual account** is a NUBAN bank account for Naira deposits, either dedicated
  (permanent, per business) or temporary (one-time, per customer payment).

## Where to look

| Topic | File |
| --- | --- |
| Overview, workflows, endpoint index | [`skills/cngn-api/SKILL.md`](skills/cngn-api/SKILL.md) |
| Every endpoint, parameters, payload shapes | [`skills/cngn-api/reference/endpoints.md`](skills/cngn-api/reference/endpoints.md) |
| AES request encryption, Ed25519 response decryption | [`skills/cngn-api/reference/encryption.md`](skills/cngn-api/reference/encryption.md) |
| Webhook events, payloads, signature verification | [`skills/cngn-api/reference/webhooks.md`](skills/cngn-api/reference/webhooks.md) |
| Error messages, causes, retry policy | [`skills/cngn-api/reference/errors.md`](skills/cngn-api/reference/errors.md) |
| `networkId` resolution, token contract addresses | [`skills/cngn-api/reference/networks.md`](skills/cngn-api/reference/networks.md) |
| Machine-readable API description | [`openapi/cngn-v1.yaml`](openapi/cngn-v1.yaml) |
| Runnable crypto helpers | [`skills/cngn-api/scripts/`](skills/cngn-api/scripts/) |

Prefer an [official SDK](https://github.com/wrappedcbdc) (TypeScript, Python, PHP, Java)
over hand-rolled HTTP: they implement both encryption directions.
