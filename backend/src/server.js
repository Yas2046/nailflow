import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.routes.js';
import appointmentsRoutes from './routes/appointments.routes.js';
import availabilityRoutes from './routes/availability.routes.js';
import clientsRoutes from './routes/clients.routes.js';
import expensesRoutes from './routes/expenses.routes.js';
import financeiroRoutes from './routes/financeiro.routes.js';
import servicesRoutes from './routes/services.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import publicRoutes from './routes/public.routes.js';
import botRoutes from './routes/bot.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import adminRoutes from './routes/admin.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import portfolioRoutes from './routes/portfolio.routes.js';
import supportRoutes from './routes/support.routes.js';
import adminSupportRoutes from './routes/adminSupport.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createOriginGuard } from './middleware/originGuard.js';
import { startHoldSweeper } from './utils/bookingRules.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeçalhos de segurança da API (o site e a CSP ficam no nginx). Respostas autenticadas nunca devem ser guardadas em cache
// do navegador ou de intermediários; /health e a página pública de leitura continuam sem essa regra.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (req.path !== '/health') res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);
// Defesa em profundidade contra CSRF: métodos que alteram dados só entram com a origem oficial (ou sem Origin, para
// n8n/Evolution/curl). Antes da autenticação e dos limitadores; ver middleware/originGuard.js.
app.use(createOriginGuard());
app.use(cookieParser());
// Importação de clientes envia até 500 linhas: precisa de mais que os 100KB padrão (só nesta rota; o limite global continua o mesmo).
app.use('/clients/import', express.json({ limit: '1mb' }));
app.use('/portfolio', express.json({ limit: '600kb' }));   // foto de até 300 KB em base64
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'nailflow-backend' });
});

app.use('/auth', authRoutes);
app.use('/appointments', appointmentsRoutes);
app.use('/availability', availabilityRoutes);
app.use('/clients', clientsRoutes);
app.use('/services', servicesRoutes);
app.use('/expenses', expensesRoutes);
// Financeiro (pagamentos e recebimentos). Fail-closed: FINANCEIRO_PAGAMENTOS_ENABLED precisa ser exatamente "true".
app.use('/financeiro', financeiroRoutes);

app.use('/dashboard', dashboardRoutes);
app.use('/public', publicRoutes);
app.use('/bot', botRoutes);
app.use('/whatsapp', whatsappRoutes);
// /admin/support ANTES de /admin: tem limitadores próprios e não deve consumir o limite por IP do /admin.
app.use('/admin/support', adminSupportRoutes);
app.use('/admin', adminRoutes);
app.use('/onboarding', onboardingRoutes);
app.use('/portfolio', portfolioRoutes);
app.use('/support', supportRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3333;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`NailFlow API rodando em http://localhost:${PORT}`);
  });
  // Cancela (cancel_reason='expired') as reservas vencidas, liberando o horário.
  startHoldSweeper();
}

export default app;
