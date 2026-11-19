/**
 * Papercard API Client
 * Wraps /api requests with error handling, session cookies, and JSON encoding.
 */

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** "/me", "me" and "/api/me" all become "/api/me". */
function apiUrl(path) {
  if (path.startsWith('/api')) return path;
  return path.startsWith('/') ? `/api${path}` : `/api/${path}`;
}

function requestOptions(method, body, headers) {
  const opts = {
    method,
    headers: { Accept: 'application/json', ...headers },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return opts;
}

/** JSON when the server says so (null if it's malformed), otherwise text. */
async function readBody(res) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return res.text();
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorMessage(res, data) {
  if (data?.error) return data.error;
  if (typeof data === 'string' && data) return data;
  return res.statusText || 'Request failed';
}

/**
 * @param {string} path  "/learn", "learn" or "/api/learn"
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string> }} [options]
 */
export async function api(path, { method = 'GET', body = undefined, headers = {} } = {}) {
  const res = await fetch(apiUrl(path), requestOptions(method, body, headers));
  const data = await readBody(res);
  if (!res.ok) throw new ApiError(errorMessage(res, data), res.status, data);
  return data;
}

export async function getMe() {
  const res = await api('/me');
  return res.user;
}

export async function getConfig() {
  return await api('/config');
}

export async function authDev(name = 'Learner', handle = 'learner') {
  const res = await api('/auth/dev', {
    method: 'POST',
    body: { name, handle },
  });
  return res.user;
}

export async function authGoogle(credential) {
  const res = await api('/auth/google', {
    method: 'POST',
    body: { credential },
  });
  return res.user;
}

export async function authLogout() {
  await api('/auth/logout', { method: 'POST', body: {} });
}
