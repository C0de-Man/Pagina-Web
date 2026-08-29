import { redirect } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

export default async function ResolverSerieTmdb({ params }: { params: Promise<{ tmdbId: string }> }) {
  const { tmdbId } = await params;

  const res = await fetch('http://localhost:3001/media/tmdb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdbId: parseInt(tmdbId, 10), tipo: 'SERIE' }),
    cache: 'no-store',
  });
  const media = await res.json();

  if (!media || media.error) {
    return <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">Medio no encontrado</div>;
  }

  redirect(urlFicha(media));
}