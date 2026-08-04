import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ContractFactory, JsonRpcProvider, Wallet, isAddress } from "ethers";

type Address = `0x${string}` & { length: 42 };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function asAddress(value: string, name: string): Address {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address`);
  return value as Address;
}

async function main() {
  const rpcUrl = requireEnv("BASE_SEPOLIA_RPC");
  const deployerKey = requireEnv("ESCROW_DEPLOYER_KEY") as `0x${string}`;
  const relayer = asAddress(requireEnv("TRIBUNAL_RELAYER"), "TRIBUNAL_RELAYER");
  const worker = asAddress(requireEnv("WORKER_ADDRESS"), "WORKER_ADDRESS");

  const artifactPath = resolve("contracts/out/ConfidentialEscrow.sol/ConfidentialEscrow.json");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
    abi: unknown[];
    bytecode: { object: `0x${string}` };
  };

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(deployerKey, provider);
  const factory = new ContractFactory(artifact.abi as any, artifact.bytecode.object, wallet);

  console.log("Deploying ConfidentialEscrow to Base Sepolia ...");
  const contract = await factory.deploy(relayer, worker);
  const receipt = await contract.deploymentTransaction()?.wait();
  const address = await contract.getAddress();

  console.log("Escrow deployed.");
  console.log("Set ESCROW_ADDRESS in .env to:", address);
  console.log("Tx hash:", receipt?.hash ?? contract.deploymentTransaction()?.hash ?? "unknown");
  console.log("Block:", receipt?.blockNumber ?? "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
