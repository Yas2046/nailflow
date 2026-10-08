import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../services/api';
import type { AuditAction } from '../admin-account/useAccountOverview';
import type { ProfessionalRow } from './derive';

/*
 * Dados do Dashboard ADM — somente endpoints que já existem, 4 chamadas por carregamento
 * (sem polling, sem N+1):
 *  - GET /admin/professionals                          → contas (base de indicadores e alertas)
 *  - GET /admin/audit-log?pageSize=6                   → atividade recente (todas as admins) + resumo
 *  - GET /admin/audit-log?action=delete&from=…&pageSize=1 → total de exclusões nos últimos 7 dias
 *  - GET /health                                       → API respondendo (+ tempo medido no navegador)
 * Só /admin/professionals é obrigatório; as demais falham sem derrubar a página.
 */

export interface DashboardAuditItem {
  id: string;
  action: AuditAction;
  actorId: string;
  actorEmail: string;
  targetBusinessName: string;
  createdAt: string;
}

interface AuditResponse {
  items: DashboardAuditItem[];
  total: number;
  summary: { today: number; last7Days: number };
}

export type Health = { ok: true; ms: number } | { ok: false };

export interface DashboardData {
  rows: ProfessionalRow[];
  audit: { items: DashboardAuditItem[]; today: number; last7Days: number } | null;
  deletes7: number | null;
  health: Health;
  loadedAt: Date;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardData };

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function measureHealth(): Promise<Health> {
  const t0 = performance.now();
  try {
    await api.get('/health');
    return { ok: true, ms: Math.round(performance.now() - t0) };
  } catch {
    return { ok: false };
  }
}

export function useAdminDashboard() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setState({ status: 'loading' });
    else setRefreshing(true);
    const from = localDate(new Date(Date.now() - 7 * 86_400_000));
    try {
      const [rows, audit, deletes, health] = await Promise.all([
        api.get<ProfessionalRow[]>('/admin/professionals'),
        api.get<AuditResponse>('/admin/audit-log?page=1&pageSize=6').catch(() => null),
        api.get<AuditResponse>(`/admin/audit-log?page=1&pageSize=1&action=delete&from=${from}`).catch(() => null),
        measureHealth(),
      ]);
      setState({
        status: 'ready',
        data: {
          rows,
          audit: audit ? { items: audit.items, today: audit.summary.today, last7Days: audit.summary.last7Days } : null,
          deletes7: deletes ? deletes.total : null,
          health,
          loadedAt: new Date(),
        },
      });
    } catch (err) {
      setState({ status: 'error', message: err instanceof ApiError ? err.message : 'Verifique sua conexão e tente novamente.' });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  return { state, refreshing, reload: () => load(false), retry: () => load(true) };
}
