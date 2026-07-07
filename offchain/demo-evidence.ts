type Role = "claimant" | "respondent";

export function demoEvidenceText(role: Role) {
  if (role === "claimant") {
    return JSON.stringify({
      side: "claimant",
      expected_delivery_utc: "2026-06-22T12:00:00Z",
      observed_delivery_utc: "2026-06-22T12:51:22Z",
      missing_rows: 5708,
      claim: "late delivery and incomplete output",
    }, null, 2);
  }

  return JSON.stringify({
    side: "respondent",
    incident_window_utc: "2026-06-22T11:10:00Z/2026-06-22T12:30:00Z",
    explanation: "upstream RPC degradation and partial source outage",
    mitigation: "delivered all rows available during outage window",
    defense: "force majeure",
  }, null, 2);
}
