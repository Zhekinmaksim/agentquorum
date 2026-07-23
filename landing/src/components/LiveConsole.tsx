import { useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, getAddress, id as keccakId, parseEther } from "ethers";
import { createClient } from "genlayer-js";
import { TransactionStatus } from "genlayer-js/types";
import { escrowAbi } from "../lib/escrowAbi";
import { GENLAYER_CHAIN, GENLAYER_NETWORK_NAME } from "../lib/genlayerNetwork";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14A34";
const GENLAYER_CHAIN_ID = GENLAYER_CHAIN.id;
const ESCROW_ADDRESS = env.VITE_ESCROW_ADDRESS ?? "0x0a2b41f8814f310A09e0Fbe256B55464d408666B";
const TRIBUNAL_ADDRESS = (env.VITE_TRIBUNAL_ADDRESS ??
  "0x3d9d27C990f9adCa2ecd5Dc2DC3B3EC910999CAc") as `0x${string}` & { length: 42 };
const INCO_OP_VALUE = parseEther("0.0001");

const PHASE_LABELS = ["None", "Open", "Ready", "Settled", "Refunded"] as const;
const DEFAULT_LOOKUP_CASE = "AQ-0";

type WalletState = {
  address: `0x${string}`;
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
  tribunalStatus: string;
  verdict: string | null;
};

type Role = "claimant" | "respondent";

type SealedDraft = {
  bond: string;
  bondCt: `0x${string}`;
  blobSize: number;
  caseId: string;
  caseKey: `0x${string}`;
  commitment: `0x${string}`;
  downloadUrl: string;
  fileName: string;
  keyCt: `0x${string}`;
  role: Role;
};

type BasePublishState = {
  fundBondTx: string;
  sealKeyTx: string;
};

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
    };
  }
}

function injectedEthereum() {
  return window.ethereum;
}

function trimAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeAddress(address: string) {
  try {
    return getAddress(address.trim());
  } catch {
    return null;
  }
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

function describeChain(chainId: number) {
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return "Base Sepolia";
  if (chainId === GENLAYER_CHAIN_ID) return GENLAYER_CHAIN.name;
  return `Wrong chain (${chainId})`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsText(file);
  });
}

