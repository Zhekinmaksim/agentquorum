import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TransactionStatus } from "genlayer-js/types";
import { JsonRpcProvider, Wallet, Contract, ContractFactory, id as keccakId, isAddress, parseEther } from "ethers";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { createGlClient, deployContractRaw, getContractAddressFromReceipt, writeContractRaw } from "./genlayer-raw.js";
import { seal, unseal, commitmentOf, bytesToHex } from "./crypto.js";
import { demoEvidenceText } from "./demo-evidence.js";
import { decryptHandlesWithFallback } from "./inco-decrypt.js";
import { handleTypes, Lightning } from "./inco.js";
import { putBlob, fetchBlob } from "./storage.js";
import escrowAbi from "./abi/ConfidentialEscrow.json" assert { type: "json" };

type Hex = `0x${string}`;
type GlAddress = `0x${string}` & { length: 42 };
const INCO_OP_VALUE = parseEther("0.0001");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function asAddress(value: string, name: string): GlAddress {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address`);
  return value as GlAddress;
}

function addrFromPk(privateKey: Hex): GlAddress {
  return new Wallet(privateKey).address as GlAddress;
}

function isPlaceholder(value: string) {
  const s = value.toLowerCase();
  return s.includes("filled_after") || s.includes("your_") || s.includes("0x_");
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

async function waitForEscrowOpenPhase(escrow: Contract, caseKey: Hex, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const phase = Number(await escrow.phaseOf(caseKey));
    if (phase === 1) return phase;
    await sleep(2_000);
  }
  throw new Error(`timed out waiting for escrow OPEN phase for ${caseKey}`);
}

async function waitForVerdict(
  glClient: ReturnType<typeof createGlClient>,
  tribunalAddress: GlAddress,
  caseId: string,
  timeoutMs = 90_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const verdictRaw = await glClient.readContract({
      address: tribunalAddress,
      functionName: "get_verdict",
      args: [caseId],
    }) as string | null;
    if (verdictRaw) {
      return JSON.parse(verdictRaw) as { ruling: string; claimant_award_bps: number; rationale: string };
    }
    await sleep(2_000);
  }
  return null;
}

function logStep(step: string, detail?: Record<string, unknown>) {
  console.log(JSON.stringify({ step, ...detail }, null, 2));
}

async function ensureEscrowAddress(
  provider: JsonRpcProvider,
  deployer: Wallet,
  relayer: GlAddress,
  worker: GlAddress,
) {
  const current = process.env.ESCROW_ADDRESS;
  if (current && !isPlaceholder(current) && isAddress(current)) return current;

  const artifact = JSON.parse(
    readFileSync(resolve("contracts/out/ConfidentialEscrow.sol/ConfidentialEscrow.json"), "utf8"),
  );
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, deployer.connect(provider));
  const contract = await factory.deploy(relayer, worker);
  await contract.waitForDeployment();
  return (await contract.getAddress()) as GlAddress;
}

async function ensureTribunalAddress(worker: GlAddress) {
  const current = process.env.TRIBUNAL_ADDRESS;
  if (current && !isPlaceholder(current) && isAddress(current)) return current as GlAddress;

  const code = readFileSync(resolve("genlayer/tribunal.py"), "utf8");
  const deployerKey = requireEnv("CLAIMANT_KEY") as Hex;
  const { receipt } = await deployContractRaw(deployerKey, code, [worker]);
  const address = getContractAddressFromReceipt(receipt);
  if (!address) throw new Error(`Tribunal deploy returned no contract address: ${JSON.stringify(receipt)}`);
  return address;
}

async function main() {
  const claimantKey = requireEnv("CLAIMANT_KEY") as Hex;
  const respondentKey = (process.env.RESPONDENT_KEY ?? requireEnv("GENLAYER_PRIVATE_KEY")) as Hex;
  const workerKey = requireEnv("WORKER_PRIVATE_KEY") as Hex;

  const claimantAddress = addrFromPk(claimantKey);
  const respondentAddress = addrFromPk(respondentKey);
  const workerAddress = addrFromPk(workerKey);

  if (claimantAddress === respondentAddress) throw new Error("claimant and respondent must be distinct");
  if (claimantAddress === workerAddress || respondentAddress === workerAddress) {
    throw new Error("worker must be distinct from claimant and respondent");
  }

  const relayer = asAddress(requireEnv("TRIBUNAL_RELAYER"), "TRIBUNAL_RELAYER");
  if (relayer.toLowerCase() !== workerAddress.toLowerCase()) {
    throw new Error("TRIBUNAL_RELAYER must match WORKER_PRIVATE_KEY address for this MVP flow");
  }

  const base = new JsonRpcProvider(requireEnv("BASE_SEPOLIA_RPC"));
  const claimantWallet = new Wallet(claimantKey, base);
  const respondentWallet = new Wallet(respondentKey, base);
  const workerWallet = new Wallet(workerKey, base);

  const escrowAddress = await ensureEscrowAddress(base, claimantWallet, relayer, workerAddress);
  const tribunalAddress = await ensureTribunalAddress(workerAddress);
  logStep("addresses.ready", { escrowAddress, tribunalAddress });

  const glReadClient = createGlClient(claimantKey);
  await glReadClient.initializeConsensusSmartContract();

  const nRaw = await glReadClient.readContract({
    address: tribunalAddress,
    functionName: "total_cases",
    args: [],
  });
  const caseIndex = Number(nRaw);
  const caseId = `AQ-${caseIndex}`;
  const caseKey = keccakId(caseId) as Hex;
  const terms = "Deliver index in 6h with complete rows and reproducible methodology.";
  logStep("case.derived", { caseIndex, caseId, caseKey });

  const openTx = await writeContractRaw(
    claimantKey,
    tribunalAddress,
    "open_case",
    [terms, caseKey, respondentAddress],
    undefined,
    0n,
    TransactionStatus.FINALIZED,
  );
  logStep("genlayer.open_case.accepted", { hash: openTx.hash });

  const escrow = new Contract(escrowAddress, escrowAbi, claimantWallet);
  const openCaseTx = await escrow.openCase(caseKey, respondentAddress, caseId);
  await openCaseTx.wait();
  logStep("base.openCase.mined", { hash: openCaseTx.hash });
  await waitForEscrowOpenPhase(escrow, caseKey);
  logStep("base.openCase.visible", { caseKey, phase: 1 });

  const claimantText = demoEvidenceText("claimant");
  const respondentText = demoEvidenceText("respondent");

  const claimantEvidence = seal(claimantText);
  const respondentEvidence = seal(respondentText);

  process.env.STORAGE_BACKEND = process.env.STORAGE_BACKEND || "local";
  const claimantUri = await putBlob(claimantEvidence.blob, `${caseId}-claimant.bin`);
  const respondentUri = await putBlob(respondentEvidence.blob, `${caseId}-respondent.bin`);

  const inco = await Lightning.baseSepoliaTestnet();
  const claimantKeyCt = await inco.encrypt(BigInt(`0x${bytesToHex(claimantEvidence.symKey)}`), {
    accountAddress: claimantAddress,
    dappAddress: escrowAddress,
    handleType: handleTypes.euint256,
  });
  const claimantBondCt = await inco.encrypt(1250n, {
    accountAddress: claimantAddress,
    dappAddress: escrowAddress,
    handleType: handleTypes.euint256,
  });
  const respondentKeyCt = await inco.encrypt(BigInt(`0x${bytesToHex(respondentEvidence.symKey)}`), {
    accountAddress: respondentAddress,
    dappAddress: escrowAddress,
    handleType: handleTypes.euint256,
  });
  const respondentBondCt = await inco.encrypt(980n, {
    accountAddress: respondentAddress,
    dappAddress: escrowAddress,
    handleType: handleTypes.euint256,
  });

  await writeContractRaw(
    claimantKey,
    tribunalAddress,
    "seal_evidence",
    [caseId, claimantEvidence.commitment, claimantUri],
    undefined,
    0n,
    TransactionStatus.FINALIZED,
  );
  logStep("genlayer.claimant.sealed", { caseId, claimantUri });
  await writeContractRaw(
    respondentKey,
    tribunalAddress,
    "seal_evidence",
    [caseId, respondentEvidence.commitment, respondentUri],
    undefined,
    0n,
    TransactionStatus.FINALIZED,
  );
  logStep("genlayer.respondent.sealed", { caseId, respondentUri });

  const claimantEscrow = new Contract(escrowAddress, escrowAbi, claimantWallet);
  const respondentEscrow = new Contract(escrowAddress, escrowAbi, respondentWallet);
  await (await claimantEscrow.fundBond(caseKey, claimantBondCt, { value: INCO_OP_VALUE })).wait();
  logStep("base.claimant.fundBond.mined", { caseKey });
  await (await claimantEscrow.sealEvidenceKey(caseKey, claimantKeyCt, { value: INCO_OP_VALUE })).wait();
  logStep("base.claimant.sealEvidenceKey.mined", { caseKey });
  await (await respondentEscrow.fundBond(caseKey, respondentBondCt, { value: INCO_OP_VALUE })).wait();
  logStep("base.respondent.fundBond.mined", { caseKey });
  await (await respondentEscrow.sealEvidenceKey(caseKey, respondentKeyCt, { value: INCO_OP_VALUE })).wait();
  logStep("base.respondent.sealEvidenceKey.mined", { caseKey });

  await (await claimantEscrow.markReady(caseKey, { value: INCO_OP_VALUE })).wait();
  logStep("base.markReady.mined", { caseKey });

  const workerReadClient = createGlClient(workerKey);
  await workerReadClient.initializeConsensusSmartContract();
  const tribunalCaseRaw = await workerReadClient.readContract({
    address: tribunalAddress,
    functionName: "get_case",
    args: [caseId],
  }) as string;
  const tribunalCase = JSON.parse(tribunalCaseRaw) as {
    claimant: { evidence_uri: string; evidence_commitment: Hex };
    respondent: { evidence_uri: string; evidence_commitment: Hex };
  };
  logStep("genlayer.get_case.ok", { caseId });

  const workerEscrow = new Contract(escrowAddress, escrowAbi, workerWallet);
  const [claimantHandle, respondentHandle] = await workerEscrow.evidenceKeyHandles(caseKey);

  const reencryptWallet = createWalletClient({
    account: privateKeyToAccount(workerKey),
    chain: baseSepolia,
    transport: http(requireEnv("BASE_SEPOLIA_RPC")),
  });
  let claimantTextOut: string;
  let respondentTextOut: string;
  let evidenceSource: "attested_decrypt" | "demo_fallback";
  try {
    const [claimantPlain, respondentPlain] = await decryptHandlesWithFallback(
      inco,
      reencryptWallet,
      [claimantHandle, respondentHandle],
    );
    logStep("inco.attestedDecrypt.ok", { caseKey });

    const claimantBlob = await fetchBlob(tribunalCase.claimant.evidence_uri);
    const respondentBlob = await fetchBlob(tribunalCase.respondent.evidence_uri);
    claimantTextOut = unseal(claimantBlob, hexToKey(claimantPlain.plaintext.value));
    respondentTextOut = unseal(respondentBlob, hexToKey(respondentPlain.plaintext.value));
    evidenceSource = "attested_decrypt";
  } catch (error) {
    if (process.env.ALLOW_DEMO_FALLBACK !== "1") throw error;
    claimantTextOut = demoEvidenceText("claimant");
    respondentTextOut = demoEvidenceText("respondent");
    evidenceSource = "demo_fallback";
    logStep("inco.attestedDecrypt.fallback", { caseKey, reason: error instanceof Error ? error.message : String(error) });
  }

  const claimantCommitment = commitmentOf(claimantTextOut);
  const respondentCommitment = commitmentOf(respondentTextOut);
  if (claimantCommitment !== tribunalCase.claimant.evidence_commitment) {
    throw new Error("claimant commitment mismatch before convene");
  }
  if (respondentCommitment !== tribunalCase.respondent.evidence_commitment) {
    throw new Error("respondent commitment mismatch before convene");
  }

  const conveneTx = await writeContractRaw(
    workerKey,
    tribunalAddress,
    "convene",
    [caseId, claimantTextOut, respondentTextOut, claimantCommitment, respondentCommitment],
    undefined,
    0n,
    TransactionStatus.FINALIZED,
  );
  logStep("genlayer.convene.accepted", { hash: conveneTx.hash, evidenceSource });

  const verdict = await waitForVerdict(workerReadClient, tribunalAddress, caseId);
  logStep("genlayer.get_verdict.ok", { caseId, verdict });

  if (!verdict) throw new Error("verdict not available after convene");
  const settleTx = await workerEscrow.settle(caseKey, verdict.claimant_award_bps, { value: INCO_OP_VALUE });
  await settleTx.wait();

  const phase = await workerEscrow.phaseOf(caseKey);
  console.log(JSON.stringify({
    escrowAddress,
    tribunalAddress,
    caseId,
    caseKey,
    genlayerOpenTx: openTx.hash,
    genlayerConveneTx: conveneTx.hash,
    baseOpenCaseTx: openCaseTx.hash,
    baseSettleTx: settleTx.hash,
    phase: Number(phase),
    verdict,
    claimantAddress,
    respondentAddress,
    workerAddress,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
