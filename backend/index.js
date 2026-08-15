require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PORT = 3001;

// --- MIDDLEWARE: comprueba el token y añade req.userId ---
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No has iniciado sesión' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesión inválida o caducada' });
  }
}

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

// --- MIS PELÍCULAS/SERIES VISTAS (con la fecha en la que se marcaron) ---
// IMPORTANTE: esta ruta va ANTES de /media/:id, si no Express confunde "watched" con un id
app.get('/media/watched', requireAuth, async (req, res) => {
  try {
    const entries = await prisma.userMedia.findMany({
      where: { userId: req.userId, watched: true },
      orderBy: { updatedAt: 'desc' } // de la más reciente a la más antigua marcada
    });

    const mediaIds = entries.map(e => e.mediaId);
    const mediaItems = await prisma.media.findMany({ where: { id: { in: mediaIds } } });

    // Unimos cada película con la fecha en la que se marcó como vista, respetando el orden
    const resultado = entries
      .map(e => {
        const item = mediaItems.find(m => m.id === e.mediaId);
        return item ? { ...item, fechaVisto: e.updatedAt, rating: e.rating, liked: e.liked } : null;
      })
      .filter(Boolean);

    res.json(resultado);
  } catch (error) {
    console.error('ERROR EN GET WATCHED:', error);
    res.status(500).json({ error: 'Error al obtener las vistas' });
  }
});

// --- MI WATCHLIST (orden: de la última que añadiste a la primera) ---
app.get('/media/watchlist', requireAuth, async (req, res) => {
  try {
    const entries = await prisma.userMedia.findMany({
      where: { userId: req.userId, watchlist: true },
      orderBy: { updatedAt: 'desc' }
    });

    const mediaIds = entries.map(e => e.mediaId);
    const mediaItems = await prisma.media.findMany({ where: { id: { in: mediaIds } } });

    const resultado = entries
      .map(e => {
        const item = mediaItems.find(m => m.id === e.mediaId);
        return item ? { ...item, fechaAgregado: e.updatedAt } : null;
      })
      .filter(Boolean);

    res.json(resultado);
  } catch (error) {
    console.error('ERROR EN GET WATCHLIST:', error);
    res.status(500).json({ error: 'Error al obtener la watchlist' });
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

// --- PELÍCULAS MÁS POPULARES DE LA HISTORIA (por número de votos, no por tendencia del momento) ---
app.get('/tmdb/popular-historico', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=es-ES&sort_by=vote_count.desc&page=1`);
    const data = await response.json();
    res.json(data.results || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener las populares históricas" });
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

    const movieRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=es-ES`);
    const movieData = await movieRes.json();

    if (!movieData.belongs_to_collection) {
      return res.json({ prequel: null, sequel: null, nombreColeccion: null, parts: [] });
    }

    const collectionId = movieData.belongs_to_collection.id;
    const colRes = await fetch(`https://api.themoviedb.org/3/collection/${collectionId}?api_key=${apiKey}&language=es-ES`);
    const colData = await colRes.json();

    const parts = colData.parts.sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    const currentIndex = parts.findIndex(p => p.id === parseInt(tmdbId));

    const prequel = currentIndex > 0 ? parts[currentIndex - 1] : null;
    const sequel = currentIndex < parts.length - 1 ? parts[currentIndex + 1] : null;

    res.json({ prequel, sequel, nombreColeccion: colData.name || null, parts });
  } catch (error) {
    console.error("Error al obtener la colección:", error);
    res.status(500).json({ error: "Error al obtener colección" });
  }
});

// --- RUTA PARA DETALLES COMPLETOS: DURACIÓN, REPARTO, EQUIPO, ESTUDIO, PAÍS, PRESUPUESTO ---
app.get('/tmdb/details/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=es-ES&append_to_response=credits`
    );
    const data = await response.json();

    const director = data.credits?.crew?.find(p => p.job === 'Director') || null;
    const guionistas = data.credits?.crew?.filter(p => p.job === 'Screenplay' || p.job === 'Writer') || [];

    res.json({
      runtime: data.runtime || null,
      presupuesto: data.budget || 0,
      ganancias: data.revenue || 0,
      estudios: data.production_companies?.map(c => c.name) || [],
      paises: data.production_countries?.map(c => c.name) || [],
      cast: data.credits?.cast?.slice(0, 15).map(a => ({
        id: a.id,
        nombre: a.name,
        personaje: a.character,
        foto: a.profile_path ? `https://image.tmdb.org/t/p/w185${a.profile_path}` : null
      })) || [],
      director: director ? { nombre: director.name, id: director.id } : null,
      guionistas: guionistas.map(g => ({ nombre: g.name, id: g.id }))
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener detalles" });
  }
});

