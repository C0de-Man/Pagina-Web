'use client';
import { useState } from 'react';
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
  // Pestañas ordenadas por número de créditos, de más a menos (igual que en
  // la captura de referencia: Director 13, Writer 10, Producer 9...).
  const roles = Object.entries(porRol)
    .filter(([, items]) => items.length > 0)
    .sort((a, b) => b[1].length - a[1].length);

  const [rolActivo, setRolActivo] = useState(roles[0]?.[0] || '');

  const items = porRol[rolActivo] || [];

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
          const posterUrl =
            local?.portada || (item.posterPath ? `https://image.tmdb.org/t/p/w300${item.posterPath}` : null);
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