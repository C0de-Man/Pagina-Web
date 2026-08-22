import { redirect } from 'next/navigation';
import { urlFicha } from '@/lib/slug';

// Página "resolvedora": no se navega aquí a propósito desde dentro de la app
// (para eso ya está el click normal en las carátulas, que sigue yendo directo
// a la ficha si ya existe). Esta ruta existe para que las carátulas puedan
// ser enlaces <a href="..."> DE VERDAD incluso cuando la película/serie
// todavía no está guardada en la base de datos local — así el clic central,
// Ctrl+clic o "abrir en pestaña nueva" del navegador funcionan de forma
// nativa, sin depender de JavaScript. Al visitarse, crea (o encuentra si ya
// existía) el registro en la base de datos y redirige a la URL final.
//
// ?tipo=SERIE se usa desde la ficha de persona (/person/[personId]), donde un
// mismo listado de créditos mezcla películas y series — sin esto, todo se
// guardaría como PELICULA por defecto y el backend intentaría pedir el id a
// la API de películas de TMDB aunque fuera una serie, dando 404.
export default async function ResolverPeliculaPorTmdb({
  params,
  searchParams,
}: {
  params: Promise<{ tmdbId: string }>;
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { tmdbId } = await params;
  const { tipo } = await searchParams;
  const tmdbIdNum = parseInt(tmdbId, 10);

  if (Number.isNaN(tmdbIdNum)) {
    redirect('/');
  }

  const tipoFinal = tipo === 'SERIE' ? 'SERIE' : 'PELICULA';

  const res = await fetch('http://localhost:3001/media/tmdb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdbId: tmdbIdNum, tipo: tipoFinal }),
    cache: 'no-store',
  });
  const media = await res.json();

  if (!media || media.error) {
    redirect('/');
  }

  redirect(urlFicha(media));
}