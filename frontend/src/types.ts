export type AppointmentStatus = 'pendente' | 'confirmado' | 'cancelado' | 'concluido' | 'nao_compareceu';

export type RecurringFrequency = 'weekly' | 'biweekly';

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
  tags?: string[];
  recurringGroupId: string | null;
}

export interface RecurringResult {
  groupId: string | null;
  created: Array<{ startsAt: string }>;
  skipped: Array<{ startsAt: string; reason: string }>;
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  tags?: string[];
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

  mes: {
    faturamentoRealizadoCents: number;
    faturamentoPrevistoCents: number;
    faturamentoPerdidoCents: number;
    agendamentosTotal: number;
    agendamentosConcluidos: number;
    agendamentosNaoCompareceu: number;
    agendamentosCancelados: number;
    novosClientes: number;
  };
  mesAnterior: { faturamentoRealizadoCents: number } | null;
  variacao: number | null;
  topServicos: Array<{
    serviceName: string;
    count: number;
    totalCents: number;
  }>;
  faturamento6Meses: Array<{
    mes: string;
    totalCents: number;
  }>;
}

export interface WhatsAppStatus {
  connected: boolean;
  phone: string | null;
  profileName: string | null;
  instanceName: string;
}

export interface WhatsAppConnect {
  alreadyConnected: boolean;
  qrCode?: string | null;
  qrCodeText?: string | null;
  count?: number;
}

export interface WhatsAppInstanceConfig {
  instanceName: string | null;
  configured: boolean;
}

export interface WhatsAppCreateInstance {
  instanceName: string;
  configured: boolean;
}
