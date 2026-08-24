'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

// Selector de año en cuadrícula de década, con flechas para moverte de 10 en 10.
// Calcado del YearPicker de FiltersSidebar.tsx (juegos).
function YearPicker({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const anioActual = new Date().getFullYear();
  const [abierto, setAbierto] = useState(false);
  const [decadaInicio, setDecadaInicio] = useState(() => {
    const base = valor ? parseInt(valor) : anioActual;
    return Math.floor(base / 10) * 10;
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const handleClickFuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', handleClickFuera);
    return () => document.removeEventListener('mousedown', handleClickFuera);
  }, [abierto]);

  const anios = Array.from({ length: 12 }, (_, i) => decadaInicio - 1 + i);

  const seleccionarAnio = (anio: number) => {
    onChange(String(anio));
    setAbierto(false);
  };

  return (
    <div ref={ref} className="relative">
      <p className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Year</p>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex justify-between items-center bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-gray-500 cursor-pointer"
      >
        <span className={valor ? 'text-white' : 'text-gray-500'}>{valor || String(anioActual)}</span>
        <span className="text-gray-500 text-xs">{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1 w-full bg-[#1c2228] border border-gray-700 rounded shadow-2xl p-3">
          <div className="flex justify-between items-center mb-3">
            <button
              type="button"
              onClick={() => setDecadaInicio((d) => d - 10)}
              className="text-gray-400 hover:text-white text-lg px-2 cursor-pointer"
            >
              ‹
            </button>
            <span className="text-sm font-bold text-white">{decadaInicio} - {decadaInicio + 9}</span>
            <button
              type="button"
              onClick={() => setDecadaInicio((d) => d + 10)}
              className="text-gray-400 hover:text-white text-lg px-2 cursor-pointer"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {anios.map((anio) => {
              const fueraDeDecada = anio < decadaInicio || anio > decadaInicio + 9;
              const esSeleccionado = String(anio) === valor;
              const esActual = anio === anioActual && !esSeleccionado;
              return (
                <button
                  key={anio}
                  type="button"
                  onClick={() => seleccionarAnio(anio)}
                  className={`text-sm py-2 rounded transition cursor-pointer ${
                    esSeleccionado
                      ? 'bg-pink-600 text-white font-bold'
                      : fueraDeDecada
                      ? 'text-gray-600 hover:bg-gray-700'
                      : esActual
                      ? 'text-blue-400 font-bold hover:bg-gray-700'
                      : 'text-gray-200 hover:bg-gray-700'
                  }`}
                >
                  {anio}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const DURACIONES = [
  { valor: 'corta', label: 'Short', hint: '<90 min' },
  { valor: 'media', label: 'Medium', hint: '90–150 min' },
  { valor: 'larga', label: 'Long', hint: '>150 min' },
];

export default function MovieFiltersSidebar({ currentYear }: { currentYear: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [anio, setAnio] = useState(searchParams.get('anio') || String(currentYear));
  const [duracion, setDuracion] = useState(searchParams.get('duracion') || '');
  const [orden, setOrden] = useState(searchParams.get('orden') || 'desc');
  const [ratingMin, setRatingMin] = useState(Number(searchParams.get('ratingMin') || 0));
  const [ratingMax, setRatingMax] = useState(Number(searchParams.get('ratingMax') || 10));

  const aplicarFiltros = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', '1');

    if (anio && anio !== String(currentYear)) params.set('anio', anio); else params.delete('anio');
    if (duracion) params.set('duracion', duracion); else params.delete('duracion');
    if (orden === 'asc') params.set('orden', 'asc'); else params.delete('orden');
    if (ratingMin > 0) params.set('ratingMin', String(ratingMin)); else params.delete('ratingMin');
    if (ratingMax < 10) params.set('ratingMax', String(ratingMax)); else params.delete('ratingMax');

    router.push(`${pathname}?${params.toString()}`);
  };

  const resetearFiltros = () => {
    setAnio(String(currentYear));
    setDuracion('');
    setOrden('desc');
    setRatingMin(0);
    setRatingMax(10);

    const params = new URLSearchParams(searchParams.toString());
    ['anio', 'duracion', 'orden', 'ratingMin', 'ratingMax'].forEach((k) => params.delete(k));
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <aside className="w-full lg:w-64 flex-shrink-0 bg-[#1c2228] border border-gray-800 rounded-lg p-4 h-fit space-y-6">
      <YearPicker valor={anio} onChange={setAnio} />

      <div>
        <p className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Popularity</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setOrden('desc')}
            className={`text-xs px-3 py-2 rounded border text-left transition cursor-pointer ${
              orden === 'desc'
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-[#2c3440] border-gray-700 text-gray-300 hover:border-gray-500'
            }`}
          >
            Most popular first
          </button>
          <button
            type="button"
            onClick={() => setOrden('asc')}
            className={`text-xs px-3 py-2 rounded border text-left transition cursor-pointer ${
              orden === 'asc'
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-[#2c3440] border-gray-700 text-gray-300 hover:border-gray-500'
            }`}
          >
            Least popular first
          </button>
        </div>
      </div>

      <div>
        <p className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Duration</p>
        <div className="flex flex-col gap-2">
          {DURACIONES.map((d) => (
            <button
              key={d.valor}
              type="button"
              onClick={() => setDuracion(duracion === d.valor ? '' : d.valor)}
              className={`flex justify-between items-center text-xs px-3 py-2 rounded border transition cursor-pointer ${
                duracion === d.valor
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-[#2c3440] border-gray-700 text-gray-300 hover:border-gray-500'
              }`}
            >
              <span className="font-semibold">{d.label}</span>
              <span className={duracion === d.valor ? 'text-blue-200' : 'text-gray-500'}>{d.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">
          Rating <span className="text-gray-500 font-normal normal-case">{ratingMin.toFixed(1)} - {ratingMax.toFixed(1)}</span>
        </p>
        <div className="space-y-2">
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={ratingMin}
            onChange={(e) => setRatingMin(Math.min(Number(e.target.value), ratingMax))}
            className="w-full accent-pink-500"
          />
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={ratingMax}
            onChange={(e) => setRatingMax(Math.max(Number(e.target.value), ratingMin))}
            className="w-full accent-pink-500"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={resetearFiltros}
          title="Reset filters"
          className="bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold px-4 py-2 rounded transition cursor-pointer"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={aplicarFiltros}
          className="flex-1 bg-pink-600 hover:bg-pink-500 text-white text-sm font-bold py-2 rounded transition cursor-pointer"
        >
          Update filters
        </button>
      </div>
    </aside>
  );
}