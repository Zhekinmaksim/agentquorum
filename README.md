# AgentQuorum

**Confidential evidence lane for agent disputes.**

AgentQuorum is the confidential mode for Internet Court-style disputes.

Internet Court covers agent commerce with an open evidence trail. AgentQuorum
covers the subset where the evidence cannot be opened: contract terms, pricing,
customer data, internal logs, and delivery records the parties will not post to
a public chain.

Two parties agree on terms, post confidential bonds, and submit sealed
evidence. If the deal breaks down, a GenLayer tribunal reads the plaintext in
private, reaches a ruling, and sends only the verdict back on-chain. The bond
amounts stay confidential under Inco Lightning, and the evidence is never
exposed to the counterparty.

## What it does

- **GenLayer** handles judgment. A committee of validators can reason over
  natural-language terms and messy evidence, then converge on a structured
  verdict through real validator deliberation. The decisive verdict fields are
  bound to the exact terms/evidence fingerprint set that was sealed before the
  hearing.
- **Inco Lightning** handles confidentiality. Bond amounts stay encrypted, and
  evidence keys are released only to the tribunal pipeline, not to the other
  side.

## Why this exists

Commercial disputes contain the exact data parties will not put on a public
chain. Open-evidence arbitration works for some cases, but not for disputes
that depend on confidential logs, private pricing, or customer information.
Confidentiality is not an extra feature here. It is the condition that makes
the use case possible.

## Why GenLayer

Whether a deliverable satisfied a natural-language obligation is a judgment
call, not a deterministic computation. A normal smart contract cannot decide
it, and a single operator with decryption rights would just reintroduce the
trusted middleman. GenLayer is the layer that lets multiple validators review
the same evidence and converge on one binding outcome.

## Relation to Internet Court

AgentQuorum is not positioned as a separate general-purpose court. It is the
confidential lane for disputes that do not fit an open evidence trail. If
Internet Court is the default path for agent commerce, AgentQuorum is the path
for the cases where the facts cannot be published.

## Core Contracts

[`genlayer/tribunal.py`](genlayer/tribunal.py) records cases, seals commitments, stores evidence metadata, and publishes the final verdict.

[`contracts/ConfidentialEscrow.sol`](contracts/ConfidentialEscrow.sol) holds confidential bonds, gates evidence-key release, and settles the encrypted pot after a ruling.

[`contracts/script/Deploy.s.sol`](contracts/script/Deploy.s.sol) deploys the escrow on Base Sepolia.

[`deploy/deployScript.ts`](deploy/deployScript.ts) deploys the tribunal on GenLayer.

[`deploy/open-cause.ts`](deploy/open-cause.ts) opens and links the case on both chains.

## Live Deployment

- **GenLayer Bradbury tribunal:** `0xF100d7169C3968cACB9F3b93C4E7d9b7a25f44E2`
- **Base Sepolia escrow:** `0x3b6312f7eDc8A08c2b3716fCd8c1c5d7d4033838`
- **Tribunal deploy result:** accepted on August 4, 2026
- **Escrow deploy tx:** `0x438dd175cc397589a8e4991a882950c7f0e1b7bb7dfae8e39ee227a452cf4afc`

## Latest Live Proof

Verified on August 4, 2026 with case `AQ-2`.

- `open_case` on GenLayer: `0x011b17d149feb6d14ca7bea65b7b297dc8718ccb4282fee380081eca6b3077db`
- `openCase` on Base Sepolia: `0x329bff5d702da79af63ec8bf9c871cea09f770a44b0384a3608ba5fe7a238c66`
- claimant `seal_evidence` on GenLayer: `0xde2cc3012627f65885ec5c7a0ff791c9902336db9289fdf0f33cd7758c2333cd`
- respondent `seal_evidence` on GenLayer: `0x70364317f53ce74ec6a490b58ae827c2a2324a4934c8d82e0bf2ae1557a5a68c`
- `convene` on GenLayer: `0xa1e593d5a4c209804be932c798a56959cca3ed322921e771e7522abd3d9d5d5c`
- `settle` on Base Sepolia: `0x38805ca4b926094f6f84fa0a751cff1bd58a31bb19e6d2a1c9d7b6b733c6986a`

The resulting verdict was:

