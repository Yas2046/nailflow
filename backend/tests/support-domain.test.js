// Testes do domínio puro da Central de Suporte (sem banco, sem rede, sem Express).
// Cobrem: máquina de estados, prioridade, validação/normalização, hash de idempotência e "não lida".
// Também conferem as constantes do domínio contra os CHECKs da migration 023 (lendo o arquivo SQL),
// para o código não divergir do banco em silêncio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATUSES, OPEN_STATUSES, PRIORITIES, CATEGORIES, REOPEN_WINDOW_MS, MAX_OPEN_TICKETS,
  canOpenTicket, planReply, planStatusChange, planProfessionalReopen,
  reopenDeadline, isWithinReopenWindow,
} from '../src/utils/supportStateMachine.js';
import {
  suggestPriority, resolveAutoPriority, planPriorityChange, normalizeForMatch,
} from '../src/utils/supportPriority.js';
import {
  SUBJECT_MIN, SUBJECT_MAX, BODY_MAX, charLength, cleanBody, cleanSubject,
  createTicketSchema, sendMessageSchema, reopenSchema, readSchema, preferencesSchema,
  adminStatusSchema, adminPrioritySchema, parseSupportInput, ticketRequestHash, messageRequestHash,
} from '../src/utils/supportValidation.js';
import { activityNotifies, isUnread, countUnread, nextReadSeq } from '../src/utils/supportUnread.js';

const SQL_023 = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations/023_support_center.sql'),
  'utf8'
);
const UUID = '3f2b8c1e-5d4a-4b7e-9c10-2a6f8d9e0b11';
const UUID2 = '9a1c7e52-0b3d-4f68-8e21-7d5c4b3a2f10';
const DAY = 24 * 60 * 60 * 1000;

// ── Máquina de estados ──────────────────────────────────────────────────────

test('resposta: efeito sobre o status por papel e estado (tabela completa)', () => {
  const cases = [
    // [ator, status atual, status depois (null = inalterado), evento esperado]
    ['admin', 'aberta', 'aguardando_profissional'],
    ['admin', 'em_atendimento', 'aguardando_profissional'],
    ['admin', 'aguardando_profissional', null],
    ['professional', 'aberta', null],
    ['professional', 'em_atendimento', null],
    ['professional', 'aguardando_profissional', 'em_atendimento'],
  ];
  for (const [actor, status, to] of cases) {
    const plan = planReply({ actor, status });
    assert.equal(plan.ok, true, `${actor} em ${status}`);
    assert.equal(plan.to, to, `${actor} em ${status}`);
    assert.deepEqual(
      plan.event,
      to ? { type: 'status_changed', from: status, to, actorRole: actor } : null,
      `${actor} em ${status}`
    );
    assert.equal(plan.clearsResolved, false);
    assert.equal(plan.setsResolved, false);
    assert.equal(plan.reopenCountDelta, 0);
  }
});

test('resposta em solicitação resolvida é recusada para os dois lados (409 ticket_resolved)', () => {
  for (const actor of ['professional', 'admin']) {
    assert.deepEqual(planReply({ actor, status: 'resolvida' }), { ok: false, status: 409, reason: 'ticket_resolved' });
  }
});

test('resposta: papel ou status desconhecido é recusado, nunca assumido', () => {
  assert.deepEqual(planReply({ actor: 'system', status: 'aberta' }), { ok: false, status: 403, reason: 'forbidden' });
  assert.deepEqual(planReply({ actor: undefined, status: 'aberta' }), { ok: false, status: 403, reason: 'forbidden' });
  assert.deepEqual(planReply({ actor: 'admin', status: 'fechada' }), { ok: false, status: 409, reason: 'invalid_status' });
});

