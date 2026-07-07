import { Contract, JsonRpcProvider, Wallet, id as keccakId, isAddress, parseEther } from "ethers";
import { TransactionStatus } from "genlayer-js/types";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import escrowAbi from "./abi/ConfidentialEscrow.json" assert { type: "json" };
import { commitmentOf, unseal } from "./crypto.js";
import { demoEvidenceText } from "./demo-evidence.js";
import { createGlClient, writeContractRaw } from "./genlayer-raw.js";
import { decryptHandlesWithFallback } from "./inco-decrypt.js";
import { Lightning } from "./inco.js";
import { fetchBlob } from "./storage.js";

type Hex = `0x${string}`;
type GlAddress = `0x${string}` & { length: 42 };
type TribunalCase = {
  claimant: { evidence_uri: string; evidence_commitment: Hex; wallet: string };
  respondent: { evidence_uri: string; evidence_commitment: Hex; wallet: string };
  has_verdict: boolean;
  phase: string;
};
type Verdict = { ruling: string; claimant_award_bps: number; rationale: string };

const INCO_OP_VALUE = parseEther("0.0001");

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function asAddress(value: string, name: string): GlAddress {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address`);
  return value as GlAddress;
}

function hexToKey(k: bigint): Uint8Array {
  const hex = k.toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForVerdict(gl: ReturnType<typeof createGlClient>, tribunalAddress: GlAddress, caseId: string, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const verdictRaw = await gl.readContract({
      address: tribunalAddress,
      functionName: "get_verdict",
      args: [caseId],
    }) as string | null;
    if (verdictRaw) return JSON.parse(verdictRaw) as Verdict;
    await sleep(2_000);
  }
  return null;
}

async function main() {
  const caseId = arg("case");
  const allowDemoFallback = process.argv.includes("--allow-demo-fallback");
  if (!caseId) {
    console.error("usage: tsx offchain/resume-ready.ts --case AQ-1 [--allow-demo-fallback]");
    process.exit(1);
  }

  const workerKey = requireEnv("WORKER_PRIVATE_KEY") as Hex;
  const tribunalAddress = asAddress(requireEnv("TRIBUNAL_ADDRESS"), "TRIBUNAL_ADDRESS");
  const escrowAddress = requireEnv("ESCROW_ADDRESS");
  const caseKey = keccakId(caseId) as Hex;

  const gl = createGlClient(workerKey);
  await gl.initializeConsensusSmartContract();

  const tribunalCaseRaw = await gl.readContract({
    address: tribunalAddress,
    functionName: "get_case",
    args: [caseId],
  }) as string;
  const tribunalCase = JSON.parse(tribunalCaseRaw) as TribunalCase;

  const base = new JsonRpcProvider(requireEnv("BASE_SEPOLIA_RPC"));
  const workerWallet = new Wallet(workerKey, base);
  const escrow = new Contract(escrowAddress, escrowAbi, workerWallet);
  const phaseBefore = Number(await escrow.phaseOf(caseKey));

  const verdictRaw = await gl.readContract({
    address: tribunalAddress,
    functionName: "get_verdict",
    args: [caseId],
  }) as string | null;

  let verdict = verdictRaw ? JSON.parse(verdictRaw) as Verdict : null;
  let evidenceSource: "attested_decrypt" | "demo_fallback" | "already_ruled" = "already_ruled";
  let claimantText = "";
  let respondentText = "";

  if (!verdict) {
    try {
      const [claimantHandle, respondentHandle] = await escrow.evidenceKeyHandles(caseKey);
      const reencryptWallet = createWalletClient({
        account: privateKeyToAccount(workerKey),
        chain: baseSepolia,
        transport: http(requireEnv("BASE_SEPOLIA_RPC")),
      });
      const inco = await Lightning.baseSepoliaTestnet();
      const [claimantPlain, respondentPlain] = await decryptHandlesWithFallback(
        inco,
        reencryptWallet,
        [claimantHandle, respondentHandle],
      );

      const claimantBlob = await fetchBlob(tribunalCase.claimant.evidence_uri);
      const respondentBlob = await fetchBlob(tribunalCase.respondent.evidence_uri);
      claimantText = unseal(claimantBlob, hexToKey(claimantPlain.plaintext.value));
      respondentText = unseal(respondentBlob, hexToKey(respondentPlain.plaintext.value));
      evidenceSource = "attested_decrypt";
    } catch (error) {
      if (!allowDemoFallback) throw error;

      claimantText = demoEvidenceText("claimant");
      respondentText = demoEvidenceText("respondent");
      evidenceSource = "demo_fallback";
    }

    const claimantCommitment = commitmentOf(claimantText);
    const respondentCommitment = commitmentOf(respondentText);

    if (claimantCommitment !== tribunalCase.claimant.evidence_commitment) {
      throw new Error("claimant commitment mismatch");
    }
    if (respondentCommitment !== tribunalCase.respondent.evidence_commitment) {
      throw new Error("respondent commitment mismatch");
    }

    const conveneTx = await writeContractRaw(
      workerKey,
      tribunalAddress,
      "convene",
      [caseId, claimantText, respondentText, claimantCommitment, respondentCommitment],
      undefined,
      0n,
      TransactionStatus.FINALIZED,
    );

    verdict = await waitForVerdict(gl, tribunalAddress, caseId);

    console.log(JSON.stringify({ step: "convene.done", caseId, hash: conveneTx.hash, evidenceSource }, null, 2));
  }

  if (!verdict) throw new Error("verdict not available");

  const settleTx = await escrow.settle(caseKey, verdict.claimant_award_bps, { value: INCO_OP_VALUE });
  await settleTx.wait();
  const phaseAfter = Number(await escrow.phaseOf(caseKey));

  console.log(JSON.stringify({
    caseId,
    caseKey,
    phaseBefore,
    phaseAfter,
    verdict,
    evidenceSource,
    settleTx: settleTx.hash,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
