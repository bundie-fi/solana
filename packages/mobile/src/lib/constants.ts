export const COLORS = {
  earnGold: "#d4a853",
  predictPurple: "#a78bfa",
  background: "#0a0a0f",
  surface: "#141420",
  border: "#1e1e2e",
} as const;

export const RPC_ENDPOINT = process.env.EXPO_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
