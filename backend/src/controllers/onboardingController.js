import { pool } from '../config/db.js';

// Mesma consulta somente leitura usada por GET /whatsapp/status.
async function isWhatsAppConnected(instanceName) {
  if (!instanceName) return false;
  try {
    const response = await fetch(
      `${process.env.EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
      { headers: { apikey: process.env.EVOLUTION_API_KEY }, signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) return false;
    const [inst] = await response.json();
    return inst?.connectionStatus === 'open';
  } catch {
    return false;
  }
}

// GET /onboarding/status
export async function getOnboardingStatus(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT
         p.is_admin,
         p.wa_instance_name,
         COALESCE(TRIM(p.phone_whatsapp), '') <> '' AS perfil,
         EXISTS (SELECT 1 FROM services s WHERE s.professional_id = p.id AND s.active) AS servicos,
         EXISTS (SELECT 1 FROM weekly_availability w WHERE w.professional_id = p.id AND w.is_working) AS horarios,
         EXISTS (SELECT 1 FROM clients c WHERE c.professional_id = p.id) AS clientes
       FROM professionals p WHERE p.id = $1`,
      [req.professionalId]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Profissional não encontrada.' });
    if (row.is_admin) return res.status(403).json({ error: 'Onboarding não se aplica ao admin.' });

    const whatsapp = await isWhatsAppConnected(row.wa_instance_name);
    const concluidos = [row.perfil, row.servicos, row.horarios, whatsapp].filter(Boolean).length;

    res.json({
      perfil: row.perfil,
      servicos: row.servicos,
      horarios: row.horarios,
      whatsapp,
      clientes: row.clientes,
      concluidos,
      total: 4,
    });
  } catch (err) {
    next(err);
  }
}
