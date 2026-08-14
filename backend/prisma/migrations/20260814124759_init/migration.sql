-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('PELICULA', 'SERIE', 'ANIME', 'MANGA', 'VIDEOJUEGO', 'COMIC');

-- CreateTable
CREATE TABLE "Media" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo" "MediaType" NOT NULL,
    "anio" INTEGER,
    "portada" TEXT,
    "sinopsis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);
