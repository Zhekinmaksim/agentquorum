import { createAccount, createClient, abi as genAbi } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { encodeFunctionData, zeroAddress } from "viem";

type GlAddress = `0x${string}` & { length: 42 };
type GlHash = `0x${string}` & { length: 66 };
type RpcJson = { jsonrpc: string; id: number; result?: any; error?: { code: number; message: string } };

type SendRawArgs = {
  privateKey: `0x${string}`;
  recipient: GlAddress;
  txData: `0x${string}`;
  value?: bigint;
  waitForStatus?: TransactionStatus;
};

const STATUS_ORDER: Record<string, number> = {
  PENDING: 0,
  PROPOSING: 1,
  COMMITTING: 2,
  REVEALING: 3,
  ACCEPTED: 4,
  FINALIZED: 5,
};

function makeCalldataObject(
  method: string | undefined,
  args: unknown[] | undefined,
  kwargs: Record<string, unknown> | Map<string, unknown> | undefined,
) {
  const out: Record<string, unknown> = {};
  if (method) out.method = method;
  if (args && args.length > 0) out.args = args;
  if (kwargs instanceof Map) {
    if (kwargs.size > 0) out.kwargs = kwargs;
  } else if (kwargs && Object.keys(kwargs).length > 0) {
    out.kwargs = kwargs;
  }
  return out;
}

async function rpc(method: string, params: any[] = []): Promise<any> {
  const endpoint = process.env.GENLAYER_RPC_URL!;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = (await res.json()) as RpcJson;
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGenLayerStatus(hash: GlHash, target: TransactionStatus, timeoutMs = 180_000) {
  const started = Date.now();
  let lastStatus = "UNKNOWN";

  while (Date.now() - started < timeoutMs) {
    const tx = await rpc("eth_getTransactionByHash", [hash]);
    const status = String(tx?.status ?? "UNKNOWN");
    lastStatus = status;

    if (status === TransactionStatus.CANCELED || status === TransactionStatus.UNDETERMINED) {
      throw new Error(`GenLayer transaction ${hash} ended with status ${status}: ${JSON.stringify(tx)}`);
    }

    if ((STATUS_ORDER[status] ?? -1) >= (STATUS_ORDER[target] ?? Number.MAX_SAFE_INTEGER)) {
      return tx;
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for ${target}, last status was ${lastStatus} for ${hash}`);
}

function parseHexInt(hex: string): number {
  return Number(BigInt(hex));
}

function parseHexBigInt(hex: string): bigint {
  return BigInt(hex);
}

export function createGlClient(privateKey?: `0x${string}`) {
  const account = privateKey ? createAccount(privateKey) : undefined;
  return createClient({
    chain: localnet,
    endpoint: process.env.GENLAYER_RPC_URL,
    ...(account ? { account } : {}),
  });
}

export async function sendRawGenLayerTransaction({
  privateKey,
  recipient,
  txData,
  value = 0n,
  waitForStatus = TransactionStatus.ACCEPTED,
}: SendRawArgs) {
  const client = createGlClient(privateKey);
  const account = createAccount(privateKey);
  await client.initializeConsensusSmartContract();

  const consensus = client.chain.consensusMainContract!;
  const chainId = parseHexInt(await rpc("eth_chainId"));
  const nonce = parseHexInt(await rpc("eth_getTransactionCount", [account.address, "latest"]));
  const gasPrice = parseHexBigInt(await rpc("eth_gasPrice"));

  const addTxData = encodeFunctionData({
    abi: consensus.abi as any,
    functionName: "addTransaction",
    args: [
      account.address,
      recipient,
      client.chain.defaultNumberOfInitialValidators,
      client.chain.defaultConsensusMaxRotations,
      txData,
    ],
  });

  const gas = parseHexBigInt(
    await rpc("eth_estimateGas", [
      {
        from: account.address,
        to: consensus.address as GlAddress,
        data: addTxData,
        value: `0x${value.toString(16)}`,
      },
    ]),
  );

  const serialized = await account.signTransaction({
    chainId,
    type: "legacy",
    nonce,
    gas,
    gasPrice,
    to: consensus.address as GlAddress,
    data: addTxData,
    value,
  });

  const hash = (await rpc("eth_sendRawTransaction", [serialized])) as GlHash;
  const receipt = await waitForGenLayerStatus(hash, waitForStatus);

  return { client, hash, receipt };
}

export async function deployContractRaw(
  privateKey: `0x${string}`,
  code: string | Uint8Array,
  args?: unknown[],
  kwargs?: Record<string, unknown> | Map<string, unknown>,
) {
  const constructorData = genAbi.calldata.encode(makeCalldataObject(undefined, args, kwargs) as any);
  const txData = genAbi.transactions.serialize([code, constructorData, false]);
  return sendRawGenLayerTransaction({
    privateKey,
    recipient: zeroAddress as GlAddress,
    txData,
    waitForStatus: TransactionStatus.FINALIZED,
  });
}

export async function writeContractRaw(
  privateKey: `0x${string}`,
  address: GlAddress,
  functionName: string,
  args?: unknown[],
  kwargs?: Record<string, unknown> | Map<string, unknown>,
  value = 0n,
  waitForStatus = TransactionStatus.ACCEPTED,
) {
  const calldata = genAbi.calldata.encode(makeCalldataObject(functionName, args, kwargs) as any);
  const txData = genAbi.transactions.serialize([calldata, false]);
  return sendRawGenLayerTransaction({
    privateKey,
    recipient: address,
    txData,
    value,
    waitForStatus,
  });
}

export function getContractAddressFromReceipt(receipt: any): GlAddress | undefined {
  return (receipt?.data?.contract_address ?? receipt?.contractAddress) as GlAddress | undefined;
}
