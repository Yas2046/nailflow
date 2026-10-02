# NailFlow — WhatsApp e Evolution API

## Evolution API

| Item | Valor |
|---|---|
| Versão | 2.3.7 |
| URL interna | http://127.0.0.1:8080 (porta publicada só em localhost) |
| URL via Nginx | https://nailflow-evolution.duckdns.org (usada pelo n8n para enviar mensagens) |
| Rodando em | Docker (container: `evolution`) |
| Banco de dados próprio | PostgreSQL (container: `evolution-db`, banco: `evolution_api`) |
| Cache | Redis (container: `redis`) |
| Autenticação | `EVOLUTION_API_KEY` (header `apikey`) |

---

## Instâncias

| Instância | Status |
|---|---|
| `chip2` | **desconectada intencionalmente** (desconectada pela responsável em 2026-09-27; `close`) |
| `chip2-teste` | **desconectada intencionalmente** (`close`) |

> Até 2026-09-25 o `chip2` estava `open`. **Não reconectar nenhuma das duas sem autorização.** Depois da última desconexão não houve nenhuma mensagem real nem teste real de webhook — a primeira mensagem após a reconexão do `chip2` será o primeiro teste real da autenticação por cabeçalho (ver abaixo).

Tecnologia interna: Baileys (protocolo WhatsApp Web nativo). **Uma instância por profissional**: cada profissional aponta para a sua em `professionals.wa_instance_name`, e esse nome (`waInstance`) é a chave de roteamento do bot, dos crons e das notificações.

### Webhook configurado (as duas instâncias)

```
POST https://nailflow-n8n.duckdns.org/webhook/whatsapp-nailflow
header: X-NailFlow-Webhook-Secret: <valor de N8N_BOT_WEBHOOK_SECRET>
```

- Desde 2026-09-27 o webhook de cada instância envia o cabeçalho `X-NailFlow-Webhook-Secret` (campo `headers` do webhook na Evolution). O node "Receber Mensagem" do n8n valida o cabeçalho com uma credencial Header Auth; sem ele, o n8n responde 403
- Nessa alteração só o `headers` mudou; `url`, `events`, `enabled`, `byEvents` e `base64` continuaram iguais
- Instâncias criadas pelo painel (`POST /api/whatsapp/evolution-instance`) já recebem o cabeçalho; sem `N8N_BOT_WEBHOOK_SECRET` no `.env`, a criação falha
- **Rollback**, se a primeira mensagem real após a reconexão não for processada (403): voltar o node "Receber Mensagem" para `authentication = none` e reiniciar o n8n

Este webhook é disparado para **toda mensagem recebida** e processado pelo workflow **"WhatsApp NailFlow — Definitivo"** no n8n. O tráfego passa pelo Nginx (443); a porta 5678 do n8n não é acessível de fora.

---

## Fluxo de conexão

```
chip2 ──Baileys──► WhatsApp Web Protocol ──► Número do cliente
                  (WebSocket persistente)
```

Quando a instância está `open`, a conexão é estável e mantida via WebSocket. Não precisa de QR periódico — o QR é necessário apenas para parear um novo dispositivo.

### Reconexão automática

Se a sessão cair, a Evolution tenta reconectar automaticamente usando as credenciais salvas em Redis e PostgreSQL (`Session` table). O loop de reconexão ocorre a cada ~3,5 minutos.

### QR Code (nova conexão)

```
GET http://127.0.0.1:8080/instance/connect/chip2
```

Retorna:
```json
{
  "base64": "data:image/png;base64,...",  // imagem PNG (pode ter baixo contraste)
  "code": "<string do QR>",               // string raw para gerar QR client-side
  "count": 1
}
```

**Implementado:** o frontend usa o campo `code` e renderiza o QR em canvas com a biblioteca `qrcode` (commit `5308ee3`), garantindo QR puro preto/branco.

### Via painel web

A profissional gerencia o WhatsApp pela tela **Configurações → WhatsApp** (gestão completa desde o commit `5be11da`):
1. Criar a instância na Evolution (`POST /api/whatsapp/evolution-instance`) ou remover (`DELETE`)
2. Frontend chama `GET /api/whatsapp/status`
3. Se desconectado: chama `POST /api/whatsapp/connect`
4. Backend obtém `code` da Evolution e repassa ao frontend
5. Frontend renderiza o QR; a profissional escaneia com o WhatsApp

O mesmo status real (`connectionStatus === 'open'`) é usado pelo aviso "WhatsApp desconectado" do menu e pela etapa WhatsApp do onboarding.

**⚠️ Status:** implementado em código mas **não testado completamente em produção** (chip2 já estava conectado quando a feature foi finalizada).

---

## Comandos úteis (Evolution)

```bash
# Status da instância
curl -s http://127.0.0.1:8080/instance/connectionState/chip2 \
  -H "apikey: $EVOLUTION_API_KEY"

# Listar todas instâncias
curl -s http://127.0.0.1:8080/instance/fetchInstances \
  -H "apikey: $EVOLUTION_API_KEY"

# Gerar QR (cuidado: sobrescreve sessão se ativo)
curl -s http://127.0.0.1:8080/instance/connect/chip2 \
  -H "apikey: $EVOLUTION_API_KEY"

# Logs do container
docker logs evolution --tail 50
```

---

## Problemas já enfrentados

### Rate limiting do WhatsApp (2026-09-18)

**O que aconteceu:** loop de reconexão (~100 tentativas em horas) gerou bloqueio temporário do WhatsApp com mensagem "Não é possível conectar novos dispositivos no momento."

**Solução:** aguardar ~4 horas sem nenhuma tentativa de QR/conexão. O bloqueio é temporário e levantado automaticamente.

**Como evitar:** não tentar QR em loop. Se a instância falhar, aguardar pelo menos 4h antes de tentar novo pareamento.

### QR Code com baixo contraste

**O que aconteceu:** a imagem PNG retornada pela Evolution tinha pixels cinza, não escaneável.

**Solução permanente (implementada):** usar o campo `code` (string raw) e renderizar o QR no cliente, em canvas, com a biblioteca `qrcode`.

---

## Variáveis relacionadas

| Variável | Descrição |
|---|---|
| `EVOLUTION_API_URL` | `http://127.0.0.1:8080` |
| `EVOLUTION_API_KEY` | Chave de autenticação da Evolution API |
| `N8N_BOT_WEBHOOK_URL` | URL do webhook `whatsapp-nailflow`, usada ao criar instâncias pelo painel |
| `N8N_BOT_WEBHOOK_SECRET` | Valor do cabeçalho `X-NailFlow-Webhook-Secret` enviado pela Evolution ao n8n (valor só no `.env`) |
