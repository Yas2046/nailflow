// Backend simulado em memória (dados fictícios; nada vem de servidor ou de pessoas reais).
// Suporta as rotas usadas por Início, Agenda, Clientes, Serviços e Financeiro. Rotas não listadas respondem 404.
import { ApiError } from '../services/api';
import type { Appointment, AppointmentStatus, Client, DashboardSummary, Service } from '../types';

const DAY = 86_400_000;
let seq = 100;
const nid = (p: string) => `${p}-${++seq}`;

function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const services: Service[] = [
  { id: 's1', name: 'Manicure em gel', description: 'Esmaltação em gel com preparação', priceCents: 9000, durationMinutes: 60, active: true, availableOnWhatsapp: true },
  { id: 's2', name: 'Alongamento em fibra', description: null, priceCents: 18000, durationMinutes: 120, active: true, availableOnWhatsapp: true },
  { id: 's3', name: 'Pedicure', description: null, priceCents: 7000, durationMinutes: 60, active: true, availableOnWhatsapp: true },
  { id: 's4', name: 'Manutenção de alongamento', description: null, priceCents: 12000, durationMinutes: 90, active: true, availableOnWhatsapp: false },
  { id: 's5', name: 'Nail art (por unha)', description: null, priceCents: 1500, durationMinutes: 15, active: false, availableOnWhatsapp: false },
];

const clients: Client[] = [
  ['c1', 'Ana Souza', '11900000001', ['recorrente']], ['c2', 'Beatriz Lima', '11900000002', []], ['c3', 'Carla Mendes', '11900000003', ['noiva']],
  ['c4', 'Daniela Rocha', '11900000004', []], ['c5', 'Elisa Prado', '11900000005', ['recorrente']], ['c6', 'Fernanda Alves', '11900000006', []],
  ['c7', 'Gabriela Torres', '11900000007', []], ['c8', 'Helena Duarte', '11900000008', ['alérgica a acetona']],
  ['c9', 'Isabela Ramos', '11900000009', []], ['c10', 'Julia Nunes', '11900000010', []],
].map(([id, name, phone, tags]) => ({ id: id as string, name: name as string, phone: phone as string, notes: null, tags: tags as string[] }));

const appts: Appointment[] = [];
function addAppt(clientId: string, serviceId: string, d: Date, status: AppointmentStatus): Appointment {
  const c = clients.find((x) => x.id === clientId)!;
  const s = services.find((x) => x.id === serviceId)!;
  const a: Appointment = {
    id: nid('a'), clientId, clientName: c.name, clientPhone: c.phone, serviceId, serviceName: s.name,
    startsAt: d.toISOString(), endsAt: new Date(d.getTime() + s.durationMinutes * 60_000).toISOString(),
    status, notes: null, recurringGroupId: null,
  };
  appts.push(a);
  return a;
}
[
  ['c1', 's1', -20, 10, 'concluido'], ['c1', 's4', -9, 10, 'concluido'], ['c2', 's3', -12, 14, 'concluido'], ['c3', 's2', -8, 9, 'concluido'],
  ['c4', 's1', -3, 15, 'concluido'], ['c5', 's4', -2, 11, 'nao_compareceu'], ['c6', 's3', -1, 16, 'cancelado'], ['c5', 's1', -30, 10, 'concluido'],
  ['c1', 's1', 0, 9, 'confirmado'], ['c2', 's2', 0, 11, 'confirmado'], ['c3', 's3', 0, 14, 'pendente'], ['c7', 's1', 0, 16, 'confirmado'],
  ['c9', 's4', -28, 10, 'concluido'], ['c10', 's3', -60, 14, 'concluido'], ['c4', 's4', 1, 10, 'confirmado'], ['c8', 's1', 2, 15, 'pendente'], ['c5', 's2', 4, 9, 'confirmado'],
].forEach(([c, s, off, h, st]) => addAppt(c as string, s as string, at(off as number, h as number), st as AppointmentStatus));

// recebimentos simulados (por atendimento); só os concluídos da primeira semana foram pagos, o resto fica "a conferir".
interface Pay { id: string; appointmentId: string; kind: 'recebimento' | 'estorno'; amountCents: number; method: string; occurredOn: string; notes: string | null; reversesPaymentId: string | null; createdAt: string }
const payments: Pay[] = [];
function pay(a: Appointment, amountCents: number, method = 'pix', dayOffset = 0) {
  payments.push({ id: nid('p'), appointmentId: a.id, kind: 'recebimento', amountCents, method, occurredOn: ymd(at(dayOffset, 12)), notes: null, reversesPaymentId: null, createdAt: at(dayOffset, 12).toISOString() });
}
const done = appts.filter((a) => a.status === 'concluido');
pay(done[0], 9000, 'pix', -20); pay(done[1], 12000, 'dinheiro', -9); pay(done[4], 4500, 'pix', -3); pay(done[5], 9000, 'cartao_credito', -30);

