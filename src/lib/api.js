export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

export const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
export const signedPct = (v, d = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
export const units = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}u`;
