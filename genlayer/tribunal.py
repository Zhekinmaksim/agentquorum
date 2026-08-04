# v0.1.8
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import hashlib
import json
import typing


RULING_CLAIMANT = "CLAIMANT"
RULING_RESPONDENT = "RESPONDENT"
RULING_SPLIT = "SPLIT"
RULING_INSUFFICIENT = "INSUFFICIENT"

VALID_RULINGS = {
    RULING_CLAIMANT,
    RULING_RESPONDENT,
    RULING_SPLIT,
    RULING_INSUFFICIENT,
}

PHASE_OPEN = "OPEN"
PHASE_SEALED = "SEALED"
PHASE_RULED = "RULED"
PHASE_APPEALED = "APPEALED"

class Party(typing.TypedDict):
    wallet: str
    evidence_commitment: str
    evidence_uri: str
    submitted: bool


class Verdict(typing.TypedDict):
    ruling: str
    claimant_award_bps: int
    rationale: str
    reasoning_commitment: str
    terms_commitment: str
    claimant_evidence_commitment: str
    respondent_evidence_commitment: str
    decided_at: int


class Case(typing.TypedDict):
    case_id: str
    terms: str
    claimant: Party
    respondent: Party
    phase: str
    escrow_ref: str
    verdict: Verdict
    has_verdict: bool
    appeal_bond_poster: str


