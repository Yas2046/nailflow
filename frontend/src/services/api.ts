const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333';

let authToken: string | null = localStorage.getItem('nailflow_token');

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem('nailflow_token', token);
  else localStorage.removeItem('nailflow_token');
}

/**
 * Erro de API que preserva, além da mensagem, o `reason` estruturado que o
 * backend já retorna em endpoints de disponibilidade (ex.: "lunch_break",
 * "appointment_overlap") e, se um dia passar a existir, uma lista de
 * horários alternativos sugeridos pelo backend. O frontend NUNCA calcula
 * disponibilidade sozinho — só traduz o que a API já decidiu.
 */
export class ApiError extends Error {
  status: number;
  reason?: string;
  alternatives?: string[];

  constructor(message: string, status: number, reason?: string, alternatives?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.alternatives = alternatives;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || `Erro ${res.status}`, res.status, data.reason, data.alternatives);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
