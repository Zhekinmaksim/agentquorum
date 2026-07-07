# RUN.md - getting AgentQuorum to a live end-to-end demo

This is the concrete punch list. It is split into what is already verified, the
blockers to a first deploy, the things to verify before trusting them, and what
can wait until after the grant.

## Already verified (runs today)

- **Crypto + commitment layer.** `npm run dryrun` passes 7 checks against real
  `@noble/ciphers@1.3.0` + `@noble/hashes@1.8.0`: seal/unseal round-trips, the
  bigint key path Inco uses round-trips, and the commitment gate accepts honest
  evidence while rejecting tampered evidence. Import paths in `offchain/crypto.ts`
  are confirmed working.
- **Contract <-> worker interface.** Key handles, `caseIdOf`, `settle`, and the
  `CaseReady` event line up with what the worker calls.
- **Configs.** `package.json`, `tsconfig.json`, `gltest.config.yaml` parse.

## Critical path to a live demo (do in order)

1. **Runner hash is pinned.** `genlayer/tribunal.py` now uses the current
   documented `py-genlayer` hash
   (`1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`). If Studio rejects
   it later, refresh it from GenLayer's "Available Runners" appendix before
   deploy.

2. **Install + build the escrow.**
   ```
   npm install
   (cd contracts && forge install foundry-rs/forge-std)
   npm run build:contracts
   npm run abi          # writes offchain/abi/ConfidentialEscrow.json (worker needs it)
   ```
   `npm install` must bring in `@inco/lightning@1.0.1`. If `forge build` fails, the `e.*` API in `ConfidentialEscrow.sol` or the
   import path in `remappings.txt` does not match the installed Inco Lightning
   version. Fix the calls to match (see step 4).

3. **Verify the Inco Lightning JS flow (the privacy crux).** Confirm against the
   current `@inco/js@0.1.41` docs / installed package:
   - `inco.encrypt(value, {accountAddress, dappAddress})` in `offchain/seal.ts`
   - `const reencryptor = await inco.getReencryptor(walletClient)` then
     `await reencryptor({handle}).value` in `offchain/worker.ts`
   The worker decrypting the gated key off-chain is the whole privacy mechanic.
   The repo is now wired to the installed `@inco/js` surface, but the funded
   Studio + Base Sepolia run is still the proof that the public covalidator and
   access-control path behave as expected end-to-end.

4. **Verify the Solidity `e.*` API.** Confirm `newEuint256`, `asEuint256`, `add`,
   `mul`, `div`, `sub`, `allow`, `allowThis` match the installed Inco Lightning
   `Lib.sol`. Adjust names if the version moved.

5. **Verify genlayer-js shapes.** In `deploy/deployScript.ts` and
   `deploy/open-cause.ts`: `deployContract({code, args})`, the receipt
   contract-address field, and `writeContract` / `readContract` argument shapes.
   Log the receipt once and adjust the field read if needed.

6. **Fund accounts and fill `.env`.** `cp .env.example .env` and set: GenLayer
   Studio key and Base Sepolia keys with gas. For the MVP set
   `TRIBUNAL_RELAYER` EQUAL to `WORKER_ADDRESS` (the worker is the relayer), and
   pass that same address as the relayer to the escrow deploy.

7. **Deploy both.**
   ```
   WORKER_ADDRESS=0x... TRIBUNAL_RELAYER=0x...(=WORKER_ADDRESS) \
     npm run deploy:escrow      # -> ESCROW_ADDRESS
   npm run deploy:tribunal      # -> TRIBUNAL_ADDRESS
   ```
   Put both addresses in `.env`.

8. **Run the full cycle.**
   ```
   npm run worker &                                    # watches CaseReady
   npm run open:cause -- --terms "deliver index in 6h" --respondent 0x...
   # claimant and respondent each:
   npm run seal -- --case AQ-0 --role claimant  --file ./ev_c.json --bond 1250
   npm run seal -- --case AQ-0 --role respondent --file ./ev_r.json --bond 980
   # submit the printed seal_evidence / fundBond / sealEvidenceKey txs
   # then call escrow.markReady(caseKey) -> worker convenes -> verdict -> settle
   ```
   Watch the worker decrypt, convene, and relay the verdict into `settle`.

9. **Run the tribunal tests.** `pip install eth_utils && npm run test:tribunal`.
   Lifecycle + tamper-rejection are deterministic; the full-deliberation test is
   marked `@integration` and invokes the real committee.

## Storage note

`STORAGE_BACKEND=local` only works when seal and worker share a filesystem. For
two parties on different machines, set `STORAGE_BACKEND=ipfs` and fill the IPFS
pinning vars in `.env`.

## After the grant (not blockers)

- **Make the frontend a real dapp.** `web/index.html` and `landing/` are a
  scripted demo. Wire `genlayer-js` reads for live case state and wallet writes
  for open/seal/fund. For the grant submission the demo + CLI flow is enough.
- **Trustless verdict relay.** `settle` is called by a trusted relayer. Replace
  with a LayerZero message verified on the Base side so the escrow does not trust
  an intermediary.
- **Host.** Deploy `landing/` to Vercel, point agentquorum.xyz.
- **Confidential compute frontier.** Validators see plaintext during `convene`.
  Closing that needs TEE / confidential compute at the node layer. See
  `docs/ARCHITECTURE.md`.

## One-line status

The crypto and contract logic are written and the crypto layer is proven. The
remaining work is installing `forge-std` for the deploy script and doing one
funded run on Studio + Base Sepolia to prove the public covalidator + relayer
path end-to-end.
