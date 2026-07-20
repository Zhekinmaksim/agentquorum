import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, id as keccakId } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { localnet } from "genlayer-js/chains";
import { escrowAbi } from "../lib/escrowAbi";

const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14A34";
const GENLAYER_RPC_URL = "https://studio.genlayer.com/api";
const ESCROW_ADDRESS = "0x0a2b41f8814f310A09e0Fbe256B55464d408666B";
const TRIBUNAL_ADDRESS = "0x2A9358126C10dB2c64d05A66ae372fD582A93486" as `0x${string}` & { length: 42 };

const PHASE_LABELS = ["None", "Open", "Ready", "Settled", "Refunded"] as const;
const DEFAULT_LOOKUP_CASE = "AQ-0";

type WalletState = {
  address: string;
  chainId: number;
};

type NetworkSnapshot = {
  totalCases: number | null;
  relayer: string;
  worker: string;
};

type LookupState = {
  caseId: string;
  caseKey: string;
  escrowPhase: string;
  escrowCaseId: string;
  tribunalCase: string | null;
  verdict: string | null;
};

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    };
  }
}

function injectedEthereum() {
  return window.ethereum;
}

function trimAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getEscrowContract(runner: JsonRpcProvider | BrowserProvider | Awaited<ReturnType<BrowserProvider["getSigner"]>>) {
  return new Contract(ESCROW_ADDRESS, escrowAbi, runner);
}

