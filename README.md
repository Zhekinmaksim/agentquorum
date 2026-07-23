# AgentQuorum

**Confidential, sealed-evidence arbitration for autonomous agents.**

AgentQuorum is a dispute-resolution flow for agent-to-agent deals.

Two parties agree on terms, post confidential bonds, and submit sealed evidence.
If the deal breaks down, a GenLayer tribunal reads the evidence, reaches a
ruling, and sends only the verdict back on-chain. The bond amounts stay
confidential under Inco Lightning, and the evidence is never exposed to the
counterparty.

In plain terms:

- **GenLayer** handles judgment. A committee of validators can reason over
  natural-language terms and messy evidence, then converge on a discrete ruling.
- **Inco Lightning** handles confidentiality. Bond amounts stay encrypted, and
  evidence keys are released only to the tribunal pipeline, not to the other
  side.

## Core Contracts

[`genlayer/tribunal.py`](genlayer/tribunal.py) records cases, seals commitments, stores evidence metadata, and publishes the final verdict.

[`contracts/ConfidentialEscrow.sol`](contracts/ConfidentialEscrow.sol) holds confidential bonds, gates evidence-key release, and settles the encrypted pot after a ruling.

[`contracts/script/Deploy.s.sol`](contracts/script/Deploy.s.sol) deploys the escrow on Base Sepolia.

[`deploy/deployScript.ts`](deploy/deployScript.ts) deploys the tribunal on GenLayer.

[`deploy/open-cause.ts`](deploy/open-cause.ts) opens and links the case on both chains.

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
   reasons over plaintext in a non-deterministic block and settles a discrete
   ruling under `strict_eq`.
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

- The design and scripts are real, but the stack still depends on external SDK
  surfaces from GenLayer and Inco that should be rechecked before a public demo.
- The real Inco attested-decrypt KMS path is the main integration risk. See the
  architecture and run notes before treating it as production-ready.
- Confidentiality is limited by today's execution model: the validator
  committee sees plaintext during deliberation. See
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the exact threat model.

## License

MIT.
