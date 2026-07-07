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
 * SDK calls are wired to genlayer-js@0.7.0 and should still be proven once on
 * a funded Studio/Base Sepolia flow.
 */

import { createClient, createAccount } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { JsonRpcProvider, Contract, Wallet, id as keccakId } from "ethers";
import escrowAbi from "../offchain/abi/ConfidentialEscrow.json" assert { type: "json" };

type GlAddress = `0x${string}` & { length: 42 };

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const terms = arg("terms");
  const respondent = arg("respondent") as GlAddress | undefined;
  if (!terms || !respondent) {
    console.error('usage: tsx deploy/open-cause.ts --terms "..." --respondent 0x...');
    process.exit(1);
  }

  const TRIBUNAL = process.env.TRIBUNAL_ADDRESS! as GlAddress;
  const ESCROW = process.env.ESCROW_ADDRESS!;

  // GenLayer side
  const account = createAccount(process.env.GENLAYER_PRIVATE_KEY as `0x${string}`);
  const gl = createClient({ chain: localnet, endpoint: process.env.GENLAYER_RPC_URL, account });
  await gl.initializeConsensusSmartContract();

  const nRaw = await gl.readContract({
    address: TRIBUNAL, functionName: "total_cases", args: [],
  });
  const n = Number(nRaw);
  const caseId = `AQ-${n}`;
  const caseKey = keccakId(caseId); // keccak256(utf8(caseId)), 0x + 64 hex

  console.log(`Opening ${caseId}  (caseKey ${caseKey})`);

  // 1. tribunal: reference the escrow case via caseKey
  await gl.writeContract({
    address: TRIBUNAL, functionName: "open_case", args: [terms, caseKey, respondent],
    value: 0n,
  });

  // 2. escrow: bind the same id + key. The opener becomes the claimant, so
  //    this must be signed by the claimant's Base wallet.
  const base = new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
  const wallet = new Wallet(process.env.CLAIMANT_KEY ?? process.env.ESCROW_DEPLOYER_KEY!, base);
  const escrow = new Contract(ESCROW, escrowAbi, wallet);
  const tx = await escrow.openCase(caseKey, respondent, caseId);
  await tx.wait();

  console.log("Cause opened on both chains.");
  console.log(`  caseId  = ${caseId}`);
  console.log(`  caseKey = ${caseKey}`);
  console.log("Next: both parties run  npm run seal -- --case " + caseId + " --role <claimant|respondent> --file <ev> --bond <amt>");
}

main().catch((e) => { console.error(e); process.exit(1); });