test('status manual da ADM: tabela exaustiva de transições (4 x 4)', () => {
  // Chave "de>para". noop = mesmo status; reopened = saída de resolvida; demais = status_changed.
  const expected = {
    'aberta>aberta': 'noop', 'aberta>em_atendimento': 'status_changed', 'aberta>aguardando_profissional': 'status_changed', 'aberta>resolvida': 'resolve',
    'em_atendimento>aberta': 'status_changed', 'em_atendimento>em_atendimento': 'noop', 'em_atendimento>aguardando_profissional': 'status_changed', 'em_atendimento>resolvida': 'resolve',
    'aguardando_profissional>aberta': 'status_changed', 'aguardando_profissional>em_atendimento': 'status_changed', 'aguardando_profissional>aguardando_profissional': 'noop', 'aguardando_profissional>resolvida': 'resolve',
    'resolvida>aberta': 'reopened', 'resolvida>em_atendimento': 'reopened', 'resolvida>aguardando_profissional': 'invalid', 'resolvida>resolvida': 'noop',
  };
  assert.equal(Object.keys(expected).length, 16);
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const want = expected[`${from}>${to}`];
      const plan = planStatusChange({ actor: 'admin', from, to });
      const label = `${from} -> ${to}`;
      if (want === 'noop') {
        assert.deepEqual(plan, { ok: true, noop: true }, label);
      } else if (want === 'invalid') {
        assert.deepEqual(plan, { ok: false, status: 409, reason: 'invalid_transition' }, label);
      } else if (want === 'reopened') {
        assert.equal(plan.ok, true, label);
        assert.deepEqual(plan.event, { type: 'reopened', from, to, actorRole: 'admin' }, label);
        assert.equal(plan.clearsResolved, true, label);
        assert.equal(plan.setsResolved, false, label);
        assert.equal(plan.reopenCountDelta, 0, `${label}: reopen_count só conta a profissional`);
      } else {
        assert.equal(plan.ok, true, label);
        assert.equal(plan.to, to, label);
        assert.deepEqual(plan.event, { type: 'status_changed', from, to, actorRole: 'admin' }, label);
        assert.equal(plan.setsResolved, want === 'resolve', label);
        assert.equal(plan.clearsResolved, false, label);
        assert.equal(plan.reopenCountDelta, 0, label);
      }
    }
  }
});

test('status manual: a profissional nunca muda status (403), qualquer que seja o par', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      assert.deepEqual(planStatusChange({ actor: 'professional', from, to }), { ok: false, status: 403, reason: 'forbidden' }, `${from} -> ${to}`);
    }
  }
});

test('status manual: expectedStatus (idempotência e corrida)', () => {
  // Já está no estado pedido: 200 sem evento, mesmo que o cliente esperasse outro estado.
  assert.deepEqual(planStatusChange({ actor: 'admin', from: 'resolvida', to: 'resolvida', expectedStatus: 'aberta' }), { ok: true, noop: true });
  // Outro ator mudou antes: 409 stale_status.
  assert.deepEqual(
    planStatusChange({ actor: 'admin', from: 'aguardando_profissional', to: 'resolvida', expectedStatus: 'em_atendimento' }),
    { ok: false, status: 409, reason: 'stale_status' }
  );
  // Esperado == atual: segue as regras normais; ausente/nulo também.
  for (const expectedStatus of ['em_atendimento', undefined, null]) {
    assert.equal(planStatusChange({ actor: 'admin', from: 'em_atendimento', to: 'resolvida', expectedStatus }).ok, true);
  }
  // stale_status vem antes de invalid_transition (o estado visto pelo cliente já não vale).
  assert.equal(planStatusChange({ actor: 'admin', from: 'resolvida', to: 'aguardando_profissional', expectedStatus: 'aberta' }).reason, 'stale_status');
});

test('status manual: valores desconhecidos são recusados', () => {
  assert.equal(planStatusChange({ actor: 'admin', from: 'aberta', to: 'fechada' }).reason, 'invalid_transition');
  assert.equal(planStatusChange({ actor: 'admin', from: 'fechada', to: 'aberta' }).reason, 'invalid_status');
  assert.equal(planStatusChange({ actor: 'system', from: 'aberta', to: 'resolvida' }).reason, 'forbidden');
  assert.equal(planStatusChange().ok, false);
});

