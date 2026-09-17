import { pool } from '../config/db.js';

async function getInstanceName(professionalId) {
  const { rows } = await pool.query(
    'SELECT wa_instance_name FROM professionals WHERE id = $1',
    [professionalId]
  );
  return rows[0]?.wa_instance_name ?? null;
}

export async function getWhatsAppStatus(req, res, next) {
  try {
    const instance = await getInstanceName(req.professionalId);
    if (!instance) {
      return res.status(404).json({ error: 'Instância WhatsApp não configurada para esta profissional.' });
    }

    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;

    const response = await fetch(
      `${baseUrl}/instance/fetchInstances?instanceName=${instance}`,
      { headers: { apikey: apiKey } }
    );

    if (!response.ok) {
      return res.status(502).json({ error: 'Falha ao consultar Evolution API.' });
    }

    const [inst] = await response.json();

    const connected = inst?.connectionStatus === 'open';
    const ownerJid = inst?.ownerJid ?? null;
    const phone = ownerJid
      ? ownerJid.replace('@s.whatsapp.net', '').replace('@c.us', '')
      : null;
    const profileName = inst?.profileName?.trim() ?? null;

    res.json({
      connected,
      phone,
      profileName,
      instanceName: instance,
    });
  } catch (err) {
    next(err);
  }
}

export async function connectWhatsApp(req, res, next) {
  try {
    const instance = await getInstanceName(req.professionalId);
    if (!instance) {
      return res.status(404).json({ error: 'Instância WhatsApp não configurada para esta profissional.' });
    }

    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;

    const response = await fetch(
      `${baseUrl}/instance/connect/${instance}`,
      { headers: { apikey: apiKey } }
    );

    if (!response.ok) {
      return res.status(502).json({ error: 'Falha ao solicitar conexão na Evolution API.' });
    }

    const data = await response.json();

    if (data?.instance?.state === 'open') {
      return res.json({ alreadyConnected: true });
    }

    if (data?.base64) {
      return res.json({
        alreadyConnected: false,
        qrCode: data.base64,
        qrCodeText: data.code ?? null,
        count: data.count ?? 1,
      });
    }

    return res.status(502).json({ error: 'Resposta inesperada da Evolution API.', detail: data });
  } catch (err) {
    next(err);
  }
}
