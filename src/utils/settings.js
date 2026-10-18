// Browser-side settings. The Tripo key override lives in localStorage and is only ever
// sent to the local bridge server, never to the page's own origin servers or Tripo directly.
const KEY = "visualisor.tripoKey";
const PREFER = "visualisor.tripoPrefer";

export const getTripoKey = () => localStorage.getItem(KEY) || "";

export function setTripoKey(value) {
  const v = value.trim();
  if (v) localStorage.setItem(KEY, v);
  else localStorage.removeItem(KEY);
}

export const getPreferOverride = () => localStorage.getItem(PREFER) === "1";
export const setPreferOverride = (on) => localStorage.setItem(PREFER, on ? "1" : "0");

// The server uses its own .env key unless none is set (or the user prefers the override).
export function tripoHeaders() {
  const key = getTripoKey();
  if (!key) return {};
  const headers = { "x-tripo-key": key };
  if (getPreferOverride()) headers["x-tripo-prefer"] = "1";
  return headers;
}
