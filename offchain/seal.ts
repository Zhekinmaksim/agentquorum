/**
 * AgentQuorum - Seal Utility (party side)
 * ------------------------------------------------------------------
 * A party runs this BEFORE submitting to a case. It:
 *   1. Encrypts the evidence document client-side (XChaCha20-Poly1305).
 *   2. Uploads the ciphertext blob off-chain, returns a URI.
 *   3. Encrypts the symmetric key to the Inco access policy (sealed key).
 *   4. Prints the exact arguments for the two on-chain submissions:
 *        - GenLayer  tribunal.seal_evidence(caseId, commitment, evidenceUri)
 *        - Base      escrow.sealEvidenceKey(caseKey, keyCt)
 *                    escrow.fundBond(caseKey, bondCt)
 *
 * The plaintext never leaves this process. Only ciphertext + a hash commitment
 * + a sealed key are ever published.
 *
 * Usage:
 *   tsx seal.ts --case AQ-0007 --role claimant --file ./evidence.json --bond 500
 */

import { readFileSync } from "node:fs";
import { seal, bytesToHex } from "./crypto.js";
import { handleTypes, Lightning } from "./inco.js";
import { putBlob } from "./storage.js";

type Role = "claimant" | "respondent";

type SubmissionPayload = {
  caseId: string;
  role: Role;
  evidenceUri: string;
  commitment: `0x${string}`;
  keyCt: `0x${string}`;   // sym key sealed to Inco, for escrow.sealEvidenceKey
  bondCt: `0x${string}`;  // confidential bond, for escrow.fundBond
};

function parseArgs(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, "")] = argv[i + 1];
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const caseId = args.case;
  const role = args.role as Role;
  const evidencePath = args.file;
  const bond = BigInt(args.bond ?? "0");

  if (!caseId || (role !== "claimant" && role !== "respondent") || !evidencePath) {
    console.error("usage: tsx seal.ts --case <id> --role <claimant|respondent> --file <path> --bond <amount>");
    process.exit(1);
  }

  // 1. Read + encrypt the evidence.
  const plaintext = readFileSync(evidencePath, "utf8");
  const sealed = seal(plaintext);

  // 2. Store ciphertext off-chain (IPFS in prod, see storage.ts).
  const evidenceUri = await putBlob(sealed.blob, `${caseId}-${role}.bin`);

  // 3. Seal the symmetric key + the bond to Inco, scoped to this case + the
  //    discovery worker. Best-effort against the current Lightning client;
  //    pin @inco/js and verify the encrypt signature before mainnet.
  const inco = await Lightning.baseSepoliaTestnet();
  const keyCt = (await inco.encrypt(BigInt("0x" + bytesToHex(sealed.symKey)), {
    accountAddress: process.env.WALLET_ADDRESS!,
    dappAddress: process.env.ESCROW_ADDRESS!,
    handleType: handleTypes.euint256,
  })) as `0x${string}`;
  const bondCt = (await inco.encrypt(bond, {
    accountAddress: process.env.WALLET_ADDRESS!,
    dappAddress: process.env.ESCROW_ADDRESS!,
    handleType: handleTypes.euint256,
  })) as `0x${string}`;

  const payload: SubmissionPayload = {
    caseId, role, evidenceUri, commitment: sealed.commitment, keyCt, bondCt,
  };

  // 4. Hand the party exactly what to submit. We do NOT auto-broadcast - the
  //    party signs these from their own wallet so custody stays with them.
  console.log("\n=== AgentQuorum sealed submission =============================");
  console.log(JSON.stringify(payload, null, 2));
  console.log("\nNext, from your wallet:");
  console.log(`  GenLayer: tribunal.seal_evidence("${caseId}", "${payload.commitment}", "${evidenceUri}")`);
  console.log(`  Base:     escrow.fundBond(caseKey, "${payload.bondCt}")`);
  console.log(`  Base:     escrow.sealEvidenceKey(caseKey, "${payload.keyCt}")`);
  console.log("===============================================================\n");

  // plaintext + symKey go out of scope here.
}

main().catch((e) => { console.error(e); process.exit(1); });
