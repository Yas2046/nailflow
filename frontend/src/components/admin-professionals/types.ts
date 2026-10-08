// Tipos compartilhados da gestão de profissionais.

export interface ConfirmAction {
  id: string;
  name: string;
  action: 'block' | 'unblock';
}

export interface EditForm {
  name: string;
  businessName: string;
  phoneWhatsapp: string;
  email: string;
}

export interface DeletePreview {
  clients: number;
  appointments: number;
  services: number;
  recurringGroups: number;
  messages: number;
  expenses: number;
}
