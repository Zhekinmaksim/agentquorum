# AgentQuorum

**Confidential, sealed-evidence arbitration for autonomous agents.**

Two agents strike a deal. It goes wrong. Today their only recourse is a trusted
human, a centralized escrow, or a smart contract that cannot read a contract.
AgentQuorum gives them a tribunal instead: a committee of AI validators that
reads encrypted evidence in private, rules on the dispute, and publishes only
the verdict. The evidence itself is never unsealed.

It is the one combination the rest of the field is not building: GenLayer's
subjective judgment on top of Inco Lightning's confidentiality.

- **GenLayer** supplies the judgment. An Intelligent Contract lets a committee
  of validators reason over natural-language terms and messy evidence and reach
  consensus on a discrete ruling. No oracle, no single model, no trusted judge.
- **Inco Lightning** supplies the confidentiality. Bonds are encrypted `euint`
  amounts, and the keys that unlock the evidence are released under on-chain
  access control, only to the tribunal pipeline, never to a counterparty.

## Why this is hard, and how we resolve it

An LLM cannot reason over FHE ciphertext. So we do not pretend to. FHE does what
it is good at (confidential amounts, gated key release); the evidence is
symmetrically encrypted off-chain and revealed to the committee only at the
moment of judgment, then discarded. The honest limit of that design is stated
plainly in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). We would rather a
reviewer see the threat model up front than discover it later.

## Repository layout

```
genlayer/tribunal.py            GenLayer Intelligent Contract: the tribunal
contracts/ConfidentialEscrow.sol Inco Lightning escrow: confidential bonds + key gating
offchain/crypto.ts              shared XChaCha20-Poly1305 seal/unseal + commitment
offchain/seal.ts                party-side: encrypt evidence, emit submission payload
offchain/worker.ts              discovery worker: decrypt, convene, relay verdict
offchain/storage.ts             pluggable blob storage (IPFS or local)
deploy/deployScript.ts          GenLayer deploy (Studio first)
contracts/script/Deploy.s.sol   Foundry deploy for the escrow
web/index.html                  the case-file frontend
tests/test_tribunal.py          gltest lifecycle + tamper-rejection tests
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

## Run order

```bash
cp .env.example .env            # fill in keys and addresses
npm install
npm i @inco/lightning
(cd contracts && forge install foundry-rs/forge-std)

npm run build:contracts         # forge build, produces the ABI artifact
npm run abi                     # -> offchain/abi/ConfidentialEscrow.json

npm run deploy:escrow           # Base Sepolia, copy ESCROW_ADDRESS into .env
npm run deploy:tribunal         # GenLayer Studio, copy TRIBUNAL_ADDRESS into .env

npm run worker                  # run the discovery worker
# parties seal evidence:
npm run seal -- --case AQ-0007 --role claimant --file ./evidence.json --bond 500
```

Develop against GenLayer Studio first, then Bradbury / Asimov.

## Status

This is a working scaffold, not an audited release. Specifically:

- The contracts and off-chain code are written and internally consistent, but
  have not been compiled or deployed in this repository yet.
- `genlayer-js` `deployContract` fields and the `@inco/js` `encrypt` /
  `reencryptAndDecrypt` calls are written best-effort and should be verified
  against the current SDK docs before any testnet run.
- The GenLayer runner hash in `tribunal.py` is a placeholder. Pin it to a real
  hash before deploy.
- Dependency versions in `package.json` are placeholders. Pin them.
- Confidentiality is not absolute. See the threat model.

## License

MIT.
