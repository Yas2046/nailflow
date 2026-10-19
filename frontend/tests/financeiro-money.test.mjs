// Financeiro (etapa 6): leitura de valores digitados, formatação em reais e datas no fuso do negócio (America/Sao_Paulo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBRLToCents, formatBRL, formatDateBR, formatDateTimeBR, todayBR, dateInBusinessTz, monthBoundsBR, addDaysISO, methodLabel, centsToInput } from '../src/utils/money.ts';

test('parseBRLToCents aceita o formato brasileiro e recusa o inválido', () => {
  assert.equal(parseBRLToCents('10'), 1000);
  assert.equal(parseBRLToCents('10,5'), 1050);
  assert.equal(parseBRLToCents('1.234,56'), 123456);
  assert.equal(parseBRLToCents('R$ 0,99'), 99);
  for (const bad of ['', ' ', '0', '0,00', '-5', '1,234', '1.23', 'abc', '10,555', '1..000,00']) assert.equal(parseBRLToCents(bad), null, bad);
  assert.equal(parseBRLToCents('0,00', { allowZero: true }), 0);
  assert.equal(parseBRLToCents('', { allowZero: true }), null);
  assert.equal(centsToInput(123456), '1234,56');
});

test('valores em reais e datas no padrão brasileiro, sem deslocar o dia', () => {
  assert.match(formatBRL(123456), /^R\$\s?1\.234,56$/);
  assert.equal(formatBRL(null), '—');
  assert.equal(formatDateBR('2026-10-19'), '19/10/2026');
  assert.equal(formatDateBR(null), '—');
  assert.match(formatDateTimeBR('2026-10-19T02:30:00Z'), /^18\/10\/2026,? 23:30$/);       // UTC-3: ainda é dia 18 em São Paulo
});

test('"hoje" e os limites do mês seguem o fuso do negócio, não o do navegador', () => {
  assert.equal(todayBR(new Date('2026-10-19T02:30:00Z')), '2026-10-18');
  assert.equal(todayBR(new Date('2026-10-19T03:30:00Z')), '2026-10-19');
  assert.equal(dateInBusinessTz('2026-03-01T02:00:00Z'), '2026-02-28');
  assert.deepEqual(monthBoundsBR(0, new Date('2026-03-01T02:00:00Z')), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthBoundsBR(-1, new Date('2026-01-15T12:00:00Z')), { from: '2025-12-01', to: '2025-12-31' });
  assert.equal(addDaysISO('2026-02-28', 1), '2026-03-01');
});

test('rótulos distinguem Boleto e método não informado, ambos agrupados em "Outros" pelo caixa', () => {
  assert.equal(methodLabel('boleto'), 'Boleto');
  assert.equal(methodLabel(null), 'Método não informado');
  assert.equal(methodLabel('outra'), 'Outros');
});
