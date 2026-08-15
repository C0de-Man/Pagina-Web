'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function MisListas() {
  const [lists, setLists] = useState<any[]>([]);
  const [logueado, setLogueado] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [creando, setCreando] = useState(false);

  const cargarListas = () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('http://localhost:3001/lists', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then(setLists)
      .catch(() => {});
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLogueado(true);
    cargarListas();
  }, []);

  const crearLista = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoNombre.trim() || creando) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    setCreando(true);
    try {
      await fetch('http://localhost:3001/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nombre: nuevoNombre.trim() }),
      });
      setNuevoNombre('');
      cargarListas();
    } catch {
      // el usuario puede reintentar
    }
    setCreando(false);
  };

  const borrarLista = async (id: number) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    if (!confirm('¿Borrar esta lista? Esta acción no se puede deshacer.')) return;

    setLists((prev) => prev.filter((l) => l.id !== id)); // optimista

    try {
      await fetch(`http://localhost:3001/lists/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      cargarListas(); // si falla, recargamos de verdad
    }
  };

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-6">Mis listas</h1>

        {!logueado ? (
          <p className="text-gray-400 text-sm">
            <Link href="/login" className="underline text-blue-400">Inicia sesión</Link> para ver tus listas.
          </p>
        ) : (
          <>
            <form onSubmit={crearLista} className="flex gap-2 mb-8 max-w-md">
              <input
                type="text"
                value={nuevoNombre}
                onChange={(e) => setNuevoNombre(e.target.value)}
                placeholder="Nombre de la nueva lista..."
                className="flex-grow bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
              <button
                type="submit"
                disabled={creando || !nuevoNombre.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold px-4 rounded transition cursor-pointer"
              >
                Crear lista
              </button>
            </form>

            {lists.length === 0 ? (
              <p className="text-gray-500 text-sm">Aún no tienes ninguna lista. Crea la primera arriba.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {lists.map((list) => (
                  <div
                    key={list.id}
                    className="relative group bg-[#1c2228] rounded-lg border border-gray-700 hover:border-gray-500 transition p-5"
                  >
                    <Link href={`/perfil/lists/${list.id}`} className="block">
                      <h2 className="font-bold text-lg text-white mb-1 pr-6">{list.nombre}</h2>
                      <p className="text-xs text-gray-400">
                        {list.totalItems} {list.totalItems === 1 ? 'título' : 'títulos'}
                      </p>
                    </Link>
                    <button
                      onClick={() => borrarLista(list.id)}
                      className="absolute top-4 right-4 text-gray-500 hover:text-red-400 transition cursor-pointer opacity-0 group-hover:opacity-100"
                      title="Borrar lista"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}