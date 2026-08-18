// --- SCRIPT DE UN SOLO USO: limpia las filas duplicadas de Media (330 y 539)
// que se crearon por el bug de POST /media/igdb, dejando solo la fila buena
// (305, la que tiene tu carátula elegida a mano y tu visto/like/lista).
//
// Cómo usarlo:
//   cd media-tracker/backend
//   node limpiar-duplicados.js
//
// Es seguro ejecutarlo aunque ya hayas borrado a mano alguna fila desde
// Prisma Studio (usa deleteMany, que no falla si no encuentra nada que borrar).

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const IDS_A_BORRAR = [330, 539];

async function main() {
  console.log('Borrando filas dependientes de Media ids:', IDS_A_BORRAR);

  const userMedia = await prisma.userMedia.deleteMany({ where: { mediaId: { in: IDS_A_BORRAR } } });
  console.log('UserMedia borradas:', userMedia.count);

  const favorites = await prisma.favorite.deleteMany({ where: { mediaId: { in: IDS_A_BORRAR } } });
  console.log('Favorite borradas:', favorites.count);

  const listItems = await prisma.listItem.deleteMany({ where: { mediaId: { in: IDS_A_BORRAR } } });
  console.log('ListItem borradas:', listItems.count);

  const gameLogs = await prisma.gameLog.deleteMany({ where: { mediaId: { in: IDS_A_BORRAR } } });
  console.log('GameLog borrados:', gameLogs.count);

  console.log('Borrando las filas de Media...');
  const media = await prisma.media.deleteMany({ where: { id: { in: IDS_A_BORRAR } } });
  console.log('Media borradas:', media.count);

  console.log('¡Listo! Solo debería quedar la fila 305 para este juego.');
}

main()
  .catch((error) => {
    console.error('ERROR COMPLETO:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
