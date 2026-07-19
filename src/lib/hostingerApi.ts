import { getAuth } from 'firebase/auth';

export type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export class HostingerApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(message: string, status: number, code = 'api_error', details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'HostingerApiError';
    this.status = status;
    this.code = mapErrorCode(code, status);
    this.details = details;
  }
}

type ConnectivityListener = (online: boolean, message: string) => void;

const connectivityListeners = new Set<ConnectivityListener>();
let apiOnline = true;
let connectivityMessage = '';
const RUNTIME_API_KEY = 'gmh-suite-api-base-url';

function mapErrorCode(code: string, status: number) {
  if (code === 'permission_denied') return 'permission-denied';
  if (code === 'unauthenticated' || code === 'invalid_token') return 'unauthenticated';
  if (code === 'not_found') return 'not-found';
  if (code === 'version_conflict') return 'aborted';
  if (status === 503 || status === 0) return 'unavailable';
  return code.replace(/_/g, '-');
}

function resolveApiBase() {
  const configured = String((import.meta.env as any).VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') return '/api';
  const runtime = localStorage.getItem(RUNTIME_API_KEY)?.trim().replace(/\/$/, '') || '';
  if (runtime) return runtime;
  return '';
}

export const API_BASE_URL = resolveApiBase();

export function needsRuntimeApiConfiguration() {
  return API_BASE_URL === '';
}

export function canEditRuntimeApiConfiguration() {
  return !(import.meta.env as any).VITE_API_BASE_URL
    && window.location.protocol !== 'http:'
    && window.location.protocol !== 'https:';
}

export function saveRuntimeApiBaseUrl(value: string) {
  const input = value.trim();
  const normalizedInput = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(normalizedInput);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Use the secure HTTPS address of the Hostinger subdomain.');
  }
  const path = url.pathname.replace(/\/$/, '');
  url.pathname = path.endsWith('/api') ? path : `${path}/api`;
  url.search = '';
  url.hash = '';
  localStorage.setItem(RUNTIME_API_KEY, url.toString().replace(/\/$/, ''));
}

export function clearRuntimeApiBaseUrl() {
  localStorage.removeItem(RUNTIME_API_KEY);
  window.location.reload();
}

export function getApiConnectivity() {
  return { online: apiOnline, message: connectivityMessage };
}

export function subscribeApiConnectivity(listener: ConnectivityListener) {
  connectivityListeners.add(listener);
  listener(apiOnline, connectivityMessage);
  return () => { connectivityListeners.delete(listener); };
}

function setConnectivity(online: boolean, message = '') {
  if (online === apiOnline && message === connectivityMessage) return;
  apiOnline = online;
  connectivityMessage = message;
  connectivityListeners.forEach(listener => listener(online, message));
}

export function createIdempotencyKey(prefix = 'gmh') {
  const uuid = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${uuid}`;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { idempotencyKey?: string; expectedVersion?: number | null } = {},
): Promise<T> {
  if (!API_BASE_URL) {
    setConnectivity(false, 'VITE_API_BASE_URL is required for installed builds.');
    throw new HostingerApiError('The Hostinger API address is not configured for this build.', 0, 'unavailable');
  }

  const user = getAuth().currentUser;
  if (!user) throw new HostingerApiError('Please log in again.', 401, 'unauthenticated');
  const token = await user.getIdToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.expectedVersion !== undefined && options.expectedVersion !== null) {
    headers.set('If-Match', String(options.expectedVersion));
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/v1${path}`, { ...options, headers });
  } catch (error) {
    const message = navigator.onLine
      ? 'The Hostinger data service is unreachable. Cached records are read-only.'
      : 'This device is offline. Cached records are read-only.';
    setConnectivity(false, message);
    throw new HostingerApiError(message, 0, 'unavailable', { cause: String(error) });
  }

  const text = await response.text();
  let payload: T & ApiErrorPayload;
  try {
    payload = text ? JSON.parse(text) : ({} as T & ApiErrorPayload);
  } catch {
    payload = {} as T & ApiErrorPayload;
  }
  if (!response.ok) {
    const code = payload.error?.code || `http_${response.status}`;
    const message = payload.error?.message || `The data service returned HTTP ${response.status}.`;
    if (response.status >= 500) setConnectivity(false, message);
    throw new HostingerApiError(message, response.status, code, payload.error?.details || {});
  }
  setConnectivity(true, '');
  return payload;
}

export async function loadCurrentProfile<T = Record<string, unknown>>() {
  return apiRequest<{ uid: string; email: string; profile: T }>('/me');
}
