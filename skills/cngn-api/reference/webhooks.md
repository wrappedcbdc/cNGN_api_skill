# cNGN webhooks

Webhooks tell your server that a deposit landed, a redemption paid out, or a withdrawal
failed, instead of polling `GET /transactions`.

Webhook URLs, event subscriptions, and the signing secret are configured in the **merchant
dashboard**, not through the API. Each environment has its own webhook URL.

## Contents

- [Event types](#event-types)
- [Delivery payload](#delivery-payload)
- [Field presence by event](#field-presence-by-event)
- [Sample payloads](#sample-payloads)
- [Verifying the signature](#verifying-the-signature)
- [Delivery behaviour](#delivery-behaviour)
- [Bridge completion callback](#bridge-completion-callback)

## Event types

| Event | Fires when |
| --- | --- |
| `deposit.received` | A fiat payment landed and is awaiting mint approval. Funds confirmed, cNGN **not** credited. |
| `deposit.completed` | A deposit (fiat or on-chain) was fully processed and cNGN credited. |
| `redemption.completed` | A redemption settled; Naira paid out to the bank account. |
| `withdrawal.completed` | An on-chain withdrawal was confirmed on the network. |
| `transaction.failed` | Any transaction failed or was rejected; `reason` explains why when known. |

`deposit.received` then `deposit.completed` is the normal fiat deposit lifecycle, sharing
one `transactionId` and `trx_ref`. **Credit your customer only on `deposit.completed`.**

## Delivery payload

Every delivery is an HTTPS `POST` with the same envelope:

```json
{
  "event": "<event type>",
  "data": { "...": "transaction snapshot, fields vary by event" },
  "timestamp": "2026-07-22T14:32:12.104Z"
}
```

`data` fields:

| Field | Type | Description |
| --- | --- | --- |
| `transactionId` | string | Unique transaction ID. Use it for idempotency. |
| `trx_ref` | string | Transaction reference, same value as in `GET /transactions` |
| `businessId` | string | Your business ID |
| `initiatorId` | string | User that initiated the transaction |
| `status` | string | `pending`, `completed`, `failed`, `rejected` |
| `trx_type` | string | `fiat_buy`, `crypto_deposit`, `fiat_redeem`, `enaira_redeem`, `withdraw` |
| `network` | string | Network the transaction executed on, when on-chain |
| `base_trx_hash` | string \| null | Hash on the origin/issuing network |
| `extl_trx_hash` | string \| null | Hash on the destination/external network |
| `explorer_link` | string \| null | Block explorer URL when a hash exists |
| `amount` | string | Decimal string |
| `asset_symbol` | string | `NGN` for fiat-side events, `CNGN` for on-chain events |
| `receiver` | string | Format varies by event; see samples |
| `reason` | string | Present on `transaction.failed` when a cause is known |
| `occurredAt` | string | ISO 8601 timestamp of the state change |

Note `trx_type` here uses different values than the `trx_type` in `GET /transactions`.
Webhooks use `fiat_buy`/`crypto_deposit`/`fiat_redeem`/`enaira_redeem`/`withdraw`; the
transactions endpoint uses `deposit`/`withdrawal`/`redeem`/`swap`.

## Field presence by event

| Field | deposit.received | deposit.completed | redemption.completed | withdrawal.completed | transaction.failed |
| --- | --- | --- | --- | --- | --- |
| `transactionId`, `trx_ref`, `businessId`, `initiatorId`, `status`, `trx_type`, `amount`, `asset_symbol`, `receiver`, `occurredAt` | Yes | Yes | Yes | Yes | Yes |
| `network` | No | Yes | Yes | Yes | Sometimes |
| `base_trx_hash` | No | Yes | No | Yes | Sometimes |
| `extl_trx_hash` | No | On-chain deposits | No | Yes | No |
| `explorer_link` | No | Yes | No | Yes | Sometimes |
| `reason` | No | No | No | No | When known |

Read every optional field defensively.

## Sample payloads

### deposit.received

Fiat landed, awaiting mint. No on-chain step yet, so no `network` or hash; `receiver` is
your business ID and `asset_symbol` is `NGN`.

```json
{
  "event": "deposit.received",
  "data": {
    "transactionId": "9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
    "trx_ref": "b3c1a2d4-8e9f-4a5b-9c0d-1e2f3a4b5c6d",
    "businessId": "4f1d0c2a-7b3e-4d5f-8a9b-0c1d2e3f4a5b",
    "initiatorId": "7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b",
    "status": "pending",
    "trx_type": "fiat_buy",
    "amount": "50000",
    "asset_symbol": "NGN",
    "receiver": "4f1d0c2a-7b3e-4d5f-8a9b-0c1d2e3f4a5b",
    "occurredAt": "2026-07-22T14:32:11.000Z"
  },
  "timestamp": "2026-07-22T14:32:11.104Z"
}
```

### deposit.completed

The mint settles on the issuing network, so the payload carries `network`, the mint hash,
and an explorer link:

```json
{
  "event": "deposit.completed",
  "data": {
    "transactionId": "9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
    "trx_ref": "b3c1a2d4-8e9f-4a5b-9c0d-1e2f3a4b5c6d",
    "businessId": "4f1d0c2a-7b3e-4d5f-8a9b-0c1d2e3f4a5b",
    "initiatorId": "7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b",
    "status": "completed",
    "trx_type": "fiat_buy",
    "network": "XBN",
    "base_trx_hash": "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
    "explorer_link": "https://explorer.bantu.network/tx/e5f6a7b8...e5f6",
    "amount": "50000",
    "asset_symbol": "NGN",
    "receiver": "4f1d0c2a-7b3e-4d5f-8a9b-0c1d2e3f4a5b",
    "occurredAt": "2026-07-22T15:05:42.000Z"
  },
  "timestamp": "2026-07-22T15:05:42.310Z"
}
```

For an **on-chain deposit** (cNGN sent to your wallet from an external address) the same
event fires with `trx_type: crypto_deposit` and `asset_symbol: CNGN`, with no preceding
`deposit.received`. Deposits arriving over EVM or Solana also carry `extl_trx_hash`, the
hash on the source network.

### redemption.completed

`receiver` encodes the destination bank account as `bankCode:accountNumber:accountName`:

```json
{
  "event": "redemption.completed",
  "data": {
    "transactionId": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    "trx_ref": "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "businessId": "4f1d0c2a-7b3e-4d5f-8a9b-0c1d2e3f4a5b",
    "initiatorId": "7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b",
    "status": "completed",
    "trx_type": "fiat_redeem",
    "network": "xbn",
    "amount": "100000",
    "asset_symbol": "NGN",
    "receiver": "058:0123456789:ADA OBI",
    "occurredAt": "2026-07-22T16:12:03.000Z"
  },
  "timestamp": "2026-07-22T16:12:03.221Z"
}
```

`trx_type` is `fiat_redeem` for bank redemptions and `enaira_redeem` for eNaira.

### withdrawal.completed

`base_trx_hash` is the burn on the issuing network, `extl_trx_hash` the transfer on the
destination network, and `receiver` the destination wallet address:

```json
{
  "event": "withdrawal.completed",
  "data": {
    "transactionId": "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f",
    "trx_ref": "f0e1d2c3-b4a5-4968-8776-5a4b3c2d1e0f",
    "businessId": "4f1d0c2a-7b3e-4d5f-8a9b-0c1d2e3f4a5b",
    "initiatorId": "7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b",
    "status": "completed",
    "trx_type": "withdraw",
    "network": "BASE",
    "base_trx_hash": "d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1",
    "extl_trx_hash": "0x4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b",
    "explorer_link": "https://basescan.org/tx/0x4a5b...4a5b",
    "amount": "25000",
    "asset_symbol": "CNGN",
    "receiver": "0x8Ba1f109551bD432803012645Ac136ddd64DBA72",
    "occurredAt": "2026-07-22T17:44:19.000Z"
  },
  "timestamp": "2026-07-22T17:44:19.402Z"
}
```

### transaction.failed

The shape depends on where in the pipeline it stopped. Branch on `data.trx_type` to know
what failed, and on `data.status` (`failed` vs `rejected`) to separate processing errors
from review declines.

A withdrawal that failed **before** the on-chain burn carries a `reason` and no hashes:

```json
{
  "event": "transaction.failed",
  "data": {
    "transactionId": "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f",
    "trx_ref": "f0e1d2c3-b4a5-4968-8776-5a4b3c2d1e0f",
    "businessId": "4f1d0c2a-7b3e-4d5f-8a9b-0c1d2e3f4a5b",
    "initiatorId": "7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b",
    "status": "failed",
    "trx_type": "withdraw",
    "network": "base",
    "amount": "25000",
    "asset_symbol": "CNGN",
    "receiver": "0x8Ba1f109551bD432803012645Ac136ddd64DBA72",
    "reason": "Insufficient balance",
    "occurredAt": "2026-07-22T17:40:02.000Z"
  },
  "timestamp": "2026-07-22T17:40:02.118Z"
}
```

A withdrawal that failed **after** the burn carries the burn hash and may have no `reason`;
funds are reverted automatically.

A redemption whose bank payout could not be processed arrives with `trx_type: fiat_redeem`
and a provider failure reason such as `"Provider failed to process payout"`. The redeemed
cNGN is reverted to your balance automatically.

A deposit declined during review arrives with `status: "rejected"`, `trx_type: fiat_buy`,
and a decline reason such as `"Deposit could not be matched to a payment"`.

## Verifying the signature

With a signing secret configured, every delivery carries:

```text
X-cNGN-Signature: sha256=<hex digest>
```

The digest is an **HMAC-SHA256 of the raw JSON request body**, keyed with your signing
secret. Compute it over the exact bytes received, not over a re-serialised object.

### TypeScript (Express)

```typescript
import crypto from "crypto";
import express from "express";

const app = express();

// Capture the raw body; the HMAC is computed over the exact bytes sent
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf.toString("utf8"); },
}));

app.post("/webhooks/cngn", (req: any, res) => {
  const received = req.header("X-cNGN-Signature") ?? "";
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.CNGN_SIGNING_SECRET!)
    .update(req.rawBody)
    .digest("hex");

  const valid = received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));

  if (!valid) return res.status(401).send("invalid signature");

  // Acknowledge immediately, process asynchronously
  res.status(200).send("ok");
  queue.add(req.body);
});
```

### Python (Flask)

```python
import hashlib, hmac, os
from flask import Flask, request, abort

app = Flask(__name__)


@app.post("/webhooks/cngn")
def cngn_webhook():
    received = request.headers.get("X-cNGN-Signature", "")
    expected = "sha256=" + hmac.new(
        os.environ["CNGN_SIGNING_SECRET"].encode(),
        request.get_data(),  # raw body bytes
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(received, expected):
        abort(401)

    enqueue(request.get_json())  # acknowledge fast
    return "ok", 200
```

### PHP

```php
<?php
$rawBody = file_get_contents('php://input');
$received = $_SERVER['HTTP_X_CNGN_SIGNATURE'] ?? '';

$expected = 'sha256=' . hash_hmac('sha256', $rawBody, getenv('CNGN_SIGNING_SECRET'));

if (!hash_equals($expected, $received)) {
    http_response_code(401);
    exit('invalid signature');
}

enqueue(json_decode($rawBody, true));
http_response_code(200);
echo 'ok';
```

Always use a constant-time comparison (`timingSafeEqual`, `hmac.compare_digest`,
`hash_equals`), never `==`.

## Delivery behaviour

Deliveries are sent **once**, with a 10-second timeout, and are **not retried**.

- **Treat webhooks as notifications, not the source of truth.** If your endpoint is down
  when an event fires, that delivery is lost. Reconcile periodically against
  `GET /transactions` or `GET /withdraw/verify/{tnxRef}`.
- **Respond `2xx` within seconds.** Persist to a queue and return `200` immediately; never
  do bank calls or blockchain lookups inline.
- **Handle duplicates idempotently.** Key processing on `data.transactionId` plus `event`.
- **Always verify the signature.** Anyone who discovers the URL can POST fake events.

## Bridge completion callback

Separate from event webhooks, `POST /bridge` accepts a per-request `callbackUrl`. When the
bridged cNGN is minted on the destination network, cNGN POSTs a one-time notification:

```json
{
  "explorerLink": "https://basescan.org/tx/0x4a5b...e9f0",
  "hash": "0x4a5b...e9f0",
  "transactionId": "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f",
  "status": "completed",
  "amount": "100000.00"
}
```

This callback is **not signed** and times out after 4.5 seconds. Treat it purely as a hint
to check state; confirm via `GET /transactions` before crediting anything.
