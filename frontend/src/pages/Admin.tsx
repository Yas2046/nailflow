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
}

export default function Admin() {
  const { professional } = useAuth();
  const [rows, setRows] = useState<ProfessionalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AdminLayout já protege a rota; este guard é só camada extra
  if (!professional) return <Navigate to="/login" replace />;
  if (!professional.isAdmin) return <Navigate to="/login" replace />;

  useEffect(() => {
    api.get<ProfessionalRow[]>('/admin/professionals')
      .then(setRows)
      .catch(() => setError('Erro ao carregar profissionais.'))
      .finally(() => setLoading(false));
  }, []);

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
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((p) => (
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
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-stone-400 text-sm">
                    Nenhuma profissional encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
