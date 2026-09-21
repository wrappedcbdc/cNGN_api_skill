---
name: cngn-api
description: Integrates with the cNGN stablecoin API at https://api.cngn.co/v1/api, covering bearer authentication, AES-256-CBC request encryption, Ed25519 response decryption, balances, transactions, virtual accounts, redemptions, on-chain withdrawals, bridging, address whitelisting, and webhook handling. Use when writing, reviewing, or debugging code that calls the cNGN API, when handling cNGN webhook deliveries, or when the user mentions cNGN, cngn_test or cngn_live API keys, Naira stablecoin payouts, or redeeming and bridging cNGN.
---

# cNGN API integration

The cNGN API is a REST API for a Naira-backed stablecoin. Every endpoint acts on the
authenticated business (also called the merchant); there is no per-request account ID.

**Base URL:** `https://api.cngn.co/v1/api`

## The two things that break most integrations

1. **Both directions are encrypted.** Request bodies on `POST`/`PUT` must be AES-256-CBC
   encrypted and sent as `{content, iv}`. The `data` field of every success response is
   encrypted to your Ed25519 public key and must be decrypted locally. Plain JSON bodies
   fail with `400 Missing encryption data, key, or IV`.
2. **`networkId` values are environment-specific database IDs.** Resolve them at runtime
   from `GET /networks`. A network ID from test never works in live.

