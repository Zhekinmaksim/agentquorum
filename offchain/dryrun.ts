/**
 * AgentQuorum - local dry run (no chains)
 * ------------------------------------------------------------------
 * Proves the parts that do NOT depend on GenLayer/Inco/Base:
 *   1. seal -> store -> fetch -> unseal round-trips the plaintext
 *   2. the brittle bigint key path (how Inco hands the key back) round-trips
 *   3. the commitment gate ACCEPTS untampered evidence
 *   4. the commitment gate REJECTS tampered evidence
 *
 * Run: tsx offchain/dryrun.ts
 */

import { seal, unseal, commitmentOf, bytesToHex } from "./crypto.js";
import { putBlob, fetchBlob } from "./storage.js";

// Mirror of worker.ts hexToKey: Inco returns the sym key as a bigint, the
// worker rebuilds the 32 bytes. This is the easiest place to get an off-by-one.
function hexToKey(k: bigint): Uint8Array {
  const hex = k.toString(16).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "  ok  " : " FAIL "} ${name}`);
  if (!cond) failures++;
}

async function main() {
  process.env.STORAGE_BACKEND = "local";

  const claimantText =
    "received 06:51:22Z\nexpected 06:00:00Z\n18,402 / 24,110 rows\n51 min late, partial";
  const respondentText =
    "delivered 06:51:22Z\nRPC degraded 05:10-06:30\nall available rows\nforce majeure cited";

  // --- party side: seal both ---
  const c = seal(claimantText);
  const r = seal(respondentText);
  const cUri = await putBlob(c.blob, "AQ-0007-claimant.bin");
  const rUri = await putBlob(r.blob, "AQ-0007-respondent.bin");

  // --- the bigint key path Inco will use ---
  const cKeyBig = BigInt("0x" + bytesToHex(c.symKey));
  const rKeyBig = BigInt("0x" + bytesToHex(r.symKey));
  check("claimant key survives bytes->bigint->bytes", eq(hexToKey(cKeyBig), c.symKey));
  check("respondent key survives bytes->bigint->bytes", eq(hexToKey(rKeyBig), r.symKey));

  // --- worker side: fetch + unseal with the reconstructed keys ---
  const cBlob = await fetchBlob(cUri);
  const rBlob = await fetchBlob(rUri);
  const cPlain = unseal(cBlob, hexToKey(cKeyBig));
  const rPlain = unseal(rBlob, hexToKey(rKeyBig));
  check("claimant plaintext round-trips", cPlain === claimantText);
  check("respondent plaintext round-trips", rPlain === respondentText);

  // --- commitment gate: ACCEPT untampered ---
  check("claimant commitment matches", commitmentOf(cPlain) === c.commitment);
  check("respondent commitment matches", commitmentOf(rPlain) === r.commitment);

  // --- commitment gate: REJECT tampered (what convene() enforces on-chain) ---
  const tampered = cPlain + " [edited by worker]";
  check("tampered evidence is rejected by the gate", commitmentOf(tampered) !== c.commitment);

  // --- what the worker would pass to tribunal.convene(...) ---
  console.log("\nconvene() args that would be submitted:");
  console.log(JSON.stringify(
    { caseId: "AQ-0007", claimant_commitment: c.commitment, respondent_commitment: r.commitment },
    null, 2
  ));

  console.log(`\n${failures === 0 ? "ALL CRYPTO CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
