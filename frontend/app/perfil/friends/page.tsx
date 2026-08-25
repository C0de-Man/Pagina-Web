'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const API_URL = 'http://localhost:3001';

interface Usuario {
  id: number;
  username: string;
  avatar: string | null;
  isFollowing: boolean;
}

export default function Amigos() {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<Usuario[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscadoYa, setBuscadoYa] = useState(false);
  const [procesandoId, setProcesandoId] = useState<number | null>(null);

  const [siguiendo, setSiguiendo] = useState<Usuario[]>([]);
  const [cargandoSiguiendo, setCargandoSiguiendo] = useState(true);

  const cargarSiguiendo = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setCargandoSiguiendo(false);
      return;
    }
    fetch(`${API_URL}/users/me/following`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => setSiguiendo(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setCargandoSiguiendo(false));
  };

  useEffect(() => {
    cargarSiguiendo();
  }, []);

  const buscar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || buscando) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    setBuscando(true);
    setBuscadoYa(true);
    try {
      const res = await fetch(`${API_URL}/users/search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setResultados(Array.isArray(data) ? data : []);
    } catch {
      setResultados([]);
    }
    setBuscando(false);
  };

  // Actualiza el estado de seguir/no-seguir en TODOS los sitios donde pueda
  // aparecer ese usuario a la vez (resultados de búsqueda y lista de
  // Following), para que no se desincronicen entre sí.
  const toggleSeguir = async (usuario: Usuario) => {
    const token = localStorage.getItem('token');
    if (!token || procesandoId) return;

    const nuevoEstado = !usuario.isFollowing;
    setProcesandoId(usuario.id);

    setResultados((prev) => prev.map((u) => (u.id === usuario.id ? { ...u, isFollowing: nuevoEstado } : u)));
    if (nuevoEstado) {
      setSiguiendo((prev) => (prev.some((u) => u.id === usuario.id) ? prev : [{ ...usuario, isFollowing: true }, ...prev]));
    } else {
      setSiguiendo((prev) => prev.filter((u) => u.id !== usuario.id));
    }

    try {
      await fetch(`${API_URL}/users/${usuario.id}/follow`, {
        method: usuario.isFollowing ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // si falla, recargamos de verdad en vez de intentar revertir a mano
      cargarSiguiendo();
      setResultados((prev) => prev.map((u) => (u.id === usuario.id ? { ...u, isFollowing: usuario.isFollowing } : u)));
    }
    setProcesandoId(null);
  };

  const renderFila = (usuario: Usuario) => (
    <div
      key={usuario.id}
      className="flex items-center justify-between gap-3 bg-[#1c2228] border border-gray-700 rounded-lg px-4 py-3"
    >
      <Link href={`/user/${usuario.username}`} className="flex items-center gap-3 group">
        <div className="w-10 h-10 rounded-full overflow-hidden bg-blue-600 flex-shrink-0">
          <img
            src={usuario.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${usuario.username}`}
            alt={usuario.username}
            className="w-full h-full object-cover"
          />
        </div>
        <span className="font-semibold text-white group-hover:underline">{usuario.username}</span>
      </Link>

      <button
        onClick={() => toggleSeguir(usuario)}
        disabled={procesandoId === usuario.id}
        className={`text-sm font-bold px-4 py-1.5 rounded transition cursor-pointer disabled:opacity-50 ${
          usuario.isFollowing
            ? 'bg-[#2c3440] text-gray-300 hover:bg-red-900/40 hover:text-red-300'
            : 'bg-blue-600 hover:bg-blue-500 text-white'
        }`}
      >
        {usuario.isFollowing ? 'Following' : 'Follow'}
      </button>
    </div>
  );

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-6">Friends</h1>

        <form onSubmit={buscar} className="flex gap-2 mb-8 max-w-md">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a username..."
            className="flex-grow bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <button
            type="submit"
            disabled={buscando}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold px-4 rounded transition cursor-pointer"
          >
            {buscando ? 'Searching...' : 'Search'}
          </button>
        </form>

        {buscadoYa && (
          <div className="mb-10">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">Search results</h2>
            {buscando ? (
              <p className="text-gray-500 text-sm">Searching...</p>
            ) : resultados.length === 0 ? (
              <p className="text-gray-500 text-sm">No users found for "{query}".</p>
            ) : (
              <div className="space-y-2">{resultados.map(renderFila)}</div>
            )}
          </div>
        )}

        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-3">
            Following {siguiendo.length > 0 && <span className="text-gray-600">({siguiendo.length})</span>}
          </h2>
          {cargandoSiguiendo ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : siguiendo.length === 0 ? (
            <p className="text-gray-500 text-sm">You're not following anyone yet. Search for a username above to get started.</p>
          ) : (
            <div className="space-y-2">{siguiendo.map(renderFila)}</div>
          )}
        </div>
      </div>
    </main>
  );
}