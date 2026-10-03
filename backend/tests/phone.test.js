import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPhone, normalizeBrPhone, normalizeClientPhone, isValidBrPhone, whatsappNumberForSending } from '../src/utils/phone.js';

test('envio à profissional: telefone vira 55 + número, sem duplicar o DDI', () => {
  const cases = {
    '31985108190': '5531985108190',          // sem DDI (11 dígitos)
    '5531985108190': '5531985108190',        // já com 55
    '(31) 98510-8190': '5531985108190',      // máscara
    '+55 (31) 98510-8190': '5531985108190',  // +55 com máscara
    ' 31 98510 8190 ': '5531985108190',      // espaços
    '031985108190': '5531985108190',         // zero de tronco
    '3133334444': '553133334444',            // fixo sem DDI (10 dígitos)
    '553185108190': '553185108190',          // 12 dígitos já com 55 (sem o 9)
    '55991234567': '5555991234567',          // DDD 55 (RS) não é confundido com DDI
    '5555991234567': '5555991234567',
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(whatsappNumberForSending(input), expected, input);
  }
});

test('envio à profissional: vazio, nulo ou inválido devolve null', () => {
  for (const input of [null, undefined, '', '   ', 'abc', '123', '123456789', '55', '12345678901234']) {
    assert.equal(whatsappNumberForSending(input), null, String(input));
  }
});

test('envio à profissional: não altera o valor de entrada nem aplica a regra do 9 das fichas', () => {
  assert.equal(whatsappNumberForSending('5531985108190'), '5531985108190'); // mantém o 9
  assert.equal(normalizeClientPhone('5531985108190'), '553185108190');      // ficha de cliente continua sem o 9
});

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
