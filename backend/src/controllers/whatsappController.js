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

export async function getInstanceConfig(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT wa_instance_name FROM professionals WHERE id = $1',
      [req.professionalId]
    );
    const instanceName = rows[0]?.wa_instance_name ?? null;
    res.json({ instanceName, configured: instanceName !== null });
  } catch (err) {
    next(err);
  }
}

export async function setInstanceConfig(req, res, next) {
  try {
    const { instanceName } = req.body;

    if (!instanceName || typeof instanceName !== 'string') {
      return res.status(400).json({ error: 'Nome de instância inválido.' });
    }
    const trimmed = instanceName.trim();
    if (!trimmed || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed) || trimmed.length > 80) {
      return res.status(400).json({ error: 'Nome de instância inválido. Use letras, números, hífens e underscores.' });
    }

    const { rows: conflict } = await pool.query(
      'SELECT id FROM professionals WHERE wa_instance_name = $1 AND id != $2',
      [trimmed, req.professionalId]
    );
    if (conflict.length > 0) {
      return res.status(409).json({ error: 'Esta instância já está vinculada a outra profissional.' });
    }

    const { rows } = await pool.query(
      'UPDATE professionals SET wa_instance_name = $1 WHERE id = $2 RETURNING wa_instance_name',
      [trimmed, req.professionalId]
    );
    res.json({ instanceName: rows[0].wa_instance_name, configured: true });
  } catch (err) {
    next(err);
  }
}

export async function removeInstanceConfig(req, res, next) {
  try {
    await pool.query(
      'UPDATE professionals SET wa_instance_name = NULL WHERE id = $1',
      [req.professionalId]
    );
    res.json({ instanceName: null, configured: false });
  } catch (err) {
    next(err);
  }
}

// ── Helpers Evolution ─────────────────────────────────────────────────────────

function evolutionFetch(path, options = {}) {
  const baseUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
      ...(options.headers || {}),
    },
  });
}

function validateInstanceName(name) {
  if (!name || typeof name !== 'string') return 'Nome de instância inválido.';
  const trimmed = name.trim();
  if (!trimmed || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed) || trimmed.length > 80) {
    return 'Nome de instância inválido. Use letras, números, hífens e underscores.';
  }
  return null;
}

// ── Criar instância na Evolution ──────────────────────────────────────────────

export async function createEvolutionInstance(req, res, next) {
  try {
    const { instanceName } = req.body;
    const validationError = validateInstanceName(instanceName);
    if (validationError) return res.status(400).json({ error: validationError });
    const trimmed = instanceName.trim();

    // Garantir que a profissional ainda não tem instância
    const existing = await getInstanceName(req.professionalId);
    if (existing) {
      return res.status(409).json({
        error: 'Você já possui uma instância WhatsApp configurada. Exclua a atual antes de criar uma nova.',
      });
    }

    // Garantir que o nome não está em uso por outra profissional
    const { rows: conflict } = await pool.query(
      'SELECT id FROM professionals WHERE wa_instance_name = $1',
      [trimmed]
    );
    if (conflict.length > 0) {
      return res.status(409).json({ error: 'Este nome de instância já está em uso.' });
    }

    // 1. Criar instância na Evolution
    const createResp = await evolutionFetch('/instance/create', {
      method: 'POST',
      body: JSON.stringify({ instanceName: trimmed, integration: 'WHATSAPP-BAILEYS' }),
    });

    if (!createResp.ok) {
      const errBody = await createResp.json().catch(() => ({}));
      // Nome duplicado na Evolution (instância existe lá mas não no banco)
      if (createResp.status === 400 || createResp.status === 409) {
        return res.status(409).json({ error: 'Este nome de instância já existe na Evolution. Escolha outro.' });
      }
      return res.status(502).json({ error: 'Falha ao criar instância na Evolution.' });
    }

    // 2. Configurar webhook n8n
    const webhookUrl = process.env.N8N_BOT_WEBHOOK_URL;
    if (!webhookUrl) {
      // Instância criada mas webhook não configurado — deletar da Evolution para manter consistência
      await evolutionFetch(`/instance/delete/${trimmed}`, { method: 'DELETE' }).catch(() => {});
      return res.status(500).json({
        error: 'Configuração de webhook ausente no servidor. Contate o suporte.',
      });
    }

    const webhookResp = await evolutionFetch(`/webhook/set/${trimmed}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          url: webhookUrl,
          enabled: true,
          events: ['MESSAGES_UPSERT'],
          webhookByEvents: false,
          webhookBase64: false,
        },
      }),
    });

    if (!webhookResp.ok) {
      // Webhook falhou — deletar instância da Evolution para não deixar estado inconsistente
      await evolutionFetch(`/instance/delete/${trimmed}`, { method: 'DELETE' }).catch(() => {});
      return res.status(502).json({
        error: 'Instância criada mas falha ao configurar webhook. Tente novamente.',
      });
    }

    // 3. Persistir no banco
    await pool.query(
      'UPDATE professionals SET wa_instance_name = $1 WHERE id = $2',
      [trimmed, req.professionalId]
    );

    res.status(201).json({ instanceName: trimmed, configured: true });
  } catch (err) {
    next(err);
  }
}

// ── Excluir instância da Evolution ────────────────────────────────────────────

export async function deleteEvolutionInstance(req, res, next) {
  try {
    const instance = await getInstanceName(req.professionalId);
    if (!instance) {
      return res.status(404).json({ error: 'Nenhuma instância configurada para excluir.' });
    }

    // Confirmar que a instância no banco é da profissional autenticada (já garantido pelo getInstanceName,
    // mas reforçamos para proteger contra race conditions)
    const { rows } = await pool.query(
      'SELECT id FROM professionals WHERE id = $1 AND wa_instance_name = $2',
      [req.professionalId, instance]
    );
    if (!rows[0]) {
      return res.status(403).json({ error: 'Instância não pertence a esta profissional.' });
    }

    // 1. Excluir na Evolution
    const deleteResp = await evolutionFetch(`/instance/delete/${instance}`, { method: 'DELETE' });

    if (!deleteResp.ok && deleteResp.status !== 404) {
      // 404 = já não existe na Evolution; outros erros bloqueiam a exclusão
      const errBody = await deleteResp.json().catch(() => ({}));
      return res.status(502).json({
        error: 'Falha ao excluir instância na Evolution. O vínculo no banco foi mantido.',
      });
    }

    // 2. Limpar o banco apenas após sucesso na Evolution (ou 404 = já inexistente)
    await pool.query(
      'UPDATE professionals SET wa_instance_name = NULL WHERE id = $1',
      [req.professionalId]
    );

    res.json({ instanceName: null, configured: false });
  } catch (err) {
    next(err);
  }
}
