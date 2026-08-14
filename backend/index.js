require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const app = express();
app.use(express.json()); // Permite recibir datos en formato JSON

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PORT = 3001;

// --- AQUÍ ESTÁ LA RUTA QUE FALTABA ---
app.get('/media', async (req, res) => {
  try {
    // Esto hace la consulta a tu base de datos PostgreSQL
    const allMedia = await prisma.media.findMany(); 
    res.json(allMedia);
  } catch (error) {
    console.error("Error al obtener los medios:", error);
    res.status(500).json({ error: 'Hubo un error al consultar la base de datos' });
  }
});

// --- RUTA PARA GUARDAR UN NUEVO MEDIO ---
app.post('/media', async (req, res) => {
  try {
    // Cambiamos al español para que coincida con tu base de datos
    const { titulo, tipo, anio } = req.body; 

    const newMedia = await prisma.media.create({
      data: {
        titulo: titulo,
        tipo: tipo,
        anio: anio, // Si en tu schema pusiste "año" o "year", ponlo exactamente igual aquí
      },
    });

    res.json(newMedia);
  } catch (error) {
    console.error("Error al crear el medio:", error);
    res.status(500).json({ error: 'No se pudo crear el registro en la base de datos' });
  }
});

// --- RUTA PARA BUSCAR PELÍCULAS/SERIES EN TMDB ---
app.get('/search', async (req, res) => {
  try {
    // Extraemos la palabra que quieras buscar (ej: ?q=matrix)
    const searchQuery = req.query.q; 
    
    if (!searchQuery) {
      return res.status(400).json({ error: 'Falta el término de búsqueda. Usa ?q=nombre_de_la_pelicula' });
    }

    // Construimos la URL oficial de TMDB usando la llave secreta de tu archivo .env
    const url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(searchQuery)}&language=es-ES&api_key=${process.env.TMDB_API_KEY}`;
    
    // Hacemos la petición a los servidores de TMDB usando fetch nativo
    const response = await fetch(url);
    const data = await response.json();

    // Devolvemos los resultados al usuario
    res.json(data.results);
  } catch (error) {
    console.error("Error al conectar con TMDB:", error);
    res.status(500).json({ error: 'Hubo un error al buscar en TMDB' });
  }
});

// --- RUTA PARA GUARDAR DESDE TMDB AUTOMÁTICAMENTE ---
app.post('/media/tmdb', async (req, res) => {
  try {
    // Pedimos el ID de TMDB y el tipo (PELICULA o SERIE) desde Thunder Client
    const { tmdbId, tipo } = req.body;

    if (!tmdbId || !tipo) {
      return res.status(400).json({ error: 'Faltan datos. Necesitas enviar tmdbId y tipo' });
    }

    // Le decimos a TMDB si debe buscar en su base de datos de películas (movie) o series (tv)
    const tmdbType = tipo === 'PELICULA' ? 'movie' : 'tv';

    // Construimos la URL para obtener los detalles exactos usando el ID
    const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?language=es-ES&api_key=${process.env.TMDB_API_KEY}`;
    
    // Hacemos la petición a TMDB
    const response = await fetch(url);
    const tmdbData = await response.json();

    // Si TMDB nos devuelve un error (ej. el ID no existe)
    if (tmdbData.success === false) {
      return res.status(404).json({ error: 'No se encontró el medio en TMDB' });
    }

    // TMDB guarda el año de películas en "release_date" y el de series en "first_air_date". 
    // Lo extraemos y nos quedamos solo con los primeros 4 dígitos (el año).
    const dateString = tmdbData.release_date || tmdbData.first_air_date || '';
    const anio = dateString ? parseInt(dateString.split('-')[0]) : null;

    // Guardamos en nuestra base de datos traduciendo lo de TMDB a tu schema.prisma
    const newMedia = await prisma.media.create({
      data: {
        titulo: tmdbData.title || tmdbData.name, // title es para pelis, name para series
        tipo: tipo, // Usamos el enum estricto de tu Prisma (PELICULA)
        anio: anio,
        sinopsis: tmdbData.overview,
        // Construimos la URL completa para que la imagen se pueda ver directamente
        portada: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : null,
      },
    });

    // Devolvemos tu registro recién creado
    res.json(newMedia);
  } catch (error) {
    console.error("Error al guardar desde TMDB:", error);
    res.status(500).json({ error: 'Hubo un error al guardar en la base de datos' });
  }
});

// --- RUTA PARA OBTENER UNA SOLA PELÍCULA POR SU ID ---
app.get('/media/:id', async (req, res) => {
  try {
    const idParam = parseInt(req.params.id);
    const mediaItem = await prisma.media.findUnique({
      where: { id: idParam }
    });
    
    if (!mediaItem) return res.status(404).json({ error: 'No encontrado' });
    res.json(mediaItem);
  } catch (error) {
    console.error("Error al buscar por ID:", error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// --- INICIO DEL SERVIDOR ---
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});