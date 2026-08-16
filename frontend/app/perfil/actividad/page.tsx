'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function Actividad() {
  const [vistas, setVistas] = useState<any[]>([]);
  const [logueado, setLogueado] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLogueado(true);

    fetch('http://localhost:3001/media/watched', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then(setVistas) // ya viene ordenado desde el backend: más reciente primero
      .catch(() => {});
  }, []);

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-extrabold mb-6">Actividad reciente</h1>

        {!logueado ? (
          <p className="text-gray-400 text-sm">
            <Link href="/login" className="underline text-blue-400">Inicia sesión</Link> para ver tu actividad.
          </p>
        ) : vistas.length === 0 ? (
          <p className="text-gray-500 text-sm">Aún no has marcado nada como visto.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {vistas.map((item) => (
              <Link key={item.id} href={`/movie/${generarSlug(item.titulo, item.anio, item.id)}`} className="group relative block">
                {item.portada ? (
                  <img
                    src={item.portada}
                    alt={item.titulo}
                    className="w-full aspect-[2/3] object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition shadow-lg"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2">
                    {item.titulo}
                  </div>
                )}
                <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2">
                  <p className="text-sm font-bold text-white">
                    {item.titulo} <span className="font-normal text-gray-300">({item.anio})</span>
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