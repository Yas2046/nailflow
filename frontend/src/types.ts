export type AppointmentStatus = 'pendente' | 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';

export interface Appointment {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  serviceId: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  notes: string | null;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  totalAtendimentos?: number;
  ultimoAtendimento?: string | null;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  durationMinutes: number;
  active: boolean;
}

// Retornado cru pelo backend (colunas em snake_case da tabela weekly_availability).
export interface WeeklyAvailabilityDay {
  id?: string;
  professional_id?: string;
  weekday: number; // 0 = domingo ... 6 = sábado
  is_working: boolean;
  start_time: string | null;
  end_time: string | null;
  break_start: string | null;
  break_end: string | null;
}

export interface DashboardSummary {
  agendamentosHoje: Array<{
    id: string;
    clientName: string;
    serviceName: string;
    startsAt: string;
    status: AppointmentStatus;
  }>;
  proximoAtendimento: {
    id: string;
    clientName: string;
    serviceName: string;
    startsAt: string;
  } | null;
  horariosDisponiveisHoje: number;
  totalClientes: number;
  faturamentoEstimadoHojeCents: number;
}