test('reabertura pela profissional: janela de 7 x 24 h (limites exatos, relógio injetado)', () => {
  const resolvedAt = new Date('2026-10-01T12:00:00.000Z');
  const at = (ms) => new Date(resolvedAt.getTime() + ms);
  const attempt = (now) => planProfessionalReopen({ actor: 'professional', status: 'resolvida', resolvedAt, now });

  const ok = attempt(at(6 * DAY + 23 * 3600e3 + 59 * 60e3)); // 6 d 23 h 59 min
  assert.equal(ok.ok, true);
  assert.equal(ok.to, 'aberta');
  assert.deepEqual(ok.event, { type: 'reopened', from: 'resolvida', to: 'aberta', actorRole: 'professional' });
  assert.equal(ok.clearsResolved, true);
  assert.equal(ok.reopenCountDelta, 1);
  assert.equal(attempt(at(7 * DAY - 1)).ok, true);                                  // 1 ms antes
  assert.deepEqual(attempt(at(7 * DAY)), { ok: false, status: 409, reason: 'reopen_window_expired' }); // exatamente 7 d
  assert.equal(attempt(at(7 * DAY + 1000)).reason, 'reopen_window_expired');        // 7 d + 1 s
  assert.equal(attempt(at(30 * DAY)).reason, 'reopen_window_expired');
});

test('reabertura pela profissional: só dela, só de resolvida, e datas inválidas expiram', () => {
  const resolvedAt = '2026-10-01T12:00:00Z';
  const now = '2026-10-02T12:00:00Z';
  assert.deepEqual(planProfessionalReopen({ actor: 'admin', status: 'resolvida', resolvedAt, now }), { ok: false, status: 403, reason: 'forbidden' });
  for (const status of OPEN_STATUSES) {
    assert.deepEqual(planProfessionalReopen({ actor: 'professional', status, resolvedAt, now }), { ok: false, status: 409, reason: 'not_resolved' }, status);
  }
  // Sem resolved_at confiável não há janela: recusa em vez de reabrir.
  for (const bad of [null, undefined, 'não é data']) {
    assert.equal(planProfessionalReopen({ actor: 'professional', status: 'resolvida', resolvedAt: bad, now }).reason, 'reopen_window_expired');
  }
  // Datas como string ISO funcionam como Date.
  assert.equal(planProfessionalReopen({ actor: 'professional', status: 'resolvida', resolvedAt, now }).ok, true);
});

test('re-resolução reinicia a janela e a ADM reabre depois de 30 dias', () => {
  const firstResolved = new Date('2026-09-01T00:00:00Z');
  const reResolved = new Date('2026-10-05T00:00:00Z');
  const now = new Date('2026-10-08T00:00:00Z'); // 37 d da primeira resolução, 3 d da segunda
  assert.equal(isWithinReopenWindow(firstResolved, now), false);
  assert.equal(isWithinReopenWindow(reResolved, now), true);
  assert.equal(reopenDeadline(reResolved).toISOString(), '2026-10-12T00:00:00.000Z');
  assert.equal(reopenDeadline(null), null);
  // A ADM não depende da janela: resolvida há 37 dias reabre normalmente.
  assert.equal(planStatusChange({ actor: 'admin', from: 'resolvida', to: 'em_atendimento' }).ok, true);
  assert.equal(REOPEN_WINDOW_MS, 7 * DAY);
});

test('limite de solicitações abertas (D5)', () => {
  assert.equal(MAX_OPEN_TICKETS, 10);
  for (const n of [0, 1, 9]) assert.equal(canOpenTicket(n), true, String(n));
  for (const n of [10, 11, 100, -1, 1.5, NaN, '3', null, undefined]) assert.equal(canOpenTicket(n), false, String(n));
});

// ── Prioridade ──────────────────────────────────────────────────────────────

