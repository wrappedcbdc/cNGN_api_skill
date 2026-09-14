# cNGN networks and contract addresses

Endpoints that move value on-chain (`POST /withdraw`, `POST /bridge`, `POST /whitelist`)
identify the target chain with a **`networkId`**.

## Contents

- [Resolving a networkId](#resolving-a-networkid)
- [Supported chains](#supported-chains)
- [Token contract addresses](#token-contract-addresses)

## Resolving a networkId

Network IDs are environment-specific database identifiers, not fixed enums. Test and live
have different IDs for the same chain. Fetch them at runtime:

```bash
curl -X GET "https://api.cngn.co/v1/api/networks" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Decrypted payload:

```json
[
  {
    "id": "9b2e6a1f-3c4d-4e5f-8a7b-1c2d3e4f5a6b",
    "name": "Base",
    "short_name": "BASE",
    "isDisabled": false,
    "blockchain": null
  }
]
```

Resolve by `short_name`, cache the map per environment for hours, and skip entries where
`isDisabled` is `true`. Pass `?includeBlockchain=true` for underlying blockchain metadata.

```typescript
async function resolveNetworkId(shortName: string): Promise<string> {
  const networks = await getNetworks();           // decrypted GET /networks payload
  const match = networks.find(
    (n) => n.short_name.toUpperCase() === shortName.toUpperCase() && !n.isDisabled,
  );
  if (!match) throw new Error(`Network ${shortName} is unavailable in this environment`);
  return match.id;
}
```

A stored `networkId` can go stale: a network may be disabled after you cached it. When
listing saved addresses or networks to a user, intersect the stored `networkId` values
with the current `GET /networks` response and show only what is still active.

## Supported chains

cNGN supports EVM chains (Ethereum, BNB Smart Chain, Polygon, Base, Asset Chain, Lisk,
Celo), Solana, Tron, and Bantu (XBN). The authoritative list for your environment is
always the `GET /networks` response: a contract existing on a chain does not mean
withdrawals and bridging are enabled for it.

## Token contract addresses

Use these when adding cNGN to wallets, indexing transfers, or interacting with the token
on-chain. Only trust addresses published here or on the official
[cNGN website](https://cngn.co); scammers deploy look-alike tokens. Verify the full
address, never just the ticker.

### Mainnet

| Network | Type | Contract address |
| --- | --- | --- |
| Bantu | Stellar-based | `GD6G2NT7CQHPIYHA52KZHWB6ONNWTSGZOOLTRLRASENM2VWSF6CHYFRX` |
| Asset Chain | EVM | `0x7923C0f6FA3d1BA6EAFCAedAaD93e737Fd22FC4F` |
| BNB Chain | EVM | `0xa8AEA66B361a8d53e8865c62D142167Af28Af058` |
| Ethereum | EVM | `0x17CDB2a01e7a34CbB3DD4b83260B05d0274C8dab` |
| Polygon | EVM | `0x52828daa48C1a9A06F37500882b42daf0bE04C3B` |
| Base | EVM | `0x46C85152bFe9f96829aA94755D9f915F9B10EF5F` |
| Solana | SPL | `3jiqwBQVRC5zRwHyqvnkQurebJ5RNxg3F5fXMwaxgkv8` |
| Lisk | EVM | `0xC7aB2C35Ea37236e644C24A4E4a1911c082887c0` |
| Celo | EVM | `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f` |
| Monad | EVM | Not yet deployed |
| Arc | EVM | Not yet deployed |

### Testnet

| Network | Type | Contract address |
| --- | --- | --- |
| Bantu | Stellar-based | `GAE7E56N3XIC6JGJI54SD3VN4EDY3OZVFA7CLHXAMMTHLU4LIFYJMFSI` |
| Asset Chain | EVM | `0x00F0a33d9AFaC108A4963D4Cb4Ef6A9C6B8D8859` |
| BNB Chain | EVM | `0x8a078b182bA9649c03982c2a80CDcc81cdc99dA8` |
| Ethereum | EVM | `0xF55E56423e6b50808fD07cB62b6A32B91903f50E` |
| Polygon | EVM | `0xf24B1Cee8cA70341FcefBCa10e7e4Db9A4896486` |
| Base | EVM | `0xEFdF04BAfE0ebabb5F5cD9e3f36564f51CFe1530` |
| Solana | SPL | `HfJWS8vJHvxKn5xW3uLXkTmEy4jny3G45QnS1Eab5sg` |
| Lisk | EVM | `0x999E3A32eF3F9EAbF133186512b5F29fADB8a816` |
| Celo | EVM | `0xa188439ccCEe9A6aa0E842f9c17C1b00C7B4dd4D` |
| Monad | EVM | `0x4F90098BA5b08ABAf039b95A851F8e764EB84b49` |
| Arc | EVM | `0x1716Df6A18DcFF031BFD209aDB8035174AdC0D31` |

Mainnet and testnet addresses are different contracts. A testnet address holds no real
value and will not work on mainnet. Match the contract to the environment of your API key:
a `cngn_test` integration should touch testnet contracts only.
