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

// Pastillas de filtro por tipo, en el mismo espíritu que Watching/Watched/
// Paused/Abandoned de la página de Watched. "todos" siempre va primero y no
// lleva color propio (es el estado por defecto, sin filtrar).
const TIPOS_FILTRO: { tipo: string; label: string; color: string }[] = [
  { tipo: 'PELICULA', label: 'Movies', color: 'bg-blue-900/40 text-blue-300' },
  { tipo: 'SERIE', label: 'Series', color: 'bg-purple-900/40 text-purple-300' },
  { tipo: 'VIDEOJUEGO', label: 'Games', color: 'bg-green-900/40 text-green-300' },
  { tipo: 'LIBRO', label: 'Books', color: 'bg-orange-900/40 text-orange-300' },
];

export default function Watchlist() {
  const [items, setItems] = useState<any[]>([]);
  const [logueado, setLogueado] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);

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

  // Solo mostramos pastillas de los tipos que de verdad tienen algo en la
  // watchlist — así no aparece "Books" vacío si nunca has añadido ninguno.
  const tiposConContenido = TIPOS_FILTRO
    .map((t) => ({ ...t, count: items.filter((i) => i.tipo === t.tipo).length }))
    .filter((t) => t.count > 0);

  const itemsFiltrados = filtroTipo ? items.filter((i) => i.tipo === filtroTipo) : items;
  const itemsOrdenados = ordenCargado ? ordenarItems(itemsFiltrados, orden, selectoresWatchlist) : itemsFiltrados;

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-extrabold">Mi Watchlist</h1>
          {logueado && items.length > 0 && (
            <SortDropdown opciones={OPCIONES_ORDEN_WATCHLIST_DISPONIBLE} valor={orden} onChange={setOrden} />
          )}
        </div>

        {logueado && tiposConContenido.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {tiposConContenido.map((t) => (
              <button
                key={t.tipo}
                onClick={() => setFiltroTipo(filtroTipo === t.tipo ? null : t.tipo)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold transition cursor-pointer ${
                  filtroTipo === t.tipo ? `${t.color} ring-1 ring-white/30` : `${t.color} opacity-60 hover:opacity-100`
                }`}
              >
                {t.label}
                <span className="bg-black/30 rounded-full px-1.5 py-0.5 text-xs">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {!logueado ? (
          <p className="text-gray-400 text-sm">
            <Link href="/login" className="underline text-blue-400">Inicia sesión</Link> para ver tu watchlist.
          </p>
        ) : items.length === 0 ? (
          <p className="text-gray-500 text-sm">Tu watchlist está vacía.</p>
        ) : itemsOrdenados.length === 0 ? (
          <p className="text-gray-500 text-sm">No tienes nada de este tipo en la watchlist.</p>
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