import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractIntent,
  extractServiceMention,
  extractDateMention,
  extractPeriodMention,
  extractSlots,
} from '../src/utils/conversationContext.js';

const SERVICES = [
  { id: 'svc-manicure', name: 'Manicure', duration_minutes: 40 },
  { id: 'svc-pedicure', name: 'Pedicure', duration_minutes: 40 },
  { id: 'svc-escova', name: 'Escova', duration_minutes: 60 },
  { id: 'svc-alongamento', name: 'Alongamento', duration_minutes: 90 },
];

// Fixa uma segunda-feira conhecida como "agora" para os testes de data não
// dependerem do dia em que a suíte é executada.
const MONDAY = new Date('2026-10-05T12:00:00-03:00'); // segunda-feira

test('extractIntent: reconhece "quero fazer X" como intenção de agendar', () => {
  assert.equal(extractIntent('Quero fazer unha sexta depois das 18h'), 'agendar');
  assert.equal(extractIntent('queria marcar um horário'), 'agendar');
});

test('extractIntent: não confunde "cancelar meu agendamento" com intenção de agendar', () => {
  assert.equal(extractIntent('quero cancelar meu agendamento de manicure'), null);
});

test('extractIntent: mensagem neutra não tem intenção', () => {
  assert.equal(extractIntent('oi, tudo bem?'), null);
});

test('extractServiceMention: reconhece nome exato do serviço', () => {
  const s = extractServiceMention('queria marcar uma escova', SERVICES);
  assert.equal(s?.id, 'svc-escova');
});

test('extractServiceMention: reconhece sinônimo coloquial ("unha" → Manicure)', () => {
  const s = extractServiceMention('quero fazer unha sexta', SERVICES);
  assert.equal(s?.id, 'svc-manicure');
});

// Cenário real que causou o bug em produção (2026-09-30): a profissional
// tem "Manicure" e "Manicure + Pedicure" cadastrados ao mesmo tempo.
const SERVICES_WITH_COMBO = [
  { id: 'svc-manicure', name: 'Manicure', duration_minutes: 40 },
  { id: 'svc-pedicure', name: 'Pedicure', duration_minutes: 50 },
  { id: 'svc-combo', name: 'Manicure + Pedicure', duration_minutes: 80 },
];

test('extractServiceMention: "unha" reconhece Manicure mesmo existindo o combo "Manicure + Pedicure"', () => {
  const s = extractServiceMention('Quero fazer unha sexta depois das 18', SERVICES_WITH_COMBO);
  assert.equal(s?.id, 'svc-manicure');
});

test('extractServiceMention: "pé" reconhece Pedicure mesmo existindo o combo "Manicure + Pedicure"', () => {
  const s = extractServiceMention('quero fazer o pé sábado', SERVICES_WITH_COMBO);
  assert.equal(s?.id, 'svc-pedicure');
});

test('extractServiceMention: nome exato "manicure" continua funcionando com o combo cadastrado', () => {
  const s = extractServiceMention('quero fazer manicure sexta', SERVICES_WITH_COMBO);
  assert.equal(s?.id, 'svc-manicure');
});

test('extractServiceMention: "manicure + pedicure" explícito reconhece o serviço composto', () => {
  const s = extractServiceMention('quero fazer manicure + pedicure sábado', SERVICES_WITH_COMBO);
  assert.equal(s?.id, 'svc-combo');
});

test('extractServiceMention: ambiguidade real (dois serviços distintos mencionados) continua retornando null', () => {
  const s = extractServiceMention('quero fazer unha e pé sábado', SERVICES_WITH_COMBO);
  assert.equal(s, null);
});

test('extractServiceMention: sem menção reconhecida retorna null', () => {
  assert.equal(extractServiceMention('oi, tudo bem?', SERVICES), null);
});

test('extractDateMention: "hoje" e "amanhã"', () => {
  const hoje = extractDateMention('pode ser hoje mesmo', MONDAY);
  assert.equal(hoje.toISOString().split('T')[0], '2026-10-05');

  const amanha = extractDateMention('e amanhã, tem?', MONDAY);
  assert.equal(amanha.toISOString().split('T')[0], '2026-10-06');
});

