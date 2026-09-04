'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import GameCard from '@/components/GameCard';
import YearGamesCarousel from '@/components/YearGamesCarousel';
import SearchFiltersSidebar, { FiltrosBusqueda, FILTROS_VACIOS } from '@/components/SearchFiltersSidebar';

export default function JuegosLobbyClient({
  currentYear,
  yearGamesConDatos,
  popularConDatos,
}: {
  currentYear: number;
  yearGamesConDatos: { juego: any; dbId: number | null; customPoster: string | null }[];
  popularConDatos: { juego: any; dbId: number | null; customPoster: string | null }[];
}) {
  const CATEGORIAS_FILTRO: { clave: string; etiqueta: string }[] = [
    { clave: 'dlc', etiqueta: 'DLCs & Expansions' },
    { clave: 'bundle', etiqueta: 'Bundles & Packs' },
    { clave: 'remaster', etiqueta: 'Remasters & Enhanced Editions' },
    { clave: 'edition', etiqueta: 'Editions / SKUs' },
    { clave: 'port', etiqueta: 'Ports' },
    { clave: 'mod', etiqueta: 'Mods' },
    { clave: 'update', etiqueta: 'Updates' },
    { clave: 'episode', etiqueta: 'Episodes & Seasons' },
  ];

  const [query, setQuery] = useState('');
  // Vacío por defecto = comportamiento de siempre (solo juegos base). Cada
  // categoría marcada aquí se SUMA al resultado, sin afectar a las demás —
  // se pueden combinar como se quiera, en vez de un interruptor "todo o nada".
  const [categoriasActivas, setCategoriasActivas] = useState<Set<string>>(new Set());
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [resultados, setResultados] = useState<any[]>([]);
  const [myDb, setMyDb] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscadoYa, setBuscadoYa] = useState(false);

  // Filtros del sidebar (Categories/Release year/Popularity/Genre/Platform/
  // Rating — mismo panel que /game/all, pero controlado en vez de por URL).
  const [filtrosSidebar, setFiltrosSidebar] = useState<FiltrosBusqueda>(FILTROS_VACIOS);
  const [plataformas, setPlataformas] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    fetch('http://localhost:3001/igdb/filtros')
      .then((r) => r.json())
      .then((data) => {
        setPlataformas(data.plataformas || []);
      })
      .catch((error) => console.error('Error al cargar plataformas:', error));
  }, []);

  const alternarCategoria = (clave: string) => {
    setCategoriasActivas((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return nuevo;
    });
  };

  // /media no lleva token (esta búsqueda va sin auth) y su "portada" es la
  // compartida, no tu personalización — solo usamos esto para saber si el
  // título ya está guardado (dbId). GameCard comprueba tu portada real por
  // su cuenta, en el navegador, con tu token.
  const getLocalData = (igdbId: number) => {
    const local = myDb.find((m: any) => m.igdbId === igdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: null,
    };
  };

  const ejecutarBusqueda = async (q: string, filtros: FiltrosBusqueda) => {
    if (!q.trim()) return;
    setBuscando(true);
    setBuscadoYa(true);
    try {
      const params = new URLSearchParams();
      params.set('q', q);

      const incluir = Array.from(categoriasActivas).join(',');
      if (incluir) params.set('incluir', incluir);

      if (filtros.estado) params.set('estado', filtros.estado);
      if (filtros.anio) params.set('anio', filtros.anio);
      if (filtros.plataforma) params.set('plataforma', filtros.plataforma);
      if (filtros.ratingMin > 0) params.set('ratingMin', String(filtros.ratingMin));
      if (filtros.ratingMax < 5) params.set('ratingMax', String(filtros.ratingMax));

      const [resJuegos, resDb] = await Promise.all([
        fetch(`http://localhost:3001/igdb/search?${params.toString()}`),
        fetch('http://localhost:3001/media'),
      ]);
      const juegos = await resJuegos.json();
      const db = await resDb.json();
      const juegosUnicos = Array.isArray(juegos)
        ? Array.from(new Map(juegos.map((j: any) => [j.id, j])).values())
        : [];
      setResultados(juegosUnicos);
      setMyDb(db);
    } catch (error) {
      console.error('Error al buscar juegos:', error);
      setResultados([]);
    }
    setBuscando(false);
  };

  const buscar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || buscando) return;
    await ejecutarBusqueda(query, filtrosSidebar);
  };

  // Se llama desde el sidebar al pulsar "Update filters" o el botón de
  // resetear. Si ya hay una búsqueda en marcha, se re-ejecuta al momento con
  // los filtros nuevos; si no, solo se guardan para la próxima búsqueda.
  const aplicarFiltrosSidebar = (filtros: FiltrosBusqueda) => {
    setFiltrosSidebar(filtros);
    if (query.trim()) ejecutarBusqueda(query, filtros);
  };

  const limpiarBusqueda = () => {
    setQuery('');
    setResultados([]);
    setBuscadoYa(false);
  };

  return (
    <>
      <form onSubmit={buscar} className="flex flex-wrap gap-2 mb-6 max-w-2xl relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a game..."
          className="flex-grow bg-[#2c3440] text-white text-sm rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-500"
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setFiltrosAbiertos((v) => !v)}
            className="bg-[#2c3440] hover:bg-[#3a4552] text-white text-sm rounded px-3 py-2 transition cursor-pointer whitespace-nowrap"
          >
            Filters{categoriasActivas.size > 0 ? ` (${categoriasActivas.size})` : ''} ▾
          </button>

          {filtrosAbiertos && (
            <div className="absolute z-20 top-full mt-1 right-0 w-64 bg-[#1c2228] border border-gray-700 rounded-lg shadow-xl p-3">
              <p className="text-xs text-gray-500 mb-2">
                Nothing checked = only base games. Check one or more to see ONLY those categories instead:
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {CATEGORIAS_FILTRO.map((cat) => (
                  <label key={cat.clave} className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer hover:text-white">
                    <input
                      type="checkbox"
                      checked={categoriasActivas.has(cat.clave)}
                      onChange={() => alternarCategoria(cat.clave)}
                      className="cursor-pointer"
                    />
                    {cat.etiqueta}
                  </label>
                ))}
              </div>
              {categoriasActivas.size > 0 && (
                <button
                  type="button"
                  onClick={() => setCategoriasActivas(new Set())}
                  className="mt-2 text-xs text-gray-500 hover:text-white underline cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={buscando}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-bold px-4 rounded transition cursor-pointer"
        >
          {buscando ? 'Searching...' : 'Search'}
        </button>
        {buscadoYa && (
          <button
            type="button"
            onClick={limpiarBusqueda}
            className="text-sm text-gray-400 hover:text-white px-3 rounded border border-gray-700 transition cursor-pointer"
          >
            Back
          </button>
        )}
      </form>

      {buscadoYa ? (
        <div className="flex flex-col lg:flex-row gap-6">
          <SearchFiltersSidebar
            plataformas={plataformas}
            onAplicar={aplicarFiltrosSidebar}
          />

          <div className="flex-grow min-w-0">
            {buscando ? (
              <p className="text-gray-500 text-sm">Searching...</p>
            ) : resultados.length === 0 ? (
              <p className="text-gray-500 text-sm">No games found for "{query}".</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                {resultados.map((juego: any) => {
                  const { dbId, customPoster } = getLocalData(juego.id);
                  return (
                    <GameCard key={juego.id} juego={juego} dbId={dbId} customPoster={customPoster} fullWidth />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-12">
            <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
              <h2 className="text-xl font-bold text-white tracking-wide">Games {currentYear}</h2>
              <Link href="/game/all" className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1 cursor-pointer">
                See all <span className="text-lg leading-none">›</span>
              </Link>
            </div>
            <YearGamesCarousel items={yearGamesConDatos} />
          </div>

          <div className="mb-12">
            <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
              <h2 className="text-xl font-bold text-white tracking-wide">Popular</h2>
              <Link href="/game/all?tipo=popular" className="text-sm text-gray-400 hover:text-white transition flex items-center gap-1 cursor-pointer">
                See all <span className="text-lg leading-none">›</span>
              </Link>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 pt-2" style={{ scrollbarWidth: 'none' }}>
              {popularConDatos.map(({ juego, dbId, customPoster }) => (
                <GameCard key={`pop-${juego.id}`} juego={juego} dbId={dbId} customPoster={customPoster} />
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}