class ConfidentialTribunal(gl.Contract):
    cases: TreeMap[str, str]
    case_count: u256
    discovery_worker: str
    owner: str

    def __init__(self, discovery_worker: str):
        self.case_count = u256(0)
        assert len(discovery_worker) == 42 and discovery_worker.startswith("0x"), (
            "discovery_worker must be a 0x address"
        )
        self.discovery_worker = discovery_worker
        self.owner = gl.message.sender_address.as_hex

    @gl.public.write
    def open_case(self, terms: str, escrow_ref: str, respondent_wallet: str) -> str:
        assert len(terms) > 0, "terms required"
        assert len(respondent_wallet) == 42 and respondent_wallet.startswith("0x"), (
            "respondent_wallet must be a 0x address"
        )

        cid = f"AQ-{int(self.case_count)}"
        self.case_count = u256(int(self.case_count) + 1)

        claimant: Party = {
            "wallet": gl.message.sender_address.as_hex,
            "evidence_commitment": "",
            "evidence_uri": "",
            "submitted": False,
        }
        respondent: Party = {
            "wallet": respondent_wallet,
            "evidence_commitment": "",
            "evidence_uri": "",
            "submitted": False,
        }

        case: Case = {
            "case_id": cid,
            "terms": terms,
            "claimant": claimant,
            "respondent": respondent,
            "phase": PHASE_OPEN,
            "escrow_ref": escrow_ref,
            "verdict": _empty_verdict(),
            "has_verdict": False,
            "appeal_bond_poster": "",
        }
        self._save_case(cid, case)
        return cid

    @gl.public.write
    def seal_evidence(self, case_id: str, evidence_commitment: str, evidence_uri: str) -> None:
        case = self._load_case(case_id)
        assert case["phase"] == PHASE_OPEN, "case not accepting evidence"

        sender = gl.message.sender_address.as_hex
        if sender == case["claimant"]["wallet"]:
            case["claimant"]["evidence_commitment"] = evidence_commitment
            case["claimant"]["evidence_uri"] = evidence_uri
            case["claimant"]["submitted"] = True
        elif sender == case["respondent"]["wallet"]:
            case["respondent"]["evidence_commitment"] = evidence_commitment
            case["respondent"]["evidence_uri"] = evidence_uri
            case["respondent"]["submitted"] = True
        else:
            assert False, "sender is not a party to this case"

        if case["claimant"]["submitted"] and case["respondent"]["submitted"]:
            case["phase"] = PHASE_SEALED

        self._save_case(case_id, case)

    @gl.public.write
    def convene(
        self,
        case_id: str,
        claimant_evidence: str,
        respondent_evidence: str,
        claimant_blob_hash: str,
        respondent_blob_hash: str,
    ) -> None:
        case = self._load_case(case_id)
        assert gl.message.sender_address.as_hex == self.discovery_worker, (
            "only the discovery worker may convene the tribunal"
        )
        assert case["phase"] == PHASE_SEALED, "case is not sealed"
        assert claimant_blob_hash == case["claimant"]["evidence_commitment"], (
            "claimant evidence does not match its sealed commitment"
        )
        assert respondent_blob_hash == case["respondent"]["evidence_commitment"], (
            "respondent evidence does not match its sealed commitment"
        )

        verdict = self._deliberate(
            case["terms"],
            claimant_evidence,
            respondent_evidence,
            claimant_blob_hash,
            respondent_blob_hash,
        )
        case["verdict"] = verdict
        case["has_verdict"] = True
        case["phase"] = PHASE_RULED
        self._save_case(case_id, case)

    def _deliberate(
        self,
        terms: str,
        claimant_arg: str,
        respondent_arg: str,
        claimant_blob_hash: str,
        respondent_blob_hash: str,
    ) -> Verdict:
        case_context = _case_context(
            terms,
            claimant_blob_hash,
            respondent_blob_hash,
        )
        prompt = self._build_prompt(terms, claimant_arg, respondent_arg, case_context)

        def leader_fn() -> typing.Any:
            raw_verdict = gl.nondet.exec_prompt(prompt, response_format="json")
            assert _is_valid_verdict_payload(raw_verdict), "invalid leader verdict payload"
            return _bind_verdict_payload(
                typing.cast(dict[str, typing.Any], raw_verdict),
                case_context,
            )

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            if not _is_valid_bound_verdict_payload(leader_result.calldata):
                return False
            own_verdict = leader_fn()
            if not _is_valid_bound_verdict_payload(own_verdict):
                return False
            return _verdicts_equivalent(
                typing.cast(dict[str, typing.Any], leader_result.calldata),
                typing.cast(dict[str, typing.Any], own_verdict),
            )

        raw_verdict = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        assert _is_valid_bound_verdict_payload(raw_verdict), "invalid verdict payload"
        return _normalize_verdict_payload(typing.cast(dict[str, typing.Any], raw_verdict))

    def _build_prompt(
        self,
        terms: str,
        claimant_arg: str,
        respondent_arg: str,
        case_context: dict[str, str],
    ) -> str:
        return "\n".join(
            [
                "You are one judge on a decentralized arbitration committee.",
                "Rule strictly from the agreement terms and the two evidence submissions.",
                "Do not invent facts and do not use outside knowledge.",
                "",
                "AGREEMENT TERMS:",
                terms,
                "",
                "CLAIMANT EVIDENCE:",
                claimant_arg,
                "",
                "RESPONDENT EVIDENCE:",
                respondent_arg,
                "",
                "SEALED INPUT FINGERPRINTS:",
                f"terms_commitment: {case_context['terms_commitment']}",
                f"claimant_evidence_commitment: {case_context['claimant_evidence_commitment']}",
                f"respondent_evidence_commitment: {case_context['respondent_evidence_commitment']}",
                "",
                "Return only JSON with keys ruling, claimant_award_bps, rationale.",
                "Allowed ruling values: CLAIMANT, RESPONDENT, SPLIT, INSUFFICIENT.",
                "If CLAIMANT, set claimant_award_bps to 10000.",
                "If RESPONDENT, set claimant_award_bps to 0.",
                "If INSUFFICIENT, set claimant_award_bps to 0.",
                "If SPLIT, set claimant_award_bps between 1 and 9999.",
                "Use only integer basis points, never a string or decimal.",
                "Keep rationale neutral and under 60 words.",
            ]
        )

    @gl.public.write
    def flag_appeal(self, case_id: str) -> None:
        case = self._load_case(case_id)
        assert case["phase"] == PHASE_RULED, "only ruled cases can be appealed"
        case["phase"] = PHASE_APPEALED
        case["appeal_bond_poster"] = gl.message.sender_address.as_hex
        self._save_case(case_id, case)

    @gl.public.view
    def get_case(self, case_id: str) -> str:
        return self.cases[case_id]

    @gl.public.view
    def get_verdict(self, case_id: str) -> typing.Optional[str]:
        case = self._load_case(case_id)
        if not case["has_verdict"]:
            return None
        return json.dumps(case["verdict"], sort_keys=True, separators=(",", ":"))

    @gl.public.view
    def total_cases(self) -> int:
        return int(self.case_count)

    def _load_case(self, case_id: str) -> Case:
        return typing.cast(Case, json.loads(self.cases[case_id]))

    def _save_case(self, case_id: str, case: Case) -> None:
        self.cases[case_id] = json.dumps(case, sort_keys=True, separators=(",", ":"))


