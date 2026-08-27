'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import StarRating from '@/components/StarRating';
import { urlFicha } from '@/lib/slug';
import SortDropdown from '@/components/SortDropdown';
import { useSortPreference } from '@/hooks/useSortPreference';
import { OPCIONES_ORDEN_WATCHED_DISPONIBLE, ordenarItems, type Selectores } from '@/lib/ordenamiento';

const selectoresPeliculas: Selectores<any> = {
  nombre: (i) => i.titulo,
  fechaEstreno: (i) => i.anio,
  miNota: (i) => i.rating,
};

export default function MisPeliculas() {
  const [peliculas, setPeliculas] = useState<any[]>([]);
  const [logueado, setLogueado] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLogueado(true);

    fetch('http://localhost:3001/media/watched', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => {
        const soloPeliculas = data.filter((m: any) => m.tipo === 'PELICULA');
        setPeliculas(soloPeliculas);
      })
      .catch(() => {});
  }, []);

  const { valor: orden, setValor: setOrden, cargado: ordenCargado } = useSortPreference('watched', {
    campo: 'fechaEstreno',
    direccion: 'DESC',
  });
  const peliculasOrdenadas = ordenCargado
    ? ordenarItems(peliculas, orden, selectoresPeliculas)
    : peliculas;

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-extrabold">Watched</h1>
          {logueado && peliculas.length > 0 && (
            <SortDropdown opciones={OPCIONES_ORDEN_WATCHED_DISPONIBLE} valor={orden} onChange={setOrden} />
          )}
        </div>

        {!logueado ? (
          <p className="text-gray-400 text-sm">
            <Link href="/login" className="underline text-blue-400">Sign in</Link> to see your movies.
          </p>
        ) : peliculas.length === 0 ? (
          <p className="text-gray-500 text-sm">You haven't marked any movies as watched yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {peliculasOrdenadas.map((item) => (
              <div key={item.id} className="flex flex-col gap-1.5">
                <Link href={urlFicha(item)} className="group relative block">
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

                {(item.rating > 0 || item.liked) && (
                  <div className="flex items-center gap-1.5 px-0.5">
                    {item.rating > 0 && <StarRating value={item.rating} readOnly size="sm" />}
                    {item.liked && <span className="text-sm">❤️</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}