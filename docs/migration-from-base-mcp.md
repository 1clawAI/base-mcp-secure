# Migration from Base MCP

This guide shows how to move from a standard `base-mcp` setup (with secrets in `.env` or `claude_desktop_config.json`) to `@1claw/base-mcp-secure` in under 10 minutes.

## Before: Insecure Setup

Your current `claude_desktop_config.json` probably looks like this:

```json
{
  "mcpServers": {
    "base-mcp": {
      "command": "npx",
      "args": ["-y", "@coinbase/base-mcp"],
      "env": {
        "SEED_PHRASE": "abandon ability able about above absent absorb ...",
        "COINBASE_API_KEY_NAME": "organizations/xxx/apiKeys/yyy",
        "COINBASE_API_PRIVATE_KEY": "-----BEGIN EC PRIVATE KEY-----\nMHQ...",
        "ALCHEMY_API_KEY": "abcdef123456",
        "OPENROUTER_API_KEY": "sk-or-v1-...",
        "NEYNAR_API_KEY": "NEYNAR-..."
      }
    }
  }
}
```

**Problems:**
- Seed phrase in plaintext on disk
- Private keys readable by any process with file access
- No transaction limits — a prompt injection can drain the wallet
- No audit trail of agent actions
- No way to revoke access without deleting the config

## After: Secured Setup

```json
{
  "mcpServers": {
    "base-mcp-secure": {
      "command": "npx",
      "args": ["@1claw/base-mcp-secure"],
      "env": {
        "ONECLAW_AGENT_API_KEY": "ocv_your_agent_key"
      }
    }
  }
}
```

**One env var. Zero secrets on disk.**

## Migration Steps

### Step 1: Create a 1Claw Account (2 min)

```bash
# Sign up at https://1claw.xyz or use the CLI
npx @1claw/cli login
```

### Step 2: Create a Vault and Store Your Secrets (3 min)

```bash
# Create a vault for Base MCP secrets
npx @1claw/cli vault create --name "base-mcp-keys"

# Store each secret (they get encrypted with HSM-backed envelope encryption)
npx @1claw/cli secret put base-mcp/seed-phrase --value "your seed phrase here"
npx @1claw/cli secret put base-mcp/coinbase-api-key-name --value "organizations/xxx/apiKeys/yyy"
npx @1claw/cli secret put base-mcp/coinbase-api-private-key --value "-----BEGIN EC PRIVATE KEY-----..."
npx @1claw/cli secret put base-mcp/alchemy-api-key --value "abcdef123456"
npx @1claw/cli secret put base-mcp/openrouter-api-key --value "sk-or-v1-..."
npx @1claw/cli secret put base-mcp/neynar-api-key --value "NEYNAR-..."
```

### Step 3: Register an Agent (2 min)

```bash
# Create an agent with Base-specific guardrails
npx @1claw/cli agent create \
  --name "base-mcp-agent" \
  --intents-api \
  --shroud \
  --tx-allowed-chains "base" \
  --tx-max-value "0.1" \
  --tx-daily-limit "1.0"
```

Save the `ocv_` API key that's returned — this is the only credential you put in your config.

### Step 4: Create an Access Policy (1 min)

```bash
npx @1claw/cli policy create \
  --vault-id YOUR_VAULT_ID \
  --principal-type agent \
  --principal-id YOUR_AGENT_ID \
  --paths "base-mcp/*" \
  --permissions read
```

### Step 5: Update Your Config (1 min)

Replace your `claude_desktop_config.json` MCP entry:

```json
{
  "mcpServers": {
    "base-mcp-secure": {
      "command": "npx",
      "args": ["@1claw/base-mcp-secure"],
      "env": {
        "ONECLAW_AGENT_API_KEY": "ocv_your_agent_key"
      }
    }
  }
}
```

### Step 6: Delete Your Old .env File

```bash
# Once you've confirmed the secured setup works:
rm .env
# Remove secrets from claude_desktop_config.json
```

## What Changed

| Aspect | Before | After |
|--------|--------|-------|
| Seed phrase location | `.env` file on disk | 1Claw Vault (HSM-encrypted, MPC optional) |
| Transaction signing | Local (unguarded) | TEE (guardrails enforced) |
| Daily spend limit | None | Configurable (default: 1 ETH) |
| Address allowlist | None | Configurable |
| Prompt injection defense | None | Shroud 11-layer pipeline |
| Audit trail | None | Full, hash-chained, tamper-evident |
| Access revocation | Delete config file | Instant via policy deletion or JWT revocation |
| Key rotation | Manual, risky | One CLI command |

## Optional: Enable Shroud LLM Proxy

For defense against prompt injection via Farcaster bios, tool results, or malicious contexts:

```bash
npx @1claw/cli agent update YOUR_AGENT_ID --shroud true
```

This routes all LLM calls through Shroud's inspection pipeline before they reach the model, blocking injection attempts in real time.

## Rollback

If you need to go back temporarily, just swap your MCP config entry back to `@coinbase/base-mcp` with the env vars. Your secrets remain safely stored in 1Claw for when you're ready to switch back.
