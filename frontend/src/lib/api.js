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

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const url = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`;
  const opts = {
    method,
    headers: {
      'Accept': 'application/json',
      ...headers,
    },
    credentials: 'same-origin',
  };

  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  let data;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const errorMsg = data?.error || (typeof data === 'string' && data) || res.statusText || 'Request failed';
    throw new ApiError(errorMsg, res.status, data);
  }

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

export async function authLogout() {
  await api('/auth/logout', { method: 'POST', body: {} });
}
