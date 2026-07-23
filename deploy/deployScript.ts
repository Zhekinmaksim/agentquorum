/**
 * AgentQuorum - GenLayer tribunal deploy
 * ------------------------------------------------------------------
 * Follows the genlayer-project-boilerplate convention: `genlayer deploy`
 * runs this script. You can also run it directly:
 *   node --import tsx deploy/deployScript.ts
 *
 * Deploys to the configured GenLayer network. By default we target Bradbury
 * for production-like behavior, but GENLAYER_NETWORK / GENLAYER_RPC_URL can
 * override that for studionet or local development.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, createAccount } from "genlayer-js";
import { TransactionStatus } from "genlayer-js/types";
import { getGenLayerChain, getGenLayerNetworkName } from "../offchain/genlayer-network.js";

async function main() {
  const account = createAccount(process.env.GENLAYER_PRIVATE_KEY as `0x${string}`);
  const client = createClient({
    chain: getGenLayerChain(),
    account,
  });

  // Required before any deploy/interaction per the genlayer-js docs.
  await client.initializeConsensusSmartContract();

  const code = readFileSync(resolve("genlayer/tribunal.py"), "utf8");

  // The tribunal constructor takes the discovery worker address. It must be
  // the same address that the escrow releases evidence keys to.
  const discoveryWorker = process.env.WORKER_ADDRESS as `0x${string}`;
  if (!discoveryWorker) throw new Error("set WORKER_ADDRESS in .env");

  console.log(`Deploying ConfidentialTribunal to ${getGenLayerNetworkName()} ...`);
  const txHash = await client.deployContract({
    code,
    args: [discoveryWorker],
  }) as `0x${string}` & { length: 66 };

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.ACCEPTED,
  });
  const tx = await client.getTransaction({ hash: txHash }) as any;

  // Field name varies by SDK version; log the receipt if this is undefined.
  const address =
    tx?.txDataDecoded?.contractAddress ??
    (receipt as any)?.data?.contract_address ??
    (receipt as any)?.contractAddress;

  console.log("Tribunal deployed.");
  console.log("Set TRIBUNAL_ADDRESS in .env to:", address ?? "(see receipt below)");
  console.log("Status:", tx?.statusName ?? (receipt as any)?.statusName ?? "unknown");
  if (!address) {
    console.dir(receipt, { depth: 4 });
    console.dir(tx, { depth: 4 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
