// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// AgentQuorum - ConfidentialEscrow (Inco Lightning, Base Sepolia)
// ---------------------------------------------------------------
// What FHE actually buys us here (the honest split from ARCHITECTURE.md):
//   1. Confidential bonds: each party's stake is an euint256. Neither the
//      counterparty nor any chain observer learns how much the other risked.
//   2. Gated decryption: the symmetric key that unlocks the off-chain
//      evidence blob is itself held encrypted. It is only e.allow-ed to the
//      discovery worker once BOTH parties have sealed and the case is ready,
//      and never to a counterparty. This is the bridge to GenLayer's tribunal.
//
// The verdict comes back from the GenLayer Intelligent Contract. For the MVP
// it arrives through a trusted relayer (settle()); for production this should
// be a LayerZero message verified on arrival.
//
// API note: Inco Lightning's exact surface evolves. Treat the `e` calls as
// the current Lightning lib and pin the version in package.json before deploy.

import {e, euint256, ebool} from "@inco/lightning/src/libs/incoLightning_testnet_v2_889158349.sol";
import {IncoUtils} from "@inco/lightning/src/periphery/IncoUtils.sol";

contract ConfidentialEscrow is IncoUtils {
    using e for euint256;
    using e for ebool;
    using e for bytes;

    enum Phase {
        None,
        Open,        // accepting confidential bonds + sealed evidence
        Ready,       // both sides funded + sealed, key releasable
        Settled,     // verdict applied, payouts allocated
        Refunded
    }

    struct Case {
        address claimant;
        address respondent;
        euint256 claimantBond;     // confidential
        euint256 respondentBond;   // confidential
        euint256 pot;              // confidential running total
        euint256 claimantKey;      // sealed sym-key for claimant evidence
        euint256 respondentKey;    // sealed sym-key for respondent evidence
        bool claimantKeySealed;
        bool respondentKeySealed;
        bool claimantFunded;
        bool respondentFunded;
        Phase phase;
        // Confidential payouts, allocated at settlement.
        euint256 claimantPayout;
        euint256 respondentPayout;
    }

    address public immutable tribunalRelayer; // authorised verdict deliverer
    address public immutable discoveryWorker; // gets the gated evidence key
    mapping(bytes32 => Case) private cases;
    mapping(bytes32 => string) private caseIds; // bytes32 key -> GenLayer "AQ-n"

    event CaseOpened(bytes32 indexed caseKey, address claimant, address respondent);
    event PartyFunded(bytes32 indexed caseKey, address party);
    event CaseReady(bytes32 indexed caseKey);
    event VerdictApplied(bytes32 indexed caseKey, uint16 claimantAwardBps);

    modifier onlyRelayer() {
        require(msg.sender == tribunalRelayer, "not relayer");
        _;
    }

    constructor(address _tribunalRelayer, address _discoveryWorker) {
        require(_tribunalRelayer != address(0) && _discoveryWorker != address(0), "zero addr");
        tribunalRelayer = _tribunalRelayer;
        discoveryWorker = _discoveryWorker;
    }

    // --- Open a case -----------------------------------------------------
    function openCase(bytes32 caseKey, address respondent, string calldata caseId) external {
        require(cases[caseKey].phase == Phase.None, "exists");
        require(respondent != address(0) && respondent != msg.sender, "bad respondent");
        require(bytes(caseId).length > 0, "caseId required");
        Case storage c = cases[caseKey];
        c.claimant = msg.sender;
        c.respondent = respondent;
        c.phase = Phase.Open;
        c.pot = e.asEuint256(0);
        caseIds[caseKey] = caseId;
        emit CaseOpened(caseKey, msg.sender, respondent);
    }

    // --- Post a confidential bond ---------------------------------------
    // `bondCt` is the client-side encrypted bond amount (handle + proof).
    function fundBond(bytes32 caseKey, bytes calldata bondCt) external payable refundUnspent {
        Case storage c = cases[caseKey];
        require(c.phase == Phase.Open, "not open");
        euint256 bond = e.newEuint256(bondCt, msg.sender);

        if (msg.sender == c.claimant) {
            require(!c.claimantFunded, "funded");
            c.claimantBond = bond;
            c.claimantFunded = true;
        } else if (msg.sender == c.respondent) {
            require(!c.respondentFunded, "funded");
            c.respondentBond = bond;
            c.respondentFunded = true;
        } else {
            revert("not a party");
        }

        c.pot = c.pot.add(bond);
        // Keep the pot readable to the contract and the relayer only.
        c.pot.allowThis();
        c.pot.allow(tribunalRelayer);
        emit PartyFunded(caseKey, msg.sender);
    }

    // --- Seal the evidence key ------------------------------------------
    // Each party submits the encrypted symmetric key that unlocks their own
    // off-chain evidence blob. Keys are stored sealed and NOT released yet.
    function sealEvidenceKey(bytes32 caseKey, bytes calldata keyCt) external payable refundUnspent {
        Case storage c = cases[caseKey];
        require(c.phase == Phase.Open, "not open");
        if (msg.sender == c.claimant) {
            c.claimantKey = e.newEuint256(keyCt, msg.sender);
            c.claimantKey.allowThis();
            c.claimantKeySealed = true;
        } else if (msg.sender == c.respondent) {
            c.respondentKey = e.newEuint256(keyCt, msg.sender);
            c.respondentKey.allowThis();
            c.respondentKeySealed = true;
        } else {
            revert("not a party");
        }
    }

    // --- Move to Ready and release the key to the worker ----------------
    // Once both sides funded and sealed, the evidence key becomes decryptable
    // ONLY by the discovery worker - never by a counterparty. This is the
    // single gated moment where confidentiality is deliberately relaxed, and
    // only toward the tribunal pipeline.
    function markReady(bytes32 caseKey) external payable refundUnspent {
        Case storage c = cases[caseKey];
        require(c.phase == Phase.Open, "not open");
        require(c.claimantFunded && c.respondentFunded, "not fully funded");
        require(c.claimantKeySealed && c.respondentKeySealed, "keys not sealed");
        c.phase = Phase.Ready;
        // Release BOTH evidence keys to the discovery worker only, never to a
        // counterparty. This is the single gated moment.
        c.claimantKey.allow(discoveryWorker);
        c.respondentKey.allow(discoveryWorker);
        emit CaseReady(caseKey);
    }

    // --- Apply the verdict ----------------------------------------------
    // Called by the relayer with the GenLayer ruling. We split the
    // confidential pot by basis points without ever revealing the pot size.
    function settle(bytes32 caseKey, uint16 claimantAwardBps) external payable refundUnspent onlyRelayer {
        require(claimantAwardBps <= 10000, "bps");
        Case storage c = cases[caseKey];
        require(c.phase == Phase.Ready, "not ready");

        // claimantPayout = pot * bps / 10000, all on ciphertext.
        euint256 bps = e.asEuint256(uint256(claimantAwardBps));
        euint256 scaled = c.pot.mul(bps);
        c.claimantPayout = scaled.div(e.asEuint256(10000));
        c.respondentPayout = c.pot.sub(c.claimantPayout);

        // Let each winner decrypt only their own payout.
        c.claimantPayout.allow(c.claimant);
        c.respondentPayout.allow(c.respondent);

        c.phase = Phase.Settled;
        emit VerdictApplied(caseKey, claimantAwardBps);
    }

    // --- Views -----------------------------------------------------------
    function phaseOf(bytes32 caseKey) external view returns (Phase) {
        return cases[caseKey].phase;
    }

    // Maps the escrow's bytes32 caseKey to the GenLayer tribunal's "AQ-n" id.
    function caseIdOf(bytes32 caseKey) external view returns (string memory) {
        return caseIds[caseKey];
    }

    // Sealed evidence key handles. Only meaningful to the discovery worker,
    // which was allow-ed to decrypt them in markReady().
    function evidenceKeyHandles(bytes32 caseKey)
        external
        view
        returns (euint256 claimantKey, euint256 respondentKey)
    {
        Case storage c = cases[caseKey];
        return (c.claimantKey, c.respondentKey);
    }

    // Returns the caller's own payout handle (decryptable only by them).
    function myPayout(bytes32 caseKey) external view returns (euint256) {
        Case storage c = cases[caseKey];
        if (msg.sender == c.claimant) return c.claimantPayout;
        if (msg.sender == c.respondent) return c.respondentPayout;
        revert("not a party");
    }

    receive() external payable {}
}
