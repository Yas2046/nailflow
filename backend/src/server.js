import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.routes.js';
import appointmentsRoutes from './routes/appointments.routes.js';
import availabilityRoutes from './routes/availability.routes.js';
import clientsRoutes from './routes/clients.routes.js';
import servicesRoutes from './routes/services.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import publicRoutes from './routes/public.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

// Healthcheck simples — útil para checar se a API subiu e o banco está acessível.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'nailflow-backend' });
});

app.use('/auth', authRoutes);
app.use('/appointments', appointmentsRoutes);
app.use('/availability', availabilityRoutes);
app.use('/clients', clientsRoutes);
app.use('/services', servicesRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/public', publicRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Middleware de erro sempre por último.
app.use(errorHandler);

const PORT = process.env.PORT || 3333;

// Evita subir o servidor durante os testes (que importam este arquivo
// indiretamente); os testes de API sobem sua própria instância.
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`NailFlow API rodando em http://localhost:${PORT}`);
  });
}

export default app;
