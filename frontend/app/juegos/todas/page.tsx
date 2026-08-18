import GameCard from '@/components/GameCard';
import FiltersSidebar from '@/components/FiltersSidebar';
import Link from 'next/link';

export default async function TodosLosJuegos({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    tipo?: string;
    categorias?: string;
    estado?: string;
    anio?: string;
    genero?: string;
    plataforma?: string;
    ratingMin?: string;
    ratingMax?: string;
  }>;
}) {
  const currentYear = new Date().getFullYear();

  const resolvedParams = await searchParams;
  const currentPage = parseInt(resolvedParams.page || '1');
  const esPopulares = resolvedParams.tipo === 'popular';

  // Querystring con TODOS los filtros activos: se reenvía al backend y también
  // se usa para no perderlos al pasar de página con los botones laterales
  const filtros = new URLSearchParams();
  if (resolvedParams.tipo) filtros.set('tipo', resolvedParams.tipo);
  if (resolvedParams.categorias) filtros.set('categorias', resolvedParams.categorias);
  if (resolvedParams.estado) filtros.set('estado', resolvedParams.estado);
  if (resolvedParams.anio) filtros.set('anio', resolvedParams.anio);
  if (resolvedParams.genero) filtros.set('genero', resolvedParams.genero);
  if (resolvedParams.plataforma) filtros.set('plataforma', resolvedParams.plataforma);
  if (resolvedParams.ratingMin) filtros.set('ratingMin', resolvedParams.ratingMin);
  if (resolvedParams.ratingMax) filtros.set('ratingMax', resolvedParams.ratingMax);

  const modo = esPopulares ? 'popular' : 'year';
  const paramsBackend = new URLSearchParams(filtros);
  paramsBackend.set('modo', modo);
  // Si no han elegido año/estado propios en el sidebar, seguimos usando el año
  // actual por defecto tal y como hacía antes la pestaña "Juegos {currentYear}"
  if (!resolvedParams.anio && !resolvedParams.estado && modo === 'year') {
    paramsBackend.set('anio', String(currentYear));
  }

  const res = await fetch(`http://localhost:3001/igdb/catalogo/page/${currentPage}?${paramsBackend.toString()}`, { cache: 'no-store' });
  const data = await res.json();
  const juegos = data.results || [];

  // TU base de datos local
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  const getLocalData = (igdbId: number) => {
    const local = myDb.find((m: any) => m.igdbId === igdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: local ? local.portada : null
    };
  };

  // Listas para los desplegables del sidebar
  const resFiltros = await fetch('http://localhost:3001/igdb/filtros', { cache: 'no-store' });
  const { generos, plataformas } = await resFiltros.json();

  const sufijoTipo = filtros.toString() ? `&${filtros.toString()}` : '';

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10 relative">

      {/* BOTÓN LATERAL IZQUIERDO */}
      {currentPage > 1 && (
        <Link
          href={`/juegos/todas?page=${currentPage - 1}${sufijoTipo}`}
          className="fixed left-4 top-1/2 -translate-y-1/2 bg-gray-900/80 hover:bg-gray-700 text-white w-14 h-14 rounded-full border border-gray-600 z-50 transition hidden lg:flex items-center justify-center shadow-2xl cursor-pointer"
        >
          <span className="text-4xl leading-none pb-1 pr-1">‹</span>
        </Link>
      )}

      {/* BOTÓN LATERAL DERECHO */}
      <Link
        href={`/juegos/todas?page=${currentPage + 1}${sufijoTipo}`}
        className="fixed right-4 top-1/2 -translate-y-1/2 bg-gray-900/80 hover:bg-gray-700 text-white w-14 h-14 rounded-full border border-gray-600 z-50 transition hidden lg:flex items-center justify-center shadow-2xl cursor-pointer"
      >
        <span className="text-4xl leading-none pb-1 pl-1">›</span>
      </Link>

      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">

        <div className="border-b border-gray-800 pb-4 mb-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-wide">
            {esPopulares ? 'Populares' : `Juegos ${currentYear}`}
            <span className="text-sm font-normal text-gray-500 ml-3 bg-gray-900 px-2 py-1 rounded">Pág. {currentPage}</span>
          </h1>
          <span className="text-sm text-gray-500 font-semibold">Mostrando {juegos.length} títulos</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <FiltersSidebar generos={generos || []} plataformas={plataformas || []} />

          {/* CUADRÍCULA */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 pt-2 flex-grow">
            {juegos.map((juego: any) => {
              const { dbId, customPoster } = getLocalData(juego.id);
              return (
                <div key={`all-${juego.id}`} className="w-full">
                  <GameCard
                    juego={juego}
                    dbId={dbId}
                    customPoster={customPoster}
                  />
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </main>
  );
}