test('prioridade sugerida: tabela de frases (alta, média, baixa)', () => {
  const cases = [
    // [categoria, assunto, corpo, esperado]
    ['tecnico', 'Não consigo entrar no sistema', 'Aparece senha inválida', 'alta'],
    ['tecnico', 'Dados sumiram', 'Perdi meus clientes!', 'alta'],
    ['tecnico', 'Página NÃO ABRE', '', 'alta'],
    ['tecnico', 'Sistema fora do ar!', '', 'alta'],
    ['tecnico', 'Cobrança duplicada', '', 'alta'],
    ['tecnico', 'Apagou o agendamento', '', 'alta'],
    ['agenda', 'URGENTE', 'preciso falar com alguém', 'alta'],            // "urgente" vale em qualquer categoria
    ['financeiro', 'Isso é urgente', '', 'alta'],
    ['tecnico', 'Dúvida sobre o tema', 'como mudar a cor', 'media'],        // tecnico sem termos de alta
    ['perfil_acesso', 'Trocar foto do perfil', '', 'media'],
    ['perfil_acesso', 'Meu e-mail', 'quero alterar', 'media'],
    ['agenda', 'Dá erro ao salvar', '', 'media'],
    ['clientes', 'Cadastro não funciona', '', 'media'],
    ['servicos_config', 'Falha ao editar', 'o serviço some', 'media'],
    ['agenda', 'Como bloquear um horário', '', 'baixa'],
    ['clientes', 'Importar contatos', 'tenho uma planilha', 'baixa'],
    ['financeiro', 'Como lançar um gasto', '', 'baixa'],
    // Regra da spec §5: termos de alta só escalam na categoria "tecnico" (lista inicial, ver decisão D15/P8).
    ['agenda', 'Perdi um horário', '', 'baixa'],
    ['financeiro', 'Cobrança', 'dúvida', 'baixa'],
  ];
  for (const [category, subject, body, expected] of cases) {
    assert.equal(suggestPriority({ category, subject, body }), expected, `${category} | ${subject} | ${body}`);
  }
});

test('prioridade sugerida: termos casam como palavra inteira, ignorando acento, caixa e pontuação', () => {
  assert.equal(suggestPriority({ category: 'tecnico', subject: 'conta perdida', body: '' }), 'media');       // "perdida" não é "perdi"
  assert.equal(suggestPriority({ category: 'agenda', subject: 'terror', body: 'errou' }), 'baixa');           // "erro" não casa "terror"/"errou"
  assert.equal(suggestPriority({ category: 'tecnico', subject: 'Não   consigo\nentrar', body: '' }), 'alta'); // espaços e quebra de linha
  assert.equal(suggestPriority({ category: 'tecnico', subject: 'nao-consigo, entrar...', body: '' }), 'alta');
  assert.equal(suggestPriority({ category: 'agenda', subject: 'ERRO!!', body: '' }), 'media');
  assert.equal(suggestPriority({ category: 'categoria-inexistente', subject: 'urgente', body: '' }), 'alta');
  assert.equal(suggestPriority({ category: 'categoria-inexistente', subject: 'oi', body: '' }), 'baixa');
  assert.equal(suggestPriority(), 'baixa');
  assert.equal(suggestPriority({ category: 'tecnico' }), 'media');
  assert.equal(normalizeForMatch('  Ação — Não Abre! '), ' acao nao abre ');
  assert.equal(normalizeForMatch(null), '  ');
});

test('prioridade: a regra automática nunca sobrescreve o ajuste manual', () => {
  assert.equal(resolveAutoPriority({ source: 'manual', current: 'baixa', suggested: 'alta' }), 'baixa');
  assert.equal(resolveAutoPriority({ source: 'auto', current: 'baixa', suggested: 'alta' }), 'alta');
  assert.equal(resolveAutoPriority({ source: 'auto', current: 'media', suggested: 'inexistente' }), 'media');
});

test('ajuste manual de prioridade: só ADM, valida, idempotente e gera evento só quando muda', () => {
  assert.deepEqual(planPriorityChange({ actor: 'professional', current: 'media', source: 'auto', to: 'alta' }), { ok: false, status: 403, reason: 'forbidden' });
  assert.deepEqual(planPriorityChange({ actor: 'admin', current: 'media', source: 'auto', to: 'urgentissima' }), { ok: false, status: 400, reason: 'invalid_priority' });
  assert.deepEqual(planPriorityChange({ actor: 'admin', current: 'media', source: 'manual', to: 'media' }), { ok: true, noop: true });
  // Mesma prioridade, ainda automática: passa a manual (a regra automática deixa de mexer), sem evento.
  assert.deepEqual(planPriorityChange({ actor: 'admin', current: 'media', source: 'auto', to: 'media' }), { ok: true, to: 'media', source: 'manual', event: null });
  for (const from of PRIORITIES) {
    for (const to of PRIORITIES.filter((p) => p !== from)) {
      assert.deepEqual(
        planPriorityChange({ actor: 'admin', current: from, source: 'auto', to }),
        { ok: true, to, source: 'manual', event: { type: 'priority_changed', from, to, actorRole: 'admin' } },
        `${from} -> ${to}`
      );
    }
  }
});

