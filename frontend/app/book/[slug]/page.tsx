import RatingWidget from '@/components/RatingWidget';
import ActionButtons from '@/components/ActionButtons';
import BookPosterButtonModal from '@/components/BookPosterButtonModal';
import MangaCollectionLinks from '@/components/MangaCollectionLinks';
import MediaTabs from '@/components/MediaTabs';
import AddToListModal from '@/components/AddToListModal';
import ReviewLogButton from '@/components/ReviewLogButton';
import PosterImage from '@/components/PosterImage';
import BackdropImage from '@/components/BackdropImage';
import { extraerIdDeSlug, urlFicha } from '@/lib/slug';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import FriendsActivityOnMedia from '@/components/FriendsActivityOnMedia';
import ReadingProgress from '@/components/ReadingProgress';

export default async function BookDetail({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const id = extraerIdDeSlug(resolvedParams.slug);

  if (!id || isNaN(id)) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';
  const region = cookieStore.get('region')?.value || 'ES';

  const res = await fetch(`http://localhost:3001/media/${id}?language=${idioma}&region=${region}`, { cache: 'no-store' });
  const media = await res.json();

  if (!media || media.error) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  // Esta plantilla es solo para libros. Si el id resulta ser de otro tipo
  // (link viejo, o el slug apunta al id equivocado), mandamos a su ficha
  // correcta.
  if (media.tipo !== 'LIBRO') {
    redirect(urlFicha(media));
  }

  // Info extra de manga (vía MAL): volúmenes/capítulos totales, estado de
  // publicación y fechas completas. Solo existe si el libro se guardó desde
  // MAL (malMangaId); para libros de Google Books/Comic Vine queda todo en null.
  const resMangaInfo = await fetch(`http://localhost:3001/media/${media.id}/manga-info`, { cache: 'no-store' });
  const mangaInfo = await resMangaInfo.json();

  // Info extra de cómic (vía Comic Vine): editorial, total de issues y
  // rango de fechas de publicación. Solo existe si el libro se guardó desde
  // Comic Vine (comicVineId).
  const resComicInfo = await fetch(`http://localhost:3001/media/${media.id}/comic-info`, { cache: 'no-store' });
  const comicInfo = await resComicInfo.json();

  // Info extra de manga vía AniList: solo existe si el libro se guardó
  // desde AniList (anilistId) — respaldo final cuando ni MAL ni MangaDex
  // encontraron el manga (ver /libros/buscar).
  const resAniListInfo = await fetch(`http://localhost:3001/media/${media.id}/anilist-info`, { cache: 'no-store' });
  const anilistInfo = await resAniListInfo.json();

  // Info extra de manga vía MangaDex: solo existe si el libro se guardó
  // desde MangaDex (mangaDexId), típicamente cuando MAL no lo encontró
  // (ver /libros/buscar) — sin esto, un manga de MangaDex se queda sin
  // autor/estado/pestaña Crew, aunque MangaDex sí tenga esos datos.
  let mangaDexInfo: any = null;
  if (media.mangaDexId) {
    try {
      const resMangaDexInfo = await fetch(`http://localhost:3001/mangadex/details/${media.mangaDexId}`, { cache: 'no-store' });
      mangaDexInfo = await resMangaDexInfo.json();
    } catch (e) {
      mangaDexInfo = null;
    }
  }
  const ESTADOS_MANGADEX: Record<string, string> = {
    ongoing: 'Publishing',
    completed: 'Finished',
    hiatus: 'On hiatus',
    cancelled: 'Cancelled',
  };
  const estadoMangaDex = mangaDexInfo?.estado ? (ESTADOS_MANGADEX[mangaDexInfo.estado] || mangaDexInfo.estado) : null;

  const formatFechaCorta = (fecha: string | null) => {
    if (!fecha) return null;
    const [y, m, d] = fecha.split('-');
    const meses = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (!m) return y; // solo año, sin mes/día
    return `${meses[parseInt(m, 10) - 1]}${d ? ` ${parseInt(d, 10)},` : ''} ${y}`;
  };
  const publicado = mangaInfo.fechaInicio
    ? `${formatFechaCorta(mangaInfo.fechaInicio)}${mangaInfo.fechaFin && mangaInfo.fechaFin !== mangaInfo.fechaInicio ? ` - ${formatFechaCorta(mangaInfo.fechaFin)}` : mangaInfo.estado === 'Finished' || mangaInfo.fechaFin === mangaInfo.fechaInicio ? '' : ' - ?'}`
    : null;

  // Mismo criterio que "publicado" del manga, pero calculado a partir del
  // primer/último issue de Comic Vine — sin un "estado" explícito de
  // Comic Vine, no sabemos si sigue en marcha, así que si no hay fecha de
  // fin, simplemente no se muestra el "- ?" (evita insinuar que sabemos
  // que sigue en curso cuando en realidad no tenemos ese dato).
  // Mientras el cómic siga "Ongoing", el rango de fechas todavía no es
  // fijo — seguirá saliendo después de la última fecha que tengamos, así
  // que se muestra "fecha de inicio - ?" (mismo criterio que ya usa el
  // manga en publicación). Solo se muestra un rango cerrado cuando ya
  // sabemos que terminó (o cuando no se ha podido determinar el estado).
  const publicadoComic = comicInfo.fechaInicio
    ? comicInfo.estado === 'Ongoing'
      ? `${formatFechaCorta(comicInfo.fechaInicio)} - ?`
      : `${formatFechaCorta(comicInfo.fechaInicio)}${comicInfo.fechaFin && comicInfo.fechaFin !== comicInfo.fechaInicio ? ` - ${formatFechaCorta(comicInfo.fechaFin)}` : ''}`
    : null;

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans pb-16">

      <BackdropImage mediaId={media.id} backdropDefault={media.backdrop} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 md:-mt-32 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">

          <div className="flex-shrink-0 w-48 md:w-64">
            <PosterImage mediaId={media.id} portadaDefault={media.portada} titulo={media.titulo} />
            <BookPosterButtonModal mediaId={media.id} />
          </div>

          <div className="flex-grow pt-24 md:pt-32">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">{media.titulo}</h1>
            <div className="flex items-center gap-2 text-gray-400 mb-6">
              <span className="text-lg">{media.anio}</span>
              <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold ml-2">
                {mangaInfo.tipoMedia || (media.comicVineId ? 'Comic' : media.mangaDexId ? 'Manga' : 'Book')}
              </span>
              {mangaInfo.estado && (
                <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold text-gray-300 flex-shrink-0">
                  {mangaInfo.estado}
                </span>
              )}
              {comicInfo.estado && (
                <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold text-gray-300 flex-shrink-0">
                  {comicInfo.estado}
                </span>
              )}
              {estadoMangaDex && !mangaInfo.estado && !comicInfo.estado && (
                <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold text-gray-300 flex-shrink-0">
                  {estadoMangaDex}
                </span>
              )}
              {anilistInfo.estado && !mangaInfo.estado && !comicInfo.estado && !estadoMangaDex && (
                <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold text-gray-300 flex-shrink-0">
                  {anilistInfo.estado}
                </span>
              )}
            </div>

            <MediaTabs
              sinopsis={media.sinopsis}
              tipo={media.tipo}
              detalles={
                mangaInfo.totalVolumenes || mangaInfo.totalCapitulos || publicado || mangaInfo.autores?.length || mangaInfo.revistas?.length
                  ? {
                    estudios: [],
                    paises: [],
                    mangaPublicado: publicado,
                    mangaVolumenes: mangaInfo.totalVolumenes,
                    mangaCapitulos: mangaInfo.totalCapitulos,
                    mangaAutores: mangaInfo.autores || [],
                    mangaRevistas: mangaInfo.revistas || [],
                  }
                  : comicInfo.editorial || comicInfo.totalIssues
                    ? {
                      estudios: comicInfo.editorial ? [{ nombre: comicInfo.editorial }] : [],
                      paises: [],
                      mangaPublicado: publicadoComic,
                      mangaCapitulos: comicInfo.totalIssues,
                      mangaAutores: comicInfo.autores || [],
                    }
                    : mangaDexInfo?.autores?.length || estadoMangaDex || mangaDexInfo?.totalCapitulos
                      ? {
                        estudios: [],
                        paises: [],
                        // MangaDex no da fecha de inicio/fin, solo estado —
                        // y ese estado ya se muestra en el badge de arriba,
                        // así que aquí no se repite (evita un "Published:
                        // Finished" sin fecha real, que no aporta nada).
                        mangaPublicado: null,
                        mangaVolumenes: mangaDexInfo?.totalVolumenes,
                        mangaCapitulos: mangaDexInfo?.totalCapitulos,
                        mangaAutores: (mangaDexInfo?.autores || []).map((nombre: string) => ({ nombre, rol: 'Author', foto: null })),
                      }
                      : anilistInfo.totalCapitulos || anilistInfo.fechaInicio || anilistInfo.autores?.length
                        ? {
                          estudios: [],
                          paises: [],
                          mangaPublicado: anilistInfo.fechaInicio
                            ? `${formatFechaCorta(anilistInfo.fechaInicio)}${anilistInfo.fechaFin && anilistInfo.fechaFin !== anilistInfo.fechaInicio ? ` - ${formatFechaCorta(anilistInfo.fechaFin)}` : anilistInfo.estado === 'Finished' || anilistInfo.fechaFin === anilistInfo.fechaInicio ? '' : ' - ?'}`
                            : null,
                          mangaVolumenes: anilistInfo.totalVolumenes,
                          mangaCapitulos: anilistInfo.totalCapitulos,
                          mangaAutores: anilistInfo.autores || [],
                        }
                        : null
              }
            />
          </div>

          <div className="flex-shrink-0 w-full md:w-72 pt-24 md:pt-32">
            <div className="bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
              <ActionButtons mediaId={media.id} tipo={media.tipo} />

              <ReadingProgress mediaId={media.id} tipo={media.tipo} className="mt-0 border-0 p-0 shadow-none bg-transparent" />

              <div className="border-t border-dashed border-gray-700 my-4"></div>

              <div className="space-y-2 mb-4">
                <ReviewLogButton mediaId={media.id} />
                <AddToListModal mediaId={media.id} />
              </div>

              <RatingWidget mediaId={media.id} />
            </div>

            {media.malMangaId && <MangaCollectionLinks malMangaId={media.malMangaId} />}
          </div>

        </div>
      </div>
    </main>
  );
}