- `ruling = CLAIMANT`
- `claimant_award_bps = 10000`
- `terms_commitment = 0x10f4e122b1faa4249674b0ddf66f1aad201a451eab61950df21250fc3addf01a`
- `claimant_evidence_commitment = 0x21ad019d6402c35bf165dfbeff6ac0cbcc246b9d634e2d11091310886f7eb199`
- `respondent_evidence_commitment = 0x85e16366874812a59d091179dd1005d53059234f4e16ec3967bf6f3a7c634923`

The live worker path reached `Ready` using real GenLayer + Base writes. The
remaining external integration issue is the current Inco attested-decrypt KMS
path returning HTTP 404 on this SDK/network route; for this proof the final
`convene` step completed through the existing demo fallback after all on-chain
commitments, seals, and readiness checks had already succeeded live.

## Why this is hard, and how we resolve it

An LLM cannot reason over FHE ciphertext. So we do not pretend to. FHE does what
it is good at (confidential amounts, gated key release); the evidence is
symmetrically encrypted off-chain and revealed to the committee only at the
moment of judgment, then discarded. The honest limit of that design is stated
plainly in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). We would rather a
reviewer see the threat model up front than discover it later.

## Repository layout

```
genlayer/tribunal.py             GenLayer tribunal contract
contracts/ConfidentialEscrow.sol Base escrow contract
offchain/crypto.ts              shared XChaCha20-Poly1305 seal/unseal + commitment
offchain/seal.ts                party-side: encrypt evidence, emit submission payload
offchain/worker.ts              discovery worker: decrypt, convene, relay verdict
offchain/storage.ts             pluggable blob storage (IPFS or local)
deploy/deployScript.ts          tribunal deployment
contracts/script/Deploy.s.sol   escrow deployment
deploy/open-cause.ts            cross-chain case opening
offchain/e2e.ts                 scripted end-to-end flow
tests/test_tribunal.py          GenLayer tests
web/index.html                  simple case-file frontend
```

## Lifecycle

1. **Open.** A party opens a cause and names the respondent. The agreement terms
   are public; both parties post confidential bonds to the escrow.
2. **Seal.** Each party encrypts its evidence client-side, stores the ciphertext
   off-chain, commits `keccak256(plaintext)` on the tribunal, and seals its
   symmetric key to Inco.
3. **Release.** Once both sides are funded and sealed, the escrow releases each
   evidence key to the discovery worker alone.
4. **Convene.** The worker decrypts, then convenes the tribunal. The committee
   reasons over plaintext in a non-deterministic block. Validators derive their
   own verdicts and accept the leader only if the ruling stays aligned and the
   verdict carries the same terms/evidence commitments that were sealed before
   judgment.
5. **Enter.** Only the verdict returns. The escrow splits the confidential pot by
   basis points without ever revealing its size.

## What runs where

- **On GenLayer:** case registry, commitments, verdict logic, appeal marker.
- **On Base Sepolia / Inco:** confidential bond accounting, key gating, payout settlement.
- **Off-chain worker:** blob fetch, key decrypt, commitment-preserving evidence delivery, verdict relay.

## Run order

```bash
cp .env.example .env            # fill in keys and addresses
npm install
npm i @inco/lightning
(cd contracts && forge install foundry-rs/forge-std)

npm run build:contracts         # forge build, produces the ABI artifact
npm run abi                     # -> offchain/abi/ConfidentialEscrow.json

npm run deploy:escrow           # Base Sepolia, copy ESCROW_ADDRESS into .env
npm run deploy:tribunal         # GenLayer Bradbury, copy TRIBUNAL_ADDRESS into .env

npm run worker                  # run the discovery worker
# parties seal evidence:
npm run seal -- --case AQ-0007 --role claimant --file ./evidence.json --bond 500
```

Develop locally or on Studio first, then promote to Bradbury for production-like validation.

## Status

This is a working prototype, not an audited release. The important caveats are:

- The GenLayer tribunal now uses a real non-deterministic validator
  deliberation path (`gl.nondet.exec_prompt` via `gl.vm.run_nondet_unsafe`)
  instead of a local heuristic.
- The recorded verdict now includes the sealed terms/evidence fingerprints, so
  reviewers can see that the ruling is bound to the exact committed dispute
  inputs rather than a free-floating output blob.
- The design and scripts are real, but the stack still depends on external SDK
  surfaces from GenLayer and Inco that should be rechecked before a public demo.
- The real Inco attested-decrypt KMS path is the main integration risk. See the
  architecture and run notes before treating it as production-ready.
- Confidentiality is limited by today's execution model: the validator
  committee sees plaintext during deliberation. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the exact threat model.

## License

MIT.