const expenses = [
  { id: 'e1', professional_id: 'mock', description: 'Esmaltes em gel', category: 'Materiais', amount_cents: 32000, expense_date: ymd(at(-6, 12)), notes: null, created_at: at(-6, 12).toISOString(), updated_at: at(-6, 12).toISOString() },
  { id: 'e2', professional_id: 'mock', description: 'Aluguel da sala', category: 'Aluguel', amount_cents: 90000, expense_date: ymd(at(-4, 12)), notes: null, created_at: at(-4, 12).toISOString(), updated_at: at(-4, 12).toISOString() },
];

// perfil da profissional fictícia (tela Configurações → Perfil e Agendamento)
const profile: Record<string, unknown> = {
  id: 'mock-prof', name: 'Profissional Demo', email: 'demo@exemplo.test', business_name: 'Studio Demo', phone_whatsapp: '5511900000000',
  avatar_b64: null, slug: 'studio-demo', bio: 'Nail designer fictícia para demonstração.', public_theme: 'vinho',
  instagram: null, confirmation_mode: 'manual', deposit_required: false, deposit_type: null, deposit_value: null, pix_key: null,
};

// estado da "conta nova" simulada (só vale com localStorage.nf_mock_onboarding = 'new')
const newAccount = { phoneSaved: false, services: 0, horarios: false };
const flag = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

// retorno de clientes e galeria (dados fictícios em memória)
const optedOut = new Set<string>();
const snoozedUntil = new Map<string, number>();
const photos: Array<{ id: string; dataUrl: string }> = [];

const priceOf = (a: Appointment) => services.find((s) => s.id === a.serviceId)?.priceCents ?? 0;
const netPaid = (id: string) => payments.filter((p) => p.appointmentId === id).reduce((n, p) => n + (p.kind === 'recebimento' ? p.amountCents : -p.amountCents), 0);
const sameDay = (iso: string, d: Date) => ymd(new Date(iso)) === ymd(d);

function financeOf(a: Appointment) {
  const received = payments.filter((p) => p.appointmentId === a.id && p.kind === 'recebimento').reduce((n, p) => n + p.amountCents, 0);
  const refunded = payments.filter((p) => p.appointmentId === a.id && p.kind === 'estorno').reduce((n, p) => n + p.amountCents, 0);
  const value = priceOf(a);
  return {
    appointmentId: a.id, status: a.status, finalPriceCents: null, canReceive: a.status === 'concluido', valueCents: value, valueBasis: 'servico' as const,
    receivedCents: received, refundedCents: refunded, netReceivedCents: received - refunded, balanceCents: Math.max(0, value - (received - refunded)),
    movimentacoes: payments.filter((p) => p.appointmentId === a.id).map((p) => ({ ...p, source: 'mock', refundedCents: 0, remainingCents: p.amountCents })),
  };
}

function receivables() {
  const itens = appts.filter((a) => a.status === 'concluido').map((a) => {
    const f = financeOf(a);
    const days = Math.floor((Date.now() - new Date(a.endsAt).getTime()) / DAY);
    return {
      appointmentId: a.id, paymentsPath: `/financeiro/atendimentos/${a.id}/pagamentos`, clientName: a.clientName, serviceName: a.serviceName, startsAt: a.startsAt, endsAt: a.endsAt,
      daysSinceService: days, valueCents: f.valueCents, valueBasis: 'servico' as const, receivedCents: f.receivedCents, refundedCents: f.refundedCents, netReceivedCents: f.netReceivedCents,
      balanceCents: f.balanceCents, overdue: f.balanceCents > 0 && days > 7, quitado: f.balanceCents === 0, movimentacoes: f.movimentacoes.length, sinalLegado: null,
    };
  });
  const aberto = itens.filter((i) => !i.quitado);
  const sum = (l: typeof itens, k: 'valueCents' | 'receivedCents' | 'refundedCents' | 'netReceivedCents' | 'balanceCents') => l.reduce((n, i) => n + i[k], 0);
  return {
    today: ymd(new Date()), graceDays: 7,
    totais: {
      atendimentos: itens.length, valorCents: sum(itens, 'valueCents'), recebidoLiquidoCents: sum(itens, 'netReceivedCents'), recebidoCents: sum(itens, 'receivedCents'),
      estornadoCents: sum(itens, 'refundedCents'), saldoPendenteCents: sum(aberto, 'balanceCents'), saldoVencidoCents: sum(aberto.filter((i) => i.overdue), 'balanceCents'),
      emAberto: aberto.length, vencidos: aberto.filter((i) => i.overdue).length,
    },
    itens,
  };
}