// ── Validação e normalização ────────────────────────────────────────────────

const validTicket = (over = {}) => ({ subject: 'Preciso de ajuda', category: 'agenda', body: 'Não consigo bloquear um horário.', clientRequestId: UUID, ...over });
const errorsOf = (schema, input) => {
  const r = parseSupportInput(schema, input);
  assert.equal(r.ok, false, JSON.stringify(input).slice(0, 80));
  return r.errors;
};

test('criação: aceita o caso válido e normaliza o texto', () => {
  const r = parseSupportInput(createTicketSchema, validTicket({ subject: '  Preciso\n  de ajuda  ', body: '  linha 1\r\nlinha 2\u0000 \t', relatedTicketNumber: 142 }));
  assert.equal(r.ok, true);
  assert.equal(r.data.subject, 'Preciso de ajuda');
  assert.equal(r.data.body, 'linha 1\nlinha 2');
  assert.equal(r.data.relatedTicketNumber, 142);
});

test('assunto: limites 3 e 120 contados em caracteres, não em unidades UTF-16', () => {
  const subject = (s) => parseSupportInput(createTicketSchema, validTicket({ subject: s }));
  assert.equal(subject('ab').ok, false);
  assert.equal(subject('abc').ok, true);
  assert.equal(subject('a'.repeat(SUBJECT_MAX)).ok, true);
  assert.equal(subject('a'.repeat(SUBJECT_MAX + 1)).ok, false);
  assert.equal(subject('😀'.repeat(SUBJECT_MAX)).ok, true);      // 120 caracteres (240 unidades UTF-16)
  assert.equal(subject('😀'.repeat(SUBJECT_MAX + 1)).ok, false);
  assert.equal(subject('   \n\t  ').ok, false);
  assert.equal(subject('  a  b  ').ok, true);                    // "a b" tem 3 caracteres
  assert.equal(SUBJECT_MIN, 3);
});

test('mensagem: limites 1 e 5000, em branco e caracteres de controle', () => {
  const body = (s) => parseSupportInput(sendMessageSchema, { body: s, clientMessageId: UUID });
  assert.equal(body('x').ok, true);
  assert.equal(body('x'.repeat(BODY_MAX)).ok, true);
  assert.equal(body('x'.repeat(BODY_MAX + 1)).ok, false);
  assert.equal(body('😀'.repeat(BODY_MAX)).ok, true);
  assert.equal(body('😀'.repeat(BODY_MAX + 1)).ok, false);
  for (const blank of ['', '   ', '\n\n\t', '\u0000\u0007\u001f', '   ']) assert.equal(body(blank).ok, false, JSON.stringify(blank));
  assert.equal(body('a\u0000b').data.body, 'ab');
  assert.equal(body('a\tb\nc').data.body, 'a\tb\nc');            // tab e quebra de linha são mantidos
  assert.equal(body('a\r\nb\rc').data.body, 'a\nb\nc');
  assert.equal(charLength('😀a'), 2);
  assert.equal(cleanBody('  x \u007f '), 'x');
  assert.equal(cleanSubject(' a\n\tb '), 'a b');
});

test('criação: schema estrito e campos obrigatórios', () => {
  // professionalId (ou qualquer campo extra) nunca é aceito do corpo: a titular vem da sessão.
  assert.ok(errorsOf(createTicketSchema, validTicket({ professionalId: UUID2 })).length > 0);
  assert.ok(errorsOf(createTicketSchema, validTicket({ status: 'resolvida' })).length > 0);
  for (const field of ['subject', 'category', 'body', 'clientRequestId']) {
    const input = validTicket();
    delete input[field];
    assert.ok(errorsOf(createTicketSchema, input).some((e) => e.field === field), field);
  }
  assert.ok(errorsOf(createTicketSchema, validTicket({ category: 'outra' })).some((e) => e.field === 'category'));
  assert.ok(errorsOf(createTicketSchema, validTicket({ clientRequestId: 'abc' })).some((e) => e.field === 'clientRequestId'));
  assert.ok(errorsOf(createTicketSchema, validTicket({ body: 123 })).some((e) => e.field === 'body'));
  for (const bad of [0, -1, 1.5, '12', Number.MAX_SAFE_INTEGER + 1]) {
    assert.ok(errorsOf(createTicketSchema, validTicket({ relatedTicketNumber: bad })).some((e) => e.field === 'relatedTicketNumber'), String(bad));
  }
  for (const c of CATEGORIES) assert.equal(parseSupportInput(createTicketSchema, validTicket({ category: c })).ok, true, c);
  for (const bad of [null, undefined, 'texto', [], 7]) assert.equal(parseSupportInput(createTicketSchema, bad).ok, false);
});

