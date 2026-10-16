import { api } from './api';

/**
 * Central de Suporte: tipos e chamadas das duas APIs (profissional: /support, ADM: /admin/support).
 * Os contratos vêm de backend/src/controllers/supportController.js e adminSupportController.js; nada aqui é
 * simulado. Valores de status/prioridade/categoria espelham os CHECKs da migration 023.
 */

// ── vocabulário ─────────────────────────────────────────────────────────────

export type SupportStatus = 'aberta' | 'em_atendimento' | 'aguardando_profissional' | 'resolvida';
export type SupportPriority = 'alta' | 'media' | 'baixa';
export type SupportCategory = 'agenda' | 'clientes' | 'servicos_config' | 'perfil_acesso' | 'financeiro' | 'tecnico';
export type SupportRole = 'professional' | 'admin';

export const STATUSES: SupportStatus[] = ['aberta', 'em_atendimento', 'aguardando_profissional', 'resolvida'];
export const PRIORITIES: SupportPriority[] = ['alta', 'media', 'baixa'];
export const CATEGORIES: Array<{ slug: SupportCategory; title: string }> = [
  { slug: 'agenda', title: 'Agenda' },
  { slug: 'clientes', title: 'Clientes' },
  { slug: 'servicos_config', title: 'Serviços e configurações' },
  { slug: 'perfil_acesso', title: 'Perfil e acesso' },
  { slug: 'financeiro', title: 'Financeiro' },
  { slug: 'tecnico', title: 'Técnico' },
];

export const categoryTitle = (slug: string) => CATEGORIES.find((c) => c.slug === slug)?.title ?? slug;

/** "Aguardando você" para a profissional; "Aguardando a profissional" para a ADM. */
export function statusLabel(status: SupportStatus, viewer: SupportRole): string {
  switch (status) {
    case 'aberta': return 'Aberta';
    case 'em_atendimento': return 'Em atendimento';
    case 'aguardando_profissional': return viewer === 'professional' ? 'Aguardando você' : 'Aguardando a profissional';
    case 'resolvida': return 'Resolvida';
  }
}

export const priorityLabel = (p: SupportPriority) => ({ alta: 'Alta', media: 'Média', baixa: 'Baixa' })[p];

export const ticketCode = (n: number) => `#${String(n).padStart(4, '0')}`;

// ── textos e limites (iguais aos do backend) ────────────────────────────────

export const SUBJECT_MAX = 120;
export const BODY_MAX = 5000;
export const FAQ_TITLE_MAX = 120;
export const FAQ_BODY_MAX = 8000;
// O aviso de privacidade do formulário fica em content/avisoPrivacidade.ts: mostra o contato de privacidade e só linka a
// política quando POLICY_PAGE_PUBLISHED for true (hoje false: a política ainda não está publicada).

/** Conta caracteres como o PostgreSQL (um emoji vale 1). */
export const charCount = (s: string) => [...s].length;

/** minúsculas e sem acentos: busca da FAQ no navegador. */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export const newId = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

// ── FAQ ─────────────────────────────────────────────────────────────────────

export interface FaqCategory { slug: SupportCategory; title: string; position: number }
export interface FaqArticle {
  id: string;
  categorySlug: SupportCategory;
  title: string;
  body: string;
  position: number;
  publishedAt: string | null;
}
export interface FaqResponse { categories: FaqCategory[]; articles: FaqArticle[] }

// ── profissional ────────────────────────────────────────────────────────────

export interface SupportBootstrap { enabled: boolean; fabHidden: boolean; unreadTickets: number; unreadIds: string[] }

export interface SupportTicket {
  id: string;
  ticketNumber: number;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  unread: boolean;
  activitySeq: number;
  profReadSeq: number;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  canReopenUntil: string | null;
}

export interface Paged<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

export interface SupportMessage { id: string; seq: number; authorRole: SupportRole; authorId?: string | null; body: string; createdAt: string }
export interface SupportEvent {
  id: string;
  seq: number;
  type: 'created' | 'status_changed' | 'priority_changed' | 'reopened';
  from: string | null;
  to: string | null;
  actorRole: SupportRole | 'system';
  actorId?: string | null;
  createdAt: string;
}
export interface SupportThread<T> {
  ticket: T;
  messages: SupportMessage[];
  events: SupportEvent[];
  hasMore: boolean;
  nextBefore: number | null;
}

export interface TicketListParams { status?: SupportStatus | ''; q?: string; page?: number; pageSize?: number }

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const supportApi = {
  bootstrap: () => api.get<SupportBootstrap>('/support/bootstrap'),
  faq: () => api.get<FaqResponse>('/support/faq'),
  list: (p: TicketListParams) => api.get<Paged<SupportTicket>>(`/support/tickets${qs({ ...p })}`),
  get: (id: string, opts: { before?: number; limit?: number } = {}) =>
    api.get<SupportThread<SupportTicket>>(`/support/tickets/${id}${qs({ ...opts })}`),
  create: (body: { subject: string; category: SupportCategory; body: string; clientRequestId: string; relatedTicketNumber?: number }) =>
    api.post<{ ticket: SupportTicket }>('/support/tickets', body),
  send: (id: string, body: { body: string; clientMessageId: string }) =>
    api.post<{ message: SupportMessage; ticket: SupportTicket }>(`/support/tickets/${id}/messages`, body),
  reopen: (id: string, body: string) => api.post<{ ticket: SupportTicket }>(`/support/tickets/${id}/reopen`, { body }),
  read: (id: string, upToSeq: number) => api.post<void>(`/support/tickets/${id}/read`, { upToSeq }),
  setFabHidden: (fabHidden: boolean) => api.put<{ fabHidden: boolean }>('/support/preferences', { fabHidden }),
};