function dashboard(): DashboardSummary {
  const hoje = appts.filter((a) => sameDay(a.startsAt, new Date())).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const next = hoje.find((a) => new Date(a.startsAt) > new Date() && (a.status === 'confirmado' || a.status === 'pendente')) ?? null;
  const month = appts.filter((a) => new Date(a.startsAt).getMonth() === new Date().getMonth());
  const recebido = payments.filter((p) => p.kind === 'recebimento').reduce((n, p) => n + p.amountCents, 0);
  const pend = appts.filter((a) => a.status === 'pendente' && new Date(a.startsAt) > new Date());
  return {
    aguardando: pend.length ? { confirmacao: pend.length, pagamento: 0, proximoVencimento: null, itens: pend.map((a) => ({ id: a.id, clientName: a.clientName, serviceName: a.serviceName, startsAt: a.startsAt, status: a.status, expiresAt: at(1, 12).toISOString() })) } : (null as never),
    agendamentosHoje: hoje.map((a) => ({ id: a.id, clientName: a.clientName, serviceName: a.serviceName, startsAt: a.startsAt, status: a.status })),
    proximoAtendimento: next ? { id: next.id, clientName: next.clientName, serviceName: next.serviceName, startsAt: next.startsAt } : null,
    horariosDisponiveisHoje: 4, totalClientes: clients.length,
    faturamentoEstimadoHojeCents: hoje.filter((a) => a.status !== 'cancelado').reduce((n, a) => n + priceOf(a), 0),
    mes: {
      base: financeiroLigado() ? 'recebimentos' : 'concluidos', despesasPagasCents: financeiroLigado() ? expenses.reduce((n, e) => n + e.amount_cents, 0) : null, aReceberCents: financeiroLigado() ? receivables().totais.saldoPendenteCents : null,
      faturamentoRealizadoCents: recebido, faturamentoPrevistoCents: month.filter((a) => ['confirmado', 'pendente'].includes(a.status)).reduce((n, a) => n + priceOf(a), 0),
      faturamentoPerdidoCents: month.filter((a) => a.status === 'nao_compareceu').reduce((n, a) => n + priceOf(a), 0),
      agendamentosTotal: month.length, agendamentosConcluidos: month.filter((a) => a.status === 'concluido').length,
      agendamentosNaoCompareceu: month.filter((a) => a.status === 'nao_compareceu').length, agendamentosCancelados: month.filter((a) => a.status === 'cancelado').length, novosClientes: 2,
    },
    mesAnterior: { faturamentoRealizadoCents: 41000 }, variacao: 12,
    topServicos: [{ serviceName: 'Manicure em gel', count: 4, totalCents: 36000 }, { serviceName: 'Manutenção de alongamento', count: 2, totalCents: 24000 }],
    faturamento6Meses: ['Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out'].map((mes, i) => ({ mes, totalCents: 30000 + i * 6000 })),
    gastos6Meses: ['Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out'].map((mes, i) => ({ mes, totalCents: 15000 + i * 2000 })),
  };
}

function clientRow(c: Client): Client {
  const done = appts.filter((a) => a.clientId === c.id && a.status === 'concluido').sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { ...c, totalAtendimentos: done.length, ultimoAtendimento: done[0]?.startsAt ?? null };
}

function clientHistory(id: string) {
  const c = clients.find((x) => x.id === id);
  if (!c) throw new ApiError('Cliente não encontrada.', 404);
  const mine = appts.filter((a) => a.clientId === id).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const done = mine.filter((a) => a.status === 'concluido');
  const total = done.reduce((n, a) => n + priceOf(a), 0);
  const first = done[done.length - 1]?.startsAt ?? null;
  const next = mine.filter((a) => ['pendente', 'confirmado'].includes(a.status) && new Date(a.startsAt) > new Date()).pop()?.startsAt ?? null;
  return {
    client: { ...c, contact_opt_out: optedOut.has(c.id) },
    metrics: {
      totalConcluidos: done.length, totalCancelados: mine.filter((a) => a.status === 'cancelado').length, totalFaltas: mine.filter((a) => a.status === 'nao_compareceu').length,
      valorTotalCents: total, ticketMedioCents: done.length ? Math.round(total / done.length) : 0, primeiroAtendimento: first, ultimoAtendimento: done[0]?.startsAt ?? null,
      proximoAtendimento: next, freqMediaDias: done.length > 1 ? 14 : null, inativaDias: done[0] ? Math.round((Date.now() - new Date(done[0].startsAt).getTime()) / DAY) : null,
      servicoFavorito: done[0]?.serviceName ?? null,
    },
    history: mine.map((a) => ({ id: a.id, starts_at: a.startsAt, ends_at: a.endsAt, status: a.status, service_id: a.serviceId, service_name: a.serviceName, price_cents_snapshot: priceOf(a), appointment_notes: a.notes, recurring_group_id: null })),
  };
}

