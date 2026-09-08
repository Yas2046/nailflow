import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Agenda from './pages/Agenda';
import Clientes from './pages/Clientes';
import Servicos from './pages/Servicos';
import Disponibilidade from './pages/Disponibilidade';
import PaginaPublica from './pages/PaginaPublica';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Página pública — apenas visualização de horários, sem autenticação */}
          <Route path="/agenda-publica" element={<PaginaPublica />} />

          <Route path="/login" element={<Login />} />

          {/* Área privada da profissional */}
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/servicos" element={<Servicos />} />
            <Route path="/disponibilidade" element={<Disponibilidade />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
