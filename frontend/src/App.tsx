import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import Login from './pages/Login';
import Register from './pages/Register';
import RedefinirSenha from './pages/RedefinirSenha';
import Inicio from './pages/Inicio';
import Agenda from './pages/Agenda';
import Clientes from './pages/Clientes';
import ClienteFicha from './pages/ClienteFicha';
import ImportarClientes from './pages/ImportarClientes';
import Servicos from './pages/Servicos';
import Financeiro from './pages/financeiro/Financeiro';
import Mais from './pages/Mais';
import Comecar from './pages/Comecar';
import ModelosMensagem from './pages/ModelosMensagem';
import Retorno from './pages/Retorno';
import { LEGACY_REDIRECTS } from './components/navConfig';
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
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />

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
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/clientes/importar" element={<ImportarClientes />} />
            <Route path="/clientes/:id" element={<ClienteFicha />} />
            <Route path="/servicos" element={<Servicos />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/financeiro/:aba" element={<Financeiro />} />
            <Route path="/mais" element={<Mais />} />
            <Route path="/comecar" element={<Comecar />} />
            <Route path="/mensagens" element={<ModelosMensagem />} />
            <Route path="/retorno" element={<Retorno />} />
            {/* rotas antigas: continuam funcionando e levam ao novo lugar (links salvos, mensagens e guias) */}
            {LEGACY_REDIRECTS.map((r) => <Route key={r.from} path={r.from} element={<Navigate to={r.to} replace />} />)}
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
