// Leitura de planilha (importação de clientes) e modelos de mensagem: lógica pura, sem navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectColumns, detectDelimiter, looksLikeHeader, parseCsv, toImportRows } from '../src/utils/csv.ts';
import { DEFAULT_TEMPLATES, VARIABLES, fillTemplate, unknownVariables } from '../src/content/mensagensModelos.ts';

test('separador: ponto e vírgula (Excel pt-BR), vírgula e tabulação', () => {
  assert.equal(detectDelimiter('nome;telefone\nA;1'), ';');
  assert.equal(detectDelimiter('nome,telefone\nA,1'), ',');
  assert.equal(detectDelimiter('nome\ttelefone\nA\t1'), '\t');
  assert.equal(detectDelimiter('"Silva, Maria";3199'), ';', 'vírgula dentro de aspas não conta');
});

test('parse: BOM, CRLF, aspas com separador e aspas escapadas, linhas vazias ignoradas', () => {
  const csv = '﻿nome;telefone;obs\r\n"Silva; Maria";(31) 98888-1111;"disse ""oi"""\r\n\r\nJoana;31 3333-2222;\r\n';
  const { rows, delimiter } = parseCsv(csv);
  assert.equal(delimiter, ';');
  assert.deepEqual(rows, [['nome', 'telefone', 'obs'], ['Silva; Maria', '(31) 98888-1111', 'disse "oi"'], ['Joana', '31 3333-2222', '']]);
});

test('cabeçalho e colunas: reconhece sinônimos com acento e sem cabeçalho cai em nome/telefone', () => {
  assert.equal(looksLikeHeader(['Nome', 'Celular', 'Observações']), true);
  assert.equal(looksLikeHeader(['Maria Silva', '31988881111']), false);
  assert.deepEqual(detectColumns(['Cliente', 'WhatsApp', 'Observações', 'Etiquetas'], true), { name: 0, phone: 1, notes: 2, tags: 3 });
  assert.deepEqual(detectColumns(['Maria Silva', '31988881111'], false), { name: 0, phone: 1, notes: null, tags: null });
  assert.deepEqual(detectColumns(['Telefone', 'Nome'], true), { name: 1, phone: 0, notes: null, tags: null }, 'ordem diferente');
});

test('linhas de importação: mapeia colunas, separa etiquetas e omite campos vazios', () => {
  const rows = toImportRows([['Maria', '3198888', 'obs', 'noiva; vip'], ['Joana', '3133', '', '']], { name: 0, phone: 1, notes: 2, tags: 3 });
  assert.deepEqual(rows, [{ name: 'Maria', phone: '3198888', notes: 'obs', tags: ['noiva', 'vip'] }, { name: 'Joana', phone: '3133' }]);
});

test('modelos: substitui variáveis, mantém as desconhecidas e nunca escreve "undefined"', () => {
  assert.equal(fillTemplate('Oi, {cliente}! {x} {hora}', { cliente: 'Maria' }), 'Oi, Maria! {x} {hora}');
  assert.deepEqual(unknownVariables('Oi {cliente} {nome}'), ['nome']);
  const values = Object.fromEntries(VARIABLES.map((v) => [v.name, v.sample]));
  for (const t of DEFAULT_TEMPLATES) {
    assert.deepEqual(unknownVariables(t.text), [], `${t.key}: variável inválida no texto padrão`);
    const out = fillTemplate(t.text, values);
    assert.doesNotMatch(out, /\{[a-z]+\}|undefined/, t.key);
  }
});

test('modelo de retorno oferece saída fácil e nenhum modelo promete envio automático', () => {
  const retorno = DEFAULT_TEMPLATES.find((t) => t.key === 'retorno');
  assert.match(retorno.text, /não receber mais mensagens/i);
  for (const t of DEFAULT_TEMPLATES) assert.doesNotMatch(t.text, /autom[aá]tic/i);
});
