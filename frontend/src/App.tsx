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
import Admin from './pages/Admin';

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

          {/* área admin — layout próprio */}
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<Admin />} />
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
          </Route>
        </Routes>
      </AuthProvider>
      </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