test('extractDateMention: dia da semana resolve para a próxima ocorrência', () => {
  // MONDAY = 2026-10-05 (segunda). "sexta" deve cair em 2026-10-09.
  const sexta = extractDateMention('sexta pode ser', MONDAY);
  assert.equal(sexta.toISOString().split('T')[0], '2026-10-09');
});

test('extractDateMention: dia da semana igual a hoje pula para a próxima semana', () => {
  // MONDAY é segunda; pedir "segunda" não deve resolver para hoje.
  const segunda = extractDateMention('pode ser segunda', MONDAY);
  assert.equal(segunda.toISOString().split('T')[0], '2026-10-12');
});

test('extractDateMention: texto sem data retorna null', () => {
  assert.equal(extractDateMention('quero fazer unha', MONDAY), null);
});

test('extractPeriodMention: "depois das 18h"', () => {
  assert.deepEqual(extractPeriodMention('depois das 18h'), { afterMinutes: 18 * 60 });
});

test('extractPeriodMention: "antes das 12h"', () => {
  assert.deepEqual(extractPeriodMention('antes das 12h'), { beforeMinutes: 12 * 60 });
});

test('extractPeriodMention: períodos nomeados (manhã/tarde/noite)', () => {
  assert.deepEqual(extractPeriodMention('de manhã'), { afterMinutes: 0, beforeMinutes: 12 * 60 });
  assert.deepEqual(extractPeriodMention('à tarde'), { afterMinutes: 12 * 60, beforeMinutes: 18 * 60 });
  assert.deepEqual(extractPeriodMention('à noite'), { afterMinutes: 18 * 60, beforeMinutes: 24 * 60 });
});

test('extractPeriodMention: "qualquer horário" cobre o dia todo', () => {
  assert.deepEqual(extractPeriodMention('pode ser qualquer horário à tarde'), { afterMinutes: 12 * 60, beforeMinutes: 18 * 60 });
  assert.deepEqual(extractPeriodMention('pode ser qualquer horário'), { afterMinutes: 0, beforeMinutes: 24 * 60 });
});

test('extractPeriodMention: sem período retorna null', () => {
  assert.equal(extractPeriodMention('quero fazer unha sexta'), null);
});

test('extractSlots: combina intenção + serviço + data + período numa mensagem só', () => {
  const slots = extractSlots('Quero fazer unha sexta depois das 18h', SERVICES, MONDAY);
  assert.equal(slots.intent, 'agendar');
  assert.equal(slots.serviceId, 'svc-manicure');
  assert.equal(slots.date, '2026-10-09');
  assert.deepEqual(slots.period, { afterMinutes: 18 * 60 });
});

test('extractSlots: mensagem de correção só atualiza o que foi dito ("Não, sábado é melhor")', () => {
  const slots = extractSlots('Não, sábado é melhor', SERVICES, MONDAY);
  assert.equal(slots.intent, undefined);
  assert.equal(slots.serviceId, undefined);
  assert.equal(slots.date, '2026-10-10');
});

test('extractSlots: "Pode ser qualquer horário à tarde" só reconhece o período', () => {
  const slots = extractSlots('Pode ser qualquer horário à tarde', SERVICES, MONDAY);
  assert.equal(slots.date, undefined);
  assert.equal(slots.serviceId, undefined);
  assert.deepEqual(slots.period, { afterMinutes: 12 * 60, beforeMinutes: 18 * 60 });
});

test('extractSlots: "Quero fazer escova e unha" — ambiguidade não vira serviço único', () => {
  // Duas menções de serviço no mesmo texto: extractServiceMention deve
  // recusar escolher por adivinhação (ver comentário da função).
  const slots = extractSlots('Quero fazer escova e unha', SERVICES, MONDAY);
  assert.equal(slots.serviceId, undefined);
});
