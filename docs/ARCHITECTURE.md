# AgentQuorum Architecture

## The core tension

AgentQuorum sits on two stacks that solve different problems, and the design
only works if their roles are kept honest.

- **FHE (Inco Lightning)** computes arithmetic and boolean circuits over
  encrypted data without decrypting it. It cannot run a language model. You
  cannot hand an LLM a ciphertext and get a reasoned ruling.
- **GenLayer** runs a committee of validators, each calling a different model,
  reasoning over plaintext and reaching consensus. It needs to read the
  evidence to judge it.

So the two stacks are given non-overlapping jobs:

| Concern                       | Stack            | Mechanism                                  |
|-------------------------------|------------------|--------------------------------------------|
| Confidential bond amounts     | Inco Lightning   | `euint256` balances, never revealed        |
| Evidence decryption key gating| Inco Lightning   | threshold access control, released to worker only |
| Evidence confidentiality      | off-chain + sym  | XChaCha20-Poly1305 blob, hash committed on-chain |
| Subjective judgment           | GenLayer IC      | committee consensus over plaintext, `strict_eq` ruling |
| Settlement split              | Inco Lightning   | `pot * bps / 10000` on ciphertext          |

The evidence is **never** FHE-encrypted for the model. It is symmetrically
encrypted, stored off-chain, and only the symmetric key is placed under Inco's
gated control. The model reasons over plaintext that exists only for the
duration of one call.

## Data flow

```
  PARTY (seal.ts)                      CHAINS                         TRIBUNAL
  ---------------                      ------                         --------
  evidence (plaintext)
     | XChaCha20 encrypt
     v
  ciphertext blob  --------> off-chain store (IPFS) --> uri
     | keccak256(plaintext)
     v
  commitment  -------------> GenLayer tribunal.seal_evidence(uri, commitment)
     | seal sym key to Inco
     v
  keyCt  ------------------> escrow.sealEvidenceKey(keyCt)
  bondCt -----------------> escrow.fundBond(bondCt)        [euint, confidential]

  both parties funded + sealed
                              escrow.markReady()
                                | releases each key to the worker only
                                v
  WORKER (worker.ts)  <----- CaseReady(caseKey)
     | read uris + commitments from GenLayer
     | read key handles from escrow, Inco re-encrypts to worker
     | fetch blobs, unseal with each key
     v
  plaintext args ----------> GenLayer tribunal.convene(...)
                                | re-checks keccak(plaintext) == commitment
                                | committee deliberates in nondet block
                                | strict_eq on ruling enum
                                v
                              Verdict {ruling, bps, rationale} on chain
  WORKER reads verdict
     |
     v
                              escrow.settle(caseKey, bps)
                                | claimantPayout = pot * bps / 10000  [ciphertext]
                                | each winner allow-ed to decrypt own payout
```

## Why these specific choices

**Discrete ruling under `strict_eq`.** The single most common GenLayer failure
mode is a vague prompt that hangs on `UNDETERMINED` because validators never
agree on free text. AgentQuorum forces the binding decision into a closed set
(`CLAIMANT`, `RESPONDENT`, `SPLIT`, `INSUFFICIENT`) plus an integer in basis
points. The committee argues freely but must land on one enum value, which is
what `strict_eq` can settle. The rationale is soft and uses a comparative
principle.

**Off-chain discovery.** A single transaction doing web fetch plus decryption
plus a model call would hit GenLayer's hardcoded execution timeout. So the
heavy work (fetching blobs, obtaining the key, decrypting) happens off-chain in
the worker. On-chain we do only the cheap, verifiable part: re-hash the
plaintext, compare to the commitment, deliberate, record. This is the
Intelligent Oracle pattern.

**Commitment over plaintext.** `keccak256(plaintext)` binds each party to exact
content. The worker can decrypt but cannot alter, because `convene()` rejects
any plaintext that does not hash back to the sealed commitment. The worker is a
courier, not a judge.

**Per-party keys.** Each party seals its own evidence under its own symmetric
key, and the escrow releases both keys to the worker only at `markReady`. A
counterparty is never granted decryption.

## Threat model, stated plainly

**What confidentiality holds against:**

- The public chain state. Only the verdict, the split, the short rationale, and
  hash commitments are ever written. Evidence and bond amounts are not.
- The opposing party. Neither side sees the other's evidence or bond, before or
  after the ruling.
- The discovery worker tampering with evidence. The on-chain commitment check
  rejects altered plaintext.

**What it does not hold against:**

- **The validator committee.** During `convene()`, the validators see plaintext
  evidence inside their execution. Confidentiality is relaxed, deliberately and
  briefly, toward the committee only.

**Mitigations in place:**

- Ephemeral symmetric keys, discarded by the worker after the ruling.
- The committee emits only the verdict and a redaction-safe rationale, not the
  evidence.
- Validator slashing for leaking sealed material.

**The frontier:**

Full confidentiality from the committee requires confidential compute at the
node layer (TEEs or FHE-internal evaluation of the model), which is a research
direction, not a shipped guarantee. AgentQuorum is honest about where the line
sits today rather than overclaiming a property it does not have. This is the
"on the edge" part of the design, and it is the most interesting open problem
the project points at.

## Cross-chain settlement

The GenLayer verdict reaches the Base Sepolia escrow through a relayer
(`settle`, restricted to `tribunalRelayer`). For the MVP this is a trusted
relayer; for production it should be a LayerZero message verified on arrival,
so the escrow trusts the verdict's origin without a trusted intermediary.

## Appeals

`flag_appeal` marks a ruled cause for appeal. GenLayer's native appeal path then
re-runs the deliberation before a larger committee, with the appellant's bond at
risk. The escrow holds settlement until the appeal window closes.
