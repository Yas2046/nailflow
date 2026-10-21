import { clearSupportDrafts } from './supportDrafts';
import { USE_MOCKS } from '../mocks/mode';

// Em modo de dados simulados a URL é inválida de propósito: nenhuma requisição real consegue sair.
export const API_URL = USE_MOCKS ? 'mock://offline' : (import.meta.env.VITE_API_URL || 'http://localhost:3333');

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
  if (USE_MOCKS) {
    const { mockRequest } = await import('../mocks/handler');
    return mockRequest<T>(path, options);
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') {
      localStorage.removeItem('nailflow_professional');
      clearSupportDrafts();
      window.location.href = '/login';
      return new Promise(() => {}) as Promise<T>;
    }
    throw new ApiError(data.error || `Erro ${res.status}`, res.status, data.reason, data.alternatives);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, ...(headers ? { headers } : {}) }),
  put: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined, ...(headers ? { headers } : {}) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
};

/** Baixa o arquivo JSON com os dados da própria conta (cookie de sessão). Em dados simulados não há servidor: recusa. */
export async function downloadMyData(): Promise<void> {
  if (USE_MOCKS) throw new Error('Exportação indisponível nos dados simulados.');
  const res = await fetch(`${API_URL}/auth/export`, { credentials: 'include' });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error || `Erro ${res.status}`);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `nailflow-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
