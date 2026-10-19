// Regras puras do Financeiro etapa 2 (utils/financeiroPagamentos.js): sem banco, rodam sempre em `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_METHODS, MAX_AMOUNT_CENTS, parseDateOnly, todayInBusinessTz, checkMovementDate, parseIdempotencyKey, requestHash,
  serviceValue, balance, receiveSchema, refundSchema, correctionSchema, financeiroPagamentosEnabled,
} from '../src/utils/financeiroPagamentos.js';

const NOW = new Date('2026-10-19T15:00:00Z'); // 12:00 em São Paulo, dia 19

test('interruptor: só liga com "true" exato (fail-closed)', () => {
  assert.equal(financeiroPagamentosEnabled({ FINANCEIRO_PAGAMENTOS_ENABLED: 'true' }), true);
  assert.equal(financeiroPagamentosEnabled({ FINANCEIRO_PAGAMENTOS_ENABLED: ' TRUE ' }), true);
  for (const v of [undefined, '', '1', 'yes', 'false', 'on', 'truee']) assert.equal(financeiroPagamentosEnabled({ FINANCEIRO_PAGAMENTOS_ENABLED: v }), false, String(v));
});

test('métodos: os seis pedidos, e nada além (igual à constraint do banco)', () => {
  assert.deepEqual([...PAYMENT_METHODS].sort(), ['cartao_credito', 'cartao_debito', 'dinheiro', 'outra', 'pix', 'transferencia']);
});

test('datas: calendário real, formato estrito, não futura, não anterior ao limite nem ao recebimento original', () => {
  assert.equal(parseDateOnly('2026-02-28'), '2026-02-28');
  assert.equal(parseDateOnly('2028-02-29'), '2028-02-29');          // bissexto
  for (const v of ['2026-02-30', '2026-13-01', '2026-00-10', '2027-02-29', '26-01-01', '2026/01/01', '2026-1-1', '', null, undefined, 20260101, '2026-01-01T00:00:00Z']) {
    assert.equal(parseDateOnly(v), null, String(v));
  }
  assert.equal(todayInBusinessTz(NOW), '2026-10-19');
  assert.equal(todayInBusinessTz(new Date('2026-10-20T01:30:00Z')), '2026-10-19', '22:30 em São Paulo ainda é dia 19');
  assert.equal(todayInBusinessTz(new Date('2026-10-20T03:00:00Z')), '2026-10-20');
  assert.deepEqual(checkMovementDate('2026-10-19', { now: NOW }), { ok: true, value: '2026-10-19' });
  assert.equal(checkMovementDate('2026-10-20', { now: NOW }).ok, false, 'amanhã');
  assert.equal(checkMovementDate('2019-12-31', { now: NOW }).ok, false, 'antes do limite');
  assert.equal(checkMovementDate('2026-10-10', { now: NOW, notBefore: '2026-10-11' }).ok, false);
  assert.equal(checkMovementDate('2026-10-11', { now: NOW, notBefore: '2026-10-11' }).ok, true);
  assert.equal(checkMovementDate('2026-02-30', { now: NOW }).ok, false);
});

test('chave de idempotência: 8 a 50 caracteres seguros', () => {
  assert.equal(parseIdempotencyKey('abcdefgh'), 'abcdefgh');
  assert.equal(parseIdempotencyKey('a'.repeat(50)), 'a'.repeat(50));
  assert.equal(parseIdempotencyKey('chave_1.2:3-x'), 'chave_1.2:3-x');
  for (const v of ['abcdefg', 'a'.repeat(51), 'com espaço aqui', 'acentuação-x', 'a;b;c;d;e;f', '', undefined, null]) assert.equal(parseIdempotencyKey(v), null, String(v));
});

