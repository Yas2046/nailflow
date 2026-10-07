import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../services/api';

export interface AccountMe {
  id: string;
  name: string;
  email: string;
  business_name: string | null;
  avatar_b64: string | null;
  is_admin: boolean;
}

export type AuditAction = 'update' | 'block' | 'unblock' | 'delete';

export interface AuditItem {
  id: string;
  action: AuditAction;
  actorId: string;
  targetBusinessName: string;
  createdAt: string;
}

interface ProfessionalRow {
  id: string;
  created_at: string;
  blocked_at: string | null;
}

export interface AccountOverview {
  me: AccountMe;
  /** null quando a listagem de profissionais não pôde ser lida. */
  createdAt: string | null;
  blockedAt: string | null;
  /** null quando o histórico não pôde ser lido (falha isolada, não derruba a página). */
  activity: AuditItem[] | null;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AccountOverview };

/**
 * Dados reais disponíveis hoje para a Visão geral da conta:
 *  - GET /auth/me                 → nome, e-mail, foto
 *  - GET /admin/professionals     → created_at / blocked_at da própria conta (filtrado pelo id)
 *  - GET /admin/audit-log         → ações administrativas feitas por esta conta
 * Sessões, 2FA, troca de senha e histórico de acessos ainda não existem no backend.
 */
export function useAccountOverview() {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    Promise.all([
      api.get<AccountMe>('/auth/me'),
      api.get<ProfessionalRow[]>('/admin/professionals').catch(() => null),
      api.get<{ items: AuditItem[] }>('/admin/audit-log?page=1&pageSize=20').catch(() => null),
    ])
      .then(([me, rows, audit]) => {
        const own = rows?.find((r) => r.id === me.id) ?? null;
        setState({
          status: 'ready',
          data: {
            me,
            createdAt: own?.created_at ?? null,
            blockedAt: own?.blocked_at ?? null,
            activity: audit ? audit.items.filter((i) => i.actorId === me.id).slice(0, 4) : null,
          },
        });
      })
      .catch((err: unknown) => {
        setState({ status: 'error', message: err instanceof ApiError ? err.message : 'Verifique sua conexão e tente novamente.' });
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  return { state, reload: load };
}
