import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import type { AuditItem } from './useAccountOverview';

/*
 * Atividade da conta = ações do admin_audit_log feitas por esta conta (actorId === id logado).
 * Fonte: GET /admin/audit-log (já existente). O endpoint não filtra por autor, então o filtro é
 * feito aqui; por isso as páginas são lidas em sequência (50 por vez, o máximo aceito) até esgotar
 * ou atingir MAX_PAGES. Se o log tiver mais que isso, `truncated` avisa que só as mais recentes
 * foram carregadas — nada é estimado.
 */

const PAGE_SIZE = 50;
const MAX_PAGES = 6;

interface AuditPage {
  items: AuditItem[];
  page: number;
  totalPages: number;
}

export interface AccountActivity {
  items: AuditItem[];
  truncated: boolean;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AccountActivity };

export function useAccountActivity() {
  const { professional } = useAuth();
  const myId = professional?.id;
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      if (!myId) throw new ApiError('Sessão não identificada. Entre novamente.', 401);
      const all: AuditItem[] = [];
      let truncated = false;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await api.get<AuditPage>(`/admin/audit-log?page=${page}&pageSize=${PAGE_SIZE}`);
        all.push(...res.items);
        if (page >= res.totalPages) break;
        if (page === MAX_PAGES) truncated = true;
      }
      setState({ status: 'ready', data: { items: all.filter((i) => i.actorId === myId), truncated } });
    } catch (err) {
      setState({ status: 'error', message: err instanceof ApiError ? err.message : 'Verifique sua conexão e tente novamente.' });
    }
  }, [myId]);

  useEffect(() => { void load(); }, [load]);

  return { state, reload: load };
}
