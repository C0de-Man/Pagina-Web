import { redirect } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

export default async function BookComicVineResolver({ params }: { params: Promise<{ comicVineId: string }> }) {
  const { comicVineId } = await params;

  const res = await fetch('http://localhost:3001/media/comicvine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comicVineId }),
    cache: 'no-store',
  });
  const media = await res.json();

  if (!media || media.error) {
    return (
      <div className="p-8 text-white text-center min-h-screen bg-gray-950 flex items-center justify-center">
        Cómic no encontrado
      </div>
    );
  }

  redirect(urlFicha(media));
}