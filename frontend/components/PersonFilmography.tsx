'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { urlFicha } from '@/lib/slug';

interface CreditoPersona {
  tmdbId: number;
  tipo: 'PELICULA' | 'SERIE';
  titulo: string;
  posterPath: string | null;
  fecha: string | null;
  rol: string;
}

interface DatosLocales {
  [clave: string]: { dbId: number; portada: string | null };
}

export default function PersonFilmography({
  porRol,
  localesPorClave,
}: {
  porRol: Record<string, CreditoPersona[]>;
  localesPorClave: DatosLocales;
}) {
  // localesPorClave llega calculado en el servidor (sin token), así que su
  // "portada" es siempre la compartida, nunca tu personalización. Aquí, ya
  // en el navegador, pedimos DE UNA VEZ la personalización de todos los
  // títulos que ya tienes guardados (en vez de uno a uno como MovieCard,
  // que aquí serían decenas de peticiones para una filmografía larga).
  const [personalizaciones, setPersonalizaciones] = useState<
    Record<number, { customPoster: string | null; customBackdrop: string | null }>
  >({});

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const dbIds = Object.values(localesPorClave)
      .map((l) => l.dbId)
      .filter(Boolean);
    if (dbIds.length === 0) return;

    fetch(`http://localhost:3001/media/personalizaciones?ids=${dbIds.join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((res) => res.json())
      .then(setPersonalizaciones)
      .catch(() => {});
  }, [localesPorClave]);

  // Ocultamos series de raíz (por ahora no se muestran en ningún sitio de la
  // app): se filtran ANTES de agrupar por rol, así ni cuentan en el número
  // de créditos de cada pestaña ni aparecen en ninguna lista.
  const porRolSinSeries = Object.fromEntries(
    Object.entries(porRol).map(([rol, items]) => [rol, items.filter((i) => i.tipo !== 'SERIE')])
  );

  // Pestañas ordenadas por número de créditos, de más a menos (igual que en
  // la captura de referencia: Director 13, Writer 10, Producer 9...).
  // Solo se muestran los roles de esta lista (a petición explícita) — con
  // gente que tiene muchísimos roles distintos (guionista, storyboard,
  // maquillaje FX...) es más simple decir qué SÍ se ve que ir excluyendo uno
  // a uno.
  const ROLES_PERMITIDOS = ['Actor', 'Director', 'Writer'];
  const roles = Object.entries(porRolSinSeries)
    .filter(([rol, items]) => items.length > 0 && ROLES_PERMITIDOS.includes(rol))
    .sort((a, b) => b[1].length - a[1].length);

  const [rolActivo, setRolActivo] = useState(roles[0]?.[0] || '');

  const items = porRolSinSeries[rolActivo] || [];

  return (
    <div>
      <div className="flex flex-wrap gap-x-1 gap-y-2 mb-6 border-b border-gray-800 pb-3">
        {roles.map(([rol, lista]) => (
          <button
            key={rol}
            onClick={() => setRolActivo(rol)}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition cursor-pointer ${
              rolActivo === rol ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {rol} <span className="text-gray-500">{lista.length}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
        {items.map((item) => {
          const clave = `${item.tipo}-${item.tmdbId}`;
          const local = localesPorClave[clave];
          const miPersonalizacion = local ? personalizaciones[local.dbId] : undefined;
          const posterUrl =
            miPersonalizacion?.customPoster ||
            local?.portada ||
            (item.posterPath ? `https://image.tmdb.org/t/p/w300${item.posterPath}` : null);
          const href = local
            ? urlFicha({ id: local.dbId, titulo: item.titulo, tipo: item.tipo })
            : `/movie/tmdb/${item.tmdbId}${item.tipo === 'SERIE' ? '?tipo=SERIE' : ''}`;
          const anio = item.fecha ? item.fecha.split('-')[0] : '';

          return (
            <Link key={clave} href={href} className="group relative block">
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt={item.titulo}
                  className="w-full aspect-[2/3] object-cover rounded-md border border-gray-700 group-hover:border-gray-400 transition shadow-lg"
                />
              ) : (
                <div className="w-full aspect-[2/3] bg-gray-800 rounded-md border border-gray-700 flex items-center justify-center text-xs text-center p-2">
                  {item.titulo}
                </div>
              )}
              <div className="absolute inset-0 rounded-md bg-black/90 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-center p-2 pointer-events-none">
                <p className="text-sm font-bold text-white">
                  {item.titulo} <span className="font-normal text-gray-300">({anio})</span>
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {items.length === 0 && <p className="text-gray-500 text-sm">Sin créditos en esta categoría.</p>}
    </div>
  );
}