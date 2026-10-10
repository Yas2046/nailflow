import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { computeStats, type ProfessionalRow } from '../components/admin-dashboard/derive';
import { IconRefresh } from '../components/AdminIcons';
import { PageHeader, Segmented } from '../components/admin-account/AccountUi';
import { resizeImageToBase64 } from '../components/admin-account/imageUtils';
import { IconSearch } from '../components/admin-professionals/icons';
import { EmptyState, ErrorState, LoadingState } from '../components/admin-professionals/ListStates';
import { FILTERS, normalize, type FilterId } from '../components/admin-professionals/filters';
import ProfessionalCard, { ProfessionalsTableHead } from '../components/admin-professionals/ProfessionalCard';
import { ConfirmActionDialog, DeleteProfessionalDialog, EditProfessionalDialog } from '../components/admin-professionals/ProfessionalDialogs';
import type { MenuItem } from '../components/admin-professionals/RowMenu';
import { SummaryStrip } from '../components/admin-professionals/SummaryStrip';
import type { ConfirmAction, DeletePreview, EditForm } from '../components/admin-professionals/types';

// Gestão de contas de profissionais. A lista vem de GET /admin/professionals (sem a conta admin);
// busca, filtros e "mostrar mais" são calculados no navegador sobre a lista já carregada.

const PAGE_SIZE = 12;