// ── ADM ─────────────────────────────────────────────────────────────────────

export interface AdminSummary { abertas: number; emAtendimento: number; aguardando: number; resolvidas7d: number; naoLidas: number }

export interface AdminTicket {
  id: string;
  ticketNumber: number;
  category: SupportCategory;
  subject: string;
  status: SupportStatus;
  priority: SupportPriority;
  prioritySource: 'auto' | 'manual';
  unread: boolean;
  activitySeq: number;
  adminReadSeq: number;
  reopenCount: number;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  professional: { id: string; name: string; businessName: string };
}

export interface AdminListParams {
  status?: SupportStatus | '';
  priority?: SupportPriority | '';
  category?: SupportCategory | '';
  professionalId?: string;
  from?: string;
  to?: string;
  unread?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminArticle {
  id: string;
  categorySlug: SupportCategory;
  title: string;
  body: string;
  position: number;
  status: 'rascunho' | 'publicado';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}
export interface AdminFaqResponse { categories: FaqCategory[]; articles: AdminArticle[] }
export interface ArticleInput { categorySlug: SupportCategory; title: string; body: string; position?: number }

export const adminSupportApi = {
  summary: () => api.get<AdminSummary>('/admin/support/summary'),
  list: (p: AdminListParams) =>
    api.get<Paged<AdminTicket>>(`/admin/support/tickets${qs({ ...p, unread: p.unread ? 'true' : undefined })}`),
  get: (id: string, opts: { before?: number; limit?: number } = {}) =>
    api.get<SupportThread<AdminTicket>>(`/admin/support/tickets/${id}${qs({ ...opts })}`),
  send: (id: string, body: { body: string; clientMessageId: string }) =>
    api.post<{ message: SupportMessage; ticket: AdminTicket }>(`/admin/support/tickets/${id}/messages`, body),
  setStatus: (id: string, status: SupportStatus, expectedStatus?: SupportStatus) =>
    api.post<{ ticket: AdminTicket }>(`/admin/support/tickets/${id}/status`, { status, expectedStatus }),
  setPriority: (id: string, priority: SupportPriority) =>
    api.put<{ ticket: AdminTicket }>(`/admin/support/tickets/${id}/priority`, { priority }),
  read: (id: string, upToSeq: number) => api.post<void>(`/admin/support/tickets/${id}/read`, { upToSeq }),
  faq: () => api.get<AdminFaqResponse>('/admin/support/faq'),
  createArticle: (a: ArticleInput) => api.post<{ article: AdminArticle }>('/admin/support/faq/articles', a),
  updateArticle: (id: string, a: ArticleInput) => api.put<{ article: AdminArticle }>(`/admin/support/faq/articles/${id}`, a),
  publish: (id: string) => api.post<{ article: AdminArticle }>(`/admin/support/faq/articles/${id}/publish`),
  unpublish: (id: string) => api.post<{ article: AdminArticle }>(`/admin/support/faq/articles/${id}/unpublish`),
  reorder: (categorySlug: SupportCategory, orderedIds: string[]) =>
    api.put<void>('/admin/support/faq/reorder', { categorySlug, orderedIds }),
};

// ── eventos legíveis (histórico) ────────────────────────────────────────────

export function eventText(e: SupportEvent, viewer: SupportRole): string {
  const who = e.actorRole === 'professional'
    ? (viewer === 'professional' ? 'Você' : 'A profissional')
    : e.actorRole === 'admin' ? 'A equipe NailFlow' : 'O sistema';
  const st = (v: string | null) => (v ? statusLabel(v as SupportStatus, viewer) : '');
  switch (e.type) {
    case 'created': return 'Solicitação aberta';
    case 'status_changed': return `${who} alterou o status para "${st(e.to)}"`;
    case 'reopened': return `${who} reabriu a solicitação`;
    case 'priority_changed': return `Prioridade alterada de ${e.from ? priorityLabel(e.from as SupportPriority) : '?'} para ${e.to ? priorityLabel(e.to as SupportPriority) : '?'}`;
  }
}

// ── datas ───────────────────────────────────────────────────────────────────

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtShort = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Tempo decorrido em linguagem simples ("há 5 min", "ontem"); datas antigas voltam para dd/mm/aaaa. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.floor((now - t) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return fmtDate(iso);
}

/** Rótulo do dia para separar mensagens: "Hoje", "Ontem" ou a data. Compara dias do calendário local. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Chave do dia local (AAAA-MM-DD), para agrupar mensagens. */
export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Textos de apoio ao escolher a categoria (só orientação visual; os valores enviados são os slugs). */
export const CATEGORY_HINTS: Record<SupportCategory, string> = {
  agenda: 'Horários, reagendamentos e bloqueios',
  clientes: 'Cadastro, etiquetas e histórico',
  servicos_config: 'Serviços, preços e WhatsApp',
  perfil_acesso: 'Conta, senha e acesso',
  financeiro: 'Gastos e relatórios',
  tecnico: 'Erros e comportamentos inesperados',
};

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
