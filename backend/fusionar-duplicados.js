// --- SCRIPT: fusiona TODOS los juegos duplicados de la base de datos ---
// Para cada grupo de filas con el mismo igdbId, decide cuál conservar:
//   1. Si solo una fila tiene datos de usuario (visto/like/nota/lista) -> esa.
//   2. Si ninguna tiene datos, pero solo una tiene carátula personalizada
//      (una URL que no sea de images.igdb.com, es decir, de SteamGridDB) -> esa.
//   3. Si ninguna tiene ni datos ni carátula personalizada -> la más antigua.
//   4. Si hay ambigüedad real (varias con datos, o varias con carátula
//      personalizada distinta) -> NO se toca, se lista aparte para revisar a mano.
//
// Cómo usarlo:
//   cd media-tracker/backend
//   node fusionar-duplicados.js
//
// Antes de borrar cada fila "perdedora", se borran también sus filas
// dependientes (UserMedia/Favorite/ListItem/GameLog) — aunque por construcción
// esas filas ya deberían estar vacías en los casos que se tocan automáticamente.

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

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
  const todos = await prisma.media.findMany({ where: { igdbId: { not: null } }, orderBy: { id: 'asc' } });

  const porIgdbId = new Map();
  for (const m of todos) {
    if (!porIgdbId.has(m.igdbId)) porIgdbId.set(m.igdbId, []);
    porIgdbId.get(m.igdbId).push(m);
  }
  const duplicados = Array.from(porIgdbId.entries()).filter(([, filas]) => filas.length > 1);

  console.log(`Procesando ${duplicados.length} juegos duplicados...\n`);

  let fusionadosOk = 0;
  const necesitanRevision = [];

  for (const [igdbId, filas] of duplicados) {
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
      const conPortadaCustom = filasConDatos.filter((f) => tienePortadaPersonalizada(f.fila.portada));
      if (conPortadaCustom.length === 1) {
        keeper = conPortadaCustom[0].fila;
      } else if (conPortadaCustom.length === 0) {
        keeper = filas[0]; // ya viene ordenado por id asc = la más antigua
      }
    }

    if (!keeper) {
      necesitanRevision.push({ igdbId, titulo: filas[0].titulo, filas, conDatosCount: conDatos.length });
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

  console.log(`\n${fusionadosOk} juegos fusionados automáticamente.`);

  if (necesitanRevision.length > 0) {
    console.log(`\n⚠️  ${necesitanRevision.length} necesitan revisión MANUAL (no se han tocado):\n`);
    for (const r of necesitanRevision) {
      console.log(`--- "${r.titulo}" (igdbId ${r.igdbId}) ---`);
      for (const f of r.filas) {
        console.log(`  id ${f.id} | portada: ${f.portada || '(sin carátula)'}`);
      }
      console.log('');
    }
  } else {
    console.log('\nNo ha quedado ningún caso ambiguo. ¡Todo limpio!');
  }
}

main()
  .catch((error) => {
    console.error('ERROR COMPLETO:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
