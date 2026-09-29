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

interface EditForm {
  name: string;
  businessName: string;
  phoneWhatsapp: string;
  email: string;
}

interface DeletePreview {
  clients: number;
  appointments: number;
  services: number;
  recurringGroups: number;
  messages: number;
  expenses: number;
}

// Recorta a imagem em quadrado e reduz para um base64 leve (mesma técnica
// usada em Perfil.tsx para o avatar da própria conta).
function resizeImageToBase64(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas não disponível.'));
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
    img.src = url;
  });
}

export default function Admin() {
  const { professional } = useAuth();
  const [rows, setRows] = useState<ProfessionalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Edição de profissional ──
  const [editTarget, setEditTarget] = useState<ProfessionalRow | null>(null);
  const [editStep, setEditStep] = useState<'form' | 'confirm'>('form');
  const [editForm, setEditForm] = useState<EditForm>({ name: '', businessName: '', phoneWhatsapp: '', email: '' });
  const [editAvatarB64, setEditAvatarB64] = useState<string | null>(null);
  const [editAvatarChanged, setEditAvatarChanged] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ── Exclusão definitiva de profissional ──
  const [deleteTarget, setDeleteTarget] = useState<ProfessionalRow | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  function openEdit(p: ProfessionalRow) {
    setEditTarget(p);
    setEditStep('form');
    setEditForm({
      name: p.name,
      businessName: p.business_name,
      phoneWhatsapp: p.phone_whatsapp ?? '',
      email: p.email,
    });
    setEditAvatarB64(null);
    setEditAvatarChanged(false);
    setEditError(null);
  }

  function closeEdit() {
    setEditTarget(null);
    setEditError(null);
  }

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setEditError('Selecione um arquivo de imagem (JPG, PNG, WEBP…).'); return; }
    if (file.size > 10 * 1024 * 1024) { setEditError('Arquivo muito grande. Use uma imagem de até 10 MB.'); return; }
    try {
      const b64 = await resizeImageToBase64(file);
      setEditAvatarB64(b64);
      setEditAvatarChanged(true);
      setEditError(null);
    } catch {
      setEditError('Não foi possível processar a imagem. Tente outra.');
    }
  }

  function goToConfirmEdit() {
    if (!editForm.name.trim() || !editForm.businessName.trim() || !editForm.email.trim()) {
      setEditError('Preencha nome, negócio e e-mail.');
      return;
    }
    setEditError(null);
    setEditStep('confirm');
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    setEditSaving(true);
    setEditError(null);
    try {
      const payload: Record<string, unknown> = {
        name: editForm.name.trim(),
        business_name: editForm.businessName.trim(),
        phone_whatsapp: editForm.phoneWhatsapp.trim(),
        email: editForm.email.trim(),
      };
      if (editAvatarChanged) payload.avatar_b64 = editAvatarB64;
      await api.put(`/admin/professionals/${editTarget.id}`, payload);
      setEditTarget(null);
      reload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Erro ao salvar profissional.');
    } finally {
      setEditSaving(false);
    }
  }

  function openDelete(p: ProfessionalRow) {
    setDeleteTarget(p);
    setDeletePreview(null);
    setDeleteConfirmText('');
    setDeleteError(null);
    setDeletePreviewLoading(true);
    api.get<DeletePreview>(`/admin/professionals/${p.id}/delete-preview`)
      .then(setDeletePreview)
      .catch(() => setDeleteError('Erro ao carregar os dados que seriam apagados.'))
      .finally(() => setDeletePreviewLoading(false));
  }

  function closeDelete() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/admin/professionals/${deleteTarget.id}`, { businessNameConfirmation: deleteConfirmText });
      setDeleteTarget(null);
      reload();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao excluir profissional.');
    } finally {
      setDeleting(false);
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
        <div className="hidden md:block rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm">
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
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openEdit(p)}
                            className="text-xs px-3 py-1.5 rounded-lg border border-wine-200 text-wine-700 hover:bg-wine-50 transition-colors font-medium"
                          >
                            Editar
                          </button>
                          {isBlocked ? (
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
                          <button
                            onClick={() => openDelete(p)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors font-medium"
                          >
                            Excluir
                          </button>
                        </div>
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

      {/* Cards — abaixo de md, substitui visualmente a tabela acima */}
      {!loading && !error && (
        <div className="md:hidden space-y-3">
          {rows.map((p) => {
            const isSelf = p.id === professional.id;
            const isBlocked = p.blocked_at !== null;
            return (
              <div key={p.id} className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-800 truncate">{p.name}</p>
                    <p className="text-xs text-stone-400 mt-0.5 truncate">{p.business_name}</p>
                  </div>
                  {p.is_admin ? (
                    <span className="shrink-0 inline-flex items-center rounded-full bg-wine-100 text-wine-700 px-2.5 py-0.5 text-xs font-medium">
                      Admin
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center rounded-full bg-stone-100 text-stone-500 px-2.5 py-0.5 text-xs font-medium">
                      Profissional
                    </span>
                  )}
                </div>

                <p className="text-sm text-stone-600 break-all mb-3">{p.email}</p>

                <div className="mb-3">
                  {isBlocked ? (
                    <span className="inline-flex items-center rounded-full bg-rose-50 text-rose-600 border border-rose-200 px-2.5 py-0.5 text-xs font-medium">
                      Bloqueada
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium">
                      Ativa
                    </span>
                  )}
                </div>

                {isSelf ? (
                  <p className="text-xs text-stone-400 italic">Esta é a sua conta</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openEdit(p)}
                        className="text-sm py-2 rounded-lg border border-wine-200 text-wine-700 hover:bg-wine-50 transition-colors font-medium"
                      >
                        Editar
                      </button>
                      {isBlocked ? (
                        <button
                          onClick={() => setConfirmAction({ id: p.id, name: p.name, action: 'unblock' })}
                          className="text-sm py-2 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors font-medium"
                        >
                          Desbloquear
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmAction({ id: p.id, name: p.name, action: 'block' })}
                          className="text-sm py-2 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors font-medium"
                        >
                          Bloquear
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => openDelete(p)}
                      className="w-full text-sm py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors font-medium"
                    >
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="rounded-2xl border border-stone-200 bg-white p-10 text-center text-stone-400 text-sm">
              Nenhuma profissional encontrada.
            </div>
          )}
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

      {/* Edição de profissional */}
      {editTarget && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-end sm:items-center justify-center p-4 z-50"
          onClick={(e) => { if (e.target === e.currentTarget && !editSaving) closeEdit(); }}
        >
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6">
            <h3 className="font-display text-lg text-wine-800 mb-4">
              {editStep === 'form' ? 'Editar profissional' : 'Confirmar alterações'}
            </h3>

            {editStep === 'form' ? (
              <div className="flex flex-col gap-4">
                {/* Avatar */}
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full overflow-hidden bg-wine-600 text-cream flex items-center justify-center font-display text-xl shrink-0">
                    {editAvatarB64 ? (
                      <img src={editAvatarB64} alt="Nova foto" className="w-full h-full object-cover" />
                    ) : (
                      (editForm.name.trim()[0] ?? '?').toUpperCase()
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-medium text-wine-600 hover:text-wine-700 underline cursor-pointer">
                      Trocar foto
                      <input type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
                    </label>
                    {editAvatarChanged && (
                      <p className="text-xs text-amber-600 mt-0.5">Nova foto selecionada — ainda não salva</p>
                    )}
                  </div>
                </div>

                <label className="block">
                  <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Nome</span>
                  <input
                    className="input"
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">Negócio</span>
                  <input
                    className="input"
                    value={editForm.businessName}
                    onChange={(e) => setEditForm((f) => ({ ...f, businessName: e.target.value }))}
                  />
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">WhatsApp</span>
                  <input
                    className="input"
                    value={editForm.phoneWhatsapp}
                    onChange={(e) => setEditForm((f) => ({ ...f, phoneWhatsapp: e.target.value }))}
                  />
                </label>

                <label className="block">
                  <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">E-mail</span>
                  <input
                    className="input"
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  />
                  <p className="text-xs text-ink/40 mt-1">
                    Este e-mail é usado para login. Ao trocar, a profissional só vai conseguir entrar com o novo e-mail.
                  </p>
                </label>

                {editError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{editError}</div>
                )}

                <div className="flex gap-3 pt-1">
                  <button onClick={closeEdit} className="btn-secondary flex-1">Cancelar</button>
                  <button onClick={goToConfirmEdit} className="btn-primary flex-1">Revisar alterações</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-stone-600">
                  Confirma salvar as alterações no cadastro de <strong>{editTarget.name}</strong>?
                </p>
                <ul className="text-sm text-stone-600 bg-stone-50 rounded-xl p-3 space-y-1">
                  <li><span className="text-stone-400">Nome:</span> {editForm.name}</li>
                  <li><span className="text-stone-400">Negócio:</span> {editForm.businessName}</li>
                  <li><span className="text-stone-400">WhatsApp:</span> {editForm.phoneWhatsapp || '—'}</li>
                  <li><span className="text-stone-400">E-mail:</span> {editForm.email}</li>
                  {editAvatarChanged && <li><span className="text-stone-400">Foto:</span> nova foto selecionada</li>}
                </ul>
                {editForm.email !== editTarget.email && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                    O e-mail de login vai mudar. A profissional precisará usar o novo e-mail para entrar.
                  </div>
                )}
                {editError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{editError}</div>
                )}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setEditStep('form')} disabled={editSaving} className="btn-secondary flex-1 disabled:opacity-60">
                    Voltar
                  </button>
                  <button onClick={handleSaveEdit} disabled={editSaving} className="btn-primary flex-1 disabled:opacity-60">
                    {editSaving ? 'Salvando…' : 'Confirmar e salvar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Exclusão definitiva de profissional */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-ink/50 flex items-end sm:items-center justify-center p-4 z-50"
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) closeDelete(); }}
        >
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6">
            <h3 className="font-display text-lg text-rose-700 mb-2">Excluir profissional definitivamente?</h3>
            <p className="text-sm text-stone-600 mb-3">
              Esta ação é <strong>irreversível</strong>. Todos os dados de <strong>{deleteTarget.name}</strong> (
              {deleteTarget.business_name}) serão apagados, incluindo:
            </p>

            {deletePreviewLoading ? (
              <p className="text-sm text-stone-400 mb-3">Calculando o que será apagado…</p>
            ) : deletePreview ? (
              <ul className="text-sm text-stone-600 bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-1 mb-3">
                <li>{deletePreview.clients} cliente(s)</li>
                <li>{deletePreview.appointments} agendamento(s)</li>
                <li>{deletePreview.services} serviço(s)</li>
                <li>{deletePreview.recurringGroups} recorrência(s)</li>
                <li>{deletePreview.messages} mensagem(ns) de WhatsApp</li>
                <li>{deletePreview.expenses} despesa(s)</li>
              </ul>
            ) : null}

            <label className="block mb-3">
              <span className="block text-xs font-medium text-ink/50 uppercase tracking-wide mb-1.5">
                Digite <strong>{deleteTarget.business_name}</strong> para confirmar
              </span>
              <input
                className="input"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoComplete="off"
              />
            </label>

            {deleteError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700 mb-3">{deleteError}</div>
            )}

            <div className="flex gap-3">
              <button onClick={closeDelete} disabled={deleting} className="btn-secondary flex-1 disabled:opacity-60">
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || deleteConfirmText.trim() !== deleteTarget.business_name}
                className="flex-1 text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-40 bg-rose-600 text-white hover:bg-rose-700"
              >
                {deleting ? 'Excluindo…' : 'Excluir definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