export default function AdminProfissionais() {
  usePageTitle('Profissionais');
  const { professional } = useAuth();
  const [rows, setRows] = useState<ProfessionalRow[]>([]);
  const [searchParams] = useSearchParams();
  const initialFilter = searchParams.get('filtro');
  const [filter, setFilter] = useState<FilterId>(FILTERS.some((f) => f.id === initialFilter) ? (initialFilter as FilterId) : 'todas');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
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

  // quem abriu o diálogo (para devolver o foco ao fechar)
  const triggerRef = useRef<HTMLElement | null>(null);
  const listTitleId = useId();

  // `silent` = recarrega depois de uma ação sem voltar ao esqueleto de carregamento
  function reload(silent = true) {
    if (!silent) { setLoading(true); setError(null); }
    api.get<ProfessionalRow[]>('/admin/professionals')
      .then((data) => { setRows(data.filter((r) => !r.is_admin)); setError(null); })
      .catch(() => setError('Erro ao carregar profissionais.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(true); }, []);

  // AdminLayout já protege a rota; este guard é só camada extra
  if (!professional) return <Navigate to="/login" replace />;
  if (!professional.isAdmin) return <Navigate to="/login" replace />;

  function chooseFilter(f: FilterId) { setFilter(f); setLimit(PAGE_SIZE); }
  function changeQuery(v: string) { setQuery(v); setLimit(PAGE_SIZE); }
  function clearFilters() { setFilter('todas'); setQuery(''); setLimit(PAGE_SIZE); }

  // ── bloquear / desbloquear ──
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

  // ── editar ──
  function openEdit(p: ProfessionalRow) {
    setEditTarget(p);
    setEditStep('form');
    setEditForm({ name: p.name, businessName: p.business_name, phoneWhatsapp: p.phone_whatsapp ?? '', email: p.email });
    setEditAvatarB64(null);
    setEditAvatarChanged(false);
    setEditError(null);
  }

  function closeEdit() {
    setEditTarget(null);
    setEditError(null);
  }

  async function handleAvatarFile(e: ChangeEvent<HTMLInputElement>) {
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

  // ── excluir ──
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

  function menuItemsFor(p: ProfessionalRow): MenuItem[] {
    const isBlocked = p.blocked_at !== null;
    return [
      { label: 'Editar', onSelect: () => openEdit(p) },
      isBlocked
        ? { label: 'Desbloquear', tone: 'success' as const, onSelect: () => setConfirmAction({ id: p.id, name: p.name, action: 'unblock' }) }
        : { label: 'Bloquear', onSelect: () => setConfirmAction({ id: p.id, name: p.name, action: 'block' }) },
      { label: 'Excluir…', tone: 'danger' as const, onSelect: () => openDelete(p) },
    ];
  }

  // ── derivados: o resumo usa o mesmo cálculo do Dashboard ──
  const stats = computeStats(rows);
  const showList = !loading && !error;
  const activeFilter = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const q = normalize(query);
  const visibleRows = rows.filter(
    (r) => activeFilter.match(r) && (!q || normalize(`${r.name} ${r.business_name} ${r.email}`).includes(q)),
  );
  const shownRows = visibleRows.slice(0, limit);
  const remaining = visibleRows.length - shownRows.length;
  const filtering = filter !== 'todas' || q !== '';

  return (
    <div className="mx-auto max-w-[80rem]">

      <PageHeader
        eyebrow="gestão / profissionais"
        title="Profissionais"
        subtitle="Gerencie o acesso e os dados de cada conta do NailFlow."
      />

      {loading && <LoadingState />}

      {error && !loading && <ErrorState message={error} onRetry={() => reload(false)} />}

      {showList && (
        <>
          <SummaryStrip stats={stats} />

          <section aria-labelledby={listTitleId}>
            <h2 id={listTitleId} className="sr-only">Lista de profissionais</h2>
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <Segmented<FilterId>
                label="Filtrar por situação"
                value={filter}
                onChange={chooseFilter}
                options={FILTERS.map((f) => ({ id: f.id, label: f.label, count: rows.filter(f.match).length }))}
              />
              <div className="flex items-center gap-2.5">
                <div className="relative min-w-0 flex-1 lg:w-80 lg:flex-none">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/55" aria-hidden="true"><IconSearch /></span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => changeQuery(e.target.value)}
                    aria-label="Buscar profissional"
                    placeholder="Buscar nome, negócio ou e-mail"
                    className="input h-[42px] !pl-9"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => reload(false)}
                  title="Atualizar lista"
                  aria-label="Atualizar lista"
                  className="btn-secondary h-[42px] w-[42px] shrink-0 !p-0"
                >
                  <IconRefresh />
                </button>
              </div>
            </div>
            <p className="mb-3 font-mono text-xs text-ink/65" aria-live="polite">
              {filtering ? `${visibleRows.length} de ${rows.length} contas` : `${rows.length} ${rows.length === 1 ? 'conta' : 'contas'}`}
            </p>

            {rows.length === 0 ? (
              <EmptyState />
            ) : visibleRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-wine-200 bg-white px-6 py-14 text-center">
                <p className="text-[15px] text-ink/65">Nenhuma conta encontrada com esses filtros.</p>
                <button type="button" onClick={clearFilters} className="btn-secondary mt-5">Limpar filtros</button>
              </div>
            ) : (
              <>
                <div className="overflow-hidden rounded-2xl border border-wine-100 bg-white">
                  <ProfessionalsTableHead />
                  <ul className="divide-y divide-wine-100">
                    {shownRows.map((p) => (
                      <ProfessionalCard key={p.id} p={p} menuItems={menuItemsFor(p)} onOpenTrigger={(el) => { triggerRef.current = el; }} />
                    ))}
                  </ul>
                </div>
                {remaining > 0 && (
                  <div className="mt-8 flex flex-col items-center gap-3">
                    <p className="font-mono text-xs text-ink/65 tabular-nums" aria-live="polite">Mostrando {shownRows.length} de {visibleRows.length}</p>
                    <button
                      type="button"
                      onClick={() => setLimit((l) => l + PAGE_SIZE)}
                      className="btn-secondary min-h-[46px] px-6"
                    >
                      Mostrar mais {Math.min(PAGE_SIZE, remaining)}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {confirmAction && (
        <ConfirmActionDialog
          action={confirmAction}
          acting={acting}
          error={actionError}
          returnFocusRef={triggerRef}
          onCancel={() => { setConfirmAction(null); setActionError(null); }}
          onConfirm={handleConfirm}
        />
      )}

      {editTarget && (
        <EditProfessionalDialog
          target={editTarget}
          step={editStep}
          form={editForm}
          avatarB64={editAvatarB64}
          avatarChanged={editAvatarChanged}
          saving={editSaving}
          error={editError}
          returnFocusRef={triggerRef}
          onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
          onAvatarFile={handleAvatarFile}
          onClose={closeEdit}
          onReview={goToConfirmEdit}
          onBack={() => setEditStep('form')}
          onSave={handleSaveEdit}
        />
      )}

      {deleteTarget && (
        <DeleteProfessionalDialog
          target={deleteTarget}
          preview={deletePreview}
          previewLoading={deletePreviewLoading}
          confirmText={deleteConfirmText}
          deleting={deleting}
          error={deleteError}
          returnFocusRef={triggerRef}
          onConfirmTextChange={setDeleteConfirmText}
          onClose={closeDelete}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
