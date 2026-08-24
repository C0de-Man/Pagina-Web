import GameCard from '@/components/GameCard';
import FiltersSidebar from '@/components/FiltersSidebar';
import Link from 'next/link';

// Calcula qué números de página mostrar en la barra, centrados en la página actual
// (máximo 7 botones, igual que en tu captura).
function getPaginas(actual: number, total: number, maxBotones = 7) {
  if (total <= maxBotones) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  let inicio = Math.max(1, actual - Math.floor(maxBotones / 2));
  let fin = inicio + maxBotones - 1;
  if (fin > total) {
    fin = total;
    inicio = fin - maxBotones + 1;
  }
  return Array.from({ length: fin - inicio + 1 }, (_, i) => inicio + i);
}

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
    orden?: string;
    ratingMin?: string;
    ratingMax?: string;
  }>;
}) {
  const currentYear = new Date().getFullYear();

  const resolvedParams = await searchParams;
  const currentPage = parseInt(resolvedParams.page || '1');
  const esPopulares = resolvedParams.tipo === 'popular';

  // Querystring con TODOS los filtros activos: se reenvía al backend y también
  // se usa para no perderlos al cambiar de página
  const filtros = new URLSearchParams();
  if (resolvedParams.tipo) filtros.set('tipo', resolvedParams.tipo);
  if (resolvedParams.categorias) filtros.set('categorias', resolvedParams.categorias);
  if (resolvedParams.estado) filtros.set('estado', resolvedParams.estado);
  if (resolvedParams.anio) filtros.set('anio', resolvedParams.anio);
  if (resolvedParams.genero) filtros.set('genero', resolvedParams.genero);
  if (resolvedParams.plataforma) filtros.set('plataforma', resolvedParams.plataforma);
  if (resolvedParams.orden) filtros.set('orden', resolvedParams.orden);
  if (resolvedParams.ratingMin) filtros.set('ratingMin', resolvedParams.ratingMin);
  if (resolvedParams.ratingMax) filtros.set('ratingMax', resolvedParams.ratingMax);

  const modo = esPopulares ? 'popular' : 'year';
  const paramsBackend = new URLSearchParams(filtros);
  paramsBackend.set('modo', modo);
  if (!resolvedParams.anio && !resolvedParams.estado && modo === 'year') {
    paramsBackend.set('anio', String(currentYear));
  }

  const res = await fetch(`http://localhost:3001/igdb/catalogo/page/${currentPage}?${paramsBackend.toString()}`, { cache: 'no-store' });
  const data = await res.json();
  const juegos = data.results || [];
  const totalPaginas = data.totalPaginas || 1;

  // TU base de datos local
  const resDb = await fetch('http://localhost:3001/media', { cache: 'no-store' });
  const myDb = await resDb.json();

  // /media es una petición de servidor, sin token, así que su "portada" es
  // siempre la COMPARTIDA — nunca tu personalización. Aquí solo comprobamos
  // si el título ya está guardado (dbId); GameCard comprueba tu portada real
  // por su cuenta, ya en el navegador, con tu token.
  const getLocalData = (igdbId: number) => {
    const local = myDb.find((m: any) => m.igdbId === igdbId);
    return {
      dbId: local ? local.id : null,
      customPoster: null
    };
  };

  // Listas para los desplegables del sidebar
  const resFiltros = await fetch('http://localhost:3001/igdb/filtros', { cache: 'no-store' });
  const { generos, plataformas } = await resFiltros.json();

  const sufijoTipo = filtros.toString() ? `&${filtros.toString()}` : '';
  const urlPagina = (p: number) => `/game/all?page=${p}${sufijoTipo}`;
  const paginasAMostrar = getPaginas(currentPage, totalPaginas);

  return (
    <main className="min-h-screen bg-[#14181c] text-white font-sans py-10">
      <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-16">

        <div className="border-b border-gray-800 pb-4 mb-6 flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-wide">
            {esPopulares ? 'Popular' : `Games ${currentYear}`}
            <span className="text-sm font-normal text-gray-500 ml-3 bg-gray-900 px-2 py-1 rounded">Page {currentPage}</span>
          </h1>
          <span className="text-sm text-gray-500 font-semibold">Showing {juegos.length} titles</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <FiltersSidebar generos={generos || []} plataformas={plataformas || []} />

          <div className="flex-grow">
            {/* CUADRÍCULA */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4 pt-2">
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

            {/* BARRA DE PAGINACIÓN */}
            <div className="flex justify-between items-center mt-10 pt-6 border-t border-gray-800">
              {currentPage > 1 ? (
                <Link
                  href={urlPagina(currentPage - 1)}
                  className="text-sm text-gray-400 hover:text-white transition cursor-pointer"
                >
                  ‹ Prev
                </Link>
              ) : (
                <span className="text-sm text-gray-700 cursor-default">‹ Prev</span>
              )}

              <div className="flex gap-2">
                {paginasAMostrar.map((p) => (
                  <Link
                    key={p}
                    href={urlPagina(p)}
                    className={`w-9 h-9 flex items-center justify-center rounded text-sm font-semibold transition cursor-pointer ${
                      p === currentPage
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#2c3440] text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {p}
                  </Link>
                ))}
              </div>

              {currentPage < totalPaginas ? (
                <Link
                  href={urlPagina(currentPage + 1)}
                  className="text-sm text-gray-400 hover:text-white transition cursor-pointer"
                >
                  Next ›
                </Link>
              ) : (
                <span className="text-sm text-gray-700 cursor-default">Next ›</span>
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}