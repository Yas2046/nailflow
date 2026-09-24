import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.routes.js';
import appointmentsRoutes from './routes/appointments.routes.js';
import availabilityRoutes from './routes/availability.routes.js';
import clientsRoutes from './routes/clients.routes.js';
import expensesRoutes from './routes/expenses.routes.js';
import servicesRoutes from './routes/services.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import publicRoutes from './routes/public.routes.js';
import botRoutes from './routes/bot.routes.js';
import whatsappRoutes from './routes/whatsapp.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
app.set('trust proxy', 1);

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(cookieParser());
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

app.use('/dashboard', dashboardRoutes);
app.use('/public', publicRoutes);
app.use('/bot', cors({ origin: '*' }), botRoutes);
app.use('/whatsapp', whatsappRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3333;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`NailFlow API rodando em http://localhost:${PORT}`);
  });
}

export default app;
