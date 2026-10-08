// Cálculos do Dashboard ADM. Tudo é derivado de GET /admin/professionals (e, para exclusões,
// de GET /admin/audit-log). Funções puras: nenhuma chamada de rede, nenhum dado estimado.

export interface ProfessionalRow {
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

const DAY = 86_400_000;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export interface PlatformStats {
  accounts: number;     // contas de profissionais (admins ficam de fora)
  active: number;
  blocked: number;
  withInstance: number; // com instância de WhatsApp configurada
  newLast30: number;
  admins: number;
}

export function computeStats(rows: ProfessionalRow[], now = Date.now()): PlatformStats {
  const pros = rows.filter((r) => !r.is_admin);
  const active = pros.filter((r) => r.blocked_at === null).length;
  return {
    accounts: pros.length,
    active,
    blocked: pros.length - active,
    withInstance: pros.filter((r) => !!r.wa_instance_name).length,
    newLast30: pros.filter((r) => now - new Date(r.created_at).getTime() <= 30 * DAY).length,
    admins: rows.length - pros.length,
  };
}

export interface AttentionItem {
  id: string;
  text: string;
  /** destino do clique; ausente = apenas informativo */
  to?: string;
  /** nota informativa: não impede o "Tudo em ordem" */
  info?: boolean;
}

/**
 * Situações reais que merecem um olhar. Sem níveis de risco: não existe motor de risco.
 * Universo = contas de profissionais (admins ficam de fora), o mesmo da gestão de profissionais:
 * os números daqui batem com os filtros da lista a que cada item leva.
 * `deletes7` = exclusões nos últimos 7 dias (null quando o histórico não pôde ser lido).
 */
export function computeAttention(rows: ProfessionalRow[], deletes7: number | null, now = Date.now()): AttentionItem[] {
  const pros = rows.filter((r) => !r.is_admin);
  const active = pros.filter((r) => r.blocked_at === null);
  const items: AttentionItem[] = [];

  const noInstance = pros.filter((r) => !r.wa_instance_name);
  const newNoInstance = noInstance.filter((r) => now - new Date(r.created_at).getTime() <= 7 * DAY);
  const oldNoInstance = noInstance.length - newNoInstance.length;
  const noNumber = pros.filter((r) => !r.phone_whatsapp?.trim()).length;
  const blocked = pros.length - active.length;
  const admins = rows.length - pros.length;

  if (newNoInstance.length > 0) {
    const n = newNoInstance.length;
    items.push({ id: 'novas-sem-config', text: `${n} ${plural(n, 'cadastro recente ainda sem configuração', 'cadastros recentes ainda sem configuração')}`, to: '/admin/profissionais?filtro=sem-instancia' });
  }
  if (deletes7 && deletes7 > 0) {
    items.push({ id: 'exclusoes', text: `${deletes7} ${plural(deletes7, 'exclusão', 'exclusões')} nos últimos 7 dias`, to: '/admin/auditoria' });
  }
  if (blocked > 0) {
    items.push({ id: 'bloqueadas', text: `${blocked} ${plural(blocked, 'conta bloqueada', 'contas bloqueadas')}`, to: '/admin/profissionais?filtro=bloqueadas' });
  }
  if (oldNoInstance > 0) {
    items.push({ id: 'sem-instancia', text: `${oldNoInstance} ${plural(oldNoInstance, 'conta sem instância do WhatsApp', 'contas sem instância do WhatsApp')}`, to: '/admin/profissionais?filtro=sem-instancia' });
  }
  if (noNumber > 0) {
    items.push({ id: 'sem-numero', text: `${noNumber} ${plural(noNumber, 'conta sem número de WhatsApp', 'contas sem número de WhatsApp')}`, to: '/admin/profissionais?filtro=sem-numero' });
  }
  if (admins === 1) {
    items.push({ id: 'um-admin', text: 'Apenas 1 conta administradora', info: true });
  }
  return items;
}

export interface MonthBucket {
  key: string;
  label: string;
  count: number;
}

/** Cadastros de profissionais por mês (últimos `months` meses, incluindo o atual). */
export function signupsByMonth(rows: ProfessionalRow[], now = new Date(), months = 6): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
      count: 0,
    });
  }
  for (const r of rows) {
    if (r.is_admin) continue;
    const d = new Date(r.created_at);
    const b = buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (b) b.count++;
  }
  return buckets;
}

/** O gráfico só aparece quando há dados suficientes para ele dizer alguma coisa. */
export function chartIsMeaningful(buckets: MonthBucket[]) {
  return buckets.filter((b) => b.count > 0).length >= 3 && buckets.reduce((s, b) => s + b.count, 0) >= 5;
}
