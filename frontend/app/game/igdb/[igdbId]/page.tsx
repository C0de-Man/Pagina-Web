import { redirect } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

export default async function GameIgdbResolver({ params }: { params: Promise<{ igdbId: string }> }) {
  const { igdbId } = await params;

  const res = await fetch('http://localhost:3001/media/igdb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ igdbId: parseInt(igdbId, 10) }),
    cache: 'no-store',
  });
  const media = await res.json();

  if (!media || media.error) {
    return (
      <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">
        Juego no encontrado
      </div>
    );
  }

  redirect(urlFicha(media));
}