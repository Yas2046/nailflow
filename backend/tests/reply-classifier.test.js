import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReply, normalizeReply } from '../src/utils/replyClassifier.js';

function expectAll(kind, expected, cases) {
  for (const text of cases) {
    assert.equal(classifyReply(text, kind), expected, `${kind}: "${text}" deveria ser ${expected}`);
  }
}

test('confirmação de agendamento: frases ambíguas não confirmam nem negam', () => {
  expectAll('booking', 'unknown', [
    'segunda seria melhor',
    'sei lá',
    'sábado dá?',
    'na verdade sim',
    'não sei',
    'sim, mas prefiro segunda à tarde',
    'sexta',
    '',
    '👍',
  ]);
});

test('confirmação de agendamento: respostas afirmativas confirmam', () => {
  expectAll('booking', 'yes', ['sim', 'Sim!', 'sim, pode', 'SIM', 's', 'ss', 'ok 👍', 'confirmo', 'pode sim', 'isso']);
});

test('confirmação de agendamento: respostas negativas negam', () => {
  expectAll('booking', 'no', ['não', 'nao', 'n', 'Não, obrigada', 'não quero', 'cancela']);
});

test('confirmação de cancelamento', () => {
  expectAll('cancel', 'yes', ['sim', 'sim, pode cancelar', 'pode cancelar', 'cancela', 'ok']);
  expectAll('cancel', 'no', ['não', 'n', 'manter', 'não cancela']);
  expectAll('cancel', 'unknown', ['sei lá', 'segunda seria melhor', 'na verdade sim', 'não sei', 'nao pode cancelar']);
});

test('repetição do último serviço', () => {
  expectAll('repeat', 'yes', ['sim', 'quero', 'bora', 'com certeza', 'pode ser']);
  expectAll('repeat', 'no', ['não', 'outro', 'outro serviço', 'ver opções', 'menu']);
  expectAll('repeat', 'unknown', ['segunda seria melhor', 'sei lá', 'sábado dá?', 'não sei', 'valeu']);
});

test('normalizeReply remove acentos, pontuação e emojis', () => {
  assert.equal(normalizeReply('  Não, OBRIGADA!! 😊 '), 'nao obrigada');
  assert.equal(normalizeReply('Sábado dá?'), 'sabado da');
});

test('tipo desconhecido gera erro', () => {
  assert.throws(() => classifyReply('sim', 'outro'));
});
