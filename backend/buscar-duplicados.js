// --- SCRIPT DE DIAGNÓSTICO: busca TODOS los juegos duplicados (misma
// igdbId, varias filas en Media) en toda la base de datos, y para cada
// duplicado muestra si tiene visto/like/nota, si está en alguna lista, o si
// tiene algún log — para saber con seguridad cuál fila conservar y cuáles
// borrar, sin arriesgarse a perder nada.
//
// Cómo usarlo:
//   cd media-tracker/backend
//   node buscar-duplicados.js
//
// Este script SOLO LEE, no borra nada — es seguro ejecutarlo cuando quieras.

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const todos = await prisma.media.findMany({
    where: { igdbId: { not: null } },
    orderBy: { id: 'asc' },
  });

  const porIgdbId = new Map();
  for (const m of todos) {
    if (!porIgdbId.has(m.igdbId)) porIgdbId.set(m.igdbId, []);
    porIgdbId.get(m.igdbId).push(m);
  }

  const duplicados = Array.from(porIgdbId.entries()).filter(([, filas]) => filas.length > 1);

  if (duplicados.length === 0) {
    console.log('No se ha encontrado ningún juego duplicado. Todo limpio.');
    return;
  }

  console.log(`Encontrados ${duplicados.length} juegos con filas duplicadas:\n`);

  for (const [igdbId, filas] of duplicados) {
    console.log(`=== "${filas[0].titulo}" (igdbId: ${igdbId}) — ${filas.length} filas ===`);

    for (const fila of filas) {
      const [userMedia, favorites, listItems, gameLogs] = await Promise.all([
        prisma.userMedia.findMany({ where: { mediaId: fila.id } }),
        prisma.favorite.findMany({ where: { mediaId: fila.id } }),
        prisma.listItem.findMany({ where: { mediaId: fila.id } }),
        prisma.gameLog.findMany({ where: { mediaId: fila.id } }),
      ]);

      const tieneAlgo = userMedia.length > 0 || favorites.length > 0 || listItems.length > 0 || gameLogs.length > 0;
      const userMediaConDatos = userMedia.filter((u) => u.watched || u.liked || u.watchlist || u.rating !== null);

      console.log(`  id ${fila.id} | creada ${fila.createdAt.toISOString()} | portada: ${fila.portada ? 'sí' : 'no'}`);
      console.log(`    UserMedia: ${userMedia.length} (con datos reales: ${userMediaConDatos.length}) | Favorite: ${favorites.length} | ListItem: ${listItems.length} | GameLog: ${gameLogs.length}`);
      console.log(`    ${tieneAlgo ? '⚠️  TIENE DATOS ENGANCHADOS — no borrar sin revisar' : '✅ vacía, candidata a borrar si otra fila es la buena'}`);
    }
    console.log('');
  }
}

main()
  .catch((error) => {
    console.error('ERROR COMPLETO:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