def _is_valid_verdict_payload(payload: typing.Any) -> bool:
    if not isinstance(payload, dict):
        return False

    ruling = payload.get("ruling")
    claimant_award_bps = payload.get("claimant_award_bps")
    rationale = payload.get("rationale")

    if ruling not in VALID_RULINGS:
        return False
    if not isinstance(claimant_award_bps, int):
        return False
    if not isinstance(rationale, str):
        return False
    if len(rationale.strip()) == 0 or len(rationale.strip()) > 280:
        return False

    if ruling == RULING_CLAIMANT:
        return claimant_award_bps == 10000
    if ruling in {RULING_RESPONDENT, RULING_INSUFFICIENT}:
        return claimant_award_bps == 0
    if ruling == RULING_SPLIT:
        return 1 <= claimant_award_bps <= 9999
    return False


def _is_hex_commitment(value: typing.Any) -> bool:
    return isinstance(value, str) and len(value) == 66 and value.startswith("0x")


def _case_context(
    terms: str,
    claimant_evidence_commitment: str,
    respondent_evidence_commitment: str,
) -> dict[str, str]:
    return {
        "terms_commitment": _sha256_hex(terms),
        "claimant_evidence_commitment": claimant_evidence_commitment,
        "respondent_evidence_commitment": respondent_evidence_commitment,
    }


def _bind_verdict_payload(
    payload: dict[str, typing.Any],
    case_context: dict[str, str],
) -> dict[str, typing.Any]:
    return {
        "ruling": payload["ruling"],
        "claimant_award_bps": payload["claimant_award_bps"],
        "rationale": str(payload["rationale"]).strip(),
        "terms_commitment": case_context["terms_commitment"],
        "claimant_evidence_commitment": case_context["claimant_evidence_commitment"],
        "respondent_evidence_commitment": case_context["respondent_evidence_commitment"],
    }


def _is_valid_bound_verdict_payload(payload: typing.Any) -> bool:
    if not _is_valid_verdict_payload(payload):
        return False
    if not isinstance(payload, dict):
        return False
    return (
        _is_hex_commitment(payload.get("terms_commitment"))
        and _is_hex_commitment(payload.get("claimant_evidence_commitment"))
        and _is_hex_commitment(payload.get("respondent_evidence_commitment"))
    )


def _normalize_verdict_payload(payload: dict[str, typing.Any]) -> Verdict:
    ruling = typing.cast(str, payload["ruling"])
    claimant_award_bps = typing.cast(int, payload["claimant_award_bps"])
    rationale = str(payload["rationale"]).strip()
    terms_commitment = typing.cast(str, payload["terms_commitment"])
    claimant_evidence_commitment = typing.cast(
        str, payload["claimant_evidence_commitment"]
    )
    respondent_evidence_commitment = typing.cast(
        str, payload["respondent_evidence_commitment"]
    )
    reasoning_commitment = _sha256_hex(
        json.dumps(
            {
                "ruling": ruling,
                "claimant_award_bps": claimant_award_bps,
                "terms_commitment": terms_commitment,
                "claimant_evidence_commitment": claimant_evidence_commitment,
                "respondent_evidence_commitment": respondent_evidence_commitment,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )
    return {
        "ruling": ruling,
        "claimant_award_bps": claimant_award_bps,
        "rationale": rationale,
        "reasoning_commitment": reasoning_commitment,
        "terms_commitment": terms_commitment,
        "claimant_evidence_commitment": claimant_evidence_commitment,
        "respondent_evidence_commitment": respondent_evidence_commitment,
        "decided_at": 0,
    }


def _verdicts_equivalent(
    leader_payload: dict[str, typing.Any], validator_payload: dict[str, typing.Any]
) -> bool:
    for key in (
        "terms_commitment",
        "claimant_evidence_commitment",
        "respondent_evidence_commitment",
    ):
        if typing.cast(str, leader_payload[key]) != typing.cast(
            str, validator_payload[key]
        ):
            return False

    leader_ruling = typing.cast(str, leader_payload["ruling"])
    validator_ruling = typing.cast(str, validator_payload["ruling"])
    if leader_ruling != validator_ruling:
        return False

    leader_bps = typing.cast(int, leader_payload["claimant_award_bps"])
    validator_bps = typing.cast(int, validator_payload["claimant_award_bps"])
    if leader_ruling == RULING_SPLIT:
        return abs(leader_bps - validator_bps) <= 1500
    return leader_bps == validator_bps


def _sha256_hex(text: str) -> str:
    return "0x" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _empty_verdict() -> Verdict:
    return {
        "ruling": "",
        "claimant_award_bps": 0,
        "rationale": "",
        "reasoning_commitment": "",
        "terms_commitment": "",
        "claimant_evidence_commitment": "",
        "respondent_evidence_commitment": "",
        "decided_at": 0,
    }
