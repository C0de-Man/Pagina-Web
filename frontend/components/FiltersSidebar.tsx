'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

const CATEGORIAS = [
  { id: 0, label: 'Main Game' },
  { id: 10, label: 'Expanded Game' },
  { id: 4, label: 'Standalone Expansion' },
  { id: 8, label: 'Remake' },
  { id: 9, label: 'Remaster' },
  { id: 11, label: 'Port' },
];

// Desplegable con buscador: escribes y la lista se filtra al vuelo.
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

export default function FiltersSidebar({
  generos,
  plataformas,
}: {
  generos: { id: number; name: string }[];
  plataformas: { id: number; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const catsIniciales = (searchParams.get('categorias') || '')
    .split(',')
    .filter(Boolean)
    .map(Number);

  const [categorias, setCategorias] = useState<number[]>(catsIniciales);
  const [estado, setEstado] = useState(searchParams.get('estado') || '');
  const [anio, setAnio] = useState(searchParams.get('anio') || '');
  const [genero, setGenero] = useState(searchParams.get('genero') || '');
  const [plataforma, setPlataforma] = useState(searchParams.get('plataforma') || '');
  const [orden, setOrden] = useState(searchParams.get('orden') || 'desc');
  const [ratingMin, setRatingMin] = useState(Number(searchParams.get('ratingMin') || 0));
  const [ratingMax, setRatingMax] = useState(Number(searchParams.get('ratingMax') || 5));

  const toggleCategoria = (id: number) => {
    setCategorias((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const aplicarFiltros = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', '1');

    if (categorias.length > 0) params.set('categorias', categorias.join(',')); else params.delete('categorias');
    if (estado) params.set('estado', estado); else params.delete('estado');
    if (anio) params.set('anio', anio); else params.delete('anio');
    if (genero) params.set('genero', genero); else params.delete('genero');
    if (plataforma) params.set('plataforma', plataforma); else params.delete('plataforma');
    if (orden === 'asc') params.set('orden', 'asc'); else params.delete('orden');
    if (ratingMin > 0) params.set('ratingMin', String(ratingMin)); else params.delete('ratingMin');
    if (ratingMax < 5) params.set('ratingMax', String(ratingMax)); else params.delete('ratingMax');

    router.push(`${pathname}?${params.toString()}`);
  };

  const resetearFiltros = () => {
    setCategorias([]);
    setEstado('');
    setAnio('');
    setGenero('');
    setPlataforma('');
    setOrden('desc');
    setRatingMin(0);
    setRatingMax(5);

    const params = new URLSearchParams(searchParams.toString());
    ['categorias', 'estado', 'anio', 'genero', 'plataforma', 'orden', 'ratingMin', 'ratingMax'].forEach((k) => params.delete(k));
    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <aside className="w-full lg:w-64 flex-shrink-0 bg-[#1c2228] border border-gray-800 rounded-lg p-4 h-fit space-y-6">
      <div>
        <p className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Categories</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIAS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleCategoria(c.id)}
              className={`text-xs px-2 py-1 rounded border transition cursor-pointer ${
                categorias.includes(c.id)
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-[#2c3440] border-gray-700 text-gray-300 hover:border-gray-500'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

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

      <ComboboxFiltro
        label="Genre"
        placeholder="Choose a genre"
        opciones={generos}
        valor={genero}
        onChange={setGenero}
      />

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