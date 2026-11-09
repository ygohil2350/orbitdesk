export const API_URL = import.meta.env.VITE_API_URL || "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken() {
  return localStorage.getItem("orbitdesk_token");
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem("orbitdesk_token", token);
  else localStorage.removeItem("orbitdesk_token");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error?.message || "Something went wrong");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function wsUrl(path: string) {
  // When the API lives on another origin (e.g. web on Vercel, API on Render), connect to it directly.
  if (/^https?:\/\//.test(API_URL)) return `${API_URL.replace(/^http/, "ws")}${path}`;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${API_URL}${path}`;
}
