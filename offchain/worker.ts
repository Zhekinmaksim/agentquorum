/**
 * AgentQuorum - Discovery Worker
 * ------------------------------------------------------------------
 * The Intelligent Oracle pattern: keep heavy discovery OFF-chain, put only
 * verification + ruling on-chain.
 *
 * Data lives in two places, and the worker reconciles them:
 *   - GenLayer tribunal : evidence URIs + keccak(plaintext) commitments
 *                         (Party.evidence_uri / Party.evidence_commitment)
 *   - Inco escrow (Base): the sealed symmetric key handles, released to this
 *                         worker only by markReady()
 *
 * Flow on CaseReady(caseKey):
 *   1. Read both evidence URIs + commitments from the GenLayer tribunal.
 *   2. Read both sealed key handles from the escrow, decrypt them via Inco.
 *   3. Fetch + unseal each ciphertext blob with its own key.
 *   4. Convene the tribunal with plaintext + recomputed commitments. The IC
 *      re-checks those against what each party sealed, so a tampering worker
 *      is rejected on-chain.
 *   5. Read the verdict, relay claimant_award_bps to escrow.settle().
 *
 * The worker is a courier, never a judge, and the hash gate means it cannot
 * smuggle in altered evidence.
 */

import { createClient } from "genlayer-js";
import { JsonRpcProvider, Contract, Wallet, parseEther } from "ethers";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { unseal, commitmentOf } from "./crypto.js";
import { decryptHandlesWithFallback } from "./inco-decrypt.js";
import { Lightning } from "./inco.js";
import { fetchBlob } from "./storage.js";
import { getGenLayerChain } from "./genlayer-network.js";
import escrowAbi from "./abi/ConfidentialEscrow.json" assert { type: "json" };

type GlAddress = `0x${string}` & { length: 42 };

const TRIBUNAL_ADDRESS = process.env.TRIBUNAL_ADDRESS! as GlAddress;
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS!;
const WORKER_PRIVATE_KEY = process.env.WORKER_PRIVATE_KEY as `0x${string}`;
const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC!;
const INCO_OP_VALUE = parseEther("0.0001");

const gl = createClient({ chain: getGenLayerChain() });
const incoPromise = Lightning.baseSepoliaTestnet();

const base = new JsonRpcProvider(BASE_SEPOLIA_RPC);
const workerWallet = new Wallet(WORKER_PRIVATE_KEY, base);
const reencryptWallet = createWalletClient({
  account: privateKeyToAccount(WORKER_PRIVATE_KEY),
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC),
});
const escrow = new Contract(ESCROW_ADDRESS, escrowAbi, workerWallet);

type Party = { evidence_uri: string; evidence_commitment: `0x${string}` };
type Case = { claimant: Party; respondent: Party };

async function unsealParty(p: Party, keyHandle: `0x${string}`): Promise<{ text: string; commitment: `0x${string}` }> {
  // Inco returns an attested plaintext for the worker-authorized handle.
  const inco = await incoPromise;
  const [keyPlain] = await decryptHandlesWithFallback(inco, reencryptWallet, [keyHandle]);
  const symKey = hexToKey(keyPlain.plaintext.value);
  const blob = await fetchBlob(p.evidence_uri);
  const text = unseal(blob, symKey);
  return { text, commitment: commitmentOf(text) };
}

function hexToKey(k: bigint): Uint8Array {
  const hex = k.toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function handleCaseReady(caseId: string, caseKey: string) {
  // 1. Evidence pointers + commitments from the tribunal.
  const raw = (await gl.readContract({
    address: TRIBUNAL_ADDRESS, functionName: "get_case", args: [caseId],
  })) as string;
  const c = JSON.parse(raw) as Case;

  // 2. Sealed key handles from the escrow (released to us by markReady).
  const [claimantKey, respondentKey] = await escrow.evidenceKeyHandles(caseKey);

  // 3. Unseal both sides.
  const claimant = await unsealParty(c.claimant, claimantKey);
  const respondent = await unsealParty(c.respondent, respondentKey);

  // 3a. Local sanity check against the sealed commitments before spending gas.
  if (claimant.commitment !== c.claimant.evidence_commitment) throw new Error("claimant commitment mismatch");
  if (respondent.commitment !== c.respondent.evidence_commitment) throw new Error("respondent commitment mismatch");

  // 4. Convene. The IC verifies the same hashes on-chain before it reasons.
  await gl.writeContract({
    address: TRIBUNAL_ADDRESS,
    functionName: "convene",
    args: [caseId, claimant.text, respondent.text, claimant.commitment, respondent.commitment],
    value: 0n,
  });

  // plaintext + keys fall out of scope here. Confidentiality is best-effort
  // at this layer - see the threat model in ARCHITECTURE.md.
}

async function relayVerdict(caseId: string, caseKey: string) {
  const verdictRaw = await gl.readContract({
    address: TRIBUNAL_ADDRESS, functionName: "get_verdict", args: [caseId],
  });
  const verdict: any = verdictRaw ? JSON.parse(verdictRaw as string) : null;
  if (!verdict) return;
  const tx = await escrow.settle(caseKey, verdict.claimant_award_bps, { value: INCO_OP_VALUE });
  await tx.wait();
}

// caseKey (escrow, bytes32) and caseId (tribunal, "AQ-n") map 1:1; the opener
// registers both. For the MVP we derive caseId from an on-chain index event.
escrow.on("CaseReady", async (caseKey: string) => {
  try {
    const caseId = await escrow.caseIdOf(caseKey); // string label, see contract note
    await handleCaseReady(caseId, caseKey);
    await relayVerdict(caseId, caseKey);
  } catch (err) {
    console.error(`case ${caseKey} failed:`, err);
  }
});

console.log("AgentQuorum discovery worker online. Watching for ready cases.");
