export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  if (d.startsWith('55') && d.length === 13)
    return `+55 (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.startsWith('55') && d.length === 12)
    return `+55 (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  if (d.length === 11)
    return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return phone;
}

/** Número brasileiro em formato nacional "(31) 90000-0000" (sem +55); outro formato aparece como foi cadastrado. */
export function formatPhoneNational(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const national = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return raw;
}
