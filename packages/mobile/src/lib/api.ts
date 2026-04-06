// API client for the Hono backend
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001/api";

export async function fetchStrategies() {
  const res = await fetch(`${API_BASE}/strategies`);
  return res.json();
}

export async function fetchStrategy(id: string) {
  const res = await fetch(`${API_BASE}/strategies/${id}`);
  return res.json();
}

export async function fetchMarkets() {
  const res = await fetch(`${API_BASE}/markets`);
  return res.json();
}

export async function fetchPortfolio(wallet: string) {
  const res = await fetch(`${API_BASE}/portfolio/${wallet}`);
  return res.json();
}

export async function buildTransaction(params: {
  type: string;
  wallet: string;
  [key: string]: unknown;
}) {
  const res = await fetch(`${API_BASE}/tx/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}
