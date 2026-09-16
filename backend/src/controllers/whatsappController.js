const INSTANCE = 'chip2';

export async function getWhatsAppStatus(req, res, next) {
  try {
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;

    const response = await fetch(
      `${baseUrl}/instance/fetchInstances?instanceName=${INSTANCE}`,
      { headers: { apikey: apiKey } }
    );

    if (!response.ok) {
      return res.status(502).json({ error: 'Falha ao consultar Evolution API.' });
    }

    const [instance] = await response.json();

    const connected = instance?.connectionStatus === 'open';
    const ownerJid = instance?.ownerJid ?? null;
    const phone = ownerJid
      ? ownerJid.replace('@s.whatsapp.net', '').replace('@c.us', '')
      : null;
    const profileName = instance?.profileName?.trim() ?? null;

    res.json({
      connected,
      phone,
      profileName,
      instanceName: INSTANCE,
    });
  } catch (err) {
    next(err);
  }
}
