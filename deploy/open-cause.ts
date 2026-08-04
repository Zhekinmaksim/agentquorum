/**
 * AgentQuorum - open a cause across both chains
 * ------------------------------------------------------------------
 * The two chains must agree on one cause. We bind them like this:
 *   caseId  = "AQ-<n>"                 (GenLayer tribunal, n = current count)
 *   caseKey = keccak256(utf8(caseId))  (Inco escrow, bytes32)
 *
 * Order:
 *   1. read tribunal.total_cases() -> n, so the new id is "AQ-<n>"
 *   2. derive caseKey from that id
 *   3. tribunal.open_case(terms, escrowRef=caseKey, respondent)
 *   4. escrow.openCase(caseKey, respondent, caseId)
 *
 * After this, the claimant + respondent seal evidence (offchain/seal.ts) and
 * the worker can resolve caseKey -> caseId via escrow.caseIdOf.
 *
 * Run: node --import tsx deploy/open-cause.ts --terms "..." --respondent 0x...
 * The configured GenLayer network owns AQ-n numbering. Base mirrors the same
 * caseKey so both chains stay in lockstep.
 */

import { createClient, createAccount } from "genlayer-js";
import { JsonRpcProvider, Contract, Wallet, id as keccakId } from "ethers";
import escrowAbi from "../offchain/abi/ConfidentialEscrow.json" assert { type: "json" };
import { getGenLayerChain } from "../offchain/genlayer-network.js";

type GlAddress = `0x${string}` & { length: 42 };

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4, delayMs = 3_000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.warn(`${label} failed (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms ...`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function main() {
  const terms = arg("terms");
  const claimantKey = (process.env.CLAIMANT_KEY ?? process.env.GENLAYER_PRIVATE_KEY) as `0x${string}` | undefined;
  const respondent =
    (arg("respondent") ??
      process.env.RESPONDENT_ADDRESS ??
      (process.env.GENLAYER_PRIVATE_KEY
        ? new Wallet(process.env.GENLAYER_PRIVATE_KEY as `0x${string}`).address
        : undefined)) as GlAddress | undefined;
  if (!terms || !respondent || !claimantKey) {
    console.error('usage: tsx deploy/open-cause.ts --terms "..." --respondent 0x...');
    process.exit(1);
  }
  const claimantAddress = new Wallet(claimantKey).address.toLowerCase();
  if (claimantAddress === respondent.toLowerCase()) {
    throw new Error("respondent must be different from claimant");
  }

  const TRIBUNAL = process.env.TRIBUNAL_ADDRESS! as GlAddress;
  const ESCROW = process.env.ESCROW_ADDRESS!;

  // GenLayer side
  const account = createAccount(claimantKey);
  const gl = createClient({ chain: getGenLayerChain(), account });
  await withRetry("initializeConsensusSmartContract", () => gl.initializeConsensusSmartContract());

  const nRaw = await withRetry("tribunal.total_cases", () =>
    gl.readContract({
      address: TRIBUNAL, functionName: "total_cases", args: [],
    })
  );
  const n = Number(nRaw);
  const caseId = `AQ-${n}`;
  const caseKey = keccakId(caseId); // keccak256(utf8(caseId)), 0x + 64 hex

  console.log(`Opening ${caseId}  (caseKey ${caseKey})`);

  // 1. tribunal: reference the escrow case via caseKey
  await withRetry("tribunal.open_case", () =>
    gl.writeContract({
      address: TRIBUNAL, functionName: "open_case", args: [terms, caseKey, respondent],
      value: 0n,
    })
  );

  // 2. escrow: bind the same id + key. The opener becomes the claimant, so
  //    this must be signed by the claimant's Base wallet.
  const base = new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
  const wallet = new Wallet(claimantKey, base);
  const escrow = new Contract(ESCROW, escrowAbi, wallet);
  const tx = await escrow.openCase(caseKey, respondent, caseId);
  await tx.wait();

  console.log("Cause opened on both chains.");
  console.log(`  caseId  = ${caseId}`);
  console.log(`  caseKey = ${caseKey}`);
  console.log("Next: both parties run  npm run seal -- --case " + caseId + " --role <claimant|respondent> --file <ev> --bond <amt>");
}

main().catch((e) => { console.error(e); process.exit(1); });
