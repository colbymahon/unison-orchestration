import {
  BASE_BUILDER_DATA_SUFFIX,
  BASE_USDC_ADDRESS,
} from "./constants.js";
import type { PaymentSettler, X402PaymentTerms } from "./types.js";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Parse the edge Worker's `Payment-Required` header.
 * Format: `network=base; token=USDC; amount=0.005; destination=0x…`
 */
export function parsePaymentRequired(headerValue: string | null): X402PaymentTerms | null {
  if (!headerValue?.trim()) return null;

  const terms: Record<string, string> = {};
  for (const part of headerValue.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    terms[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }

  const destination = terms.destination ?? "";
  const amount = terms.amount ?? "";
  if (!destination || !amount) return null;

  return {
    network: terms.network ?? "base",
    token: terms.token ?? "USDC",
    amount,
    destination,
  };
}

function appendBuilderSuffix(data: `0x${string}`): `0x${string}` {
  const raw = data.slice(2) + BASE_BUILDER_DATA_SUFFIX;
  return `0x${raw}` as `0x${string}`;
}

/**
 * viem-backed payment settler — broadcasts USDC on Base, returns tx hash for replay.
 * Requires optional peer dependency: `npm install viem`
 */
export function createRpcPaymentSettler(options: {
  privateKey: string;
  rpcUrl: string;
  usdcAddress?: string;
}): PaymentSettler {
  const usdc = (options.usdcAddress ?? BASE_USDC_ADDRESS) as `0x${string}`;
  const key = options.privateKey.trim() as `0x${string}`;

  return async (terms: X402PaymentTerms): Promise<string> => {
    const { createPublicClient, createWalletClient, encodeFunctionData, http, parseUnits } =
      await import("viem");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { base } = await import("viem/chains");

    const transport = http(options.rpcUrl);
    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: base, transport });
    const wallet = createWalletClient({
      account,
      chain: base,
      transport,
    });

    const calldata = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [
        terms.destination as `0x${string}`,
        parseUnits(terms.amount, 6),
      ],
    });

    const txHash = await wallet.sendTransaction({
      to: usdc,
      data: appendBuilderSuffix(calldata),
      gas: 100_000n,
      chain: base,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("USDC settlement transaction reverted");
    }

    return txHash;
  };
}

/** Resolve a payment settler from standard Unison agent environment variables. */
export function paymentSettlerFromEnv(): PaymentSettler | undefined {
  const privateKey =
    process.env.UNISON_AGENT_PRIVATE_KEY?.trim() ||
    process.env.UNISON_PRIVATE_KEY?.trim();
  const rpcUrl =
    process.env.UNISON_BASE_RPC_URL?.trim() ||
    process.env.BASE_RPC_URL?.trim();

  if (!privateKey || !rpcUrl) return undefined;

  return createRpcPaymentSettler({ privateKey, rpcUrl });
}

export { BASE_USDC_ADDRESS };
