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
