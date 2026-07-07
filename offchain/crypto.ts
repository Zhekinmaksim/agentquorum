/**
 * AgentQuorum - shared evidence crypto
 * ------------------------------------------------------------------
 * One source of truth for how evidence is sealed and unsealed, so the seal
 * utility (party side) and the discovery worker (tribunal side) can never
 * disagree on format or hashing.
 *
 * Blob layout:  [ 24-byte nonce | XChaCha20-Poly1305 ciphertext + 16-byte tag ]
 * Commitment:   keccak256(plaintext bytes)  - binds the party to exact content,
 *               so the worker cannot feed altered evidence to the tribunal.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8 } from "@noble/hashes/utils";

export const NONCE_BYTES = 24;
export const KEY_BYTES = 32;

export type SealedEvidence = {
  blob: Uint8Array;          // nonce || ciphertext, the thing stored off-chain
  symKey: Uint8Array;        // 32-byte key, to be sealed to Inco (never raw on-chain)
  commitment: `0x${string}`; // keccak256(plaintext), goes on the GenLayer tribunal
};

/** keccak256 of plaintext, 0x-prefixed. Matches the tribunal's integrity gate. */
export function commitmentOf(plaintext: string): `0x${string}` {
  return ("0x" + bytesToHex(keccak_256(utf8ToBytes(plaintext)))) as `0x${string}`;
}

/** Encrypt one evidence document. Generates a fresh key + nonce. */
export function seal(plaintext: string): SealedEvidence {
  const symKey = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const ct = xchacha20poly1305(symKey, nonce).encrypt(utf8ToBytes(plaintext));
  const blob = new Uint8Array(NONCE_BYTES + ct.length);
  blob.set(nonce, 0);
  blob.set(ct, NONCE_BYTES);
  return { blob, symKey, commitment: commitmentOf(plaintext) };
}

/** Reverse of seal(), used by the worker once Inco releases the key. */
export function unseal(blob: Uint8Array, symKey: Uint8Array): string {
  const nonce = blob.slice(0, NONCE_BYTES);
  const ct = blob.slice(NONCE_BYTES);
  return bytesToUtf8(xchacha20poly1305(symKey, nonce).decrypt(ct));
}

export { bytesToHex, hexToBytes };
