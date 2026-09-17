import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Agenda from './pages/Agenda';
import Clientes from './pages/Clientes';
import Servicos from './pages/Servicos';
import Disponibilidade from './pages/Disponibilidade';
import Perfil from './pages/Perfil';
import PaginaPublica from './pages/PaginaPublica';
import Configuracoes from './pages/Configuracoes';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/p/:slug" element={<PaginaPublica />} />
          <Route path="/agenda-publica" element={<PaginaPublica />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/servicos" element={<Servicos />} />
            <Route path="/disponibilidade" element={<Disponibilidade />} />
            <Route path="/perfil" element={<Perfil />} />
            <Route path="/configuracoes" element={<Configuracoes />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