test('hash do pedido: estável, independente da ordem das chaves, e sensível a cada campo', () => {
  const base = { appointmentId: 'a', amountCents: 100, method: 'pix', occurredOn: '2026-10-01', notes: null };
  const h = requestHash('receive', 'p1', base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(requestHash('receive', 'p1', { notes: null, occurredOn: '2026-10-01', method: 'pix', amountCents: 100, appointmentId: 'a' }), h);
  for (const [k, v] of Object.entries({ appointmentId: 'b', amountCents: 101, method: 'dinheiro', occurredOn: '2026-10-02', notes: 'x' })) {
    assert.notEqual(requestHash('receive', 'p1', { ...base, [k]: v }), h, k);
  }
  assert.notEqual(requestHash('refund', 'p1', base), h, 'operação');
  assert.notEqual(requestHash('receive', 'p2', base), h, 'profissional');
});

test('valor do serviço e saldo: valor final quando existe, senão o preço registrado; líquido = recebido - estornado', () => {
  assert.deepEqual(serviceValue({ final_price_cents: 8000, price_cents_snapshot: 10000 }), { cents: 8000, basis: 'final' });
  assert.deepEqual(serviceValue({ final_price_cents: null, price_cents_snapshot: 10000 }), { cents: 10000, basis: 'servico' });
  assert.deepEqual(serviceValue({ final_price_cents: 0, price_cents_snapshot: 10000 }), { cents: 0, basis: 'final' }, 'valor final zero é valor final');
  assert.deepEqual(balance(10000, 7000, 2000), { valueCents: 10000, receivedCents: 7000, refundedCents: 2000, netCents: 5000, balanceCents: 5000 });
  assert.equal(balance(10000, 10000, 10000).balanceCents, 10000, 'tudo estornado: o saldo volta ao valor');
});

test('validação dos pedidos: valores em centavos inteiros, positivos e limitados; método da lista; campos desconhecidos recusados', () => {
  const ok = { amountCents: 1500, method: 'pix', occurredOn: '2026-10-01' };
  assert.ok(receiveSchema.safeParse(ok).success);
  for (const m of PAYMENT_METHODS) assert.ok(receiveSchema.safeParse({ ...ok, method: m }).success, m);
  const bad = [
    { ...ok, amountCents: 0 }, { ...ok, amountCents: -1 }, { ...ok, amountCents: 10.5 }, { ...ok, amountCents: '1500' },
    { ...ok, amountCents: MAX_AMOUNT_CENTS + 1 }, { ...ok, amountCents: NaN }, { ...ok, amountCents: Infinity }, { ...ok, amountCents: null },
    { ...ok, method: 'cheque' }, { ...ok, method: 'PIX' }, { ...ok, method: undefined },
    { ...ok, occurredOn: undefined }, { ...ok, extra: 1 }, { ...ok, professionalId: 'x' }, { ...ok, kind: 'estorno' }, { ...ok, notes: 'x'.repeat(301) },
  ];
  for (const b of bad) assert.equal(receiveSchema.safeParse(b).success, false, JSON.stringify(b));
  assert.ok(receiveSchema.safeParse({ ...ok, amountCents: MAX_AMOUNT_CENTS }).success);
  assert.ok(refundSchema.safeParse({ amountCents: 100, occurredOn: '2026-10-01', reason: 'Cliente devolveu' }).success);
  for (const b of [{ amountCents: 100, occurredOn: '2026-10-01' }, { amountCents: 100, occurredOn: '2026-10-01', reason: 'ab' }, { amountCents: 100, occurredOn: '2026-10-01', reason: '   ' },
    { amountCents: 0, occurredOn: '2026-10-01', reason: 'motivo ok' }, { amountCents: 100, occurredOn: '2026-10-01', reason: 'motivo ok', method: 'pix' }]) {
    assert.equal(refundSchema.safeParse(b).success, false, JSON.stringify(b));
  }
  const corr = { reason: 'Valor digitado errado', occurredOn: '2026-10-01', novo: { amountCents: 900, method: 'dinheiro' } };
  assert.ok(correctionSchema.safeParse(corr).success);
  assert.equal(correctionSchema.safeParse({ ...corr, novo: { amountCents: 0, method: 'pix' } }).success, false);
  assert.equal(correctionSchema.safeParse({ ...corr, novo: { amountCents: 900 } }).success, false);
  assert.equal(correctionSchema.safeParse({ ...corr, reason: '' }).success, false);
  assert.equal(correctionSchema.safeParse({ ...corr, novo: { ...corr.novo, extra: 1 } }).success, false);
});
