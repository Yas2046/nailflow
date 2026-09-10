# NailFlow — Workflows n8n

Camada de automação que conecta a API do NailFlow ao WhatsApp. Todos os 5
workflows já estão prontos em `workflows/`; falta apenas importar, configurar
credenciais e variáveis, e ativar.

## O que cada workflow faz

| Arquivo | Nome | Disparo | Função |
|---|---|---|---|
| `1-novo-agendamento.json` | Novo agendamento | Webhook (mensagem recebida do WhatsApp) | Interpreta a mensagem por palavras-chave, verifica disponibilidade na API, cria a cliente (se nova) e cria o agendamento |
| `2-consulta-horarios.json` | Consulta de horários | Webhook (mensagem recebida do WhatsApp) | Responde com os próximos horários livres, sem criar agendamento |
| `3-confirmacao.json` | Confirmação de agendamento | Webhook (chamado pela própria API) | Avisa a cliente no WhatsApp quando a profissional confirma um horário |
| `4-lembrete.json` | Lembrete de amanhã | Agendado (todo dia às 18h) | Busca os agendamentos do dia seguinte e envia lembrete a cada cliente |
| `5-cancelamento.json` | Cancelamento de agendamento | Webhook (chamado pela própria API) | Avisa a cliente no WhatsApp quando um agendamento é cancelado |

Os workflows 3 e 5 são chamados automaticamente pelo backend via
`backend/src/utils/notifyN8n.js`, que dispara um POST para a URL configurada
em `N8N_WEBHOOK_CONFIRMED_URL` (confirmação) ou `N8N_WEBHOOK_CANCELLED_URL`
(cancelamento) sempre que um agendamento é confirmado ou cancelado.

Os workflows 1 e 2 recebem mensagens do WhatsApp e chamam de volta a API do
NailFlow (rotas autenticadas: `/services`, `/availability/slots`, `/clients`,
`/appointments`).

## 1. Importar os workflows

Em cada arquivo `.json` dentro de `workflows/`:

1. Abra o n8n → menu **⋯** → **Import from File**.
2. Selecione o arquivo. Repita para os 5 arquivos.
3. Cada workflow é importado desativado (`active: false`) — só ative depois
   de configurar credenciais e variáveis (passos abaixo).

## 2. Variáveis de ambiente do n8n

Os workflows leem estas variáveis via `$env`. Configure-as no ambiente onde o
n8n roda (no `docker-compose.yml` da raiz do projeto, ou em **Settings →
Environment** se usar n8n Cloud):

| Variável | Usada em | O que colocar |
|---|---|---|
| `API_URL` | Workflows 1, 2, 4 | URL pública da API NailFlow (ex.: `http://host.docker.internal:3333` em Docker local, ou a URL de produção) |
| `WHATSAPP_TOKEN` | Workflows 1, 2, 3, 4, 5 | Token de acesso da WhatsApp Business Platform (Meta) |
| `WHATSAPP_PHONE_ID` | Workflows 1, 2, 3, 4, 5 | Phone Number ID do WhatsApp Business |

**Onde conseguir o token e o Phone Number ID:** crie um app em
https://developers.facebook.com/apps, adicione o produto **WhatsApp**, e
copie os valores na aba de configuração da API.

## 3. Credencial para chamar a API do NailFlow

Os workflows 1, 2 e 4 chamam rotas autenticadas da API (`authentication:
genericCredentialType`, tipo `httpHeaderAuth`). Crie a credencial uma vez:

1. No n8n: **Credentials → New → Header Auth**.
2. Nome do header: `Authorization`.
3. Valor: `Bearer <token>` — gere um token de longa duração fazendo login uma
   vez via `POST /auth/login` com o e-mail/senha da profissional e copiando o
   campo `token` da resposta.
4. Abra cada node HTTP Request que usa "Header Auth" (aparecem marcados nos
   workflows 1, 2 e 4) e selecione essa credencial.

⚠️ **Limitação conhecida, documentada e não resolvida nesta entrega:** o JWT
gerado no login expira em `JWT_EXPIRES_IN` (7 dias por padrão). Para uso em
automação de longo prazo, o token vai expirar e as chamadas da API passarão a
retornar 401. Duas opções para quando for colocar em produção:
- Aumentar `JWT_EXPIRES_IN` no backend para um token dedicado à automação, ou
- Gerar um novo token periodicamente e atualizar a credencial no n8n.
Isso não foi automatizado para não sair do escopo original do projeto.

## 4. Configurar o webhook de entrada do WhatsApp (Meta)

Os workflows 1 e 2 expõem, respectivamente:
- `POST /webhook/nailflow/mensagem-recebida`
- (o node de consulta de horários reaproveita o mesmo padrão de path — confira o node "Webhook WhatsApp (Meta)" de cada workflow para a URL exata gerada pelo n8n)

A Meta exige dois comportamentos na mesma URL de webhook:
1. **Verificação (GET)**: quando você cadastra a URL no painel da Meta, ela
   faz uma chamada `GET` com `hub.mode`, `hub.verify_token` e `hub.challenge`,
   esperando a API responder com o valor de `hub.challenge` em texto puro,
   caso `hub.verify_token` bata com `WHATSAPP_VERIFY_TOKEN`.
2. **Mensagens (POST)**: é o que os workflows já tratam.

**Isso ainda não está implementado nos workflows importados** (eles só têm o
node de webhook em modo POST). Para a verificação funcionar, adicione
manualmente, no workflow 1 (ou em um workflow separado só para isso), um
segundo node de Webhook configurado para `GET` no mesmo path, seguido de um
node **Respond to Webhook** que devolve `{{$json.query["hub.challenge"]}}`
como texto simples, condicionado a `$json.query["hub.verify_token"] ===
$env.WHATSAPP_VERIFY_TOKEN`. Isso é uma configuração pontual feita uma única
vez no painel da Meta, por isso foi deixada como passo manual documentado em
vez de um workflow adicional fora do escopo original.

## 5. Ativar

Depois de configurar variáveis e credenciais, abra cada workflow e ative o
toggle **Active** no canto superior direito.

## 6. Testando sem WhatsApp de verdade

Você pode testar os workflows 3, 4 e 5 sem nenhuma credencial do WhatsApp
configurada: eles só falham no node que *envia* a mensagem. Para testar a
lógica de negócio isoladamente, use o botão **Execute Workflow** do n8n com
um payload de exemplo no node de Webhook (ou no Schedule Trigger, para o
workflow 4).
