export let csrf = "";
let account = "";
export const setAccount = (value) => {
  account = value || "";
};
export const setCSRF = (value) => {
  csrf = value || "";
};
export class APIError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
export async function api(path, method = "GET", body, extraHeaders = {}) {
  const headers = {
    ...(account ? { "X-Account-ID": account } : {}),
    ...extraHeaders,
  };
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch("/api" + path, {
      method,
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new APIError(
      "Connection unavailable. Your local draft is preserved.",
      0,
      null,
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new APIError(
      data.error || "This request could not be completed.",
      response.status,
      data,
    );
  return data;
}
export async function downloadAPI(path, method = "GET", body) {
  const response = await fetch("/api" + path, {
    method,
    headers: {
      ...(account ? { "X-Account-ID": account } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json();
    throw new APIError(data.error || "Download failed", response.status, data);
  }
  return response.blob();
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
