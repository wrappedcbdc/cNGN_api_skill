# cNGN endpoint reference

Base URL: `https://api.cngn.co/v1/api`. Every request needs
`Authorization: Bearer <cngn_test…|cngn_live…>` and a whitelisted source IP.

All request bodies shown here are the **plain payload before encryption**. On the wire a
body is `{"content": "<base64 ciphertext>", "iv": "<base64 IV>"}`. All responses shown are
the **decrypted** contents of `data`; on the wire `data` is an encrypted base64 string.
See [encryption.md](encryption.md).

## Contents

- [Wallet: get balance, get transactions](#wallet)
- [Networks: get networks](#networks)
- [Deposits: get virtual account, create temporary virtual account](#deposits)
- [Redemptions: redeem asset, verify account details, get banks, update bank account](#redemptions)
- [On-chain transfers: withdraw, verify withdrawal, bridge quote, bridge](#on-chain-transfers)
- [Whitelisting: whitelist address, get whitelisted addresses](#address-whitelisting)
- [Pagination](#pagination)
- [Permissions summary](#permissions-summary)

---

## Wallet

### GET /balance

Returns the cNGN balances held by your business. No parameters, no body, so this is the
easiest call to verify credentials with.

Decrypted `data` is an array of balance objects:

| Field | Type | Description |
| --- | --- | --- |
| `asset_type` | string | Asset classification, for example `credit_alphanum4` |
| `asset_code` | string | Asset ticker, `CNGN` |
| `balance` | string | Available balance as a decimal string |

```bash
curl -X GET "https://api.cngn.co/v1/api/balance" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

```json
{
  "status": 200,
  "message": "Balance fetched successfully",
  "data": [
    { "asset_type": "credit_alphanum4", "asset_code": "CNGN", "balance": "150000.00" }
  ]
}
```

Balances are decimal **strings**. Parse them with a decimal type, never a float.

### GET /transactions

Paginated history of deposits, withdrawals, redemptions, and bridges, newest first.

Query parameters: `page` (default `1`), `limit` (default `10`).

Decrypted `data` is `{ data: Transaction[], pagination: Pagination }`.

**Transaction object:**

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique transaction ID |
| `from` | string | Sender identifier or address |
| `receiver` | object | `{address}` for on-chain, `{bank, accountNumber}` for fiat |
| `amount` | string | Amount as a decimal string |
| `description` | string | Human-readable description |
| `createdAt` | string | ISO 8601 timestamp |
| `trx_ref` | string | Transaction reference; use with `/withdraw/verify/{tnxRef}` |
| `trx_type` | string | `deposit`, `withdrawal`, `redeem`, `swap` |
| `network` | string | Network the transaction executed on |
| `asset_type` | string | Asset classification |
| `asset_symbol` | string | `CNGN` |
| `base_trx_hash` | string \| null | Hash on the origin/issuing network |
| `extl_trx_hash` | string \| null | Hash on the external/destination network |
| `explorer_link` | string \| null | Block explorer URL |
| `status` | string | `pending`, `success`, `failed` |

```bash
curl -X GET "https://api.cngn.co/v1/api/transactions?page=1&limit=10" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

```json
{
  "status": 200,
  "message": "Transactions fetched successfully",
  "data": {
    "data": [
      {
        "id": "9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
        "from": "Acme Ltd",
        "receiver": { "address": "0x8Ba1f109551bD432803012645Ac136ddd64DBA72" },
        "amount": "25000.00",
        "description": "Withdrawal to external wallet",
        "createdAt": "2026-07-20T14:32:11.000Z",
        "trx_ref": "WD-7f3a2b1c",
        "trx_type": "withdrawal",
        "network": "Base",
        "asset_type": "credit_alphanum4",
        "asset_symbol": "CNGN",
        "base_trx_hash": "0x4a5b...e9f0",
        "extl_trx_hash": null,
        "explorer_link": "https://basescan.org/tx/0x4a5b...e9f0",
        "status": "success"
      }
    ],
    "pagination": {
      "count": 42, "pages": 5, "isLastPage": false, "nextPage": 2, "previousPage": null
    }
  }
}
```

Use a higher `limit` rather than many small pages; the rate limit is 20 requests per
60 seconds.

---

## Networks

### GET /networks

Lists networks available for withdrawals, bridging, and whitelisting. The `id` of each
entry is the `networkId` other endpoints expect.

Query parameters: `includeBlockchain` (boolean, default `false`).

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Network ID; pass as `networkId` elsewhere |
| `name` | string | Full network name |
| `short_name` | string | Short code, for example `BASE`, `BSC` |
| `isDisabled` | boolean | Disabled networks cannot be used for transfers |
| `blockchain` | object \| null | Blockchain metadata when `includeBlockchain=true` |

```json
{
  "status": 200,
  "message": "Supported networks fetched successfully",
  "data": [
    {
      "id": "9b2e6a1f-3c4d-4e5f-8a7b-1c2d3e4f5a6b",
      "name": "Base",
      "short_name": "BASE",
      "isDisabled": false,
      "blockchain": null
    }
  ]
}
```

IDs differ between test and live. Resolve them per environment and filter out
`isDisabled: true`. See [networks.md](networks.md).

---

## Deposits

### GET /virtual-account

**Permission: Fiat Deposit.** Returns the dedicated virtual bank account(s) assigned to
your business. Naira transferred in is converted and credited as cNGN.

| Field | Type | Description |
| --- | --- | --- |
| `accountNumber` | string | 10-digit NUBAN |
| `accountName` | string | Your registered business name |
| `bankName` | string | Bank hosting the virtual account |
| `bankCode` | string | CBN bank code |

```json
{
  "status": 200,
  "message": "Virtual account created successfully",
  "data": [
    {
      "accountNumber": "9977581222",
      "accountName": "ACME LTD / CNGN",
      "bankName": "Providus Bank",
      "bankCode": "101"
    }
  ]
}
```

### POST /virtual-account/temporary

**Permission: Fiat Deposit. Encrypted body.** Creates a short-lived account tied to one
expected amount, for checkout flows where each payment needs its own account number.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `amount` | number | yes | Expected deposit in Naira; minimum `100` |
| `customer` | object | yes | `{email (required), name}` |
| `accountName` | string | no | Display name, 3–50 characters |
| `narration` | string | no | Max 100 characters |

```json
{
  "amount": 50000,
  "customer": { "name": "Ada Obi", "email": "ada@example.com" },
  "accountName": "Acme Checkout",
  "narration": "Order #1042"
}
```

Decrypted response: `reference`, `paymentReference`, `amount`, `amountExpected` (total
including fees), `fee`, `vat`, `currency` (`NGN`), `status`, `narration`, `accountNumber`,
`accountName`, `bankName`, `bankCode`, `expiresAt`.

```json
{
  "status": 200,
  "message": "Temporary virtual account created successfully",
  "data": {
    "reference": "DEP-8c1f2a9b",
    "paymentReference": "PAY-55aa66bb",
    "amount": 50000,
    "amountExpected": 50075,
    "fee": 70,
    "vat": 5,
    "currency": "NGN",
    "status": "pending",
    "narration": "Order #1042",
    "accountNumber": "8801234567",
    "accountName": "Acme Checkout",
    "bankName": "Wema Bank",
    "bankCode": "035",
    "expiresAt": "2026-07-22T18:45:00.000Z"
  }
}
```

Deposits arriving after `expiresAt` are not credited. Show the payer `amountExpected`, not
`amount`, when fees are passed on.

---

## Redemptions

### POST /redeemAsset

**Permission: Redeem. Encrypted body.** Burns cNGN and pays the equivalent Naira to a bank
account. Verify the destination with `/account/verify` first.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `amount` | number | yes | cNGN to redeem; minimum `1` |
| `bankCode` | string | yes | CBN code from `GET /banks` |
| `accountNumber` | string | yes | 10 digits |
| `saveDetails` | boolean | no | Save the bank details for future redemptions |

```json
{
  "status": 200,
  "message": "Deposit for redeem was successfully",
  "data": {
    "trxRef": "RD-3e7a91cf",
    "address": "0x1fA2b3C4d5E6f7A8b9C0d1E2f3A4b5C6d7E8f9A0"
  }
}
```

Track `trxRef` via `GET /transactions` or the `redemption.completed` webhook. A failed
payout reverts the cNGN to your balance automatically and fires `transaction.failed`.

### POST /account/verify

**Encrypted body.** Resolves a Nigerian bank account to its registered name. Call it
before `/redeemAsset` or `/bank-account` and surface the name for human confirmation.

Body: `{bankCode, accountNumber}`, both required.

```json
{
  "status": 200,
  "message": "Account details verified successfully",
  "data": { "accountNumber": "0123456789", "accountName": "ADA OBI", "bankCode": "058" }
}
```

An unresolvable account returns `400 Could not resolve account details`.

### GET /banks

Supported banks with their CBN codes. Cache for hours.

```json
{
  "status": 200,
  "message": "Banks fetched successfully",
  "data": [
    { "name": "Access Bank", "code": "044" },
    { "name": "Guaranty Trust Bank", "code": "058" },
    { "name": "United Bank for Africa", "code": "033" },
    { "name": "Zenith Bank", "code": "057" }
  ]
}
```

### PUT /bank-account

**Encrypted body.** Updates the settlement bank account for your business.

Body: `{bankName, bankAccountName, bankAccountNumber}`, all required. Note these field
names differ from the `bankCode`/`accountNumber` pair used by `/redeemAsset` and
`/account/verify`.

```json
{
  "status": 200,
  "message": "Bank account updated successfully",
  "data": {
    "bankName": "Guaranty Trust Bank",
    "bankAccountName": "ACME LTD",
    "bankAccountNumber": "0123456789"
  }
}
```

---

## On-chain transfers

### POST /withdraw

**Permission: Send Crypto. Encrypted body.** Sends cNGN from your balance to an external
wallet.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `amount` | number | yes | cNGN to withdraw |
| `address` | string | yes | Destination wallet on the target network |
| `networkId` | string | yes | From `GET /networks` |
| `shouldSaveAddress` | boolean | no | Default `false` |

Depending on your account configuration the destination may need to be whitelisted first
via `POST /whitelist`.

```json
{
  "status": 200,
  "message": "Withdrawal was successfully",
  "data": {
    "trxRef": "WD-7f3a2b1c",
    "address": "0x8Ba1f109551bD432803012645Ac136ddd64DBA72"
  }
}
```

### GET /withdraw/verify/{tnxRef}

Returns the full transaction record for a withdrawal, same shape as a `/transactions`
item. Path parameter `tnxRef` is the `trxRef` returned by `/withdraw`.

Poll with exponential backoff, not a tight loop. Unknown references return
`400 Transaction not found`.

### POST /bridge-quote

**Permission: Swap. Encrypted body.** Fees and receivable amount for a bridge, before
committing.

Body: `{amount, originNetworkId, destinationNetworkId, destinationAddress}`, all required.

```json
{
  "status": 200,
  "message": "Swap quote fetched successfully",
  "data": {
    "amountReceivable": "99750.00",
    "networkFee": "150.00",
    "bridgeFee": "100.00"
  }
}
```

### POST /bridge

**Permission: Swap. Encrypted body.** Moves cNGN between networks.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `originNetworkId` | string | yes | Bridging from |
| `destinationNetworkId` | string | yes | Bridging to |
| `destinationAddress` | string | yes | Receives cNGN on the destination network |
| `senderAddress` | string | no | Address you will send from on the origin network |
| `callbackUrl` | string | no | HTTPS URL notified once when the bridge completes |

```json
{
  "status": 200,
  "message": "Swap was successfully",
  "data": {
    "receivableAddress": "0x2aB3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B1",
    "transactionId": "c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f",
    "reference": "BR-5d4c3b2a"
  }
}
```

The bridge only starts once you send cNGN to `receivableAddress` on the **origin**
network. The `callbackUrl` notification is unsigned with a 4.5 second timeout; see
[webhooks.md](webhooks.md#bridge-completion-callback).

---

## Address whitelisting

### POST /whitelist

**Encrypted body.** Registers an external wallet address against a network so it can
receive withdrawals.

Body: `{networkId, address}`, both required. Returns your full updated list.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Whitelist entry ID |
| `networkId` | string | Network the address is whitelisted on |
| `publicKey` | string | The whitelisted wallet address |
| `internalPublicKey` | string | Internal deposit address paired to this entry |
| `network` | object | `{id, name, short_name}` when included |
| `created_at` / `updated_at` | string | ISO 8601 timestamps |

```json
{
  "status": 200,
  "message": "Address whitelisted successfully",
  "data": [
    {
      "id": "7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d",
      "networkId": "9b2e6a1f-3c4d-4e5f-8a7b-1c2d3e4f5a6b",
      "publicKey": "0x8Ba1f109551bD432803012645Ac136ddd64DBA72",
      "internalPublicKey": "0x3cD4e5F6a7B8c9D0e1F2a3B4c5D6e7F8a9B0c1D2",
      "created_at": "2026-07-22T10:15:00.000Z",
      "updated_at": "2026-07-22T10:15:00.000Z"
    }
  ]
}
```

`publicKey` is the address **you** whitelisted; `internalPublicKey` is the cNGN-side
deposit address for that network. Do not confuse them when rendering a UI.

### GET /whitelisted

Every address you have whitelisted, across all networks. Query parameter
`includeNetwork` (boolean, default `false`) embeds `{id, name, short_name}` per entry.

An entry can exist for a network that has since been disabled. When listing addresses for
users, intersect this response with `GET /networks` and show only active networks.

---

## Pagination

List endpoints return:

| Field | Type | Description |
| --- | --- | --- |
| `count` | number | Total records |
| `pages` | number | Total pages |
| `isLastPage` | boolean | Whether the current page is the last |
| `nextPage` | number \| null | `null` on the last page |
| `previousPage` | number \| null | `null` on the first page |

---

## Permissions summary

A role lacking the permission gets `{"status": false, "message": "Permission denied"}`.
Permissions are managed by the organisation's administrator in the merchant dashboard.

| Permission | Endpoints |
| --- | --- |
| Fiat Deposit | `GET /virtual-account`, `POST /virtual-account/temporary` |
| Redeem | `POST /redeemAsset` |
| Send Crypto | `POST /withdraw` |
| Swap | `POST /bridge-quote`, `POST /bridge` |

Redemption and withdrawal are additionally subject to platform-level service controls. If
disabled during an incident they return
`400 Service is currently unavailable. Please try again later.`, which is transient.
