require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const app = express();
app.use(cors());
app.use(express.json()); 

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PORT = 3001;

// --- RUTA PARA OBTENER TODOS LOS MEDIOS ---
app.get('/media', async (req, res) => {
  try {
    const allMedia = await prisma.media.findMany();
    res.json(allMedia);
  } catch (error) {
    res.status(500).json({ error: 'Hubo un error al consultar la base de datos' });
  }
});

// --- RUTA PARA GUARDAR UN NUEVO MEDIO ---
app.post('/media', async (req, res) => {
  try {
    const { titulo, tipo, anio } = req.body;
    const newMedia = await prisma.media.create({ data: { titulo, tipo, anio } });
    res.json(newMedia);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo crear el registro' });
  }
});

// --- RUTA PARA BUSCAR EN TMDB ---
app.get('/search', async (req, res) => {
  try {
    const searchQuery = req.query.q;
    if (!searchQuery) return res.status(400).json({ error: 'Falta término' });
    const url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(searchQuery)}&language=es-ES&api_key=${process.env.TMDB_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data.results);
  } catch (error) {
    res.status(500).json({ error: 'Hubo un error al buscar en TMDB' });
  }
});

// --- RUTA PARA GUARDAR DESDE TMDB AUTOMÁTICAMENTE ---
app.post('/media/tmdb', async (req, res) => {
  try {
    const { tmdbId, tipo } = req.body;
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=es-ES`);
    const data = await response.json();

    const backdropUrl = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null;
    const posterUrl = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;

    const newMedia = await prisma.media.create({
      data: {
        tmdbId: data.id,
        titulo: data.title || data.name,
        tipo: tipo || "PELICULA",
        anio: data.release_date ? parseInt(data.release_date.split('-')[0]) : null,
        portada: posterUrl,
        backdrop: backdropUrl,
        sinopsis: data.overview
      }
    });
    res.json(newMedia);
  } catch (error) {
    res.status(500).json({ error: "Hubo un error al guardar" });
  }
});

// --- RUTA PARA OBTENER UNA SOLA PELÍCULA POR SU ID ---
app.get('/media/:id', async (req, res) => {
  try {
    const idParam = parseInt(req.params.id);
    const mediaItem = await prisma.media.findUnique({ where: { id: idParam } });
    if (!mediaItem) return res.status(404).json({ error: 'No encontrado' });
    res.json(mediaItem);
  } catch (error) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// --- RUTA PARA OBTENER IMÁGENES DE TMDB ---
app.get('/tmdb/images/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    if (!tmdbId || tmdbId === 'undefined' || tmdbId === 'null') return res.status(400).json({ error: "Sin tmdbId" });
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/images?api_key=${apiKey}`);
    const data = await response.json();
    res.json(data.posters || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener imágenes" });
  }
});

// --- RUTA PARA ACTUALIZAR LA PORTADA ---
app.patch('/media/:id/poster', async (req, res) => {
  try {
    const { id } = req.params;
    const { newPosterUrl } = req.body;
    const updatedMedia = await prisma.media.update({
      where: { id: parseInt(id) },
      data: { portada: newPosterUrl }
    });
    res.json(updatedMedia);
  } catch (error) {
    res.status(500).json({ error: "Error al actualizar la portada" });
  }
});

// --- RUTAS PARA EL LOBBY ---
app.get('/tmdb/now_playing', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/movie/now_playing?api_key=${apiKey}&language=es-ES&page=1`);
    const data = await response.json();
    res.json(data.results);
  } catch (error) {
    res.status(500).json({ error: "Error" });
  }
});

app.get('/tmdb/popular', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/movie/popular?api_key=${apiKey}&language=es-ES&page=1`);
    const data = await response.json();
    res.json(data.results);
  } catch (error) {
    res.status(500).json({ error: "Error" });
  }
});

// --- RUTA PARA EL LOBBY DE UN AÑO (Solo 20 resultados para la vista previa) ---
app.get('/tmdb/year/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=es-ES&primary_release_year=${year}&sort_by=popularity.desc&page=1`);
    const data = await response.json();
    res.json(data.results || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener películas" });
  }
});

// --- NUEVA RUTA MAGICA: Paginación de 7x6 (42 películas) ---
app.get('/tmdb/year/:year/page/:page', async (req, res) => {
  try {
    const year = req.params.year;
    const page = parseInt(req.params.page) || 1;
    const apiKey = process.env.TMDB_API_KEY;
    
    // Queremos exactamente 42 por página (7 columnas x 6 filas)
    const itemsPerPage = 42; 
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = page * itemsPerPage;
    
    // Las páginas de TMDB traen 20, calculamos cuáles pedir
    const startTmdbPage = Math.floor(startIndex / 20) + 1;
    const endTmdbPage = Math.ceil(endIndex / 20);

    let combined = [];
    
    for (let i = startTmdbPage; i <= endTmdbPage; i++) {
      const response = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=es-ES&primary_release_year=${year}&sort_by=popularity.desc&page=${i}`);
      const data = await response.json();
      if (data.results) combined.push(...data.results);
    }

    // Filtramos duplicados
    const uniqueCombined = Array.from(new Map(combined.map(m => [m.id, m])).values());

    // Extraemos las 42 exactas
    const offset = startIndex % 20;
    const finalResults = uniqueCombined.slice(offset, offset + itemsPerPage);

    res.json({ page, results: finalResults });
  } catch (error) {
    console.error("Error obteniendo pelis paginadas:", error);
    res.status(500).json({ error: "Error al obtener películas" });
  }
});

// --- RUTA PARA OBTENER PRECUELA Y SECUELA (COLECCIÓN) ---
app.get('/tmdb/collection/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;

    // 1. Obtener detalles de la peli para saber si pertenece a una saga
    const movieRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=es-ES`);
    const movieData = await movieRes.json();

    if (!movieData.belongs_to_collection) {
      return res.json({ prequel: null, sequel: null });
    }

    // 2. Obtener la colección completa
    const collectionId = movieData.belongs_to_collection.id;
    const colRes = await fetch(`https://api.themoviedb.org/3/collection/${collectionId}?api_key=${apiKey}&language=es-ES`);
    const colData = await colRes.json();

    // 3. Ordenar todas las películas de la saga por fecha de salida
    const parts = colData.parts.sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    // 4. Buscar dónde está la peli actual en esa lista
    const currentIndex = parts.findIndex(p => p.id === parseInt(tmdbId));

    // 5. La anterior es la precuela, la siguiente es la secuela
    const prequel = currentIndex > 0 ? parts[currentIndex - 1] : null;
    const sequel = currentIndex < parts.length - 1 ? parts[currentIndex + 1] : null;

    res.json({ prequel, sequel });
  } catch (error) {
    console.error("Error al obtener la colección:", error);
    res.status(500).json({ error: "Error al obtener colección" });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});