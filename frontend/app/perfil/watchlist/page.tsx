'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';
import SortDropdown from '@/components/SortDropdown';
import { useSortPreference } from '@/hooks/useSortPreference';
import { OPCIONES_ORDEN_WATCHLIST_DISPONIBLE, ordenarItems, type Selectores } from '@/lib/ordenamiento';

// El backend no devuelve una fecha de "añadido a watchlist" en cada item,
// pero SÍ entrega el array ya ordenado (primero añadido → último añadido).
// Por eso "fechaAgregado" se resuelve aquí con la posición original en ese
// array, no con un campo propio del item.
const selectoresWatchlist: Selectores<any> = {
  nombre: (i) => i.titulo,
  fechaEstreno: (i) => i.anio,
  fechaAgregado: (i) => i.__ordenOriginal,
};

export default function Watchlist() {
  const [items, setItems] = useState<any[]>([]);
  const [logueado, setLogueado] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setLogueado(true);

    fetch('http://localhost:3001/media/watchlist', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then((data) => {
        // guardamos la posición original antes de que se pueda reordenar
        const conIndice = data.map((item: any, i: number) => ({ ...item, __ordenOriginal: i }));
        setItems(conIndice);
      })
      .catch(() => {});
  }, []);

  // Igual que en el backend hoy: por defecto, primero añadido → último añadido
  const { valor: orden, setValor: setOrden, cargado: ordenCargado } = useSortPreference('watchlist', {
    campo: 'fechaAgregado',
    direccion: 'ASC',
  });
  const itemsOrdenados = ordenCargado ? ordenarItems(items, orden, selectoresWatchlist) : items;

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-extrabold">Mi Watchlist</h1>
          {logueado && items.length > 0 && (
            <SortDropdown opciones={OPCIONES_ORDEN_WATCHLIST_DISPONIBLE} valor={orden} onChange={setOrden} />
          )}
        </div>

        {!logueado ? (
          <p className="text-gray-400 text-sm">
            <Link href="/login" className="underline text-blue-400">Inicia sesión</Link> para ver tu watchlist.
          </p>
        ) : items.length === 0 ? (
          <p className="text-gray-500 text-sm">Tu watchlist está vacía.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {itemsOrdenados.map((item) => (
              <Link key={item.id} href={urlFicha(item)} className="group relative block">
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