// --- REGISTRO DE USUARIO ---
app.post('/auth/register', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Faltan datos: email, username y password son obligatorios' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: { email, username, password: hashedPassword }
    });

    // Nunca devolvemos la contraseña, ni siquiera la cifrada
    const { password: _, ...userSinPassword } = newUser;
    res.status(201).json(userSinPassword);
  } catch (error) {
    console.error('ERROR DETALLADO EN REGISTRO:', error);
    if (error.code === 'P2002') {
      // Error de Prisma cuando se viola una restricción @unique
      return res.status(409).json({ error: 'Ese email o username ya está en uso' });
    }
    res.status(500).json({ error: 'Error al registrar el usuario' });
  }
});

// --- INICIO DE SESIÓN ---
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan datos: email y password son obligatorios' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userSinPassword } = user;
    res.json({ token, user: userSinPassword });
  } catch (error) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// --- OBTENER MI ESTADO PERSONAL CON UNA PELÍCULA ---
app.get('/media/:id/status', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const status = await prisma.userMedia.findUnique({
      where: { userId_mediaId: { userId: req.userId, mediaId } }
    });

    // Si nunca ha interactuado con esta película, devolvemos valores por defecto
    res.json(status || {
      watched: false,
      liked: false,
      watchlist: false,
      rating: null,
      customPoster: null
    });
  } catch (error) {
    console.error('ERROR EN GET STATUS:', error);
    res.status(500).json({ error: 'Error al obtener el estado' });
  }
});

// --- ACTUALIZAR MI ESTADO PERSONAL CON UNA PELÍCULA ---
app.patch('/media/:id/status', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const { watched, liked, watchlist, rating, customPoster } = req.body;

    // Construimos solo con los campos que realmente vienen en la petición
    const data = {};
    if (watched !== undefined) data.watched = watched;
    if (liked !== undefined) data.liked = liked;
    if (watchlist !== undefined) data.watchlist = watchlist;
    if (rating !== undefined) data.rating = rating;
    // Si se pone una nota (rating no nulo), se marca automáticamente como visto
    if (rating !== undefined && rating !== null) data.watched = true;
    if (customPoster !== undefined) data.customPoster = customPoster;

    const status = await prisma.userMedia.upsert({
      where: { userId_mediaId: { userId: req.userId, mediaId } },
      update: data,
      create: { userId: req.userId, mediaId, ...data }
    });

    res.json(status);
  } catch (error) {
    console.error('ERROR EN PATCH STATUS:', error);
    res.status(500).json({ error: 'Error al actualizar el estado' });
  }
});

