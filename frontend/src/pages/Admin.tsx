import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

interface ProfessionalRow {
  id: string;
  name: string;
  email: string;
  phone_whatsapp: string | null;
  business_name: string;
  wa_instance_name: string | null;
  created_at: string;
  is_admin: boolean;
  blocked_at: string | null;
}

interface ConfirmAction {
  id: string;
  name: string;
  action: 'block' | 'unblock';
}

export default function Admin() {
  const { professional } = useAuth();
  const [rows, setRows] = useState<ProfessionalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // AdminLayout já protege a rota; este guard é só camada extra
  if (!professional) return <Navigate to="/login" replace />;
  if (!professional.isAdmin) return <Navigate to="/login" replace />;

  function reload() {
    api.get<ProfessionalRow[]>('/admin/professionals')
      .then(setRows)
      .catch(() => setError('Erro ao carregar profissionais.'))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  async function handleConfirm() {
    if (!confirmAction) return;
    setActing(true);
    setActionError(null);
    try {
      await api.post(`/admin/professionals/${confirmAction.id}/${confirmAction.action}`);
      setConfirmAction(null);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erro ao atualizar profissional.');
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-semibold text-wine-800">Profissionais</h1>
        <p className="text-sm text-stone-500 mt-1">Profissionais cadastradas no sistema</p>
      </div>

      {loading && (
        <div className="text-center py-16 text-stone-400 text-sm">Carregando…</div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 bg-stone-50 text-left">
                <th className="px-5 py-3 font-medium text-stone-500">Nome / Negócio</th>
                <th className="px-5 py-3 font-medium text-stone-500">E-mail</th>
                <th className="px-5 py-3 font-medium text-stone-500 hidden md:table-cell">WhatsApp</th>
                <th className="px-5 py-3 font-medium text-stone-500 hidden lg:table-cell">Instância WA</th>
                <th className="px-5 py-3 font-medium text-stone-500 hidden lg:table-cell">Cadastro</th>
                <th className="px-5 py-3 font-medium text-stone-500">Tipo</th>
                <th className="px-5 py-3 font-medium text-stone-500">Status</th>
                <th className="px-5 py-3 font-medium text-stone-500">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((p) => {
                const isSelf = p.id === professional.id;
                const isBlocked = p.blocked_at !== null;
                return (
                  <tr key={p.id} className="hover:bg-stone-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-stone-800">{p.name}</p>
                      <p className="text-xs text-stone-400 mt-0.5">{p.business_name}</p>
                    </td>
                    <td className="px-5 py-3.5 text-stone-600">{p.email}</td>
                    <td className="px-5 py-3.5 text-stone-500 hidden md:table-cell">
                      {p.phone_whatsapp || <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-stone-500 hidden lg:table-cell font-mono text-xs">
                      {p.wa_instance_name || <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-stone-400 hidden lg:table-cell text-xs">
                      {new Date(p.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-5 py-3.5">
                      {p.is_admin ? (
                        <span className="inline-flex items-center rounded-full bg-wine-100 text-wine-700 px-2.5 py-0.5 text-xs font-medium">
                          Admin
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-stone-100 text-stone-500 px-2.5 py-0.5 text-xs font-medium">
                          Profissional
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {isBlocked ? (
                        <span className="inline-flex items-center rounded-full bg-rose-50 text-rose-600 border border-rose-200 px-2.5 py-0.5 text-xs font-medium">
                          Bloqueada
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium">
                          Ativa
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {isSelf ? (
                        <span className="text-xs text-stone-300">—</span>
                      ) : isBlocked ? (
                        <button
                          onClick={() => setConfirmAction({ id: p.id, name: p.name, action: 'unblock' })}
                          className="text-xs px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors font-medium"
                        >
                          Desbloquear
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmAction({ id: p.id, name: p.name, action: 'block' })}
                          className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors font-medium"
                        >
                          Bloquear
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-stone-400 text-sm">
                    Nenhuma profissional encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmação de bloqueio/desbloqueio */}
      {confirmAction && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-end sm:items-center justify-center p-4 z-50"
          onClick={(e) => { if (e.target === e.currentTarget && !acting) { setConfirmAction(null); setActionError(null); } }}
        >
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6">
            <h3 className="font-display text-lg text-wine-800 mb-2">
              {confirmAction.action === 'block' ? 'Bloquear profissional?' : 'Desbloquear profissional?'}
            </h3>
            <p className="text-sm text-stone-600">
              {confirmAction.action === 'block' ? (
                <>Isso vai impedir <strong>{confirmAction.name}</strong> de acessar o sistema e encerrar a sessão dela imediatamente.</>
              ) : (
                <>Isso vai liberar o acesso de <strong>{confirmAction.name}</strong>. Ela precisará fazer login novamente.</>
              )}
            </p>
            {actionError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 mt-3">{actionError}</div>
            )}
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => { setConfirmAction(null); setActionError(null); }}
                disabled={acting}
                className="btn-secondary flex-1 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={acting}
                className={`flex-1 text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-60 ${
                  confirmAction.action === 'block'
                    ? 'bg-rose-600 text-white hover:bg-rose-700'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {acting ? 'Aguarde…' : confirmAction.action === 'block' ? 'Bloquear' : 'Desbloquear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
