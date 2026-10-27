import type { Activity } from "./types";
const configured = import.meta.env.VITE_API_URL as string | undefined;
export const API = configured?.replace(/\/$/, "") || "/api";
export function getToken() {
  return sessionStorage.getItem("stateforge.session");
}
export function setToken(token: string | null) {
  if (token) sessionStorage.setItem("stateforge.session", token);
  else sessionStorage.removeItem("stateforge.session");
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message =
        typeof data.detail === "string"
          ? data.detail
          : Array.isArray(data.detail)
            ? data.detail
                .map(
                  (x: { loc: string[]; msg: string }) =>
                    `${x.loc.join(".")}: ${x.msg}`,
                )
                .join("\n")
            : message;
    } catch {
      /* keep HTTP status */
    }
    if (response.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event("stateforge.expired"));
    }
    throw new ApiError(message, response.status);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export async function download(path: string) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok)
    throw new Error("Artifact download failed. Refresh and try again.");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download =
    response.headers
      .get("content-disposition")
      ?.match(/filename="([^"]+)"/)?.[1] || "stateforge.zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function stream(
  project: string,
  after: number,
  signal: AbortSignal,
  onEvent: (e: Activity) => void,
  onStatus: (s: "connected" | "reconnecting") => void,
) {
  let cursor = after;
  while (!signal.aborted) {
    try {
      const response = await fetch(
        `${API}/projects/${project}/stream?after=${cursor}`,
        { headers: { Authorization: `Bearer ${getToken()}` }, signal },
      );
      if (response.status === 401) {
        window.dispatchEvent(new Event("stateforge.expired"));
        return;
      }
      if (!response.ok || !response.body) throw new Error("Stream unavailable");
      onStatus("connected");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (block.includes("event: expired")) {
            window.dispatchEvent(new Event("stateforge.expired"));
            return;
          }
          const data = block.split("\n").find((l) => l.startsWith("data: "));
          if (data) {
            const event = JSON.parse(data.slice(6)) as Activity;
            cursor = event.id;
            onEvent(event);
          }
        }
      }
    } catch (e) {
      if (signal.aborted) return;
    }
    if (signal.aborted) return;
    onStatus("reconnecting");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2000);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
