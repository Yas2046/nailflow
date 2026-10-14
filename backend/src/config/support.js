// Interruptor da Central de Suporte. Fail-closed: só liga com o valor exato "true" (aparado, sem diferenciar
// maiúsculas). Ausente, vazio, "1", "yes", "false" ou qualquer outra coisa deixa a central DESLIGADA.
// Avaliado uma vez, na carga do módulo (o .env é lido na inicialização; mudar o valor exige reiniciar o PM2).
export function parseSupportFlag(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export const SUPPORT_CENTER_ENABLED = parseSupportFlag(process.env.SUPPORT_CENTER_ENABLED);
