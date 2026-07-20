import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const NONCE_BYTES = 24;
export const KEY_BYTES = 32;

export type SealedEvidence = {
  blob: Uint8Array;
  symKey: Uint8Array;
  commitment: `0x${string}`;
};

export function commitmentOf(plaintext: string): `0x${string}` {
  return (`0x${bytesToHex(keccak_256(utf8ToBytes(plaintext)))}`) as `0x${string}`;
}

export function seal(plaintext: string): SealedEvidence {
  const symKey = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(symKey, nonce).encrypt(utf8ToBytes(plaintext));
  const blob = new Uint8Array(NONCE_BYTES + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, NONCE_BYTES);
  return { blob, symKey, commitment: commitmentOf(plaintext) };
}

export { bytesToHex };
