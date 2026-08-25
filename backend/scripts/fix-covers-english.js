// --- SCRIPT DE UN SOLO USO: poner en inglés las carátulas/banners
// COMPARTIDOS (Media.portada / Media.backdrop) de TODAS las películas y
// series ya guardadas en la base de datos. ---
//
// A partir de esto:
// - Cualquier cuenta nueva (o cualquiera que aún no haya personalizado esa
//   película) verá directamente la carátula en inglés, sin hacer nada.
// - Cada usuario sigue pudiendo cambiarla a la que quiera con
//   "Cambiar carátula / banner" en la propia ficha — este script no lo
//   afecta.
// - NO toca UserMedia.customPoster/customBackdrop de nadie: si alguien ya
//   había elegido una carátula personalizada a mano, se queda exactamente
//   igual.
//
// Uso: desde la carpeta backend/, con el servidor PARADO o corriendo (da
// igual, no hay conflicto):
//
//   node scripts/fix-covers-english.js
//
// Tarda un rato con catálogos grandes porque pide a TMDB una película/serie
// a la vez (en secuencia, no en paralelo) para no saturar su límite de
// peticiones.

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.error('Falta TMDB_API_KEY en el .env de backend/');
    process.exit(1);
  }

  const items = await prisma.media.findMany({
    where: { tipo: { in: ['PELICULA', 'SERIE'] }, tmdbId: { not: null } },
    select: { id: true, tmdbId: true, tipo: true, titulo: true },
  });

  console.log(`Encontradas ${items.length} películas/series con tmdbId. Empezando...\n`);

  let actualizados = 0;
  let sinCambios = 0;
  let fallidos = 0;

  for (const [i, item] of items.entries()) {
    try {
      const endpointTmdb = item.tipo === 'SERIE' ? 'tv' : 'movie';
      const resp = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${item.tmdbId}?api_key=${apiKey}&language=en-US`);
      const data = await resp.json();

      if (!data || data.status_code) {
        console.log(`[${i + 1}/${items.length}] ✗ ${item.titulo} — TMDB no respondió bien`);
        fallidos++;
        continue;
      }

      const portada = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;
      const backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null;

      if (!portada && !backdrop) {
        console.log(`[${i + 1}/${items.length}] – ${item.titulo} — sin carátula/banner en inglés, se deja como estaba`);
        sinCambios++;
        continue;
      }

      await prisma.media.update({
        where: { id: item.id },
        data: {
          ...(portada ? { portada } : {}),
          ...(backdrop ? { backdrop } : {}),
        },
      });
      console.log(`[${i + 1}/${items.length}] ✓ ${item.titulo}`);
      actualizados++;
    } catch (e) {
      console.log(`[${i + 1}/${items.length}] ✗ ${item.titulo} — error: ${e.message}`);
      fallidos++;
    }
  }

  console.log(`\nListo. Actualizadas: ${actualizados} — Sin cambios: ${sinCambios} — Fallidas: ${fallidos} — Total: ${items.length}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
