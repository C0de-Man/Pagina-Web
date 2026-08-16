'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { generarSlug } from '@/lib/slug';

export default function Home() {
  const [mediaList, setMediaList] = useState<any[]>([]);
  const [logueado, setLogueado] = useState(false);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setCargando(false);
      return;
    }
    setLogueado(true);
    fetch('http://localhost:3001/media/mine', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setMediaList(data);
        } else {
          console.error('Respuesta inesperada de /media/mine:', data);
          setMediaList([]);
        }
      })
      .catch((err) => {
        console.error('Error al pedir /media/mine:', err);
        setMediaList([]);
      })
      .finally(() => setCargando(false));
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center text-emerald-400">
          Mi Catálogo
        </h1>

        {cargando ? (
          <p className="text-center text-gray-500">Cargando...</p>
        ) : !logueado ? (
          <p className="text-center text-gray-400">
            <Link href="/login" className="underline text-blue-400">Inicia sesión</Link> para ver tu catálogo.
          </p>
        ) : mediaList.length === 0 ? (
          <p className="text-center text-gray-500">
            Aún no has marcado nada como visto, en watchlist, con like, con nota, ni añadido a ninguna lista.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {mediaList.map((media: any) => (
              <Link
                href={`/peliculas/${generarSlug(media.titulo, media.anio, media.id)}`}
                key={media.id}
                className="bg-gray-900 rounded-lg overflow-hidden shadow-xl transition-transform hover:scale-105 border border-gray-800 block cursor-pointer"
              >
                {media.portada ? (
                  <img
                    src={media.portada}
                    alt={media.titulo}
                    className="w-full aspect-[2/3] object-cover"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] bg-gray-800 flex items-center justify-center text-gray-500">
                    Sin imagen
                  </div>
                )}

                <div className="p-4">
                  <h2 className="font-bold text-lg truncate" title={media.titulo}>
                    {media.titulo}
                  </h2>
                  <div className="flex justify-between items-center mt-2 text-sm text-gray-400">
                    <span>{media.anio}</span>
                    <span className="bg-gray-800 px-2 py-1 rounded-md text-xs border border-gray-700">
                      {media.tipo}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}