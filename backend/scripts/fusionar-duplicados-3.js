// --- SCRIPT: último paso, resuelve los dos casos ambiguos que elegiste a mano ---
// GTA VI -> te quedas con la opción B (id 531)
// GTA V  -> te quedas con la opción A (id 212, la más antigua de las que
//           tenían esa misma carátula)
//
// Cómo usarlo:
//   cd media-tracker/backend
//   node fusionar-duplicados-3.js

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const GRUPOS = [
  { titulo: 'Grand Theft Auto VI', keeperId: 531, todasLasIds: [199, 531, 533, 543, 545] },
  { titulo: 'Grand Theft Auto V', keeperId: 212, todasLasIds: [212, 329, 532, 534, 540, 542, 544] },
];

async function main() {
  for (const grupo of GRUPOS) {
    const aBorrar = grupo.todasLasIds.filter((id) => id !== grupo.keeperId);

    await prisma.userMedia.deleteMany({ where: { mediaId: { in: aBorrar } } });
    await prisma.favorite.deleteMany({ where: { mediaId: { in: aBorrar } } });
    await prisma.listItem.deleteMany({ where: { mediaId: { in: aBorrar } } });
    await prisma.gameLog.deleteMany({ where: { mediaId: { in: aBorrar } } });
    const resultado = await prisma.media.deleteMany({ where: { id: { in: aBorrar } } });

    console.log(`✅ "${grupo.titulo}" — conservada id ${grupo.keeperId}, filas de Media borradas: ${resultado.count} (ids: ${aBorrar.join(', ')})`);
  }

  console.log('\n¡Listo! Los dos últimos casos están resueltos.');
}

main()
  .catch((error) => {
    console.error('ERROR COMPLETO:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