test('demais payloads: mensagem, reabertura, leitura, preferência e ADM', () => {
  assert.ok(errorsOf(sendMessageSchema, { body: 'oi' }).some((e) => e.field === 'clientMessageId'));
  assert.ok(errorsOf(sendMessageSchema, { body: 'oi', clientMessageId: UUID, ticketId: UUID2 }).length > 0);
  assert.equal(parseSupportInput(reopenSchema, { body: 'voltou a falhar' }).ok, true);
  assert.equal(parseSupportInput(reopenSchema, { body: '  ' }).ok, false);
  assert.equal(parseSupportInput(reopenSchema, {}).ok, false);

  for (const ok of [0, 1, 99, Number.MAX_SAFE_INTEGER]) assert.equal(parseSupportInput(readSchema, { upToSeq: ok }).ok, true, String(ok));
  for (const bad of [-1, 1.5, '3', null, undefined, Number.MAX_SAFE_INTEGER + 1]) assert.equal(parseSupportInput(readSchema, { upToSeq: bad }).ok, false, String(bad));
  assert.equal(parseSupportInput(readSchema, { upToSeq: 1, extra: 1 }).ok, false);

  assert.equal(parseSupportInput(preferencesSchema, { fabHidden: true }).ok, true);
  assert.equal(parseSupportInput(preferencesSchema, { fabHidden: false }).ok, true);
  for (const bad of ['true', 1, null, {}]) assert.equal(parseSupportInput(preferencesSchema, { fabHidden: bad }).ok, false, String(bad));

  assert.equal(parseSupportInput(adminStatusSchema, { status: 'resolvida' }).ok, true);
  assert.equal(parseSupportInput(adminStatusSchema, { status: 'resolvida', expectedStatus: 'aberta' }).ok, true);
  assert.equal(parseSupportInput(adminStatusSchema, { status: 'fechada' }).ok, false);
  assert.equal(parseSupportInput(adminStatusSchema, { status: 'aberta', expectedStatus: 'fechada' }).ok, false);
  assert.equal(parseSupportInput(adminPrioritySchema, { priority: 'alta' }).ok, true);
  assert.equal(parseSupportInput(adminPrioritySchema, { priority: 'critica' }).ok, false);
});

test('erros de validação não devolvem o texto digitado', () => {
  const secret = 'SEGREDO-' + 'x'.repeat(BODY_MAX);
  const errors = errorsOf(sendMessageSchema, { body: secret, clientMessageId: UUID });
  assert.ok(errors.length > 0);
  assert.ok(!JSON.stringify(errors).includes('SEGREDO'));
  const bad = errorsOf(createTicketSchema, validTicket({ category: 'SEGREDO' }));
  assert.ok(!JSON.stringify(bad).includes('SEGREDO'));
});

