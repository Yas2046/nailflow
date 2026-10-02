import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPhone, normalizeBrPhone, normalizeClientPhone, isValidBrPhone } from '../src/utils/phone.js';

test('painel: formatos válidos viram 55 + DDD + 8 dígitos', () => {
  const cases = {
    '553188887777': '553188887777',          // já normalizado
    '(31) 98888-7777': '553188887777',       // máscara
    '+55 31 98888-7777': '553188887777',     // +55
    '5531988887777': '553188887777',         // 55 com o 9
    '31 98888-7777': '553188887777',         // formato brasileiro comum
    '31988887777': '553188887777',
    '(31) 3333-4444': '553133334444',        // fixo
  };
  for (const [input, expected] of Object.entries(cases)) {
    const n = normalizeClientPhone(input);
    assert.equal(n, expected, input);
    assert.equal(isValidBrPhone(n), true, input);
  }
});

test('painel: números inválidos são recusados', () => {
  for (const input of ['123', '984272376', '000000000000000', '5500988887777', '', 'abc']) {
    assert.equal(isValidBrPhone(normalizeClientPhone(input)), false, input);
  }
});

test('bot: regra de WhatsApp não acrescenta DDI a números estrangeiros', () => {
  assert.equal(normalizeBrPhone('12025550123'), '12025550123');
  assert.equal(normalizeBrPhone('351912345678'), '351912345678');
  assert.equal(normalizeBrPhone('5531988887777'), '553188887777');
  assert.equal(normalizeBrPhone('553188887777'), '553188887777');
});

test('cleanPhone mantém só os dígitos do JID', () => {
  assert.equal(cleanPhone('5531988887777@s.whatsapp.net'), '5531988887777');
  assert.equal(cleanPhone('553188887777'), '553188887777');
});
