'use client';
import { useState, useEffect, useRef } from 'react';

export interface FiltrosBusqueda {
  estado: string;
  anio: string;
  plataforma: string;
  ratingMin: number;
  ratingMax: number;
}

export const FILTROS_VACIOS: FiltrosBusqueda = {
  estado: '',
  anio: '',
  plataforma: '',
  ratingMin: 0,
  ratingMax: 5,
};

// Desplegable con buscador: escribes y la lista se filtra al vuelo.
// Copia exacta del de FiltersSidebar.tsx (mismo componente, duplicado a
// propósito para no arriesgar ese archivo — ver resumen de sesión).
function ComboboxFiltro({
  label,
  placeholder,
  opciones,
  valor,
  onChange,
}: {
  label: string;
  placeholder: string;
  opciones: { id: number; name: string }[];
  valor: string;
  onChange: (v: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const handleClickFuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', handleClickFuera);
    return () => document.removeEventListener('mousedown', handleClickFuera);
  }, [abierto]);

  const seleccionada = opciones.find((o) => String(o.id) === valor);
  const filtradas = opciones.filter((o) => o.name.toLowerCase().includes(texto.toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <p className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">{label}</p>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex justify-between items-center bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-gray-500 cursor-pointer"
      >
        <span className={seleccionada ? 'text-white' : 'text-gray-500'}>
          {seleccionada ? seleccionada.name : placeholder}
        </span>
        <span className="text-gray-500 text-xs">{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div className="absolute z-20 mt-1 w-full bg-[#1c2228] border border-gray-700 rounded shadow-2xl max-h-64 overflow-hidden flex flex-col">
          <input
            autoFocus
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Search..."
            className="w-full bg-[#2c3440] border-b border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none"
          />
          <div className="overflow-y-auto">
            {valor && (
              <button
                type="button"
                onClick={() => { onChange(''); setTexto(''); setAbierto(false); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-700 cursor-pointer"
              >
                Clear filter
              </button>
            )}
            {filtradas.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-500">No results</p>
            ) : (
              filtradas.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(String(o.id)); setTexto(''); setAbierto(false); }}
                  className={`w-full text-left px-3 py-2 text-sm cursor-pointer hover:bg-gray-700 ${
                    String(o.id) === valor ? 'bg-gray-700 text-white font-semibold' : 'text-gray-200'
                  }`}
                >
                  {o.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Selector de año en cuadrícula de década, con flechas para moverte de 10 en 10.
// Copia exacta del de FiltersSidebar.tsx.
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

  // 12 celdas: un año de antes de la década, los 10 de la década, y uno de después
  const anios = Array.from({ length: 12 }, (_, i) => decadaInicio - 1 + i);

  const seleccionarAnio = (anio: number) => {
    onChange(String(anio));
    setAbierto(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="w-full flex justify-between items-center bg-[#2c3440] border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-gray-500 cursor-pointer"
      >
        <span className={valor ? 'text-white' : 'text-gray-500'}>{valor || 'Choose a year'}</span>
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

          {valor && (
            <button
              type="button"
              onClick={() => { onChange(''); setAbierto(false); }}
              className="w-full text-center text-xs text-gray-400 hover:text-white mt-3 pt-2 border-t border-gray-700 cursor-pointer"
            >
              Clear year
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Versión "controlada" de FiltersSidebar: mismo aspecto y mismos filtros,
// pero sin router.push — el estado vive aquí dentro y se avisa al padre por
// el callback onAplicar cuando se pulsa "Update filters" (o al resetear).
// Pensado para el buscador de juegos, donde los filtros se combinan con el
// término de búsqueda en vez de con la URL.
export default function SearchFiltersSidebar({
  plataformas,
  onAplicar,
}: {
  plataformas: { id: number; name: string }[];
  onAplicar: (filtros: FiltrosBusqueda) => void;
}) {
  const [estado, setEstado] = useState('');
  const [anio, setAnio] = useState('');
  const [plataforma, setPlataforma] = useState('');
  const [ratingMin, setRatingMin] = useState(0);
  const [ratingMax, setRatingMax] = useState(5);

  const aplicarFiltros = () => {
    onAplicar({ estado, anio, plataforma, ratingMin, ratingMax });
  };

  const resetearFiltros = () => {
    setEstado('');
    setAnio('');
    setPlataforma('');
    setRatingMin(0);
    setRatingMax(5);
    onAplicar({ ...FILTROS_VACIOS });
  };

  return (
    <aside className="w-full lg:w-64 flex-shrink-0 bg-[#1c2228] border border-gray-800 rounded-lg p-4 h-fit space-y-6">
      <div>
        <p className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Release year</p>
        <div className="flex gap-2 mb-2">
          <button
            type="button"
            onClick={() => setEstado(estado === 'upcoming' ? '' : 'upcoming')}
            className={`flex-1 text-xs py-2 rounded border transition cursor-pointer ${
              estado === 'upcoming' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#2c3440] border-gray-700 text-gray-300 hover:border-gray-500'
            }`}
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={() => setEstado(estado === 'released' ? '' : 'released')}
            className={`flex-1 text-xs py-2 rounded border transition cursor-pointer ${
              estado === 'released' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[#2c3440] border-gray-700 text-gray-300 hover:border-gray-500'
            }`}
          >
            Released
          </button>
        </div>
        <YearPicker valor={anio} onChange={setAnio} />
      </div>

      <ComboboxFiltro
        label="Platform"
        placeholder="Choose a platform"
        opciones={plataformas}
        valor={plataforma}
        onChange={setPlataforma}
      />

      <div>
        <p className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">
          Rating <span className="text-gray-500 font-normal normal-case">{ratingMin.toFixed(1)} - {ratingMax.toFixed(1)}</span>
        </p>
        <div className="space-y-2">
          <input
            type="range"
            min={0}
            max={5}
            step={0.5}
            value={ratingMin}
            onChange={(e) => setRatingMin(Math.min(Number(e.target.value), ratingMax))}
            className="w-full accent-pink-500"
          />
          <input
            type="range"
            min={0}
            max={5}
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