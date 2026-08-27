'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import StarRating from '@/components/StarRating';
import { urlFicha } from '@/lib/slug';
import SortDropdown from '@/components/SortDropdown';
import { useSortPreference } from '@/hooks/useSortPreference';
import { OPCIONES_ORDEN_JUEGOS_DISPONIBLE, ordenarItems, type Selectores } from '@/lib/ordenamiento';

const API_URL = 'http://localhost:3001';

const selectoresJuegos: Selectores<any> = {
  nombre: (i) => i.titulo,
  fechaLanzamiento: (i) => i.anio,
  miNota: (i) => i.rating,
};

export default function JuegosDeUsuario() {
  const params = useParams();
  const username = params.username as string;

  const [items, setItems] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [esPrivado, setEsPrivado] = useState(false);

  useEffect(() => {
    if (!username) return;

    const token = localStorage.getItem('token');

    fetch(`${API_URL}/users/${encodeURIComponent(username)}/watched?tipo=VIDEOJUEGO`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
    })
      .then((res) => {
        if (res.status === 403) {
          setEsPrivado(true);
          throw new Error('private');
        }
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then(setItems)
      .catch((err) => {
        if (err.message !== 'private') setNoEncontrado(true);
      })
      .finally(() => setCargando(false));
  }, [username]);

  const { valor: orden, setValor: setOrden, cargado: ordenCargado } = useSortPreference('user-played', {
    campo: 'fechaLanzamiento',
    direccion: 'DESC',
  });
  const itemsOrdenados = ordenCargado ? ordenarItems(items, orden, selectoresJuegos) : items;

  if (cargando) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">Loading...</main>;
  }

  if (noEncontrado) {
    return <main className="min-h-screen bg-[#14181c] text-white flex items-center justify-center">User not found</main>;
  }

  if (esPrivado) {
    return (
      <main className="min-h-screen bg-[#14181c] text-white flex flex-col items-center justify-center gap-2">
        <span className="text-3xl">🔒</span>
        <p className="text-gray-300 font-semibold">This account is private</p>
        <Link href={`/user/${username}`} className="text-sm text-gray-500 hover:underline">
          Back to {username}'s profile
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-extrabold">Played</h1>
          {items.length > 0 && (
            <SortDropdown opciones={OPCIONES_ORDEN_JUEGOS_DISPONIBLE} valor={orden} onChange={setOrden} />
          )}
        </div>
        <p className="text-sm text-gray-400 mb-6">
          <Link href={`/user/${username}`} className="hover:underline">{username}</Link>
        </p>

        {items.length === 0 ? (
          <p className="text-gray-500 text-sm">{username} hasn't marked any games as played yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {itemsOrdenados.map((item) => (
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