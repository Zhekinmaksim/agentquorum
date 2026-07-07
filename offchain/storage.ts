/**
 * AgentQuorum - off-chain blob storage
 * ------------------------------------------------------------------
 * Ciphertext evidence lives off-chain; only its hash commitment goes on
 * the tribunal. Swap the backend by setting STORAGE_BACKEND.
 *   - "ipfs"  : pin to IPFS via an HTTP pinning endpoint (prod)
 *   - "local" : write under ./.blobs and serve by file URI (dev/tests)
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BACKEND = process.env.STORAGE_BACKEND ?? "local";
const LOCAL_DIR = resolve(process.cwd(), ".blobs");

export async function putBlob(blob: Uint8Array, name: string): Promise<string> {
  if (BACKEND === "ipfs") {
    const res = await fetch(`${process.env.IPFS_PIN_URL}/add`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.IPFS_TOKEN}` },
      body: new Uint8Array(blob).buffer,
    });
    if (!res.ok) throw new Error(`ipfs pin failed: ${res.status}`);
    const { cid } = await res.json();
    return `ipfs://${cid}`;
  }
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(resolve(LOCAL_DIR, name), blob);
  return `file://${resolve(LOCAL_DIR, name)}`;
}

export async function fetchBlob(uri: string): Promise<Uint8Array> {
  if (uri.startsWith("file://")) {
    return new Uint8Array(readFileSync(uri.slice("file://".length)));
  }
  const url = uri.startsWith("ipfs://")
    ? `${process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs"}/${uri.slice("ipfs://".length)}`
    : uri;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`blob fetch failed: ${uri}`);
  return new Uint8Array(await res.arrayBuffer());
}
