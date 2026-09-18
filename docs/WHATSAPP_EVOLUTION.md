# NailFlow — WhatsApp e Evolution API

## Evolution API

| Item | Valor |
|---|---|
| Versão | 2.3.7 |
| URL interna | http://127.0.0.1:8080 |
| Rodando em | Docker (container: `evolution`) |
| Banco de dados próprio | PostgreSQL (container: `evolution-db`, banco: `evolution_api`) |
| Cache | Redis (container: `redis`) |
| Autenticação | `EVOLUTION_API_KEY` (header `apikey`) |

---

## Instância `chip2`

| Item | Valor |
|---|---|
| Nome | chip2 |
| Status atual | `open` (conectado) |
| Profissional | profissional de teste/produção |
| Verificado em | 2026-09-18 às 19h |
| Tecnologia interna | Baileys (protocolo WhatsApp Web nativo) |

### Webhook configurado

```
POST https://nailflow-n8n.duckdns.org/webhook/whatsapp-nailflow
```

Este webhook é disparado para **toda mensagem recebida** no chip2 e é processado pelo workflow **"WhatsApp NailFlow — Definitivo"** no n8n.

---

## Fluxo de conexão

```
chip2 ──Baileys──► WhatsApp Web Protocol ──► Número do cliente
                  (WebSocket persistente)
```

Quando chip2 está `open`, a conexão é estável e mantida via WebSocket. Não precisa de QR periódico — o QR é necessário apenas para parear um novo dispositivo.

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
  "code": "2@Q9Etb7...",                  // string raw para gerar QR client-side
  "count": 1
}
```

**Recomendado:** usar o campo `code` com biblioteca `qrcodejs` para garantir QR puro preto/branco e scannable.

### Via painel web

A profissional pode conectar o WhatsApp pela tela **Configurações → WhatsApp**:
1. Frontend chama `GET /api/whatsapp/status`
2. Se desconectado: chama `POST /api/whatsapp/connect`
3. Backend obtém `code` da Evolution e repassa ao frontend
4. Frontend renderiza QR code
5. Profissional escaneia com o WhatsApp

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

**Solução permanente:** usar o campo `code` (string raw) com a biblioteca `qrcodejs` para renderizar QR client-side em puro preto/branco.

---

## Variáveis relacionadas

| Variável | Descrição |
|---|---|
| `EVOLUTION_API_URL` | `http://127.0.0.1:8080` |
| `EVOLUTION_API_KEY` | Chave de autenticação da Evolution API |
