'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const API_URL = 'http://localhost:3001';

export default function ListasDeUsuario() {
  const params = useParams();
  const username = params.username as string;

  const [lists, setLists] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);

  useEffect(() => {
    if (!username) return;

    fetch(`${API_URL}/users/${encodeURIComponent(username)}/lists`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then((data) => setLists(Array.isArray(data) ? data : []))
      .catch(() => setNoEncontrado(true))
      .finally(() => setCargando(false));
  }, [username]);

  if (cargando) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">Loading...</main>;
  }

  if (noEncontrado) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">User not found</main>;
  }

  const listasFiltradas = lists.filter((l) =>
    l.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-1">Lists</h1>
        <p className="text-sm text-gray-400 mb-6">
          <Link href={`/user/${username}`} className="hover:underline">{username}</Link>
        </p>

        {lists.length > 1 && (
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Search lists..."
            className="w-full max-w-md bg-[#2c3440] text-white text-sm rounded px-3 py-2 mb-8 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
        )}

        {lists.length === 0 ? (
          <p className="text-gray-500 text-sm">{username} doesn't have any public lists yet.</p>
        ) : listasFiltradas.length === 0 ? (
          <p className="text-gray-500 text-sm">No lists match "{busqueda}".</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {listasFiltradas.map((list) => (
              <Link
                key={list.id}
                href={`/user/${username}/lists/${list.id}`}
                className="bg-[#1c2228] rounded-lg border border-gray-700 hover:border-gray-500 transition overflow-hidden h-28 flex items-center"
              >
                {list.portadas && list.portadas.length > 0 && (
                  <div className="flex -space-x-8 h-full flex-shrink-0 pl-1">
                    {list.portadas.map((src: string, i: number) => (
                      <img
                        key={i}
                        src={src}
                        alt=""
                        className="h-full aspect-[2/3] object-cover rounded border-2 border-[#1c2228] shadow-lg"
                        style={{ zIndex: list.portadas.length - i }}
                      />
                    ))}
                  </div>
                )}

                <div className="flex flex-col justify-between h-full flex-grow min-w-0 items-end text-right p-4">
                  <h2 className="font-bold text-white truncate max-w-full">{list.nombre}</h2>
                  <p className="text-xs text-gray-400">
                    {list.totalItems} {list.totalItems === 1 ? 'title' : 'titles'}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}