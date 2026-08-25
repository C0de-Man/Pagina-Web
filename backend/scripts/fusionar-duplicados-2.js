// --- SCRIPT: segunda pasada, solo para los grupos que quedaron pendientes ---
// El primer script (fusionar-duplicados.js) comparaba "cuántas filas tienen
// carátula personalizada" en vez de "cuántas carátulas personalizadas
// DISTINTAS hay" — así que casos donde la misma URL personalizada estaba
// simplemente repetida en varias filas duplicadas se marcaban como
// ambiguos sin serlo. Este script corrige eso: si todas las carátulas
// personalizadas del grupo son la MISMA url, se fusiona solo. Solo se deja
// para revisión manual si hay de verdad más de una URL personalizada distinta.
//
// Cómo usarlo:
//   cd media-tracker/backend
//   node fusionar-duplicados-2.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Los igdbId que quedaron pendientes en la primera pasada.
const IGDB_IDS_PENDIENTES = [52189, 127044, 1020, 347668, 733, 3266];

function tienePortadaPersonalizada(url) {
  return !!url && !url.includes('images.igdb.com');
}

async function datosDeFila(mediaId) {
  const [userMedia, favorites, listItems, gameLogs] = await Promise.all([
    prisma.userMedia.findMany({ where: { mediaId } }),
    prisma.favorite.findMany({ where: { mediaId } }),
    prisma.listItem.findMany({ where: { mediaId } }),
    prisma.gameLog.findMany({ where: { mediaId } }),
  ]);
  const userMediaConDatos = userMedia.filter((u) => u.watched || u.liked || u.watchlist || u.rating !== null);
  const tieneAlgo = userMediaConDatos.length > 0 || favorites.length > 0 || listItems.length > 0 || gameLogs.length > 0;
  return { tieneAlgo };
}

async function main() {
  let fusionadosOk = 0;
  const siguenAmbiguos = [];

  for (const igdbId of IGDB_IDS_PENDIENTES) {
    const filas = await prisma.media.findMany({ where: { igdbId }, orderBy: { id: 'asc' } });
    if (filas.length <= 1) {
      console.log(`(${igdbId}) ya no tiene duplicados, se salta.`);
      continue;
    }

    const filasConDatos = [];
    for (const fila of filas) {
      const datos = await datosDeFila(fila.id);
      filasConDatos.push({ fila, ...datos });
    }
    const conDatos = filasConDatos.filter((f) => f.tieneAlgo);

    let keeper = null;

    if (conDatos.length === 1) {
      keeper = conDatos[0].fila;
    } else if (conDatos.length === 0) {
      const urlsPersonalizadasDistintas = Array.from(
        new Set(
          filasConDatos
            .filter((f) => tienePortadaPersonalizada(f.fila.portada))
            .map((f) => f.fila.portada)
        )
      );
      if (urlsPersonalizadasDistintas.length <= 1) {
        // 0 o 1 carátula personalizada distinta -> no hay ambigüedad real.
        // Preferimos la fila con esa carátula personalizada si existe;
        // si no hay ninguna personalizada, la más antigua.
        const conEsaUrl = filasConDatos.find((f) => tienePortadaPersonalizada(f.fila.portada));
        keeper = conEsaUrl ? conEsaUrl.fila : filas[0];
      }
    }

    if (!keeper) {
      siguenAmbiguos.push({ igdbId, titulo: filas[0].titulo, filas });
      continue;
    }

    const aBorrar = filas.filter((f) => f.id !== keeper.id).map((f) => f.id);

    await prisma.userMedia.deleteMany({ where: { mediaId: { in: aBorrar } } });
    await prisma.favorite.deleteMany({ where: { mediaId: { in: aBorrar } } });
    await prisma.listItem.deleteMany({ where: { mediaId: { in: aBorrar } } });
    await prisma.gameLog.deleteMany({ where: { mediaId: { in: aBorrar } } });
    await prisma.media.deleteMany({ where: { id: { in: aBorrar } } });

    console.log(`✅ "${filas[0].titulo}" — conservada id ${keeper.id}, borradas: ${aBorrar.join(', ')}`);
    fusionadosOk++;
  }

  console.log(`\n${fusionadosOk} juegos fusionados en esta segunda pasada.`);

  if (siguenAmbiguos.length > 0) {
    console.log(`\n⚠️  ${siguenAmbiguos.length} siguen siendo ambiguos DE VERDAD (varias carátulas personalizadas distintas):\n`);
    for (const r of siguenAmbiguos) {
      console.log(`--- "${r.titulo}" (igdbId ${r.igdbId}) ---`);
      for (const f of r.filas) {
        console.log(`  id ${f.id} | portada: ${f.portada || '(sin carátula)'}`);
      }
      console.log('');
    }
  } else {
    console.log('Ningún caso ambiguo real. ¡Todo limpio!');
  }
}

main()
  .catch((error) => {
    console.error('ERROR COMPLETO:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
