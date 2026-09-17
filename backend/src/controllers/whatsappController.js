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

export async function connectWhatsApp(req, res, next) {
  try {
    const baseUrl = process.env.EVOLUTION_API_URL;
    const apiKey = process.env.EVOLUTION_API_KEY;

    // Evolution API v2: GET /instance/connect/{instance}
    // Returns {instance:{state:"open"}} if already connected
    // Returns {base64, code, count} when QR is available
    const response = await fetch(
      `${baseUrl}/instance/connect/${INSTANCE}`,
      { headers: { apikey: apiKey } }
    );

    if (!response.ok) {
      return res.status(502).json({ error: 'Falha ao solicitar conexão na Evolution API.' });
    }

    const data = await response.json();

    // Already connected
    if (data?.instance?.state === 'open') {
      return res.json({ alreadyConnected: true });
    }

    // QR Code returned
    if (data?.base64) {
      return res.json({
        alreadyConnected: false,
        qrCode: data.base64,      // data:image/png;base64,...
        qrCodeText: data.code ?? null,
        count: data.count ?? 1,
      });
    }

    // Unexpected response
    return res.status(502).json({ error: 'Resposta inesperada da Evolution API.', detail: data });
  } catch (err) {
    next(err);
  }
}