// --- NOTA MEDIA DE UNA PELÍCULA (calculada entre todos los usuarios) ---
app.get('/media/:id/rating', async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);

    const ratings = await prisma.userMedia.findMany({
      where: { mediaId, rating: { not: null } },
      select: { rating: true }
    });

    const suma = ratings.reduce((acc, r) => acc + r.rating, 0);
    const count = ratings.length;

    // Intentamos obtener la nota base de TMDB (misma escala 0-10)
    let tmdbAvg = null;
    const media = await prisma.media.findUnique({ where: { id: mediaId }, select: { tmdbId: true } });

    if (media?.tmdbId) {
      try {
        const apiKey = process.env.TMDB_API_KEY;
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${media.tmdbId}?api_key=${apiKey}`);
        const tmdbData = await tmdbRes.json();
        if (tmdbData.vote_average) tmdbAvg = tmdbData.vote_average;
      } catch (e) {
        // si falla TMDB, seguimos solo con las notas locales
      }
    }

    // Sin nota de TMDB y sin votos locales: no hay nada que mostrar
    if (tmdbAvg === null && count === 0) {
      return res.json({ average: null, count: 0 });
    }

    // TMDB cuenta como "un voto base" que se combina con las notas de los usuarios
    const pesoBase = tmdbAvg !== null ? 1 : 0;
    const sumaTotal = suma + (tmdbAvg !== null ? tmdbAvg : 0);
    const totalVotos = count + pesoBase;

    const average = sumaTotal / totalVotos;

    res.json({ average: Math.round(average * 10) / 10, count, tmdbAvg });
  } catch (error) {
    console.error('ERROR EN GET RATING:', error);
    res.status(500).json({ error: 'Error al calcular la nota media' });
  }
});

// --- MIS LISTAS: obtener todas ---
// --- MIS LISTAS: obtener todas (con miniaturas y, opcionalmente, si contienen una película concreta) ---
app.get('/lists', requireAuth, async (req, res) => {
  try {
    const mediaId = req.query.mediaId ? parseInt(req.query.mediaId) : null;
    const lists = await prisma.list.findMany({
      where: { userId: req.userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });

    // Traemos las portadas de todas las películas usadas en todas las listas, de una vez
    const todosMediaIds = [...new Set(lists.flatMap(l => l.items.map(i => i.mediaId)))];
    const mediaItems = await prisma.media.findMany({ where: { id: { in: todosMediaIds } } });

    res.json(lists.map(l => {
      const portadas = l.items
        .slice(0, 6)
        .map(i => mediaItems.find(m => m.id === i.mediaId)?.portada)
        .filter(Boolean);

      return {
        id: l.id,
        nombre: l.nombre,
        createdAt: l.createdAt,
        totalItems: l.items.length,
        portadas,
        contieneMedia: mediaId ? l.items.some(i => i.mediaId === mediaId) : undefined
      };
    }));
  } catch (error) {
    console.error('ERROR EN GET LISTS:', error);
    res.status(500).json({ error: 'Error al obtener las listas' });
  }
});

// --- CREAR UNA LISTA NUEVA ---
app.post('/lists', requireAuth, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre de la lista es obligatorio' });
    }
    const list = await prisma.list.create({
      data: { userId: req.userId, nombre: nombre.trim() }
    });
    res.status(201).json(list);
  } catch (error) {
    console.error('ERROR EN POST LISTS:', error);
    res.status(500).json({ error: 'Error al crear la lista' });
  }
});

// --- VER UNA LISTA CONCRETA (con sus películas) ---
app.get('/lists/:id', requireAuth, async (req, res) => {
  try {
    const listId = parseInt(req.params.id);
    const list = await prisma.list.findUnique({
      where: { id: listId },
      include: { items: true }
    });

    if (!list || list.userId !== req.userId) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }

    const mediaIds = list.items.map(i => i.mediaId);
    const mediaItems = await prisma.media.findMany({ where: { id: { in: mediaIds } } });

    res.json({ id: list.id, nombre: list.nombre, items: mediaItems });
  } catch (error) {
    console.error('ERROR EN GET LIST:', error);
    res.status(500).json({ error: 'Error al obtener la lista' });
  }
});

// --- AÑADIR UNA PELÍCULA A UNA LISTA ---
app.post('/lists/:id/items', requireAuth, async (req, res) => {
  try {
    const listId = parseInt(req.params.id);
    const { mediaId } = req.body;

    const list = await prisma.list.findUnique({ where: { id: listId } });
    if (!list || list.userId !== req.userId) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }

    const item = await prisma.listItem.create({
      data: { listId, mediaId }
    });
    res.status(201).json(item);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Esta película ya está en la lista' });
    }
    console.error('ERROR EN POST LIST ITEM:', error);
    res.status(500).json({ error: 'Error al añadir a la lista' });
  }
});

// --- QUITAR UNA PELÍCULA DE UNA LISTA ---
app.delete('/lists/:id/items/:mediaId', requireAuth, async (req, res) => {
  try {
    const listId = parseInt(req.params.id);
    const mediaId = parseInt(req.params.mediaId);

    const list = await prisma.list.findUnique({ where: { id: listId } });
    if (!list || list.userId !== req.userId) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }

    await prisma.listItem.delete({
      where: { listId_mediaId: { listId, mediaId } }
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE LIST ITEM:', error);
    res.status(500).json({ error: 'Error al quitar de la lista' });
  }
});

// --- MIS LISTAS: obtener todas (opcionalmente marcando si contienen una película concreta) ---
app.get('/lists', requireAuth, async (req, res) => {
  try {
    const mediaId = req.query.mediaId ? parseInt(req.query.mediaId) : null;
    const lists = await prisma.list.findMany({
      where: { userId: req.userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(lists.map(l => ({
      id: l.id,
      nombre: l.nombre,
      createdAt: l.createdAt,
      totalItems: l.items.length,
      contieneMedia: mediaId ? l.items.some(i => i.mediaId === mediaId) : undefined
    })));
  } catch (error) {
    console.error('ERROR EN GET LISTS:', error);
    res.status(500).json({ error: 'Error al obtener las listas' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});