Prefer an [official SDK](#official-sdks) over hand-rolled HTTP: the SDKs implement both
encryption directions for you.

## Request lifecycle

Every call follows the same shape:

```
Bearer cngn_test…/cngn_live… ──▶ IP whitelist check ──▶ decrypt body ──▶ validate ──▶ handle
                                                                                       │
        {status, message, data: "<base64 encrypted>"} ◀── encrypt data to your Ed25519 ─┘
```

- **Auth:** `Authorization: Bearer <api key>`. The key prefix selects the environment
  (`cngn_test` = sandbox, `cngn_live` = production). Same base URL for both.
- **Source IP** must be whitelisted in the merchant dashboard, or the call fails `403`.
- **Success envelope:** `{ "status": 200, "message": "...", "data": "<encrypted base64>" }`.
- **Error envelope:** `{ "status": 400, "message": "..." }` with no `data`. Permission
  failures instead return `{ "status": false, "message": "Permission denied" }`, so never
  branch on `status === 200` alone; treat a non-200 `status` or a `false` as failure.
- **Rate limit:** 20 requests per 60 seconds **per API key**; exceeding it blocks the key
  for 60 seconds with a `429`.

## Endpoints

| Method | Path | Purpose | Permission |
| --- | --- | --- | --- |
| GET | `/balance` | cNGN balances | none |
| GET | `/transactions` | Paginated history | none |
| GET | `/transactions/{tnxRef}` | Single transaction by reference | none |
| GET | `/networks` | Supported networks; source of `networkId` | none |
| GET | `/virtual-account` | Dedicated NUBAN deposit account(s) | Fiat Deposit |
| POST | `/virtual-account/temporary` | One-time deposit account | Fiat Deposit |
| POST | `/redeemAsset` | Redeem cNGN to a bank account | Redeem |
| POST | `/account/verify` | Resolve a bank account name | none |
| GET | `/banks` | Supported banks with CBN codes | none |
| PUT | `/bank-account` | Update settlement bank account | none |
| POST | `/withdraw` | Send cNGN to an external wallet | Send Crypto |
| GET | `/withdraw/verify/{tnxRef}` | Withdrawal status | none |
| POST | `/bridge-quote` | Fees for a cross-chain move | Swap |
| POST | `/bridge` | Move cNGN between networks | Swap |
| POST | `/whitelist` | Whitelist an external address | none |
| GET | `/whitelisted` | List whitelisted addresses | none |

Full parameters, response shapes, and examples: **[reference/endpoints.md](reference/endpoints.md)**.

## Vocabulary

Use these terms exactly; they are not interchangeable.

- **Redeem** converts cNGN back to Naira, settled to a bank account. Never call this
  "withdraw to bank".
- **Withdraw** is always an on-chain transfer of cNGN to an external wallet.
- **Bridge** moves cNGN between blockchain networks. The backend calls it "swap"
  internally and some response messages say "Swap"; user-facing text says "bridge".
- **Virtual account** is a NUBAN bank account for Naira deposits: *dedicated* (permanent,
  per business) or *temporary* (one-time, per customer payment).

## Rules that must not be broken

- **Never hard-code a `networkId`.** Fetch `GET /networks`, match on `short_name`, and
  skip entries where `isDisabled` is `true`.
- **Never put an API key, encryption key, or Ed25519 private key in client-side code**,
  a mobile app, or source control. These are server-side only.
- **Never blindly retry a `400` on a money-moving endpoint** (`/redeemAsset`, `/withdraw`,
  `/bridge`). Confirm state first with `GET /withdraw/verify/{tnxRef}` or
  `GET /transactions`, or you risk double-spending. Retry `429` (after 60 seconds) and
  `5xx` with exponential backoff.
- **Never credit a customer on `deposit.received`.** Wait for `deposit.completed`.
- **Never trust an unverified webhook.** Validate `X-cNGN-Signature` before acting.
- **Cache `/banks` and `/networks` for hours**, not seconds; the rate limit is tight.

## Common workflows

### Collect a Naira deposit

1. `GET /virtual-account` for a permanent account, or `POST /virtual-account/temporary`
   with `{amount, customer:{email,name}}` for a per-payment account that expires.
2. Show the returned `accountNumber` / `bankName` to the payer.
3. Wait for the `deposit.received` webhook (funds confirmed, cNGN **not** yet credited),
   then `deposit.completed` (cNGN credited). Credit your customer on the second one.

### Redeem cNGN to a bank account

1. `GET /banks` for the CBN bank code (cache it).
2. `POST /account/verify` with `{bankCode, accountNumber}` and show the resolved
   `accountName` for confirmation before moving money.
3. `POST /redeemAsset` with `{amount, bankCode, accountNumber, saveDetails?}`.
4. Track the returned `trxRef` via `GET /transactions`, or the `redemption.completed` /
   `transaction.failed` webhooks. Failed payouts revert the cNGN automatically.

### Withdraw cNGN on-chain

1. `GET /networks`, resolve the target `networkId` for this environment.
2. If your account requires it, `POST /whitelist` with `{networkId, address}` first.
3. `POST /withdraw` with `{amount, address, networkId, shouldSaveAddress?}`.
4. Poll `GET /withdraw/verify/{trxRef}` with exponential backoff, or wait for the
   `withdrawal.completed` webhook.

### Bridge between networks

1. `POST /bridge-quote` with `{amount, originNetworkId, destinationNetworkId,
   destinationAddress}` to get `amountReceivable`, `networkFee`, and `bridgeFee`.
2. `POST /bridge` with the same network/address fields plus optional `senderAddress` and
   `callbackUrl`.
3. Send cNGN to the returned `receivableAddress` **on the origin network**.
4. The optional `callbackUrl` fires once, unsigned, with a 4.5 second timeout, so treat it
   only as a hint and confirm via `GET /transactions` before crediting anything.

## Reference material

Read these only when the task needs them.

- **[reference/endpoints.md](reference/endpoints.md)** — every endpoint: parameters,
  decrypted response shapes, worked examples, pagination.
- **[reference/encryption.md](reference/encryption.md)** — AES-256-CBC request encryption
  and Ed25519/Curve25519 response decryption, with reference implementations.
- **[reference/webhooks.md](reference/webhooks.md)** — the five event types, payload
  fields per event, signature verification, delivery guarantees.
- **[reference/errors.md](reference/errors.md)** — every documented error message, its
  cause, and whether it is retryable.
- **[reference/networks.md](reference/networks.md)** — resolving `networkId`, supported
  chains, and the official token contract addresses per chain.
- **[../../openapi/cngn-v1.yaml](../../openapi/cngn-v1.yaml)** — OpenAPI 3.1 description of
  the wire format and the decrypted payload schemas, for codegen and for agents that
  consume specs directly.

## Utility scripts

Reference implementations of the crypto both directions. Read them as reference, or run
them directly to check a key pair or debug a payload:

```bash
# Round-trip a request body through AES-256-CBC
python3 scripts/cngn_crypto.py encrypt '{"amount":1000}' "$CNGN_ENCRYPTION_KEY"

# Decrypt a response `data` field with your Ed25519 private key file
python3 scripts/cngn_crypto.py decrypt "<base64 data>" ./cngn_api_key
```

`scripts/cngn_crypto.py` needs `pip install cryptography pynacl`;
`scripts/cngn_crypto.ts` needs `npm install libsodium-wrappers`.

## Official SDKs

Server-side only. They handle bearer auth, request encryption, and response decryption.

| Language | Package |
| --- | --- |
| TypeScript / Node.js | [`cngn-typescript-library`](https://github.com/wrappedcbdc/cngn-typescript-library) |
| Python | [`cngn-python-library`](https://github.com/wrappedcbdc/cngn-python-library) |
| PHP | [`cngn-php-library`](https://github.com/wrappedcbdc/cngn-php-library) |
| Java | [`cngn-java-library`](https://github.com/wrappedcbdc/cngn-java-library) |