function overlaps(startsAt: string, endsAt: string, ignoreId?: string) {
  return appts.some((a) => a.id !== ignoreId && !['cancelado'].includes(a.status) && startsAt < a.endsAt && endsAt > a.startsAt);
}

// Até 4 horários livres no mesmo dia (de 30 em 30 min, 08:00-19:00) mais próximos do pedido, como a API faz em alternatives.
function alternativesFor(startsAt: string, minutes: number, ignoreId?: string): string[] {
  const want = new Date(startsAt);
  const out: Array<{ iso: string; dist: number }> = [];
  for (let m = 8 * 60; m <= 19 * 60; m += 30) {
    const s0 = new Date(want); s0.setHours(Math.floor(m / 60), m % 60, 0, 0);
    const e0 = new Date(s0.getTime() + minutes * 60_000);
    if (!overlaps(s0.toISOString(), e0.toISOString(), ignoreId)) out.push({ iso: s0.toISOString(), dist: Math.abs(s0.getTime() - want.getTime()) });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, 4).map((x) => x.iso).sort();
}

function qparam(q: URLSearchParams, k: string) { return q.get(k) ?? undefined; }
const parse = (b: unknown) => (typeof b === 'string' && b ? JSON.parse(b) : (b ?? {})) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Simula o servidor com o módulo Financeiro desligado: localStorage.nf_mock_financeiro = 'off' (as rotas /financeiro/* respondem 404). */
function financeiroLigado(): boolean {
  try { return localStorage.getItem('nf_mock_financeiro') !== 'off'; } catch { return true; }
}

function route(method: string, path: string, body: Record<string, any>): unknown { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [p, qs = ''] = path.split('?');
  if (p.startsWith('/financeiro') && !financeiroLigado()) throw new ApiError('Recurso não disponível.', 404);
  // Revisão de estados: localStorage.nf_mock_fail = '/clients' faz essa rota (e as filhas) responder 500;
  // localStorage.nf_mock_empty = '1' devolve listas vazias (conta nova).
  const flag = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
  const failPrefix = flag('nf_mock_fail');
  if (failPrefix && p.startsWith(failPrefix)) throw new ApiError('Erro simulado para revisão da tela.', 500);
  if (flag('nf_mock_empty') === '1' && method === 'GET') {
    if (['/clients', '/appointments', '/services', '/expenses', '/availability/blocked'].includes(p)) return [];
    if (p === '/financeiro/despesas') return { today: ymd(new Date()), despesas: [], totais: Object.fromEntries(['a_revisar', 'pendente', 'vencida', 'paga'].map((k) => [k, { count: 0, amountCents: 0, paidCents: 0, remainingCents: 0 }])) };
    if (p === '/financeiro/a-receber') return { today: ymd(new Date()), graceDays: 7, totais: { atendimentos: 0, valorCents: 0, recebidoLiquidoCents: 0, recebidoCents: 0, estornadoCents: 0, saldoPendenteCents: 0, saldoVencidoCents: 0, emAberto: 0, vencidos: 0 }, itens: [] };
  }
  const q = new URLSearchParams(qs);
  let m: RegExpMatchArray | null;

  if (p === '/auth/login') return { token: 'mock', professional: { id: 'mock-prof', name: 'Profissional Demo', email: 'demo@exemplo.test', businessName: 'Studio Demo', slug: 'studio-demo' } };
  if (/^\/auth\/logout$/.test(p)) return {};
  if (p === '/auth/me') {
    if (method === 'PUT') {
      Object.assign(profile, body);
      if ('instagram' in body) profile.instagram = body.instagram ? String(body.instagram).trim().replace(/^@/, '').toLowerCase() || null : null;
      newAccount.phoneSaved = true;
    }
    return flag('nf_mock_onboarding') === 'new' && !newAccount.phoneSaved ? { ...profile, phone_whatsapp: '' } : profile;
  }
  if (p === '/auth/booking-settings') {
    Object.assign(profile, body);
    return profile;
  }
  if (p === '/whatsapp/status') return { connected: false, phone: null, profileName: null, instanceName: '' };
  if (p === '/health') return { ok: true };

  // ── área administrativa (só leitura, dados fictícios; ações de bloquear/editar/excluir não existem na simulação) ──
  if (p === '/admin/professionals' && method === 'GET') {
    return [
      { id: 'mock-prof', name: 'Profissional Demo', email: 'demo@exemplo.test', phone_whatsapp: '5511900000000', business_name: 'Studio Demo', wa_instance_name: null, created_at: at(-40, 9).toISOString(), is_admin: false, blocked_at: null },
      { id: 'mock-prof-2', name: 'Outra Profissional', email: 'outra@exemplo.test', phone_whatsapp: null, business_name: 'Studio Dois', wa_instance_name: 'demo-2', created_at: at(-10, 9).toISOString(), is_admin: false, blocked_at: at(-2, 9).toISOString() },
      { id: 'mock-admin', name: 'Admin Demo', email: 'admin@exemplo.test', phone_whatsapp: null, business_name: 'NailFlow', wa_instance_name: null, created_at: at(-90, 9).toISOString(), is_admin: true, blocked_at: null },
    ];
  }
  if (p === '/admin/audit-log') {
    const items = [{ id: 'au1', action: 'block', actorId: 'mock-admin', actorEmail: 'admin@exemplo.test', targetId: 'mock-prof-2', targetBusinessName: 'Studio Dois', createdAt: at(-2, 9).toISOString() }];
    return { items, page: 1, pageSize: 15, total: items.length, totalPages: 1, summary: { today: 0, last7Days: items.length } };
  }

  // ── página pública de reserva (dados fictícios; a reserva só entra na memória) ──
  if (/^\/public\/[^/]+\/gallery$/.test(p)) return { photos: photos.map((x) => ({ id: x.id, src: x.dataUrl })) };
  if ((m = p.match(/^\/public\/([^/]+)\/(info|services|availability|appointments)$/))) {
    if (m[2] === 'info') return { businessName: 'Studio Demo', bio: 'Nail designer fictícia para demonstração.', theme: 'vinho', photo: null, instagramUrl: profile.instagram ? `https://www.instagram.com/${String(profile.instagram)}/` : null };
    if (m[2] === 'services') return services.filter((s) => s.active && s.availableOnWhatsapp).map((s) => ({ id: s.id, name: s.name, priceCents: s.priceCents, durationMinutes: s.durationMinutes }));
    if (m[2] === 'availability') {
      const days = Array.from({ length: 6 }, (_, i) => {
        const d = at(i + 1, 0);
        return { date: ymd(d), slots: [[9, 0], [10, 30], [14, 0], [15, 30]].map(([h, mi]) => at(i + 1, h, mi).toISOString()) };
      });
      return { businessName: 'Studio Demo', whatsappLink: '', days };
    }
    const s = services.find((x) => x.id === body.serviceId);
    if (!s) throw new ApiError('Serviço inválido.', 400);
    return { id: nid('pub'), startsAt: body.startsAt, endsAt: body.startsAt, serviceName: s.name, status: 'pendente' };
  }

  // ── Central de Suporte (lado da profissional) ──
  if (p === '/support/bootstrap') return { enabled: true, fabHidden: false, unreadTickets: 0, unreadIds: [] };
  if (p === '/support/faq') {
    return {
      categories: [{ slug: 'agenda', title: 'Agenda', position: 1 }, { slug: 'financeiro', title: 'Financeiro', position: 2 }],
      articles: [
        { id: 'f1', categorySlug: 'agenda', title: 'Como remarcar um horário?', body: 'Abra o agendamento, altere data ou horário e confirme o resumo. A cliente não é avisada automaticamente.', position: 1, publishedAt: at(-5, 9).toISOString() },
        { id: 'f2', categorySlug: 'financeiro', title: 'Concluir é o mesmo que receber?', body: 'Não. Concluir encerra o atendimento; o recebimento (inclusive parcial) é lançado à parte no Financeiro.', position: 1, publishedAt: at(-5, 9).toISOString() },
      ],
    };
  }
  if (p === '/support/tickets') {
    if (method === 'POST') return { ticket: { id: nid('t'), ticketNumber: 1, category: body.category ?? 'agenda', subject: body.subject ?? '', status: 'aberta', unread: false, activitySeq: 1, profReadSeq: 1, createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), resolvedAt: null, canReopenUntil: null } };
    return { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 };
  }
  if (p === '/dashboard') return dashboard();
  if (p === '/onboarding/status' && flag('nf_mock_onboarding') === 'new') {
    const perfil = newAccount.phoneSaved; const servicos = newAccount.services > 0; const horarios = newAccount.horarios;
    return { perfil, servicos, horarios, whatsapp: false, link: true, clientes: false, concluidos: [perfil, servicos, horarios, false, true].filter(Boolean).length, total: 5 };
  }
  if (p === '/onboarding/status') return { perfil: true, servicos: true, horarios: true, whatsapp: false, link: true, clientes: true, concluidos: 5, total: 5 };
  if (p === '/whatsapp/instance') return { instanceName: null, configured: false };
  if (p === '/availability' && method !== 'GET') { newAccount.horarios = true; return {}; }
  if (p === '/availability') return [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, is_working: w !== 0, start_time: w === 0 ? null : '09:00', end_time: w === 0 ? null : '18:00', break_start: w === 0 ? null : '12:00', break_end: w === 0 ? null : '13:00' }));
  if (p === '/availability/blocked') return [];

  if (p === '/services') {
    if (flag('nf_mock_onboarding') === 'new' && method === 'GET') return services.filter((x) => x.id.startsWith('s-'));
    if (method === 'POST') { newAccount.services += 1; const s: Service = { id: nid('s'), description: null, active: true, availableOnWhatsapp: true, ...(body as Partial<Service>) } as Service; services.push(s); return s; }
    return services;
  }
  if ((m = p.match(/^\/services\/([^/]+)$/))) {
    const s = services.find((x) => x.id === m![1]);
    if (!s) throw new ApiError('Serviço não encontrado.', 404);
    if (method === 'PUT') Object.assign(s, body);
    return s;
  }

  if (p === '/clients/return-suggestions' && method === 'GET') {
    const inactive = Number(q.get('inactiveDays') ?? 45);
    if (!Number.isInteger(inactive) || inactive < 30 || inactive > 180) throw new ApiError('Informe de 30 a 180 dias.', 400);
    const items = clients.flatMap((c) => {
      if (optedOut.has(c.id) || (snoozedUntil.get(c.id) ?? 0) > Date.now()) return [];
      if (appts.some((a) => a.clientId === c.id && ['pendente', 'aguardando_pagamento', 'confirmado'].includes(a.status) && new Date(a.endsAt) > new Date())) return [];
      const last = appts.filter((a) => a.clientId === c.id && a.status === 'concluido').sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
      if (!last) return [];
      const days = Math.floor((Date.now() - new Date(last.startsAt).getTime()) / DAY);
      const svc = services.find((x) => x.id === last.serviceId);
      const interval = svc?.returnIntervalDays ?? 25;
      const reason = days >= inactive ? 'sem_agendar' : days >= interval ? 'manutencao' : null;
      return reason ? [{ clientId: c.id, name: c.name, phone: c.phone, lastServiceName: last.serviceName, lastServiceAt: last.startsAt, daysSince: days, reason, intervalDays: interval, intervalIsDefault: svc?.returnIntervalDays == null }] : [];
    });
    return { defaults: { maintenanceDays: 25, inactiveDays: 45 }, inactiveDays: inactive, items };
  }
  if ((m = p.match(/^\/clients\/([^/]+)\/contact-preferences$/)) && method === 'PUT') {
    if (!clients.some((c) => c.id === m![1])) throw new ApiError('Cliente não encontrada.', 404);
    if (typeof body.contactOptOut === 'boolean') { if (body.contactOptOut) optedOut.add(m[1]); else optedOut.delete(m[1]); }
    if ('snoozeDays' in body) { if (body.snoozeDays === null) snoozedUntil.delete(m[1]); else snoozedUntil.set(m[1], Date.now() + Number(body.snoozeDays) * DAY); }
    return { id: m[1], contactOptOut: optedOut.has(m[1]), returnSnoozedUntil: snoozedUntil.has(m[1]) ? new Date(snoozedUntil.get(m[1])!).toISOString() : null };
  }

  if (p === '/portfolio' && method === 'GET') return { available: true, max: 6, photos: photos.map((x) => ({ id: x.id, createdAt: new Date().toISOString(), previewSrc: x.dataUrl })) };
  if (p === '/portfolio' && method === 'POST') {
    if (photos.length >= 6) throw new ApiError('Você já tem 6 fotos. Remova uma para adicionar outra.', 409);
    const ph = { id: nid('ph'), dataUrl: String(body.dataUrl) };
    photos.push(ph);
    return { id: ph.id, createdAt: new Date().toISOString() };
  }
  if ((m = p.match(/^\/portfolio\/([^/]+)$/)) && method === 'DELETE') {
    const i = photos.findIndex((x) => x.id === m![1]);
    if (i < 0) throw new ApiError('Foto não encontrada.', 404);
    photos.splice(i, 1);
    return undefined;
  }

  if (p === '/clients/import' && method === 'POST') {
    const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
    const seen = new Set<string>();
    const results = (body.rows as Array<{ name?: string; phone?: string }>).map((r, index) => {
      const d = digits(r.phone);
      if (!String(r.name ?? '').trim()) return { index, status: 'invalid', reason: 'Nome em branco.' };
      if (d.length < 10 || d.length > 13) return { index, status: 'invalid', reason: 'Telefone inválido (use DDD + número).' };
      if (seen.has(d)) return { index, status: 'duplicate_file', reason: 'Mesmo telefone de outra linha.' };
      seen.add(d);
      const existing = clients.find((c) => digits(c.phone).endsWith(d.slice(-8)));
      if (existing) return { index, status: 'duplicate_existing', reason: `Já cadastrada como "${existing.name}".` };
      return { index, status: 'ok' };
    });
    const ok = results.filter((r) => r.status === 'ok');
    if (!body.dryRun) ok.forEach((r) => { const row = body.rows[r.index]; clients.push({ id: nid('c'), name: String(row.name).trim(), phone: digits(row.phone), notes: row.notes ?? null, tags: row.tags ?? [] } as Client); });
    const n = (s: string) => results.filter((r) => r.status === s).length;
    return { dryRun: !!body.dryRun, summary: { total: results.length, importable: ok.length, invalid: n('invalid'), duplicateInFile: n('duplicate_file'), duplicateExisting: n('duplicate_existing'), created: body.dryRun ? 0 : ok.length, skippedRace: 0 }, results };
  }

  if (p === '/clients') {
    if (method === 'POST') { const c: Client = { id: nid('c'), notes: null, tags: [], ...(body as Partial<Client>) } as Client; clients.push(c); return c; }
    return clients.map(clientRow);
  }
  if ((m = p.match(/^\/clients\/([^/]+)$/))) {
    if (method === 'PUT') { const c = clients.find((x) => x.id === m![1]); if (c) Object.assign(c, body); return c; }
    return clientHistory(m[1]);
  }

  if (p === '/appointments') {
    if (method === 'POST') {
      const s = services.find((x) => x.id === body.serviceId);
      const c = clients.find((x) => x.id === body.clientId);
      if (!s || !c) throw new ApiError('Cliente ou serviço inválido.', 400);
      const start = new Date(body.startsAt);
      const end = new Date(start.getTime() + s.durationMinutes * 60_000);
      if (overlaps(start.toISOString(), end.toISOString())) throw new ApiError('Esse horário já está ocupado.', 409, 'appointment_overlap', alternativesFor(start.toISOString(), s.durationMinutes));
      return addAppt(c.id, s.id, start, 'pendente');
    }
    const from = qparam(q, 'from'); const to = qparam(q, 'to');
    return appts.filter((a) => (!from || a.endsAt >= from) && (!to || a.startsAt < to));
  }
  if ((m = p.match(/^\/appointments\/([^/]+)(?:\/(confirm|reject|mark-paid|check-in))?$/))) {
    const a = appts.find((x) => x.id === m![1]);
    if (!a) throw new ApiError('Agendamento não encontrado.', 404);
    if (m[2] === 'confirm') a.status = 'confirmado';
    else if (m[2] === 'reject') a.status = 'cancelado';
    else if (m[2] === 'mark-paid') a.paidAt = new Date().toISOString();
    else if (m[2] === 'check-in') {
      if (a.status !== 'confirmado') throw new ApiError('Só é possível registrar a chegada de um agendamento confirmado.', 409);
      a.checkedInAt ??= new Date().toISOString();
    }
    else if (method === 'DELETE') a.status = 'cancelado';
    else if (method === 'PUT') {
      if (body.startsAt && overlaps(body.startsAt, new Date(new Date(body.startsAt).getTime() + (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime())).toISOString(), a.id)) {
        throw new ApiError('Esse horário já está ocupado.', 409, 'appointment_overlap', alternativesFor(body.startsAt, Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000), a.id));
      }
      Object.assign(a, body);
    }
    return a;
  }

  if (p === '/expenses/summary') {
    const gastos = expenses.reduce((n, e) => n + e.amount_cents, 0);
    const fat = payments.filter((x) => x.kind === 'recebimento').reduce((n, x) => n + x.amountCents, 0);
    return { base: 'recebimentos', gastosCents: gastos, faturadoCents: fat, resultadoCents: fat - gastos, categorias: expenses.map((e) => ({ category: e.category, totalCents: e.amount_cents, count: 1 })) };
  }
  if (p === '/expenses') {
    if (method === 'POST') { const e = { id: nid('e'), professional_id: 'mock', notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body } as (typeof expenses)[number]; expenses.push(e); return e; }
    return expenses;
  }

  // ── Financeiro ──
  if (p === '/financeiro/caixa') return { fechamentos: [] };
  if ((m = p.match(/^\/financeiro\/caixa\/(\d{4}-\d{2}-\d{2})$/))) {
    const rec = payments.filter((x) => x.occurredOn === m![1] && x.kind === 'recebimento').reduce((n, x) => n + x.amountCents, 0);
    return { date: m[1], fechamento: null, versoes: [], esperado: { metodos: [], totais: { receivedCents: rec, refundedCents: 0, expensesPaidCents: 0, expectedCents: rec } } };
  }
  if (p === '/financeiro/a-receber') return receivables();
  if (p === '/financeiro/alertas') {
    const r = receivables().totais;
    const alertas = r.vencidos ? [{ type: 'a_receber_vencido', severity: 'media', title: 'Atendimentos concluídos sem recebimento há mais de 7 dias', count: r.vencidos, amountCents: r.saldoVencidoCents, path: '/financeiro/a-receber' }] : [];
    return { hoje: ymd(new Date()), total: alertas.length, alertas };
  }
  if (p === '/financeiro/movimentacoes') {
    const itens = payments.map((x) => {
      const a = appts.find((y) => y.id === x.appointmentId)!;
      return { id: x.id, tipo: x.kind, date: x.occurredOn, method: x.method, methodInformed: true, amountCents: x.amountCents, label: `${a.clientName} · ${a.serviceName}`, notes: null, createdAt: x.createdAt, appointmentId: a.id, appointmentStartsAt: a.startsAt, expenseId: null, reversesPaymentId: null, historicoPath: `/financeiro/pagamentos/${x.id}/historico` };
    });
    const rec = payments.reduce((n, x) => n + (x.kind === 'recebimento' ? x.amountCents : 0), 0);
    return { from: qparam(q, 'from') ?? ymd(new Date()), to: qparam(q, 'to') ?? ymd(new Date()), truncated: false, totais: { quantidade: itens.length, recebidoCents: rec, estornadoCents: 0, despesasPagasCents: 0, saldoCents: rec }, itens };
  }
  if (p === '/financeiro/despesas') {
    const list = expenses.map((e) => ({ id: e.id, description: e.description, category: e.category, amountCents: e.amount_cents, expenseDate: e.expense_date, dueOn: null, paidOn: e.expense_date, paidMethod: 'pix', notes: null, createdAt: e.created_at, status: 'paga', state: 'paga', paidCents: e.amount_cents, remainingCents: 0, legacyPaid: false, overdue: false, paymentsCount: 1 }));
    const zero = { count: 0, amountCents: 0, paidCents: 0, remainingCents: 0 };
    return { today: ymd(new Date()), despesas: list, totais: { a_revisar: zero, pendente: zero, vencida: zero, paga: { count: list.length, amountCents: list.reduce((n, e) => n + e.amountCents, 0), paidCents: list.reduce((n, e) => n + e.amountCents, 0), remainingCents: 0 } } };
  }
  if ((m = p.match(/^\/financeiro\/atendimentos\/([^/]+)\/pagamentos$/))) {
    const a = appts.find((x) => x.id === m![1]);
    if (!a) throw new ApiError('Atendimento não encontrado.', 404);
    if (method === 'POST') {
      const f = financeOf(a);
      if (!f.canReceive) throw new ApiError('Só é possível receber atendimentos concluídos.', 422);
      if (body.amountCents > f.balanceCents) throw new ApiError('O valor excede o saldo do atendimento.', 422);
      pay(a, body.amountCents, body.method ?? 'pix');
      return { replayed: false, resumo: financeOf(a) };
    }
    return financeOf(a);
  }

  throw new ApiError('Recurso não disponível nos dados simulados.', 404);
}

export async function mockRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  await new Promise((r) => setTimeout(r, 60));
  const result = route((options.method ?? 'GET').toUpperCase(), path, parse(options.body));
  return (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as T;
}

// usado nos testes
export const __mockInternals = { netPaid };
