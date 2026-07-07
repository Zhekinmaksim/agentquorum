# v0.1.8
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
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

        verdict = self._deliberate(case["terms"], claimant_evidence, respondent_evidence)
        case["verdict"] = verdict
        case["has_verdict"] = True
        case["phase"] = PHASE_RULED
        self._save_case(case_id, case)

    def _deliberate(self, terms: str, claimant_arg: str, respondent_arg: str) -> Verdict:
        # The Studio runner surface currently available in this environment does
        # not expose prompt-execution primitives. For the live demo path we
        # apply a deterministic ruling over the structured JSON submissions.
        claimant = _safe_json_obj(claimant_arg)
        respondent = _safe_json_obj(respondent_arg)

        expected = str(claimant.get("expected_delivery_utc", ""))
        observed = str(claimant.get("observed_delivery_utc", ""))
        missing_rows = int(claimant.get("missing_rows", 0) or 0)
        late = expected != "" and observed != "" and observed > expected

        respondent_text = json.dumps(respondent, sort_keys=True).lower()
        outage_claimed = ("outage" in respondent_text) or ("degradation" in respondent_text)

        if late and missing_rows > 0:
            ruling = RULING_SPLIT if outage_claimed else RULING_CLAIMANT
            bps = 7000 if outage_claimed else 10000
            rationale = "Delivery was late and incomplete; outage mitigation reduces but does not erase liability."
        elif late or missing_rows > 0:
            ruling = RULING_SPLIT
            bps = 6000
            rationale = "Evidence shows partial non-performance; claimant receives a majority share of the pot."
        else:
            ruling = RULING_RESPONDENT
            bps = 0
            rationale = "Claimant did not prove a compensable delivery failure from the submitted records."

        return {
            "ruling": ruling,
            "claimant_award_bps": bps,
            "rationale": rationale,
            "reasoning_commitment": json.dumps(
                {"ruling": ruling, "claimant_award_bps": bps},
                sort_keys=True,
                separators=(",", ":"),
            ),
            "decided_at": 0,
        }

    def _build_prompt(self, terms: str, claimant_arg: str, respondent_arg: str) -> str:
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
                "Return only JSON with keys ruling, claimant_award_bps, rationale.",
                "Allowed ruling values: CLAIMANT, RESPONDENT, SPLIT, INSUFFICIENT.",
                "If CLAIMANT, set claimant_award_bps to 10000.",
                "If RESPONDENT, set claimant_award_bps to 0.",
                "If SPLIT, set claimant_award_bps between 1 and 9999.",
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


def _extract_json(raw: str) -> str:
    s = raw.strip()
    fence = "`" * 3
    if s.startswith(fence + "json"):
        s = s[len(fence) + 4 :]
    elif s.startswith(fence):
        s = s[len(fence) :]
    if s.endswith(fence):
        s = s[: -len(fence)]

    start = s.find("{")
    end = s.rfind("}")
    fallback = {
        "ruling": RULING_INSUFFICIENT,
        "claimant_award_bps": 0,
        "rationale": "Model returned no parseable verdict.",
    }

    if start == -1 or end == -1 or end < start:
        return json.dumps(fallback, sort_keys=True, separators=(",", ":"))

    try:
        obj = json.loads(s[start : end + 1])
    except Exception:
        return json.dumps(fallback, sort_keys=True, separators=(",", ":"))

    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def _safe_json_obj(raw: str) -> dict[str, typing.Any]:
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _empty_verdict() -> Verdict:
    return {
        "ruling": "",
        "claimant_award_bps": 0,
        "rationale": "",
        "reasoning_commitment": "",
        "decided_at": 0,
    }
