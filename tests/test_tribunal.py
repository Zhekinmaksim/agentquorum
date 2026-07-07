"""
AgentQuorum tribunal tests (gltest)
-----------------------------------
Run:  gltest            (uses gltest.config.yaml, default network studionet)

Note on API: the gltest surface (get_contract_factory, deploy, connect,
transact/call, the assertion helpers) has shifted across genlayer-test
versions. If a call name differs, check the installed gltest version and the
genlayer-project-boilerplate tests, then adjust. The TEST INTENT below is the
stable part.

Determinism: the lifecycle and the tamper-rejection test do NOT invoke the
model. convene() asserts the commitment match BEFORE _deliberate(), so feeding
a mismatched hash reverts without ever calling an LLM. Only the final, marked
integration test runs real committee consensus and is therefore slow and
non-deterministic in its exact ruling.
"""

import pytest
from eth_utils import keccak
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded, tx_execution_failed


def keccak_hex(text: str) -> str:
    # Must match the contract's commitment: keccak256(plaintext), 0x-prefixed.
    return "0x" + keccak(text.encode()).hex()


def deploy_tribunal(accounts):
    factory = get_contract_factory("ConfidentialTribunal")
    worker = accounts[2]
    contract = factory.deploy(args=[worker.address], account=accounts[0])
    return contract, worker


def open_and_seal(contract, accounts):
    claimant, respondent = accounts[0], accounts[1]
    res = contract.open_case(
        args=["Deliver index within 6h", "escrow-ref-0", respondent.address],
        account=claimant,
    ).transact()
    assert tx_execution_succeeded(res)
    case_id = "AQ-0"

    c_text = "claimant: delivery 51 min late, partial index"
    r_text = "respondent: upstream RPC outage, force majeure"

    assert tx_execution_succeeded(
        contract.seal_evidence(
            args=[case_id, keccak_hex(c_text), "file://c.bin"], account=claimant
        ).transact()
    )
    assert tx_execution_succeeded(
        contract.seal_evidence(
            args=[case_id, keccak_hex(r_text), "file://r.bin"], account=respondent
        ).transact()
    )
    return case_id, c_text, r_text


def test_lifecycle_reaches_sealed(accounts):
    contract, _ = deploy_tribunal(accounts)
    case_id, _, _ = open_and_seal(contract, accounts)
    case = contract.get_case(args=[case_id]).call()
    assert case["phase"] == "SEALED"
    assert case["claimant"]["submitted"] is True
    assert case["respondent"]["submitted"] is True


def test_non_party_cannot_seal(accounts):
    contract, _ = deploy_tribunal(accounts)
    contract.open_case(
        args=["terms", "ref", accounts[1].address], account=accounts[0]
    ).transact()
    # accounts[3] is a stranger to this cause.
    res = contract.seal_evidence(
        args=["AQ-0", keccak_hex("x"), "file://x.bin"], account=accounts[3]
    ).transact()
    assert tx_execution_failed(res)


def test_convene_rejects_tampered_evidence(accounts):
    """The integrity gate: a worker that alters evidence is rejected on-chain,
    deterministically, before any model call."""
    contract, worker = deploy_tribunal(accounts)
    case_id, c_text, r_text = open_and_seal(contract, accounts)

    # Worker submits plaintext whose hash does NOT match the sealed commitment.
    tampered = c_text + " [edited by worker]"
    res = contract.convene(
        args=[case_id, tampered, r_text, keccak_hex(tampered), keccak_hex(r_text)],
        account=worker,
    ).transact()
    assert tx_execution_failed(res)  # commitment mismatch


def test_only_worker_can_convene(accounts):
    contract, _ = deploy_tribunal(accounts)
    case_id, c_text, r_text = open_and_seal(contract, accounts)
    # accounts[1] is the respondent, not the discovery worker.
    res = contract.convene(
        args=[case_id, c_text, r_text, keccak_hex(c_text), keccak_hex(r_text)],
        account=accounts[1],
    ).transact()
    assert tx_execution_failed(res)


@pytest.mark.integration
def test_full_deliberation_produces_valid_ruling(accounts):
    """Slow: invokes the real committee. We assert only that the ruling is a
    valid enum value and the case is RULED, since the exact outcome is a
    model-consensus result, not a fixture."""
    contract, worker = deploy_tribunal(accounts)
    case_id, c_text, r_text = open_and_seal(contract, accounts)

    res = contract.convene(
        args=[case_id, c_text, r_text, keccak_hex(c_text), keccak_hex(r_text)],
        account=worker,
    ).transact()
    assert tx_execution_succeeded(res)

    verdict = contract.get_verdict(args=[case_id]).call()
    assert verdict["ruling"] in {"CLAIMANT", "RESPONDENT", "SPLIT", "INSUFFICIENT"}
    assert 0 <= verdict["claimant_award_bps"] <= 10000

    case = contract.get_case(args=[case_id]).call()
    assert case["phase"] == "RULED"