export default function LiveConsole() {
  const baseProvider = useMemo(() => new JsonRpcProvider(BASE_SEPOLIA_RPC), []);
  const tribunalClient = useMemo(() => createClient({ chain: GENLAYER_CHAIN }), []);

  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [network, setNetwork] = useState<NetworkSnapshot>({ totalCases: null, relayer: "", worker: "" });
  const [nextCaseId, setNextCaseId] = useState("");
  const [caseTerms, setCaseTerms] = useState("Deliver index in 6h with complete rows and reproducible methodology.");
  const [respondent, setRespondent] = useState("");
  const [lookupCaseId, setLookupCaseId] = useState(DEFAULT_LOOKUP_CASE);
  const [lookup, setLookup] = useState<LookupState | null>(null);

  const [sealCaseId, setSealCaseId] = useState("");
  const [sealRole, setSealRole] = useState<Role>("claimant");
  const [bondAmount, setBondAmount] = useState("1000");
  const [evidenceText, setEvidenceText] = useState("");
  const [evidenceFileName, setEvidenceFileName] = useState("");
  const [evidenceUri, setEvidenceUri] = useState("");
  const [sealedDraft, setSealedDraft] = useState<SealedDraft | null>(null);
  const [genPublishTx, setGenPublishTx] = useState("");
  const [basePublish, setBasePublish] = useState<BasePublishState | null>(null);
  const [readyHash, setReadyHash] = useState("");

  const [walletError, setWalletError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitNotice, setSubmitNotice] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [lookupNotice, setLookupNotice] = useState("");
  const [sealError, setSealError] = useState("");
  const [genPublishError, setGenPublishError] = useState("");
  const [basePublishError, setBasePublishError] = useState("");
  const [readyError, setReadyError] = useState("");
  const [submitGenHash, setSubmitGenHash] = useState("");
  const [submitHash, setSubmitHash] = useState("");
  const [busy, setBusy] = useState<"" | "connect" | "submit" | "lookup" | "seal" | "publishGen" | "publishBase" | "ready">("");
  const normalizedRespondent = normalizeAddress(respondent);
  const samePartyAsConnectedWallet = !!wallet && normalizedRespondent === wallet.address;

  useEffect(() => {
    void refreshNetwork();
  }, []);

  useEffect(() => {
    return () => {
      if (sealedDraft?.downloadUrl) URL.revokeObjectURL(sealedDraft.downloadUrl);
    };
  }, [sealedDraft?.downloadUrl]);

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
    setSealCaseId((current) => current || `AQ-${totalCases}`);
  }

  async function expectedCaseIdFromGenLayer() {
    const totalCasesRaw = await tribunalClient.readContract({
      address: TRIBUNAL_ADDRESS,
      functionName: "total_cases",
      args: [],
    });
    return `AQ-${Number(totalCasesRaw)}`;
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
      const accounts = (await browserProvider.send("eth_requestAccounts", [])) as string[];
      const networkInfo = await browserProvider.getNetwork();
      setWallet({ address: getAddress(accounts[0]) as `0x${string}`, chainId: Number(networkInfo.chainId) });
    } catch (error) {
      setWalletError(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function syncWalletFromProvider(expectedAddress?: `0x${string}`) {
    const browserProvider = new BrowserProvider(injectedEthereum()!);
    const accounts = (await browserProvider.send("eth_accounts", [])) as string[];
    const networkInfo = await browserProvider.getNetwork();
    const fallback = wallet?.address ?? expectedAddress;
    const address = accounts[0] ? getAddress(accounts[0]) : fallback;
    if (!address) throw new Error("No connected wallet address found after network switch.");
    setWallet({ address: address as `0x${string}`, chainId: Number(networkInfo.chainId) });
  }

  async function ensureBaseSepoliaChain() {
    if (!injectedEthereum()) throw new Error("No injected wallet found.");
    await injectedEthereum()!.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
    });
    await syncWalletFromProvider();
  }

  async function switchToBaseSepolia() {
    try {
      await ensureBaseSepoliaChain();
    } catch (error) {
      setWalletError(errorMessage(error));
    }
  }

  async function ensureGenLayerChain() {
    if (!wallet) throw new Error("Connect a wallet first.");
    if (!injectedEthereum()) throw new Error("No injected wallet found.");
    const client = createClient({
      chain: GENLAYER_CHAIN,
      account: wallet.address,
      provider: injectedEthereum()!,
    });
    await client.connect(GENLAYER_NETWORK_NAME, "npm");
    await syncWalletFromProvider(wallet.address);
  }

  async function switchToGenLayer() {
    try {
      await ensureGenLayerChain();
    } catch (error) {
      setWalletError(errorMessage(error));
    }
  }

  async function submitOpenCase() {
    if (!wallet) {
      setSubmitError("Connect a wallet first.");
      return;
    }
    if (!nextCaseId.trim()) {
      setSubmitError("Case ID is required.");
      return;
    }
    if (!caseTerms.trim()) {
      setSubmitError("Case terms are required.");
      return;
    }
    if (!normalizedRespondent) {
      setSubmitError("Respondent must be a valid 0x address.");
      return;
    }
    if (normalizedRespondent === wallet.address) {
      setSubmitError("Respondent must be a different wallet than the connected claimant.");
      return;
    }
    setBusy("submit");
    setSubmitError("");
    setSubmitNotice("");
    setSubmitGenHash("");
    setSubmitHash("");

    try {
      const caseId = nextCaseId.trim();
      const expectedCaseId = await expectedCaseIdFromGenLayer();
      if (caseId !== expectedCaseId) {
        setNextCaseId(expectedCaseId);
        throw new Error(`GenLayer currently expects ${expectedCaseId}. Case numbering is owned by GenLayer, so retry with that ID.`);
      }
      const caseKey = keccakId(caseId);
      await ensureGenLayerChain();
      const client = createClient({
        chain: GENLAYER_CHAIN,
        account: wallet.address,
        provider: injectedEthereum()!,
      });
      const genTxHash = await client.writeContract({
        address: TRIBUNAL_ADDRESS,
        functionName: "open_case",
        args: [caseTerms.trim(), caseKey, normalizedRespondent],
        value: 0n,
      });
      await client.waitForTransactionReceipt({ hash: genTxHash, status: TransactionStatus.ACCEPTED });
      await tribunalClient.readContract({ address: TRIBUNAL_ADDRESS, functionName: "get_case", args: [caseId] });
      setSubmitGenHash(genTxHash);

      await ensureBaseSepoliaChain();
      const browserProvider = new BrowserProvider(injectedEthereum()!);
      const signer = await browserProvider.getSigner();
      const escrow = getEscrowContract(signer);
      const tx = await escrow.openCase(caseKey, normalizedRespondent, caseId);
      await tx.wait();

      setSubmitHash(tx.hash);
      setSubmitNotice("GenLayer cause opened first, then mirrored to Base with the same AQ-n and caseKey.");
      setSealCaseId(caseId);
      setLookupCaseId(caseId);
      await refreshCase(caseId);
      await refreshNetwork();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function handleEvidenceFile(file: File | null) {
    if (!file) return;

    try {
      const text = await readFileAsText(file);
      setEvidenceText(text);
      setEvidenceFileName(file.name);
    } catch (error) {
      setSealError(errorMessage(error));
    }
  }

  async function sealEvidenceInBrowser() {
    if (!wallet) {
      setSealError("Connect a wallet first. The wallet address is part of the Inco encryption context.");
      return;
    }
    if (!sealCaseId.trim()) {
      setSealError("Case ID is required.");
      return;
    }
    if (!evidenceText.trim()) {
      setSealError("Paste evidence text or load a file first.");
      return;
    }

    let bond: bigint;
    try {
      bond = BigInt(bondAmount.trim());
    } catch {
      setSealError("Bond amount must be an integer.");
      return;
    }

    setBusy("seal");
    setSealError("");
    setGenPublishError("");
    setBasePublishError("");
    setReadyError("");
    setGenPublishTx("");
    setBasePublish(null);
    setReadyHash("");

    try {
      const [{ Lightning }, { handleTypes }, { bytesToHex, seal }] = await Promise.all([
        import("@inco/js/lite"),
        import("@inco/js"),
        import("../lib/evidenceCrypto"),
      ]);
      const sealed = seal(evidenceText);
      const lightning = await Lightning.baseSepoliaTestnet();
      const keyCt = await lightning.encrypt(BigInt(`0x${bytesToHex(sealed.symKey)}`), {
        accountAddress: wallet.address,
        dappAddress: ESCROW_ADDRESS,
        handleType: handleTypes.euint256,
      });
      const bondCt = await lightning.encrypt(bond, {
        accountAddress: wallet.address,
        dappAddress: ESCROW_ADDRESS,
        handleType: handleTypes.euint256,
      });
      const blobPayload = new Uint8Array(sealed.blob.length);
      blobPayload.set(sealed.blob);
      const downloadUrl = URL.createObjectURL(new Blob([blobPayload], { type: "application/octet-stream" }));

      setSealedDraft((current) => {
        if (current?.downloadUrl) URL.revokeObjectURL(current.downloadUrl);
        return {
          bond: bond.toString(),
          bondCt,
          blobSize: sealed.blob.length,
          caseId: sealCaseId.trim(),
          caseKey: keccakId(sealCaseId.trim()) as `0x${string}`,
          commitment: sealed.commitment,
          downloadUrl,
          fileName: `${sealCaseId.trim()}-${sealRole}.bin`,
          keyCt,
          role: sealRole,
        };
      });
      setLookupCaseId(sealCaseId.trim());
    } catch (error) {
      setSealError(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function publishGenLayerSeal() {
    if (!wallet) {
      setGenPublishError("Connect a wallet first.");
      return;
    }
    if (!sealedDraft) {
      setGenPublishError("Seal evidence in the browser first.");
      return;
    }
    if (!evidenceUri.trim()) {
      setGenPublishError("Paste a persistent encrypted blob URI first.");
      return;
    }
    if (!caseTerms.trim()) {
      setGenPublishError("Case terms are required to mirror the GenLayer case.");
      return;
    }
    if (!normalizedRespondent) {
      setGenPublishError("Respondent must be a valid 0x address.");
      return;
    }

    setBusy("publishGen");
    setGenPublishError("");
    setGenPublishTx("");

    try {
      await ensureGenLayerChain();
      const client = createClient({
        chain: GENLAYER_CHAIN,
        account: wallet.address,
        provider: injectedEthereum()!,
      });
      try {
        await client.readContract({ address: TRIBUNAL_ADDRESS, functionName: "get_case", args: [sealedDraft.caseId] });
      } catch {
        const openHash = await client.writeContract({
          address: TRIBUNAL_ADDRESS,
          functionName: "open_case",
          args: [caseTerms.trim(), sealedDraft.caseKey, normalizedRespondent],
          value: 0n,
        });
        await client.waitForTransactionReceipt({ hash: openHash, status: TransactionStatus.ACCEPTED });
        setSubmitGenHash(openHash);
      }
      const txHash = await client.writeContract({
        address: TRIBUNAL_ADDRESS,
        functionName: "seal_evidence",
        args: [sealedDraft.caseId, sealedDraft.commitment, evidenceUri.trim()],
        value: 0n,
      });
      await client.waitForTransactionReceipt({ hash: txHash, status: TransactionStatus.ACCEPTED });
      setGenPublishTx(txHash);
      await syncWalletFromProvider(wallet.address);
      await refreshCase(sealedDraft.caseId);
    } catch (error) {
      setGenPublishError(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function publishBaseSeal() {
    if (!wallet) {
      setBasePublishError("Connect a wallet first.");
      return;
    }
    if (!sealedDraft) {
      setBasePublishError("Seal evidence in the browser first.");
      return;
    }

    setBusy("publishBase");
    setBasePublishError("");
    setBasePublish(null);

    try {
      await ensureBaseSepoliaChain();
      const browserProvider = new BrowserProvider(injectedEthereum()!);
      const signer = await browserProvider.getSigner();
      const escrow = getEscrowContract(signer);

      const fundBondTx = await escrow.fundBond(sealedDraft.caseKey, sealedDraft.bondCt, { value: INCO_OP_VALUE });
      await fundBondTx.wait();
      const sealKeyTx = await escrow.sealEvidenceKey(sealedDraft.caseKey, sealedDraft.keyCt, { value: INCO_OP_VALUE });
      await sealKeyTx.wait();

      setBasePublish({ fundBondTx: fundBondTx.hash, sealKeyTx: sealKeyTx.hash });
      await refreshCase(sealedDraft.caseId);
    } catch (error) {
      setBasePublishError(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function markCaseReady() {
    if (!wallet) {
      setReadyError("Connect a wallet first.");
      return;
    }
    if (!sealedDraft) {
      setReadyError("Seal evidence in the browser first.");
      return;
    }

    setBusy("ready");
    setReadyError("");
    setReadyHash("");

    try {
      await ensureBaseSepoliaChain();
      const browserProvider = new BrowserProvider(injectedEthereum()!);
      const signer = await browserProvider.getSigner();
      const escrow = getEscrowContract(signer);
      const tx = await escrow.markReady(sealedDraft.caseKey, { value: INCO_OP_VALUE });
      await tx.wait();
      setReadyHash(tx.hash);
      await refreshCase(sealedDraft.caseId);
      await refreshNetwork();
    } catch (error) {
      setReadyError(errorMessage(error));
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
    setLookupNotice("");

    try {
      const caseKey = keccakId(normalized);
      const escrow = getEscrowContract(baseProvider);
      const [phaseResult, escrowCaseIdResult, tribunalCaseResult, verdictResult] = await Promise.allSettled([
        escrow.phaseOf(caseKey),
        escrow.caseIdOf(caseKey),
        tribunalClient.readContract({ address: TRIBUNAL_ADDRESS, functionName: "get_case", args: [normalized] }),
        tribunalClient.readContract({ address: TRIBUNAL_ADDRESS, functionName: "get_verdict", args: [normalized] }),
      ]);

      if (phaseResult.status === "rejected") throw phaseResult.reason;

      const phaseRaw = phaseResult.value;
      const escrowCaseId = escrowCaseIdResult.status === "fulfilled" ? escrowCaseIdResult.value : "";
      const tribunalCaseRaw = tribunalCaseResult.status === "fulfilled" ? String(tribunalCaseResult.value) : null;
      const verdictRaw =
        verdictResult.status === "fulfilled" && verdictResult.value != null ? String(verdictResult.value) : null;
      const tribunalStatus = tribunalCaseRaw
        ? "GenLayer case found."
        : "GenLayer case not found yet. Base escrow data is shown below.";

      const phaseIndex = Number(phaseRaw);
      setLookup({
        caseId: normalized,
        caseKey,
        escrowPhase: PHASE_LABELS[phaseIndex] ?? `Unknown (${phaseIndex})`,
        escrowCaseId,
        tribunalCase: tribunalCaseRaw,
        tribunalStatus,
        verdict: verdictRaw,
      });
      if (tribunalCaseRaw && !escrowCaseId) {
        setLookupNotice("GenLayer case exists, but the Base escrow mirror is not visible yet.");
      } else if (tribunalCaseResult.status === "rejected") {
        setLookupNotice(tribunalStatus);
      }
    } catch (error) {
      setLookup(null);
      setLookupError(errorMessage(error));
    } finally {
      setBusy("");
    }
  }

  const parsedTribunalCase = safeJson(lookup?.tribunalCase ?? null);
  const parsedVerdict = safeJson(lookup?.verdict ?? null);
  const workflowSteps = [
    { label: "Connect", value: wallet ? "Ready" : "Required", active: !wallet },
    { label: "Open", value: submitHash ? "Sent" : nextCaseId || "AQ-n", active: !!wallet && !submitHash },
    { label: "Seal", value: sealedDraft ? "Sealed" : "Local", active: !!submitHash && !sealedDraft },
    { label: "Publish", value: basePublish || genPublishTx ? "In progress" : "Both chains", active: !!sealedDraft && !(basePublish && genPublishTx) },
    { label: "Monitor", value: lookup?.escrowPhase ?? "Fetch", active: !!lookup },
  ];

  return (
    <section id="live-state" className="max-w-[1180px] mx-auto px-7 pb-6">
      <div className="border-t-[3px] border-double border-ink pt-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="font-sans text-[11px] font-800 tracking-[0.12em] uppercase text-oxblood">Live Console</div>
            <div className="font-display text-[28px] leading-tight mt-1">Run a confidential case from the page.</div>
          </div>
          <button
            type="button"
            onClick={() => { void refreshNetwork(); void refreshCase(); }}
            className="border border-ink px-3 py-1.5 font-sans text-[11px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors"
          >
            Refresh Live State
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-5">
          {workflowSteps.map((step, index) => (
            <div key={step.label} className={`border p-3 ${step.active ? "border-ink bg-white" : "border-hair bg-white/60"}`}>
              <div className="font-sans text-[9px] font-800 uppercase tracking-[0.12em] text-gray-450">{index + 1}. {step.label}</div>
              <div className="font-display text-[18px] leading-none mt-1">{step.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 mt-5">
          <div className="space-y-5">
            <details className="border border-hair bg-white/60 p-4">
              <summary className="cursor-pointer font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">Advanced network snapshot</summary>
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
            </details>

            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">1. Connect Wallet</div>
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

                {wallet && wallet.chainId !== GENLAYER_CHAIN_ID && (
                  <button
                    type="button"
                    onClick={() => { void switchToGenLayer(); }}
                    className="border border-ink px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors"
                  >
                    Switch to {GENLAYER_CHAIN.name}
                  </button>
                )}
              </div>
              <div className="mt-2 font-sans text-[11px] text-gray-450">
                Chain status: {wallet ? describeChain(wallet.chainId) : "No wallet connected"}
              </div>
              <div className="mt-1 font-sans text-[11px] text-gray-450">
                GenLayer writes target {GENLAYER_CHAIN.name}. The site will prompt MetaMask to add or switch the network when a GenLayer action starts.
              </div>
              {walletError && <div className="mt-2 font-sans text-[11px] text-oxblood">{walletError}</div>}
            </div>

            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">2. Open Cause</div>
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
                  <div className="mt-1 font-sans text-[10px] text-gray-450">
                    Use the other party&apos;s Base wallet here, not the connected claimant address.
                  </div>
                </label>
              </div>
              <label className="block mt-3">
                <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450 mb-1">Case Terms</div>
                <textarea
                  value={caseTerms}
                  onChange={(event) => setCaseTerms(event.target.value)}
                  rows={3}
                  className="w-full border border-hair bg-white px-3 py-2 font-sans text-[12px] outline-none resize-y"
                />
              </label>
              <div className="mt-3 flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => { void submitOpenCase(); }}
                  disabled={busy === "submit" || samePartyAsConnectedWallet}
                  className="bg-ink text-white px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-oxblood transition-colors disabled:opacity-60"
                >
                  {busy === "submit" ? "Submitting..." : "Open Cause on Both Chains"}
                </button>
                <div className="font-sans text-[11px] text-gray-450">
                  GenLayer is the source of truth for <span className="font-mono">AQ-n</span>. Base mirrors the same <span className="font-mono">keccak256(caseId)</span>.
                </div>
              </div>
              {samePartyAsConnectedWallet && (
                <div className="mt-2 font-sans text-[11px] text-oxblood">
                  Respondent cannot be the same address as the connected claimant wallet.
                </div>
              )}
              {submitGenHash && (
                <div className="mt-3 border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">GenLayer open_case</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{submitGenHash}</div>
                </div>
              )}
              {submitHash && (
                <div className="mt-3 border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Base openCase</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{submitHash}</div>
                </div>
              )}
              {submitNotice && <div className="mt-2 font-sans text-[11px] text-gray-450">{submitNotice}</div>}
              {submitError && <div className="mt-2 font-sans text-[11px] text-oxblood">{submitError}</div>}
            </div>

            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">3. Seal Evidence Locally</div>
              <div className="mt-2 font-sans text-[11px] text-gray-450">Plaintext stays in the browser. The page produces a ciphertext blob, a commitment, and encrypted Inco inputs.</div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <label className="block">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450 mb-1">Case ID</div>
                  <input
                    value={sealCaseId}
                    onChange={(event) => setSealCaseId(event.target.value)}
                    className="w-full border border-hair bg-white px-3 py-2 font-mono text-[12px] outline-none"
                  />
                </label>
                <label className="block">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450 mb-1">Role</div>
                  <select
                    value={sealRole}
                    onChange={(event) => setSealRole(event.target.value as Role)}
                    className="w-full border border-hair bg-white px-3 py-2 font-sans text-[12px] outline-none"
                  >
                    <option value="claimant">Claimant</option>
                    <option value="respondent">Respondent</option>
                  </select>
                </label>
                <label className="block">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450 mb-1">Confidential Bond</div>
                  <input
                    value={bondAmount}
                    onChange={(event) => setBondAmount(event.target.value)}
                    className="w-full border border-hair bg-white px-3 py-2 font-mono text-[12px] outline-none"
                  />
                </label>
              </div>

              <div className="mt-3">
                <label className="block">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450 mb-1">Evidence Text</div>
                  <textarea
                    value={evidenceText}
                    onChange={(event) => setEvidenceText(event.target.value)}
                    placeholder='{"expected_delivery_utc":"2026-07-20T08:00:00Z","observed_delivery_utc":"2026-07-20T11:10:00Z","missing_rows":14}'
                    rows={7}
                    className="w-full border border-hair bg-white px-3 py-2 font-mono text-[12px] outline-none resize-y"
                  />
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="border border-ink px-3 py-2 font-sans text-[11px] uppercase tracking-[0.08em] cursor-pointer hover:bg-ink hover:text-white transition-colors">
                    Load File
                    <input
                      type="file"
                      accept=".txt,.json,.md,.csv"
                      className="hidden"
                      onChange={(event) => { void handleEvidenceFile(event.target.files?.[0] ?? null); }}
                    />
                  </label>
                  <div className="font-sans text-[11px] text-gray-450">
                    {evidenceFileName ? `Loaded: ${evidenceFileName}` : "Plaintext never leaves the browser at seal time."}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <label className="block">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450 mb-1">Encrypted Blob URI</div>
                  <input
                    value={evidenceUri}
                    onChange={(event) => setEvidenceUri(event.target.value)}
                    placeholder="ipfs://... or https://..."
                    className="w-full border border-hair bg-white px-3 py-2 font-mono text-[12px] outline-none"
                  />
                </label>
                <div className="mt-1 font-sans text-[11px] text-gray-450">
                  The downloaded ciphertext blob must be uploaded to persistent storage first. Then this URI is what gets sealed into the GenLayer record.
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => { void sealEvidenceInBrowser(); }}
                  disabled={busy === "seal"}
                  className="bg-ink text-white px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-oxblood transition-colors disabled:opacity-60"
                >
                  {busy === "seal" ? "Sealing..." : "Seal in Browser"}
                </button>
              </div>

              {sealedDraft && (
                <div className="space-y-3 mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="border border-hair p-3">
                      <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Commitment</div>
                      <div className="font-mono text-[11px] mt-1 break-all">{sealedDraft.commitment}</div>
                    </div>
                    <div className="border border-hair p-3">
                      <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Case Key</div>
                      <div className="font-mono text-[11px] mt-1 break-all">{sealedDraft.caseKey}</div>
                    </div>
                    <div className="border border-hair p-3">
                      <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Ciphertext Blob</div>
                      <div className="font-sans text-[11px] mt-1">{sealedDraft.blobSize} bytes</div>
                      <a
                        href={sealedDraft.downloadUrl}
                        download={sealedDraft.fileName}
                        className="inline-block mt-2 font-sans text-[11px] uppercase tracking-[0.08em] underline underline-offset-2"
                      >
                        Download blob
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {sealError && <div className="mt-2 font-sans text-[11px] text-oxblood">{sealError}</div>}
            </div>

            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">4. Publish Sealed Inputs</div>
              <div className="mt-2 font-sans text-[11px] text-gray-450">Publish the commitment and blob URI to GenLayer, then publish encrypted bond and key to Base Sepolia.</div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => { void switchToGenLayer(); }}
                  className="border border-ink px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors"
                >
                  Switch to GenLayer
                </button>
                <button
                  type="button"
                  onClick={() => { void publishGenLayerSeal(); }}
                  disabled={busy === "publishGen"}
                  className="border border-ink px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors disabled:opacity-60"
                >
                  {busy === "publishGen" ? "Publishing..." : "Publish Seal to GenLayer"}
                </button>
                <button
                  type="button"
                  onClick={() => { void switchToBaseSepolia(); }}
                  className="border border-ink px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors"
                >
                  Switch to Base
                </button>
                <button
                  type="button"
                  onClick={() => { void publishBaseSeal(); }}
                  disabled={busy === "publishBase"}
                  className="border border-ink px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors disabled:opacity-60"
                >
                  {busy === "publishBase" ? "Publishing..." : "Publish Bond + Key to Base"}
                </button>
                <button
                  type="button"
                  onClick={() => { void markCaseReady(); }}
                  disabled={busy === "ready"}
                  className="border border-ink px-4 py-2 font-sans text-[12px] uppercase tracking-[0.08em] hover:bg-ink hover:text-white transition-colors disabled:opacity-60"
                >
                  {busy === "ready" ? "Marking..." : "Mark Ready"}
                </button>
              </div>

              {sealedDraft && (
                <details className="mt-4 border border-hair p-3">
                  <summary className="cursor-pointer font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Encrypted payload details</summary>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div className="border border-hair p-3">
                      <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Encrypted Bond</div>
                      <div className="font-mono text-[11px] mt-1 break-all">{sealedDraft.bondCt}</div>
                    </div>
                    <div className="border border-hair p-3">
                      <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Encrypted Evidence Key</div>
                      <div className="font-mono text-[11px] mt-1 break-all">{sealedDraft.keyCt}</div>
                    </div>
                  </div>
                </details>
              )}

              {genPublishTx && (
                <div className="mt-3 border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">GenLayer Seal Transaction</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{genPublishTx}</div>
                </div>
              )}

              {basePublish && (
                <div className="mt-3 border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">Base Transactions</div>
                  <div className="mt-2 font-sans text-[11px] text-gray-450">fundBond</div>
                  <div className="font-mono text-[11px] break-all">{basePublish.fundBondTx}</div>
                  <div className="mt-2 font-sans text-[11px] text-gray-450">sealEvidenceKey</div>
                  <div className="font-mono text-[11px] break-all">{basePublish.sealKeyTx}</div>
                </div>
              )}

              {readyHash && (
                <div className="mt-3 border border-hair p-3">
                  <div className="font-sans text-[9px] uppercase tracking-[0.08em] text-gray-450">markReady Transaction</div>
                  <div className="font-mono text-[11px] mt-1 break-all">{readyHash}</div>
                </div>
              )}

              {genPublishError && <div className="mt-2 font-sans text-[11px] text-oxblood">{genPublishError}</div>}
              {basePublishError && <div className="mt-2 font-sans text-[11px] text-oxblood">{basePublishError}</div>}
              {readyError && <div className="mt-2 font-sans text-[11px] text-oxblood">{readyError}</div>}
            </div>
          </div>

          <div className="space-y-5 lg:sticky lg:top-[76px] lg:self-start">
            <div className="border border-ink bg-white/70 p-4">
              <div className="font-sans text-[10px] font-800 uppercase tracking-[0.1em] text-gray-450">5. Monitor Case</div>
              <div className="flex gap-3 mt-3">
                <input
                  value={lookupCaseId}
                  onChange={(event) => setLookupCaseId(event.target.value)}
                  className="flex-1 border border-hair bg-white px-3 py-2 font-mono text-[12px] outline-none"
                  placeholder="AQ-0"
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
              {lookupNotice && <div className="mt-2 font-sans text-[11px] text-gray-450">{lookupNotice}</div>}
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
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-ink-soft">{parsedTribunalCase ? JSON.stringify(parsedTribunalCase, null, 2) : lookup.tribunalStatus}</pre>
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
