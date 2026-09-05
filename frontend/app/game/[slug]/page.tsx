import RatingWidget from '@/components/RatingWidget';
import ActionButtons from '@/components/ActionButtons';
import AddToListModal from '@/components/AddToListModal';
import GameImagesModal from '@/components/GameImagesModal';
import GameTabs from '@/components/GameTabs';
import GameCollectionLinks from '@/components/GameCollectionLinks';
import GameRemakeOfBadge from '@/components/GameRemakeOfBadge';
import GameDlcOfBadge from '@/components/GameDlcOfBadge';
import GameLogModal from '@/components/GameLogModal';
import PosterImage from '@/components/PosterImage';
import BackdropImage from '@/components/BackdropImage';
import { extraerIdDeSlug, urlFicha } from '@/lib/slug';
import { formatFechaLanzamientoIgdb } from '@/lib/fecha';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Mismo mapa que ya usan MediaTabs.tsx / ReviewDetailModal.tsx: el tipo se
// guarda en español en la base de datos, pero la interfaz es en inglés.
const ETIQUETA_TIPO: Record<string, string> = {
  PELICULA: 'Film',
  SERIE: 'Series',
  VIDEOJUEGO: 'Game',
  ANIME: 'Anime',
  MANGA: 'Manga',
  COMIC: 'Comic',
};

export default async function GameDetail({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const id = extraerIdDeSlug(resolvedParams.slug);

  if (!id || isNaN(id)) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  const cookieStore = await cookies();
  const idioma = cookieStore.get('idioma')?.value || 'es-ES';

  const res = await fetch(`http://localhost:3001/media/${id}?language=${idioma}`, { cache: 'no-store' });
  const media = await res.json();

  let detalles: any = null;
  if (media.igdbId) {
    const resDetalles = await fetch(`http://localhost:3001/igdb/details/${media.igdbId}`, { cache: 'no-store' });
    detalles = await resDetalles.json();
  }

  const fechaCompleta = detalles ? formatFechaLanzamientoIgdb(detalles.fechaLanzamiento, idioma) : null;

  if (!media || media.error) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  // Esta plantilla es solo para videojuegos. Si el id resulta ser una película/serie,
  // mandamos a la ficha correcta en /movie/.
  if (media.tipo !== 'VIDEOJUEGO') {
    redirect(urlFicha(media));
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans pb-16">
      <BackdropImage mediaId={media.id} backdropDefault={media.backdrop} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 md:-mt-32 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">

          <div className="flex-shrink-0 w-48 md:w-64">
            <PosterImage mediaId={media.id} portadaDefault={media.portada} titulo={media.titulo} />
            <GameImagesModal mediaId={media.id} />
          </div>

          <div className="flex-grow pt-24 md:pt-32">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">{media.titulo}</h1>
            <div className="flex items-center gap-2 text-gray-400 mb-6">
              <span className="text-lg">{fechaCompleta || media.anio}</span>
              <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold ml-2">{ETIQUETA_TIPO[media.tipo] || media.tipo}</span>
              {detalles?.estado && (
                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                  detalles.estado === 'Cancelled' ? 'bg-red-900/60 text-red-300' : 'bg-amber-900/60 text-amber-300'
                }`}>
                  {detalles.estado}
                </span>
              )}
            </div>

            <GameRemakeOfBadge igdbId={media.igdbId} />
            <GameDlcOfBadge igdbId={media.igdbId} />

            <GameTabs sinopsis={media.sinopsis} detalles={detalles} igdbId={media.igdbId} />
          </div>

          <div className="flex-shrink-0 w-full md:w-72 pt-24 md:pt-32">
            <div className="bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
              <ActionButtons mediaId={media.id} tipo={media.tipo} />

              <div className="border-t border-dashed border-gray-700 my-4"></div>

              <div className="space-y-2 mb-4">
                <GameLogModal mediaId={media.id} igdbId={media.igdbId} />
                <AddToListModal mediaId={media.id} />
              </div>

              <RatingWidget mediaId={media.id} />
            </div>

            {media.igdbId && (
              <GameCollectionLinks
                igdbId={media.igdbId}
                currentMediaIgdbId={media.igdbId}
                tituloActual={media.titulo}
                anioActual={media.anio}
                portadaActual={media.portada}
              />
            )}
          </div>

        </div>
      </div>
    </main>
  );
}