test('request_hash: 64 hex minúsculos, determinístico e sensível ao conteúdo', () => {
  const base = { subject: 'Preciso de ajuda', category: 'agenda', body: 'texto' };
  const h = ticketRequestHash(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(ticketRequestHash({ ...base }), h);
  assert.equal(ticketRequestHash({ ...base, relatedTicketNumber: undefined }), h);
  assert.equal(ticketRequestHash({ ...base, relatedTicketNumber: null }), h);
  assert.notEqual(ticketRequestHash({ ...base, relatedTicketNumber: 1 }), h);
  assert.notEqual(ticketRequestHash({ ...base, body: 'texto2' }), h);
  assert.notEqual(ticketRequestHash({ ...base, subject: 'Outro assunto' }), h);
  assert.notEqual(ticketRequestHash({ ...base, category: 'clientes' }), h);
  // Fronteira entre campos não se confunde ("a"+"bc" x "ab"+"c").
  assert.notEqual(ticketRequestHash({ subject: 'ab', category: 'c', body: 'd' }), ticketRequestHash({ subject: 'a', category: 'bc', body: 'd' }));

  const m = messageRequestHash({ body: 'oi' });
  assert.match(m, /^[0-9a-f]{64}$/);
  assert.equal(messageRequestHash({ body: 'oi' }), m);
  assert.notEqual(messageRequestHash({ body: 'oi!' }), m);
  // Mesmo texto como mensagem e como criação não colide.
  assert.notEqual(messageRequestHash({ body: 'texto' }), ticketRequestHash(base));
  // Repetição com o mesmo conteúdo normalizado dá o mesmo hash (CRLF x LF).
  const a = parseSupportInput(sendMessageSchema, { body: 'a\r\nb', clientMessageId: UUID }).data;
  const b = parseSupportInput(sendMessageSchema, { body: ' a\nb ', clientMessageId: UUID2 }).data;
  assert.equal(messageRequestHash(a), messageRequestHash(b));
});

// ── Não lida ────────────────────────────────────────────────────────────────

test('não lida: regras por lado e espelho', () => {
  const t = (lastActor, lastSeq, profReadSeq, adminReadSeq) => ({ lastActor, lastSeq, profReadSeq, adminReadSeq });
  // Profissional: só se a última atividade que notifica foi da ADM e está além do cursor dela.
  assert.equal(isUnread('professional', t('admin', 5, 4, 0)), true);
  assert.equal(isUnread('professional', t('admin', 5, 5, 0)), false);
  assert.equal(isUnread('professional', t('admin', 5, 9, 0)), false);
  assert.equal(isUnread('professional', t('professional', 5, 0, 0)), false);   // a própria atividade não é novidade
  // ADM: espelho.
  assert.equal(isUnread('admin', t('professional', 5, 0, 4)), true);
  assert.equal(isUnread('admin', t('professional', 5, 0, 5)), false);
  assert.equal(isUnread('admin', t('admin', 5, 0, 0)), false);
  // Ticket recém-criado: last_seq 0 nunca é não lido.
  assert.equal(isUnread('admin', t('professional', 0, 0, 0)), false);
  assert.equal(isUnread('outro', t('admin', 5, 0, 0)), false);
  assert.equal(countUnread('professional', [t('admin', 2, 0, 0), t('admin', 2, 2, 0), t('professional', 3, 0, 0), t('admin', 7, 6, 0)]), 2);
  assert.equal(countUnread('admin', []), 0);
});

test('o que notifica: mensagens sempre; eventos só se não forem de prioridade nem do sistema', () => {
  assert.equal(activityNotifies({ kind: 'message', actorRole: 'admin' }), true);
  assert.equal(activityNotifies({ kind: 'message', actorRole: 'professional' }), true);
  for (const type of ['status_changed', 'reopened', 'created']) {
    assert.equal(activityNotifies({ kind: 'event', type, actorRole: 'admin' }), true, type);
  }
  assert.equal(activityNotifies({ kind: 'event', type: 'priority_changed', actorRole: 'admin' }), false);
  assert.equal(activityNotifies({ kind: 'event', type: 'status_changed', actorRole: 'system' }), false);
  assert.equal(activityNotifies({ kind: 'outro' }), false);
});

test('cursor de leitura: só cresce, é idempotente e não passa do que existe', () => {
  assert.equal(nextReadSeq({ current: 0, upToSeq: 4, activitySeq: 6 }), 4);
  assert.equal(nextReadSeq({ current: 4, upToSeq: 2, activitySeq: 6 }), 4);      // upToSeq menor não retrocede
  assert.equal(nextReadSeq({ current: 4, upToSeq: 4, activitySeq: 6 }), 4);      // repetir dá o mesmo
  assert.equal(nextReadSeq({ current: 4, upToSeq: 99, activitySeq: 6 }), 6);     // limitado ao activity_seq
  assert.equal(nextReadSeq({ current: 6, upToSeq: 99, activitySeq: 6 }), 6);
  // Cenário do defeito corrigido na spec: a ADM responde (seq 5) enquanto a tela só exibiu até o 4.
  const ticket = { lastActor: 'admin', lastSeq: 5, profReadSeq: 0, adminReadSeq: 0 };
  const cursor = nextReadSeq({ current: 0, upToSeq: 4, activitySeq: 5 });
  assert.equal(isUnread('professional', { ...ticket, profReadSeq: cursor }), true);
  assert.equal(isUnread('professional', { ...ticket, profReadSeq: nextReadSeq({ current: cursor, upToSeq: 5, activitySeq: 5 }) }), false);
});

// ── Coerência com a migration 023 ───────────────────────────────────────────

const sqlList = (re) => {
  const m = SQL_023.match(re);
  assert.ok(m, `padrão não encontrado em 023: ${re}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test('constantes do domínio batem com os CHECKs da migration 023', () => {
  assert.deepEqual(sqlList(/support_tickets_status_check\s+CHECK \(status IN \(([^)]*)\)\)/), STATUSES);
  assert.deepEqual(sqlList(/support_tickets_priority_check CHECK \(priority IN \(([^)]*)\)\)/), PRIORITIES);
  assert.deepEqual(sqlList(/support_faq_categories_slug_check\s+CHECK \(slug IN \(([^)]*)\)\)/), CATEGORIES);
  assert.deepEqual(sqlList(/support_ticket_events_actor_role_check CHECK \(actor_role IN \(([^)]*)\)\)/), ['professional', 'admin', 'system']);
  // Limites de texto.
  assert.equal(Number(SQL_023.match(/support_tickets_subject_check CHECK \(char_length\(subject\) <= (\d+)/)[1]), SUBJECT_MAX);
  assert.equal(Number(SQL_023.match(/support_messages_body_check CHECK \(char_length\(body\) BETWEEN 1 AND (\d+)/)[1]), BODY_MAX);
  assert.match(SQL_023, /char_length\(regexp_replace\(subject, [^)]*\)\) >= 3/);
  // Formato do request_hash exigido pelo banco.
  assert.match(SQL_023, /request_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(ticketRequestHash({ subject: 'abc', category: 'agenda', body: 'x' }), /^[0-9a-f]{64}$/);
  // O que notifica: o trigger usa exatamente esta regra (mensagens sempre; eventos exceto prioridade/sistema).
  assert.match(SQL_023, /type <> 'priority_changed' AND actor_role <> 'system'/);
});

test('todo evento que o domínio produz é aceito pelo CHECK de valores dos eventos (023)', () => {
  const allowed = {};
  for (const m of SQL_023.matchAll(/WHEN '(\w+)'\s+THEN to_value IN \(([^)]*)\)/g)) {
    allowed[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  assert.deepEqual(Object.keys(allowed).sort(), ['priority_changed', 'reopened', 'status_changed']);
  assert.deepEqual(sqlList(/support_ticket_events_type_check\s+CHECK \(type IN \(([^)]*)\)\)/), ['created', 'status_changed', 'priority_changed', 'reopened']);

  const events = [];
  const take = (plan) => { if (plan.ok && plan.event) events.push(plan.event); };
  for (const actor of ['professional', 'admin']) {
    for (const status of STATUSES) {
      take(planReply({ actor, status }));
      for (const to of STATUSES) take(planStatusChange({ actor, from: status, to }));
    }
  }
  take(planProfessionalReopen({ actor: 'professional', status: 'resolvida', resolvedAt: new Date(), now: new Date() }));
  for (const from of PRIORITIES) for (const to of PRIORITIES) take(planPriorityChange({ actor: 'admin', current: from, source: 'auto', to }));

  assert.ok(events.length > 20, `eventos gerados: ${events.length}`);
  for (const e of events) {
    assert.ok(allowed[e.type], `tipo ${e.type} fora do CHECK`);
    assert.ok(allowed[e.type].includes(e.to), `${e.type} -> ${e.to} seria rejeitado pelo banco`);
    assert.ok(['professional', 'admin'].includes(e.actorRole));
  }
  // Reabertura nunca produz status_changed para 'resolvida' nem 'reopened' para os estados proibidos.
  assert.ok(events.some((e) => e.type === 'reopened' && e.actorRole === 'admin'));
  assert.ok(events.some((e) => e.type === 'reopened' && e.actorRole === 'professional'));
});
