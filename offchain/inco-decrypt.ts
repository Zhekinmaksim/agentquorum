import type { WalletClient } from "viem";

type Handle = `0x${string}`;
type DecryptResult = Array<{ plaintext: { value: bigint } }>;
type IncoLike = {
  attestedDecrypt(walletClient: WalletClient, handles: Handle[]): Promise<unknown>;
  attestedReveal(handles: Handle[]): Promise<unknown>;
};

function is404(error: unknown) {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    if (message.includes("HTTP 404") || message.includes("[unimplemented] HTTP 404")) {
      return true;
    }
    current =
      current && typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return false;
}

export async function decryptHandlesWithFallback(
  inco: IncoLike,
  walletClient: WalletClient,
  handles: Handle[],
): Promise<DecryptResult> {
  try {
    return await inco.attestedDecrypt(walletClient, handles) as DecryptResult;
  } catch (error) {
    if (!is404(error)) throw error;
    return await inco.attestedReveal(handles) as DecryptResult;
  }
}
