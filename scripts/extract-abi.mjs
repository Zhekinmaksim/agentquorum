// Pulls the ABI out of the Foundry build artifact and writes the flat array
// to offchain/abi/ConfidentialEscrow.json, which worker.ts imports.
// Run after `npm run build:contracts`:  node scripts/extract-abi.mjs
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const artifact = resolve("contracts/out/ConfidentialEscrow.sol/ConfidentialEscrow.json");
if (!existsSync(artifact)) {
  console.error("Build artifact not found. Run `npm run build:contracts` first.");
  process.exit(1);
}

const { abi } = JSON.parse(readFileSync(artifact, "utf8"));
const outDir = resolve("offchain/abi");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "ConfidentialEscrow.json"), JSON.stringify(abi, null, 2));
console.log(`Wrote ${abi.length} ABI entries to offchain/abi/ConfidentialEscrow.json`);
