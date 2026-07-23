import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

type GenLayerNetworkName = "localnet" | "studionet" | "testnetAsimov" | "testnetBradbury";
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

function inferNetworkFromRpcUrl(rpcUrl: string | undefined): GenLayerNetworkName | null {
  if (!rpcUrl) return null;
  if (rpcUrl.includes("rpc-bradbury.genlayer.com")) return "testnetBradbury";
  if (rpcUrl.includes("rpc-asimov.genlayer.com")) return "testnetAsimov";
  if (rpcUrl.includes("studio.genlayer.com")) return "studionet";
  if (rpcUrl.includes("localhost") || rpcUrl.includes("127.0.0.1")) return "localnet";
  return null;
}

export const GENLAYER_NETWORK_NAME =
  ((env.VITE_GENLAYER_NETWORK as GenLayerNetworkName | undefined) ??
    inferNetworkFromRpcUrl(env.VITE_GENLAYER_RPC_URL) ??
    "testnetBradbury");

const baseChain =
  GENLAYER_NETWORK_NAME === "testnetBradbury"
    ? testnetBradbury
    : GENLAYER_NETWORK_NAME === "testnetAsimov"
      ? testnetAsimov
      : GENLAYER_NETWORK_NAME === "studionet"
        ? studionet
        : localnet;

export const GENLAYER_CHAIN = env.VITE_GENLAYER_RPC_URL
  ? {
      ...baseChain,
      rpcUrls: {
        ...baseChain.rpcUrls,
        default: {
          ...baseChain.rpcUrls.default,
          http: [env.VITE_GENLAYER_RPC_URL],
        },
      },
    }
  : baseChain;
