import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

type GenLayerNetworkName = "localnet" | "studionet" | "testnetAsimov" | "testnetBradbury";

function inferNetworkFromRpcUrl(rpcUrl: string | undefined): GenLayerNetworkName | null {
  if (!rpcUrl) return null;
  if (rpcUrl.includes("rpc-bradbury.genlayer.com")) return "testnetBradbury";
  if (rpcUrl.includes("rpc-asimov.genlayer.com")) return "testnetAsimov";
  if (rpcUrl.includes("studio.genlayer.com")) return "studionet";
  if (rpcUrl.includes("localhost") || rpcUrl.includes("127.0.0.1")) return "localnet";
  return null;
}

export function getGenLayerNetworkName(): GenLayerNetworkName {
  const configured = process.env.GENLAYER_NETWORK as GenLayerNetworkName | undefined;
  return configured ?? inferNetworkFromRpcUrl(process.env.GENLAYER_RPC_URL) ?? "testnetBradbury";
}

export function getGenLayerChain() {
  const network = getGenLayerNetworkName();
  const chain =
    network === "testnetBradbury"
      ? testnetBradbury
      : network === "testnetAsimov"
        ? testnetAsimov
        : network === "studionet"
          ? studionet
          : localnet;

  if (!process.env.GENLAYER_RPC_URL) return chain;

  return {
    ...chain,
    rpcUrls: {
      ...chain.rpcUrls,
      default: {
        ...chain.rpcUrls.default,
        http: [process.env.GENLAYER_RPC_URL],
      },
    },
  };
}
