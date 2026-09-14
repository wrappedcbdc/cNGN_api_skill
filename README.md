# cNGN API skill

An agent skill for building on the [cNGN](https://cngn.co) stablecoin API
(`https://api.cngn.co/v1/api`). It packages the integration knowledge that coding agents
otherwise get wrong: that payloads are encrypted in both directions, that `networkId`
values are environment-specific, and that money-moving endpoints must not be retried
blindly.

Distributed as a **Claude Code plugin**, and usable by **any agent** that reads
`AGENTS.md` or plain Markdown.

## Contents

```
.claude-plugin/
  plugin.json            Claude Code plugin manifest
  marketplace.json       Lets this repo act as a single-plugin marketplace
skills/cngn-api/
  SKILL.md               Overview, rules, workflows, endpoint index
  reference/
    endpoints.md         Every endpoint: parameters, payload shapes, examples
    encryption.md        AES-256-CBC requests, Ed25519 responses, in TS/Python/PHP
    webhooks.md          Five event types, payloads, signature verification
    errors.md            Error messages, causes, retry policy
    networks.md          networkId resolution and token contract addresses
  scripts/
    cngn_crypto.py       Encrypt a body / decrypt a response from the CLI
    cngn_crypto.ts       Same, for Node, plus a minimal typed client
openapi/
  cngn-v1.yaml           OpenAPI 3.1 description of the wire format and payload schemas
AGENTS.md                Entry point for non-Claude agents
```

## Install for Claude Code

From a checkout, or straight from the hosted repository:

```
/plugin marketplace add <owner>/cngn-api-skill
/plugin install cngn-api@cngn-skills
```

The skill then activates on its own whenever a task mentions cNGN, `cngn_test` /
`cngn_live` keys, or Naira stablecoin payouts. Invoke it explicitly with `/cngn-api`.

For local development, point the marketplace at the directory instead:

```
/plugin marketplace add ./cngn-api-skill
```

## Use with other agents

The skill body and every reference file are plain Markdown with no tool-specific syntax,
so any agent can consume them.

| Agent | How |
| --- | --- |
| OpenAI Codex, Cursor, Gemini CLI, Aider, Jules | They read `AGENTS.md` from the repository root. Vendor this repo into your project, or copy `AGENTS.md` and `skills/cngn-api/` into it. |
| Claude API / claude.ai | Zip `skills/cngn-api/` and upload it as a Skill; `SKILL.md` already carries the required `name` and `description` frontmatter. |
| GitHub Copilot | Copy the "Non-negotiables" section of `AGENTS.md` into `.github/copilot-instructions.md`. |
| Anything with tool/function calling | Load `openapi/cngn-v1.yaml`. It describes the encrypted wire format, and names the decrypted payload schema for each operation via `x-cngn-plaintext-request` / `x-cngn-plaintext-response`. |
| No agent at all | The reference files are readable documentation on their own. |

## Utility scripts

```bash
# Encrypt a request body into the {content, iv} wire format
python3 skills/cngn-api/scripts/cngn_crypto.py encrypt '{"amount":1000}' -

# Decrypt a response `data` field
python3 skills/cngn-api/scripts/cngn_crypto.py decrypt "<base64 data>" ./cngn_api_key

# Confirm an encryption key round-trips before debugging anything else
python3 skills/cngn-api/scripts/cngn_crypto.py selftest -
```

Passing `-` as the key reads `CNGN_ENCRYPTION_KEY` from the environment so the secret
stays out of shell history. Python needs `pip install cryptography pynacl`; the
TypeScript equivalent needs `npm install libsodium-wrappers`.

## Source and maintenance

Content is derived from the [cNGN API documentation](https://api.cngn.co) source
(`docs_cNGN_api`), which is in turn documented from the cNGN v2 backend's third-party
router. When endpoints change:

1. Update the matching page under `docs_cNGN_api/api-reference/`.
2. Update `skills/cngn-api/reference/endpoints.md` and `openapi/cngn-v1.yaml` here.
3. Bump `version` in both `.claude-plugin/plugin.json` and
   `.claude-plugin/marketplace.json`.

Keep `SKILL.md` under 500 lines and keep reference links one level deep from it; agents
read linked files on demand, and deeper nesting causes partial reads.

## Security

This repository contains no credentials and never should. API keys, encryption keys, and
Ed25519 private keys are server-side secrets belonging to a merchant account; keep them in
a secrets manager.

## License

MIT. See [LICENSE](LICENSE).
