import RatingWidget from '@/components/RatingWidget';
import ActionButtons from '@/components/ActionButtons';
import PosterButtonModal from '@/components/PosterButtonModal';
import CollectionLinks from '@/components/CollectionLinks';
import MediaTabs from '@/components/MediaTabs';
import RemakeOfBadge from '@/components/RemakeOfBadge';
import AddToListModal from '@/components/AddToListModal';
import ReviewLogButton from '@/components/ReviewLogButton';
import WatchProviders from '@/components/WatchProviders';
import PosterImage from '@/components/PosterImage';
import BackdropImage from '@/components/BackdropImage';
import { extraerIdDeSlug, urlFicha } from '@/lib/slug';
import { formatFechaEstrenoTmdb } from '@/lib/fecha';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import FriendsActivityOnMedia from '@/components/FriendsActivityOnMedia';

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

function formatRuntime(minutes: number | null) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default async function MediaDetail({ params }: { params: Promise<{ slug: string }> }) {
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

  // Esta plantilla es solo para películas/series. Si el id resulta ser un videojuego
  // (por ejemplo, alguien pegó un link viejo o el slug apunta al id equivocado),
  // mandamos a la ficha correcta en /game/.
  if (media.tipo === 'VIDEOJUEGO' || media.tipo === 'SERIE') {
    redirect(urlFicha(media));
  }

  let detalles: any = null;
  if (media.tmdbId) {
    const resDetalles = await fetch(`http://localhost:3001/tmdb/details/${media.tmdbId}?language=${idioma}`, { cache: 'no-store' });
    detalles = await resDetalles.json();
  }

  const duracion = detalles ? formatRuntime(detalles.runtime) : null;
  const fechaCompleta = detalles ? formatFechaEstrenoTmdb(detalles.fechaEstreno, idioma) : null;

  return (
    <main className="min-h-screen bg-gray-950 text-white font-sans pb-16">

      <BackdropImage mediaId={media.id} backdropDefault={media.backdrop} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-24 md:-mt-32 relative z-10">
        <div className="flex flex-col md:flex-row gap-8">

          <div className="flex-shrink-0 w-48 md:w-64">
            <PosterImage mediaId={media.id} portadaDefault={media.portada} titulo={media.titulo} />
            <PosterButtonModal tmdbId={media.tmdbId} mediaId={media.id} />
          </div>

          <div className="flex-grow pt-24 md:pt-32">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">{media.titulo}</h1>
            <div className="flex items-center gap-2 text-gray-400 mb-6">
              <span className="text-lg">{fechaCompleta || media.anio}</span>
              {duracion && <span className="text-lg text-gray-500">({duracion})</span>}
              <span className="bg-gray-800 px-2 py-1 rounded text-xs font-semibold ml-2">{ETIQUETA_TIPO[media.tipo] || media.tipo}</span>
            </div>

            <RemakeOfBadge remakeOf={media.remakeOf} />

            <MediaTabs sinopsis={media.sinopsis} detalles={detalles} />
          </div>

          <div className="flex-shrink-0 w-full md:w-72 pt-24 md:pt-32">
            <div className="bg-[#1c2228] rounded-lg border border-gray-700 p-4 shadow-xl">
              <ActionButtons mediaId={media.id} />

              <div className="border-t border-dashed border-gray-700 my-4"></div>

              <div className="space-y-2 mb-4">
                <ReviewLogButton mediaId={media.id} />
                <AddToListModal mediaId={media.id} />
              </div>

              <RatingWidget mediaId={media.id} />
            </div>

            <FriendsActivityOnMedia mediaId={media.id} />

            <CollectionLinks tmdbId={media.tmdbId} tituloActual={media.titulo} anioActual={media.anio} />
            <WatchProviders tmdbId={media.tmdbId} />
          </div>

        </div>
      </div>
    </main>
  );
}