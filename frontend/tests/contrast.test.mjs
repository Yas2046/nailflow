// Contraste dos pares de cor que o redesign usa para texto (WCAG AA: 4,5:1), nos três temas da área da profissional.
// Lê os tokens reais de src/index.css; se alguém trocar uma cor e quebrar o contraste, este teste acusa.
// Limite: verifica pares de tokens, não cada tela (as telas foram conferidas no navegador com uma varredura de contraste).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(import.meta.dirname, '../src/index.css'), 'utf8').split('\r').join('');

function tokens(selectorRe) {
  const m = css.match(selectorRe);
  assert.ok(m, `bloco não encontrado: ${selectorRe}`);
  const out = {};
  for (const [, name, r, g, b] of m[1].matchAll(/--([a-z]+-?\d*):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) out[name] = [Number(r), Number(g), Number(b)];
  return out;
}
const base = { ...tokens(/:root,\s*\n\[data-theme="vinho"\] \{([\s\S]*?)\n\}/), };
const THEMES = {
  vinho: base,
  verde: tokens(/\[data-theme="verde"\] \{([\s\S]*?)\n\}/),
  azul: tokens(/\[data-theme="azul"\] \{([\s\S]*?)\n\}/),
};
const FIXED = {};
for (const [, name, r, g, b] of css.match(/\n:root \{\s*\n\s*--cream[\s\S]*?\n\}/)[0].matchAll(/--([a-z]+-?\d*):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) FIXED[name] = [Number(r), Number(g), Number(b)];

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const mix = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const ratio = (fg, bg, a = 1) => { const f = mix(fg, bg, a); const [hi, lo] = [lum(f), lum(bg)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const WHITE = [255, 255, 255];

// alfas definidos em index.css para os tons secundários de texto (ink/35..65)
const SECUNDARIOS = [...css.matchAll(/\.text-ink\\\/(\d+)[^{]*\{ color: rgb\(var\(--ink\) \/ ([\d.]+)\); \}/g)].map((m) => Number(m[2]));

test('tokens lidos do CSS (três temas e cores fixas)', () => {
  for (const [name, t] of Object.entries(THEMES)) assert.ok(t['wine-700'] && t['wine-50'], name);
  assert.ok(FIXED.cream && FIXED.ink && FIXED['gold-700'] && FIXED['sage-700']);
  assert.ok(SECUNDARIOS.length >= 3);
});

test('texto secundário (ink com transparência) passa AA sobre creme e branco', () => {
  for (const a of SECUNDARIOS) {
    assert.ok(ratio(FIXED.ink, FIXED.cream, a) >= 4.5, `ink/${a} sobre creme`);
    assert.ok(ratio(FIXED.ink, WHITE, a) >= 4.5, `ink/${a} sobre branco`);
  }
});

for (const [name, t] of Object.entries(THEMES)) {
  test(`tema ${name}: botões, menu lateral, rótulos do painel escuro e links`, () => {
    assert.ok(ratio(WHITE, t['wine-600']) >= 4.5, 'texto branco no botão primário (wine-600)');
    assert.ok(ratio(WHITE, t['wine-700']) >= 4.5, 'texto branco no menu (wine-700)');
    assert.ok(ratio(t['wine-100'], t['wine-700'], 0.85) >= 4.5, 'item inativo do menu (wine-100/85 sobre wine-700)');
    assert.ok(ratio(t['wine-300'], t['wine-800']) >= 4.5, 'rótulos sobre painel escuro (wine-300 sobre wine-800)');
    assert.ok(ratio(t['wine-700'], FIXED.cream) >= 4.5, 'links/títulos (wine-700 sobre creme)');
    assert.ok(ratio(t['wine-700'], t['wine-50']) >= 4.5, 'wine-700 sobre wine-50 (chips)');
  });
}

test('ouro e verde usados como texto pequeno têm variante escura que passa AA', () => {
  assert.ok(ratio(FIXED['gold-700'], mix(FIXED['gold-400'], WHITE, 0.2)) >= 4.5, 'gold-700 sobre gold-400/20');
  assert.ok(ratio(FIXED['sage-700'], FIXED['sage-100']) >= 4.5, 'sage-700 sobre sage-100');
});
