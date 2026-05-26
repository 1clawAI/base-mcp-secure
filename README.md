# @1claw/base-mcp-secure

**Run Base MCP without the .env file.**

A drop-in companion for [Base MCP](https://github.com/base/base-mcp) that keeps the full feature set — wallet ops, Morpho lending, NFT transfers, onramp, Farcaster resolution — without ever putting a seed phrase or API key on disk.

> Base MCP gives agents the keys to the chain. 1Claw makes sure the agent never actually holds them.

## The Problem

Base MCP currently tells you to paste a 12/24-word seed phrase, Coinbase API private key, Alchemy key, and OpenRouter key into either a `.env` file or — worse — into `claude_desktop_config.json` in plaintext. Then it hands the LLM `transfer-funds`, `deploy-contract`, `call_contract`, and `erc20_transfer` with no allowlists, no value caps, no simulation, and no audit trail.

One prompt injection through a poisoned Farcaster username or a malicious tool result and the wallet is gone.

## The Solution

```
Claude/Cursor ─► Shroud TEE ─► LLM ─► base-mcp-secure (Vault-bootstrapped) ─► Intents API ─► Base
```

| Surface | What it replaces | How |
|---------|-----------------|-----|
| **Vault** | The `.env` file | Secrets resolved from HSM-encrypted vault at boot. Never touch disk. MPC optional. |
| **Intents API** | Local seed signer | All signing happens in a TEE with per-agent guardrails enforced server-side. |
| **Shroud** | Nothing (new) | 11-layer inspection pipeline blocks prompt injection before the model acts. |
| **Policy Engine** | Nothing (new) | Fine-grained access control — agents only see secrets they're granted. |

## Quick Start

### 1. Install

```bash
npm install @1claw/base-mcp-secure
```

### 2. Store your secrets in 1Claw

```bash
npx @1claw/cli login
npx @1claw/cli vault create --name "base-mcp-keys"
npx @1claw/cli secret put base-mcp/seed-phrase --value "your seed phrase"
npx @1claw/cli secret put base-mcp/coinbase-api-private-key --value "-----BEGIN EC..."
npx @1claw/cli secret put base-mcp/alchemy-api-key --value "your_key"
```

### 3. Create a secured agent

```bash
npx @1claw/cli agent create \
  --name "my-base-agent" \
  --intents-api \
  --shroud \
  --tx-allowed-chains "base" \
  --tx-max-value "0.1" \
  --tx-daily-limit "1.0"
```

### 4. Update your MCP config

```json
{
  "mcpServers": {
    "base-mcp-secure": {
      "command": "npx",
      "args": ["@1claw/base-mcp-secure"],
      "env": {
        "ONECLAW_AGENT_API_KEY": "ocv_your_key_here"
      }
    }
  }
}
```

**That's it.** One env var. Zero secrets on disk.

## How It Works

### Boot sequence

1. MCP server starts
2. Authenticates to 1Claw with a short-lived JWT (from the `ocv_` API key)
3. Resolves `SEED_PHRASE`, `COINBASE_API_PRIVATE_KEY`, `ALCHEMY_API_KEY`, etc. from the vault
4. Injects credentials into process memory (never written to disk)
5. Starts the standard Base MCP server with the Intents wallet provider active

### Transaction flow

1. LLM emits `transfer-funds` tool call
2. Shroud inspects the request (injection scoring, PII detection, exfil blocking)
3. `OneclawIntentsWalletProvider` converts it to an Intents API call
4. Server-side guardrails enforce: chain allowlist, address allowlist, value cap, daily limit
5. Tenderly simulation runs (optional, default: on)
6. Transaction is signed in the TEE and broadcast to Base
7. Full audit trail recorded with hash-chain integrity

### What the agent CAN'T do (even if prompt-injected)

- Transfer to unlisted addresses (blocked by `tx_to_allowlist`)
- Exceed daily spend (blocked by `tx_daily_limit_eth`)
- Move to another chain (blocked by `tx_allowed_chains`)
- Read the seed phrase (blocked by Intents API private key gating)
- Replay a transaction (blocked by idempotency keys)

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ONECLAW_AGENT_API_KEY` | Yes | Agent API key (`ocv_` prefix) |
| `ONECLAW_AGENT_ID` | No | Explicit agent ID (auto-resolved from key if omitted) |
| `ONECLAW_API_URL` | No | API URL (default: `https://api.1claw.xyz`) |
| `ONECLAW_VAULT_ID` | No | Explicit vault ID (auto-resolved if omitted) |
| `ONECLAW_SECRET_PREFIX` | No | Vault path prefix (default: `base-mcp/`) |
| `ONECLAW_CHAIN_ID` | No | Chain ID — `84532` for Base Sepolia (default: `8453` Base mainnet) |

### Vault Secret Paths

Store secrets under `base-mcp/` (configurable via `ONECLAW_SECRET_PREFIX`):

```
base-mcp/seed-phrase
base-mcp/coinbase-api-key-name
base-mcp/coinbase-api-private-key
base-mcp/alchemy-api-key
base-mcp/openrouter-api-key
base-mcp/neynar-api-key
```

## Use as a Library

```typescript
import {
  bootstrapSecrets,
  OneclawIntentsWalletProvider,
  createBaseMainnetProvider,
} from "@1claw/base-mcp-secure";

// Resolve secrets from vault
const secrets = await bootstrapSecrets({
  agentApiKey: "ocv_...",
});

// Create a wallet provider backed by Intents API
const wallet = createBaseMainnetProvider({
  agentApiKey: "ocv_...",
  agentId: "your-agent-id",
});

// Send a transaction (TEE-signed, guardrail-enforced)
const result = await wallet.sendTransaction({
  to: "0xRecipient",
  value: "1000000000000000", // 0.001 ETH in wei
});

console.log(`TX: ${result.txHash} (${result.status})`);
```

## Examples

- [`examples/claude-desktop.json`](examples/claude-desktop.json) — Claude Desktop config with zero secrets
- [`examples/cursor.json`](examples/cursor.json) — Cursor IDE MCP config
- [`examples/morpho-yield-agent.md`](examples/morpho-yield-agent.md) — Autonomous Morpho yield agent with $50/day cap

## Docs

- [Migration from Base MCP](docs/migration-from-base-mcp.md) — Step-by-step migration guide
- [Policy Recipes](docs/policy-recipes.md) — Pre-built guardrail configs for common use cases

## Security Comparison

| Threat Vector | Base MCP | base-mcp-secure |
|--------------|----------|-----------------|
| Seed phrase on disk | `.env` / config JSON | Never touches disk (Vault + MPC) |
| Prompt injection → drain | Unguarded | Shroud blocks + guardrails cap |
| Unlimited transfers | No limits | Per-tx and daily caps |
| Cross-chain pivot | Possible | `tx_allowed_chains` enforced |
| Replay attacks | No protection | Idempotency keys |
| Credential exfil via tool result | Possible | Shroud redaction + output policy |
| Audit trail | None | Hash-chained, tamper-evident |
| Access revocation | Delete files | Instant (policy delete / JWT revoke) |
| Key rotation | Manual seed replacement | One CLI command |

## x402 Integration

This package works with 1Claw's x402 micropayment system. The agent pays per-request in USDC on Base via the Coinbase CDP facilitator. The whole loop is circular and on-chain:

```
Agent uses Base MCP to act onchain
  → pays 1Claw per-request in USDC on Base
  → signs via Intents API on Base
  → everything is on Base
```

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE).

---

Built by [1Claw](https://1claw.xyz) — AI Agent Secrets Management.
