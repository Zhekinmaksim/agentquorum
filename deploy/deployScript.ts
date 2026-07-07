/**
 * AgentQuorum - GenLayer tribunal deploy
 * ------------------------------------------------------------------
 * Follows the genlayer-project-boilerplate convention: `genlayer deploy`
 * runs this script. You can also run it directly:
 *   node --import tsx deploy/deployScript.ts
 *
 * Develop against Studio first. The installed genlayer-js version does not
 * export a dedicated studionet chain, so we use localnet plus an overridden
 * RPC endpoint from GENLAYER_RPC_URL.
 *
 * Verify field names against the current genlayer-js: deployContract args and
 * the receipt's contract-address field have moved between versions.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, createAccount } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

async function main() {
  const account = createAccount(process.env.GENLAYER_PRIVATE_KEY as `0x${string}`);
  const client = createClient({
    chain: localnet,
    endpoint: process.env.GENLAYER_RPC_URL,
    account,
  });

  // Required before any deploy/interaction per the genlayer-js docs.
  await client.initializeConsensusSmartContract();

  const code = readFileSync(resolve("genlayer/tribunal.py"), "utf8");

  // The tribunal constructor takes the discovery worker address. It must be
  // the same address that the escrow releases evidence keys to.
  const discoveryWorker = process.env.WORKER_ADDRESS as `0x${string}`;
  if (!discoveryWorker) throw new Error("set WORKER_ADDRESS in .env");

  console.log("Deploying ConfidentialTribunal to studionet ...");
  const txHash = await client.deployContract({
    code,
    args: [discoveryWorker],
  }) as `0x${string}` & { length: 66 };

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
  });

  // Field name varies by SDK version; log the receipt if this is undefined.
  const address =
    (receipt as any)?.data?.contract_address ??
    (receipt as any)?.contractAddress;

  console.log("Tribunal deployed.");
  console.log("Set TRIBUNAL_ADDRESS in .env to:", address ?? "(see receipt below)");
  if (!address) console.dir(receipt, { depth: 4 });
}

main().catch((e) => { console.error(e); process.exit(1); });
