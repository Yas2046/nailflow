import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import Inicio from './pages/Inicio';
import Dashboard from './pages/Dashboard';
import Agenda from './pages/Agenda';
import Clientes from './pages/Clientes';
import Servicos from './pages/Servicos';
import Gastos from './pages/Gastos';
import Disponibilidade from './pages/Disponibilidade';
import Perfil from './pages/Perfil';
import PaginaPublica from './pages/PaginaPublica';
import Configuracoes from './pages/Configuracoes';
import AdminDashboard from './pages/AdminDashboard';
import AdminProfissionais from './pages/AdminProfissionais';
import AdminAuditoria from './pages/AdminAuditoria';
import AdminContaVisaoGeral from './pages/admin/AdminContaVisaoGeral';
import AdminContaPerfil from './pages/admin/AdminContaPerfil';
import AdminContaSeguranca from './pages/admin/AdminContaSeguranca';
import AdminContaAtividade from './pages/admin/AdminContaAtividade';
import Ajuda from './pages/Ajuda';
import AjudaPasso from './pages/AjudaPasso';
import AjudaImprimir from './pages/AjudaImprimir';
import SuporteHub from './pages/suporte/SuporteHub';
import SuporteSolicitacoes from './pages/suporte/SuporteSolicitacoes';
import SuporteNova from './pages/suporte/SuporteNova';
import SuporteConversa from './pages/suporte/SuporteConversa';
import AdminSuporte from './pages/admin/AdminSuporte';
import AdminSuporteFaq from './pages/admin/AdminSuporteFaq';
import AdminSuporteAtendimento from './pages/admin/AdminSuporteAtendimento';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/p/:slug" element={<PaginaPublica />} />
          <Route path="/agenda-publica" element={<PaginaPublica />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* guia rápido — público, não exige login */}
          <Route path="/ajuda" element={<Ajuda />} />
          <Route path="/ajuda/imprimir" element={<AjudaImprimir />} />
          <Route path="/ajuda/:passo" element={<AjudaPasso />} />

          {/* área admin — layout próprio */}
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/profissionais" element={<AdminProfissionais />} />
            <Route path="/admin/auditoria" element={<AdminAuditoria />} />
            {/* Central de Suporte (as telas se escondem quando GET /admin/support/summary responde 404) */}
            <Route path="/admin/suporte" element={<AdminSuporte />} />
            <Route path="/admin/suporte/faq" element={<AdminSuporteFaq />} />
            <Route path="/admin/suporte/:id" element={<AdminSuporteAtendimento />} />
            <Route path="/admin/conta" element={<AdminContaVisaoGeral />} />
            <Route path="/admin/conta/perfil" element={<AdminContaPerfil />} />
            <Route path="/admin/conta/seguranca" element={<AdminContaSeguranca />} />
            <Route path="/admin/conta/atividade" element={<AdminContaAtividade />} />
          </Route>

          {/* área profissional */}
          <Route element={<Layout />}>
            <Route path="/" element={<Inicio />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/servicos" element={<Servicos />} />
            <Route path="/gastos" element={<Gastos />} />
            <Route path="/disponibilidade" element={<Disponibilidade />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
            {/* Central de Suporte (cada tela mostra "indisponível" quando o bootstrap informa que está desligada) */}
            <Route path="/suporte" element={<SuporteHub />} />
            <Route path="/suporte/solicitacoes" element={<SuporteSolicitacoes />} />
            <Route path="/suporte/solicitacoes/nova" element={<SuporteNova />} />
            <Route path="/suporte/solicitacoes/:id" element={<SuporteConversa />} />
          </Route>
        </Routes>
      </AuthProvider>
      </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
