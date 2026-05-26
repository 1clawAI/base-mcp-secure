/**
 * OneclawIntentsWalletProvider — replaces AgentKit's local signer with
 * 1Claw's Intents API (TEE-backed transaction signing).
 *
 * The seed phrase never leaves the TEE. All signing happens server-side
 * with full guardrail enforcement (allowlists, value caps, daily limits,
 * simulation, idempotency).
 */

import { OneclawClient } from "@1claw/sdk";
import { randomUUID } from "crypto";

export interface IntentsWalletConfig {
  apiUrl?: string;
  agentId?: string;
  agentApiKey?: string;
  /** Chain name for signing (default: "base") */
  chain?: string;
  /** Chain ID (default: 8453 for Base mainnet) */
  chainId?: number;
  /** Run Tenderly simulation before every broadcast */
  simulateFirst?: boolean;
}

export interface TransactionRequest {
  to: string;
  value?: string;
  data?: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: number;
}

export interface TransactionResult {
  txHash: string;
  status: string;
  signedTx?: string;
  simulationResult?: unknown;
}

export interface SignMessageResult {
  signature: string;
  messageHash: string;
  from: string;
}

export class OneclawIntentsWalletProvider {
  private client: OneclawClient;
  private agentId: string;
  private chain: string;
  private chainId: number;
  private simulateFirst: boolean;
  private _address?: string;

  constructor(config: IntentsWalletConfig) {
    const apiUrl = config.apiUrl || process.env.ONECLAW_API_URL || "https://api.1claw.xyz";
    const agentId = config.agentId || process.env.ONECLAW_AGENT_ID;
    const apiKey = config.agentApiKey || process.env.ONECLAW_AGENT_API_KEY;

    if (!agentId || !apiKey) {
      throw new Error(
        "OneclawIntentsWalletProvider requires agentId and agentApiKey"
      );
    }

    this.client = new OneclawClient({
      baseUrl: apiUrl,
      agentId,
      apiKey,
    });

    this.agentId = agentId;
    this.chain = config.chain || "base";
    this.chainId = config.chainId || 8453;
    this.simulateFirst = config.simulateFirst ?? true;
  }

  async getAddress(): Promise<string> {
    if (this._address) return this._address;

    const agent = await this.client.agents.get(this.agentId);
    const signingKey = agent.signing_keys?.find(
      (k: { chain: string; is_active: boolean }) =>
        k.chain === this.chain && k.is_active
    );

    if (signingKey?.address) {
      this._address = signingKey.address;
    } else if (agent.evm_address) {
      this._address = agent.evm_address;
    } else {
      throw new Error(
        `No signing key found for chain "${this.chain}". ` +
          `Provision one with: POST /v1/agents/${this.agentId}/signing-keys { "chain": "${this.chain}" }`
      );
    }

    return this._address;
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResult> {
    const idempotencyKey = randomUUID();

    const resp = await this.client.agents.submitTransaction(this.agentId, {
      chain: this.chain,
      chain_id: this.chainId,
      to: tx.to,
      value_wei: tx.value || "0",
      data: tx.data,
      max_fee_per_gas: tx.maxFeePerGas,
      max_priority_fee_per_gas: tx.maxPriorityFeePerGas,
      nonce: tx.nonce,
      simulate_first: this.simulateFirst,
      idempotency_key: idempotencyKey,
    });

    return {
      txHash: resp.tx_hash,
      status: resp.status,
      signedTx: resp.signed_tx,
      simulationResult: resp.simulation_result,
    };
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const resp = await this.client.agents.signIntent(this.agentId, {
      intent_type: "transaction",
      chain: this.chain,
      chain_id: this.chainId,
      to: tx.to,
      value_wei: tx.value || "0",
      data: tx.data,
      max_fee_per_gas: tx.maxFeePerGas,
      max_priority_fee_per_gas: tx.maxPriorityFeePerGas,
      nonce: tx.nonce,
    });

    return resp.signed_tx;
  }

  async signMessage(message: string): Promise<SignMessageResult> {
    const hex = Buffer.from(message, "utf-8").toString("hex");

    const resp = await this.client.agents.signIntent(this.agentId, {
      intent_type: "personal_sign",
      chain: this.chain,
      message: hex,
    });

    return {
      signature: resp.signature,
      messageHash: resp.message_hash,
      from: resp.from,
    };
  }

  async simulateTransaction(tx: TransactionRequest) {
    return this.client.agents.simulateTransaction(this.agentId, {
      chain: this.chain,
      chain_id: this.chainId,
      to: tx.to,
      value_wei: tx.value || "0",
      data: tx.data,
    });
  }

  getChain(): string {
    return this.chain;
  }

  getChainId(): number {
    return this.chainId;
  }
}

/**
 * Factory for creating providers with common presets.
 */
export function createBaseMainnetProvider(
  config?: Partial<IntentsWalletConfig>
): OneclawIntentsWalletProvider {
  return new OneclawIntentsWalletProvider({
    chain: "base",
    chainId: 8453,
    simulateFirst: true,
    ...config,
  });
}

export function createBaseSepoliaProvider(
  config?: Partial<IntentsWalletConfig>
): OneclawIntentsWalletProvider {
  return new OneclawIntentsWalletProvider({
    chain: "base",
    chainId: 84532,
    simulateFirst: false,
    ...config,
  });
}