function safeJson(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default function LiveConsole() {
  const baseProvider = useMemo(() => new JsonRpcProvider(BASE_SEPOLIA_RPC), []);
  const tribunalClient = useMemo(
    () =>
      createClient({
        chain: localnet,
        endpoint: GENLAYER_RPC_URL,
        // Dummy account keeps the SDK on its HTTP transport path for read-only calls.
        account: createAccount("0x1111111111111111111111111111111111111111111111111111111111111111"),
      }),
    [],
  );
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [network, setNetwork] = useState<NetworkSnapshot>({ totalCases: null, relayer: "", worker: "" });
  const [nextCaseId, setNextCaseId] = useState("");
  const [respondent, setRespondent] = useState("");
  const [lookupCaseId, setLookupCaseId] = useState(DEFAULT_LOOKUP_CASE);
  const [lookup, setLookup] = useState<LookupState | null>(null);
  const [walletError, setWalletError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [submitHash, setSubmitHash] = useState("");
  const [busy, setBusy] = useState<"" | "connect" | "submit" | "lookup">("");

  useEffect(() => {
    void refreshNetwork();
  }, []);

  async function refreshNetwork() {
    const escrow = getEscrowContract(baseProvider);
    const [relayer, worker, totalCasesRaw] = await Promise.all([
      escrow.tribunalRelayer(),
      escrow.discoveryWorker(),
      tribunalClient.readContract({ address: TRIBUNAL_ADDRESS, functionName: "total_cases", args: [] }),
    ]);

    const totalCases = Number(totalCasesRaw);
    setNetwork({ relayer, worker, totalCases });
    setNextCaseId((current) => current || `AQ-${totalCases}`);
  }

  async function connectWallet() {
    if (!injectedEthereum()) {
      setWalletError("No injected wallet found. Open the site in a browser with MetaMask or Rabby.");
      return;
    }

    setBusy("connect");
    setWalletError("");

    try {
      const browserProvider = new BrowserProvider(injectedEthereum()!);
      const accounts = await browserProvider.send("eth_requestAccounts", []);
      const networkInfo = await browserProvider.getNetwork();
      setWallet({ address: accounts[0], chainId: Number(networkInfo.chainId) });
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function switchToBaseSepolia() {
    if (!injectedEthereum()) return;
    try {
      await injectedEthereum()!.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
      });
      setWallet((current) => current ? { ...current, chainId: BASE_SEPOLIA_CHAIN_ID } : current);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : String(error));
    }
  }

  async function submitOpenCase() {
    if (!wallet) {
      setSubmitError("Connect a wallet first.");
      return;
    }
    if (wallet.chainId !== BASE_SEPOLIA_CHAIN_ID) {
      setSubmitError("Switch the connected wallet to Base Sepolia first.");
      return;
    }
    if (!nextCaseId.trim()) {
      setSubmitError("Case ID is required.");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(respondent.trim())) {
      setSubmitError("Respondent must be a valid 0x address.");
      return;
    }

    setBusy("submit");
    setSubmitError("");
    setSubmitHash("");

    try {
      const browserProvider = new BrowserProvider(injectedEthereum()!);
      const signer = await browserProvider.getSigner();
      const escrow = getEscrowContract(signer);
      const caseId = nextCaseId.trim();
      const caseKey = keccakId(caseId);

      const tx = await escrow.openCase(caseKey, respondent.trim(), caseId);
      await tx.wait();
      setSubmitHash(tx.hash);
      setLookupCaseId(caseId);
      await refreshCase(caseId);
      await refreshNetwork();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function refreshCase(caseId = lookupCaseId) {
    const normalized = caseId.trim();
    if (!normalized) {
      setLookupError("Case ID is required.");
      return;
    }

    setBusy("lookup");
    setLookupError("");

    try {
      const caseKey = keccakId(normalized);
      const escrow = getEscrowContract(baseProvider);
      const [phaseRaw, escrowCaseId, tribunalCaseRaw, verdictRaw] = await Promise.all([
        escrow.phaseOf(caseKey),
        escrow.caseIdOf(caseKey).catch(() => ""),
        tribunalClient.readContract({ address: TRIBUNAL_ADDRESS, functionName: "get_case", args: [normalized] }).then(String),
        tribunalClient
          .readContract({ address: TRIBUNAL_ADDRESS, functionName: "get_verdict", args: [normalized] })
          .then((value) => (value == null ? null : String(value)))
          .catch(() => null),
      ]);

      const phaseIndex = Number(phaseRaw);
      setLookup({
        caseId: normalized,
        caseKey,
        escrowPhase: PHASE_LABELS[phaseIndex] ?? `Unknown (${phaseIndex})`,
        escrowCaseId,
        tribunalCase: tribunalCaseRaw,
        verdict: verdictRaw,
      });
    } catch (error) {
      setLookup(null);
      setLookupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  const parsedTribunalCase = safeJson(lookup?.tribunalCase ?? null);
  const parsedVerdict = safeJson(lookup?.verdict ?? null);

  return (
    <section id="live-state" className="max-w-[1180px] mx-auto px-7 pb-14">
      <div className="border-t-[3px] border-double border-ink pt-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="font-sans text-[11px] font-800 tracking-[0.12em] uppercase text-oxblood">Live Console</div>
            <div className="font-display text-[28px] leading-tight mt-1">Wallet, submit, verdict, and live chain state.</div>
          </div>
          <button
            type="button"
            onClick={() => { void refreshNetwork(); void refreshCase(); }}
            className="border border-ink px-3 py-1.5 font-sans text-[11px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors"
          >
            Refresh Live State
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 mt-5">
          <div className="space-y-5">
            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">Network Snapshot</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <div className="border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Tribunal</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{TRIBUNAL_ADDRESS}</div>
                </div>
                <div className="border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Escrow</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{ESCROW_ADDRESS}</div>
                </div>
                <div className="border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Total Cases</div>
                  <div className="font-display text-[28px] leading-none mt-1">{network.totalCases ?? "..."}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div className="border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Tribunal Relayer</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{network.relayer || "Loading..."}</div>
                </div>
                <div className="border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Discovery Worker</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{network.worker || "Loading..."}</div>
                </div>
              </div>
            </div>

            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">Wallet Flow</div>
              <div className="mt-3 flex flex-wrap gap-3 items-center">
                {wallet ? (
                  <div className="font-display text-[18px]">
                    Connected: <span className="text-oxblood">{trimAddress(wallet.address)}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { void connectWallet(); }}
                    disabled={busy === "connect"}
                    className="bg-ink text-white px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-oxblood transition-colors disabled:opacity-60"
                  >
                    {busy === "connect" ? "Connecting..." : "Connect Wallet"}
                  </button>
                )}

                {wallet && wallet.chainId !== BASE_SEPOLIA_CHAIN_ID && (
                  <button
                    type="button"
                    onClick={() => { void switchToBaseSepolia(); }}
                    className="border border-ink px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors"
                  >
                    Switch to Base Sepolia
                  </button>
                )}
              </div>
              <div className="mt-2 font-sans text-[11px] text-gray-450">
                Chain status: {wallet ? `${wallet.chainId === BASE_SEPOLIA_CHAIN_ID ? "Base Sepolia" : `Wrong chain (${wallet.chainId})`}` : "No wallet connected"}
              </div>
              {walletError && <div className="mt-2 font-sans text-[11px] text-oxblood">{walletError}</div>}
            </div>

            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">Submit Flow</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <label className="block">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450 mb-1">Suggested Case ID</div>
                  <input
                    value={nextCaseId}
                    onChange={(event) => setNextCaseId(event.target.value)}
                    className="w-full border border-hair bg-white px-3 py-2 font-mono text-[12px] outline-none"
                  />
                </label>
                <label className="block">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450 mb-1">Respondent Address</div>
                  <input
                    value={respondent}
                    onChange={(event) => setRespondent(event.target.value)}
                    placeholder="0x..."
                    className="w-full border border-hair bg-white px-3 py-2 font-mono text-[12px] outline-none"
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => { void submitOpenCase(); }}
                  disabled={busy === "submit"}
                  className="bg-ink text-white px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-oxblood transition-colors disabled:opacity-60"
                >
                  {busy === "submit" ? "Submitting..." : "Open Escrow Case"}
                </button>
                <div className="font-sans text-[11px] text-gray-450">
                  Case key will be derived live as <span className="font-mono">keccak256(caseId)</span>.
                </div>
              </div>
              {submitHash && (
                <div className="mt-3 border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Submitted Transaction</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{submitHash}</div>
                </div>
              )}
              {submitError && <div className="mt-2 font-sans text-[11px] text-oxblood">{submitError}</div>}
            </div>
          </div>

          <div className="space-y-5">
            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">Verdict Fetch Flow</div>
              <div className="flex gap-3 mt-3">
                <input
                  value={lookupCaseId}
                  onChange={(event) => setLookupCaseId(event.target.value)}
                  className="flex-1 border border-hair bg-white px-3 py-2 font-mono text-[12px] outline-none"
                  placeholder="AQ-1"
                />
                <button
                  type="button"
                  onClick={() => { void refreshCase(); }}
                  disabled={busy === "lookup"}
                  className="bg-ink text-white px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-oxblood transition-colors disabled:opacity-60"
                >
                  {busy === "lookup" ? "Fetching..." : "Fetch"}
                </button>
              </div>
              <div className="mt-2 font-sans text-[11px] text-gray-450">
                Reads both chains: Base Sepolia for escrow phase, GenLayer for case and verdict.
              </div>
              {lookupError && <div className="mt-2 font-sans text-[11px] text-oxblood">{lookupError}</div>}
            </div>

            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">Live Chain State</div>
              {lookup ? (
                <div className="space-y-3 mt-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="border border-hair p-3">
                      <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Case ID</div>
                      <div className="font-mono text-[12px] mt-1">{lookup.caseId}</div>
                    </div>
                    <div className="border border-hair p-3">
                      <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Escrow Phase</div>
                      <div className="font-display text-[22px] leading-none mt-1">{lookup.escrowPhase}</div>
                    </div>
                  </div>
                  <div className="border border-hair p-3">
                    <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Case Key</div>
                    <div className="font-mono text-[11px] mt-1 break-all">{lookup.caseKey}</div>
                  </div>
                  <div className="border border-hair p-3">
                    <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Escrow Mapping</div>
                    <div className="font-mono text-[11px] mt-1">{lookup.escrowCaseId || "No Base-side case mapping found yet."}</div>
                  </div>
                  <div className="border border-hair p-3">
                    <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Tribunal Case</div>
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-ink-soft">{JSON.stringify(parsedTribunalCase, null, 2)}</pre>
                  </div>
                  <div className="border border-hair p-3">
                    <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Verdict</div>
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-ink-soft">{parsedVerdict ? JSON.stringify(parsedVerdict, null, 2) : "No verdict returned yet."}</pre>
                  </div>
                </div>
              ) : (
                <div className="mt-3 font-sans text-[12px] text-gray-450">
                  Fetch a case by `AQ-n` to show the live escrow phase and tribunal verdict.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
