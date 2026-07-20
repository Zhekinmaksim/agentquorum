import { useState } from "react";
import { motion } from "motion/react";

const GITHUB_REPO = "https://github.com/Zhekinmaksim/agentquorum";
const INSIDE = [
  { title: "Order of Procedure", blurb: "How a cause is sealed, heard, and entered.", href: "#procedure" },
  { title: "The Record", blurb: "Published holdings. Evidence stays sealed.", href: "#record" },
  { title: "Documentation", blurb: "Contracts, worker, threat model.", href: "#documentation" },
  { title: "Grant Dossier", blurb: "Repository, architecture, and deployment record.", href: GITHUB_REPO },
];

const SEATS: [string, string][] = [
  ["chair", "Propose"],
  ["s2", "Concur"],
  ["s3", "Concur"],
  ["s4", "Dissent"],
  ["s5", "Concur"],
];
const seatColor = (label: string) =>
  label === "Dissent" ? "text-oxblood" : label === "Propose" ? "text-ink" : "text-[#2f6b35]";

export default function Hero() {
  const [draft, setDraft] = useState("");

  function openCauseDraft() {
    const summary = draft.trim();
    const title = summary ? `Cause intake: ${summary.slice(0, 72)}` : "Cause intake";
    const body = [
      "Proposed dispute",
      "",
      summary || "(Describe the dispute here.)",
      "",
      "---",
      "Submitted from the AgentQuorum landing page.",
    ].join("\n");

    const url = `${GITHUB_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="bg-bg-base">
      <div className="max-w-[1180px] mx-auto px-7 pt-[62px] pb-10">
        {/* MASTHEAD */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7 }}
          className="text-center pt-4"
        >
          <div className="font-sans text-[clamp(11px,1.4vw,16px)] font-800 tracking-[0.5em] uppercase text-oxblood pl-[0.5em] mb-1.5">
            Reports of the Tribunal
          </div>
          <h1 className="font-masthead font-400 leading-[0.88] text-[clamp(90px,16vw,190px)]">
            Quorum
          </h1>
          <div className="h-[5px] bg-ink w-full max-w-[1120px] mx-auto mt-5" />
          <div className="h-px bg-ink w-full max-w-[1120px] mx-auto mt-2" />
          <div className="font-display italic text-[clamp(15px,2.2vw,21px)] text-ink-soft mt-4">
            Sealed-evidence arbitration for autonomous agents
          </div>
          <div className="mt-3.5 py-1.5 flex justify-between flex-wrap gap-2 font-sans text-[11px] tracking-[0.06em] uppercase text-ink-soft">
            <span className="text-ink font-700">Vol. I &middot; No. 7</span>
            <span>Confidential Proceedings &middot; In Camera</span>
            <span className="text-ink font-700">GenLayer &times; Inco Lightning</span>
          </div>
        </motion.div>

        {/* FRONT PAGE */}
        <div className="grid grid-cols-1 lg:grid-cols-[2.4fr_5fr_4fr] mt-0">
          {/* LEFT RAIL */}
          <div className="lg:pr-6 lg:border-r lg:border-hair pt-6">
            <div className="font-sans text-[11px] font-800 tracking-[0.12em] uppercase border-b-2 border-ink pb-1.5 mb-3">Inside</div>
            {INSIDE.map((item) => (
              <a key={item.title} href={item.href} className="block py-3 border-b border-hair group">
                <div className="font-display font-600 text-[17px] leading-tight group-hover:text-oxblood transition-colors">{item.title}</div>
                <div className="font-sans text-[11.5px] text-gray-450 mt-1">{item.blurb}</div>
              </a>
            ))}
            <div className="mt-4 border border-ink p-3 font-mono text-[10.5px] leading-relaxed text-ink-soft">
              <span className="text-ink font-500">Est. 2026</span>
              <br />Intelligent Contract tribunal.
              <br />Confidential euint bonds.
              <br />Verdict of record only.
            </div>
          </div>

          {/* LEAD STORY */}
          <div className="lg:px-6 lg:border-r lg:border-hair pt-6">
            <div className="font-sans text-[12px] font-800 tracking-[0.06em] uppercase text-oxblood flex items-center gap-2 mb-2.5">
              <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.6 }} className="w-2 h-2 rounded-full bg-oxblood" />
              Live Cause &middot; In Camera
            </div>
            <motion.h2
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.15 }}
              className="font-display font-900 text-[clamp(30px,4vw,50px)] leading-[1.02] tracking-[-0.015em]"
            >
              A committee rules in private, and reveals only the{" "}
              <span className="text-oxblood">verdict.</span>
            </motion.h2>
            <div className="font-sans text-[12px] uppercase tracking-[0.03em] my-3.5">
              By The Tribunal{" "}
              <span className="font-display normal-case tracking-normal italic text-gray-450">&middot; sitting in confidential session</span>
            </div>
            <div className="[column-count:2] [column-gap:26px] font-display text-[15.5px] leading-[1.5] text-ink-soft text-justify">
              <p className="mb-2.5">
                <span className="float-left font-display font-900 text-[64px] leading-[0.66] pr-2 pt-1.5 text-ink">T</span>
                wo agents strike a deal. It goes wrong. Their only recourse today is a trusted human, a centralized escrow, or a smart contract that cannot read a contract. Quorum convenes a tribunal instead.
              </p>
              <p className="mb-2.5">Each party submits encrypted evidence and a confidential bond. A committee of artificial validators reasons over the plaintext behind sealed doors, puts a single ruling to a roll call, and enters only the outcome into the public record.</p>
              <p>The evidence itself is never unsealed. Bond amounts are never disclosed. What survives onto the chain is the holding, the split, and a short rationale. It is the one pairing the field is not building: GenLayer's judgment over Inco Lightning's confidentiality.</p>
            </div>
            <div id="cause-intake" className="mt-4 border-t-2 border-ink pt-3.5">
              <div className="font-sans text-[11px] font-800 tracking-[0.08em] uppercase mb-2">Submit a cause to the tribunal</div>
              <div className="bg-white border border-black/[0.12] pl-3.5 pr-1 py-1 flex items-center">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Describe the dispute..."
                  className="bg-transparent flex-1 outline-none font-sans text-[14px] text-ink placeholder:text-gray-350 py-2"
                />
                <button
                  type="button"
                  aria-label="Open a cause"
                  onClick={openCauseDraft}
                  className="bg-ink text-white w-[34px] h-[34px] flex items-center justify-center hover:bg-oxblood transition-colors shrink-0"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
              <div className="mt-2 font-sans text-[11px] text-gray-450">
                This MVP opens a prefilled GitHub issue instead of a live on-chain case flow.
              </div>
            </div>
          </div>

          {/* SPECIMEN CAUSE (the hook) */}
          <div id="record" className="lg:pl-6 pt-6">
            <div className="font-sans text-[11px] font-800 tracking-[0.12em] uppercase border-b-2 border-ink pb-1.5 mb-3">Specimen Cause</div>
            <div className="border-2 border-ink">
              <div className="bg-ink text-bg-base px-3.5 py-2 font-sans text-[11px] font-700 tracking-[0.14em] uppercase flex justify-between">
                <span>Cause AQ-0007</span><span>Of Record</span>
              </div>
              <div className="p-3.5">
                <div className="font-display text-[14px] leading-snug text-ink-soft pb-3 border-b border-hair">
                  <b className="text-ink">Indexer Agent</b> to deliver a complete Base index within six hours. Escrow releases on verified delivery. Completeness disputes go to the tribunal.
                </div>
                <div className="grid grid-cols-2 border-b border-hair">
                  {[
                    { role: "Claimant", who: "Client Agent", bond: "1,250 GEN", ev: "received 06:51:22Z\nexpected 06:00:00Z\n18,402 / 24,110 rows\n51 min late, partial", edge: true },
                    { role: "Respondent", who: "Indexer Agent", bond: "980 GEN", ev: "delivered 06:51:22Z\nRPC degraded 05:10-06:30\nall available rows\nforce majeure cited", edge: false },
                  ].map((p, idx) => (
                    <div key={p.role} className={`py-3 ${p.edge ? "pr-3 border-r border-hair" : "pl-3"}`}>
                      <div className="font-sans text-[10px] font-800 uppercase tracking-[0.08em] text-oxblood">{p.role}</div>
                      <div className="font-display font-700 text-[16px] mt-0.5">{p.who}</div>
                      <div className="font-sans text-[9px] font-700 uppercase tracking-[0.06em] text-gray-450 mt-2.5 mb-1">Bond</div>
                      <span className="font-mono text-[12px] blur-[4px] select-none">{p.bond}</span>
                      <div className="font-sans text-[9px] font-700 uppercase tracking-[0.06em] text-gray-450 mt-2.5 mb-1">Evidence</div>
                      <motion.pre
                        initial={{ filter: "blur(4px)" }}
                        animate={{ filter: "blur(0px)" }}
                        transition={{ delay: 1.1, duration: 0.7 }}
                        className="font-mono text-[10.5px] leading-[1.55] text-ink-soft whitespace-pre-wrap"
                      >{p.ev}</motion.pre>
                    </div>
                  ))}
                </div>
                <div className="pt-3">
                  <div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.16em] text-gray-450 mb-1.5">
                    <span>roll call</span><span>in camera</span>
                  </div>
                  <div className="grid grid-cols-5 border border-ink">
                    {SEATS.map(([sn, bal], i) => (
                      <div key={sn} className={`py-2 text-center ${i < 4 ? "border-r border-hair" : ""}`}>
                        <div className="font-mono text-[8px] text-gray-350">{sn}</div>
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 1.5 + i * 0.3, duration: 0.3 }}
                          className={`font-sans text-[9.5px] font-700 uppercase mt-1.5 ${seatColor(bal)}`}
                        >{bal}</motion.div>
                      </div>
                    ))}
                  </div>
                </div>
                <motion.div
                  id="opinion"
                  initial={{ opacity: 0, scale: 1.03 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 3.1, duration: 0.5 }}
                  className="mt-3 border-t-[3px] border-double border-ink pt-2.5"
                >
                  <div className="font-sans text-[9px] font-800 uppercase tracking-[0.16em] text-gray-450 mb-1">
                    Published Verdict
                  </div>
                  <div className="font-sans text-[10px] font-800 uppercase tracking-[0.07em]">Opinion of the Tribunal</div>
                  <div className="flex items-baseline gap-3 my-1.5">
                    <span className="font-display font-900 text-[30px] leading-none">Split</span>
                    <span className="font-sans text-[11px] border border-ink px-2 py-1 text-ink-soft">claimant <b className="text-oxblood">6,500 bps</b></span>
                  </div>
                  <div className="font-display italic text-[13px] text-ink-soft border-l-[3px] border-oxblood pl-2.5">
                    Late and incomplete, but a logged RPC outage partially excuses it. Fault shared.
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-8 mt-8">
          <div id="procedure" className="border-t-[3px] border-double border-ink pt-4">
            <div className="font-sans text-[11px] font-800 tracking-[0.12em] uppercase mb-3">Order of Procedure</div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {[
                ["Open", "Create the cause and post the terms."],
                ["Seal", "Encrypt evidence and commit its hash."],
                ["Release", "Gate the evidence keys to the worker only."],
                ["Convene", "Let the tribunal review plaintext in private."],
                ["Enter", "Settle the encrypted pot from the verdict."],
              ].map(([step, detail]) => (
                <div key={step} className="border border-hair p-3 bg-white/60">
                  <div className="font-sans text-[10px] font-800 tracking-[0.08em] uppercase text-oxblood">{step}</div>
                  <div className="font-display text-[15px] leading-snug mt-1.5 text-ink-soft">{detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div id="documentation" className="border-t-[3px] border-double border-ink pt-4">
            <div className="font-sans text-[11px] font-800 tracking-[0.12em] uppercase mb-3">Documentation</div>
            <div className="space-y-3">
              {[
                { label: "Repository", href: GITHUB_REPO, note: "Full project source, deploy scripts, and worker code." },
                { label: "Architecture", href: `${GITHUB_REPO}/blob/main/docs/ARCHITECTURE.md`, note: "Threat model, data flow, and confidentiality boundary." },
                { label: "README", href: `${GITHUB_REPO}#readme`, note: "Main contract files, run order, and status." },
              ].map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer" className="block border border-hair p-3 bg-white/60 hover:border-ink transition-colors">
                  <div className="font-display font-700 text-[18px] leading-tight">{link.label}</div>
                  <div className="font-sans text-[11.5px] text-gray-450 mt-1">{link.note}</div>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* COLOPHON */}
        <div style={{ borderTop: "3px double #121212" }} className="mt-8 pt-3.5 flex justify-between flex-wrap gap-2 font-sans text-[11px] tracking-[0.04em] text-gray-450">
          <span>AGENTQUORUM.XYZ</span>
          <span>2026 &middot; SEALED-EVIDENCE ARBITRATION</span>
          <span>GENLAYER + INCO LIGHTNING</span>
        </div>
      </div>
    </section>
  );
}
