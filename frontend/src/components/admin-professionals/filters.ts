import type { ProfessionalRow } from '../admin-dashboard/derive';

// ── busca e filtros: calculados sobre a lista já carregada (nenhuma chamada extra) ──

export type FilterId = 'todas' | 'ativas' | 'bloqueadas' | 'sem-instancia' | 'sem-numero';

export const FILTERS: Array<{ id: FilterId; label: string; match: (r: ProfessionalRow) => boolean }> = [
  { id: 'todas', label: 'Todas', match: () => true },
  { id: 'ativas', label: 'Ativas', match: (r) => r.blocked_at === null },
  { id: 'bloqueadas', label: 'Bloqueadas', match: (r) => r.blocked_at !== null },
  { id: 'sem-instancia', label: 'Sem WhatsApp', match: (r) => !r.wa_instance_name },
  { id: 'sem-numero', label: 'Sem número', match: (r) => !r.phone_whatsapp?.trim() },
];

export const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
