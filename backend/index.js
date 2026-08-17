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

// --- TOKEN DE IGDB (vía Twitch): se pide una vez y se reutiliza hasta que caduca ---
let igdbToken = null;
let igdbTokenExpira = 0;

async function getIgdbToken() {
  if (igdbToken && Date.now() < igdbTokenExpira) {
    return igdbToken; // seguimos teniendo uno válido, no pedimos otro
  }

  const url = `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`;
  const res = await fetch(url, { method: 'POST' });
  const data = await res.json();

  igdbToken = data.access_token;
  // Restamos 60 segundos de margen por seguridad antes de que caduque de verdad
  igdbTokenExpira = Date.now() + (data.expires_in - 60) * 1000;

  return igdbToken;
}

// --- BUSCAR JUEGOS EN IGDB ---
app.get('/igdb/search', async (req, res) => {
  try {
    const searchQuery = req.query.q;
    if (!searchQuery) return res.status(400).json({ error: 'Falta término' });

    const token = await getIgdbToken();

    const body = `search "${searchQuery}"; fields name,cover.url,first_release_date,summary; limit 20;`;

    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.IGDB_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'text/plain'
      },
      body
    });

    const data = await response.json();

    // IGDB devuelve las URLs sin "https:" y en tamaño miniatura (t_thumb) — las arreglamos aquí
    const arreglados = (data || []).map(juego => ({
      ...juego,
      cover: juego.cover ? {
        ...juego.cover,
        url: `https:${juego.cover.url.replace('t_thumb', 't_cover_big')}`
      } : null
    }));

    res.json(arreglados);
  } catch (error) {
    console.error('ERROR EN GET /igdb/search:', error);
    res.status(500).json({ error: 'Error al buscar en IGDB' });
  }
});

// --- ARREGLA LAS URLS DE PORTADA DE IGDB (sin "https:" y en miniatura por defecto) ---
function arreglarCoverIgdb(juego) {
  return {
    ...juego,
    cover: juego.cover ? {
      ...juego.cover,
      url: `https:${juego.cover.url.replace('t_thumb', 't_cover_big')}`
    } : null
  };
}

// --- JUEGOS MÁS POPULARES DE LA HISTORIA (por número de valoraciones) ---
app.get('/igdb/popular', async (req, res) => {
  try {
    const token = await getIgdbToken();
    const body = `fields name,cover.url,first_release_date,summary; where total_rating_count != null; sort total_rating_count desc; limit 20;`;
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.IGDB_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'text/plain'
      },
      body
    });
    const data = await response.json();
    res.json((data || []).map(arreglarCoverIgdb));
  } catch (error) {
    console.error('ERROR EN GET /igdb/popular:', error);
    res.status(500).json({ error: 'Error al obtener juegos populares' });
  }
});

// --- POPULARES HISTÓRICOS, PAGINADOS DE 42 EN 42 ---
app.get('/igdb/popular/page/:page', async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const itemsPerPage = 42;
    const offset = (page - 1) * itemsPerPage;

    const token = await getIgdbToken();
    const body = `fields name,cover.url,first_release_date,summary; where total_rating_count != null; sort total_rating_count desc; limit ${itemsPerPage}; offset ${offset};`;
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.IGDB_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'text/plain'
      },
      body
    });
    const data = await response.json();
    res.json({ results: (data || []).map(arreglarCoverIgdb) });
  } catch (error) {
    console.error('ERROR EN GET /igdb/popular/page:', error);
    res.status(500).json({ error: 'Error al obtener juegos populares' });
  }
});

// --- JUEGOS DE UN AÑO CONCRETO (vista previa del lobby, 20 resultados) ---
app.get('/igdb/year/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const desde = Math.floor(new Date(Date.UTC(year, 0, 1)).getTime() / 1000);
    const hasta = Math.floor(new Date(Date.UTC(year, 11, 31, 23, 59, 59)).getTime() / 1000);

    const token = await getIgdbToken();
    const body = `fields name,cover.url,first_release_date,summary; where first_release_date >= ${desde} & first_release_date <= ${hasta}; sort hypes desc; limit 20;`;
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.IGDB_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'text/plain'
      },
      body
    });
    const data = await response.json();
    res.json((data || []).map(arreglarCoverIgdb));
  } catch (error) {
    console.error('ERROR EN GET /igdb/year:', error);
    res.status(500).json({ error: 'Error al obtener juegos del año' });
  }
});

// --- JUEGOS DE UN AÑO, PAGINADOS DE 42 EN 42 ---
app.get('/igdb/year/:year/page/:page', async (req, res) => {
  try {
    const year = parseInt(req.params.year);
    const page = parseInt(req.params.page) || 1;
    const itemsPerPage = 42;
    const offset = (page - 1) * itemsPerPage;

    const desde = Math.floor(new Date(Date.UTC(year, 0, 1)).getTime() / 1000);
    const hasta = Math.floor(new Date(Date.UTC(year, 11, 31, 23, 59, 59)).getTime() / 1000);

    const token = await getIgdbToken();
    const body = `fields name,cover.url,first_release_date,summary; where first_release_date >= ${desde} & first_release_date <= ${hasta}; sort hypes desc; limit ${itemsPerPage}; offset ${offset};`;
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.IGDB_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'text/plain'
      },
      body
    });
    const data = await response.json();
    res.json({ page, results: (data || []).map(arreglarCoverIgdb) });
  } catch (error) {
    console.error('ERROR EN GET /igdb/year/page:', error);
    res.status(500).json({ error: 'Error al obtener juegos del año' });
  }
});

// --- TRADUCTOR AUTOMÁTICO (MyMemory, gratis, sin clave) ---
// Solo se usa para juegos: es la única fuente de texto que no tenemos en varios idiomas de origen.
async function traducirTexto(texto, idiomaDestino) {
  if (!texto) return texto;
  try {
    const destino = idiomaDestino.split('-')[0]; // "es-ES" -> "es"

    // La API gratuita de MyMemory limita las peticiones anónimas a 500 caracteres;
    // si el resumen es más largo, lo recortamos ANTES de mandarlo para no disparar el error.
    const textoParaTraducir = texto.length > 490 ? texto.slice(0, 490) : texto;

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textoParaTraducir)}&langpair=en|${destino}`;
    const res = await fetch(url);
    const data = await res.json();

    const traducido = data.responseData?.translatedText;
    const statusOk = String(data.responseStatus) === '200';
    // A veces MyMemory devuelve HTTP 200 pero mete el mensaje de error DENTRO de
    // translatedText (ej. "QUERY LENGTH LIMIT EXCEEDED..."), así que además de mirar
    // responseStatus comprobamos que el texto no parezca un error en mayúsculas.
    const pareceError = !traducido || !statusOk || /LIMIT EXCEEDED|INVALID|ERROR/i.test(traducido);

    return pareceError ? texto : traducido;
  } catch (e) {
    console.error('Error al traducir con MyMemory:', e);
    return texto; // si falla, nos quedamos con el original en inglés
  }
}

// --- BUSCAR CARÁTULAS Y BANNERS EN STEAMGRIDDB ---
// SteamGridDB tiene muchas más opciones de carátula por juego que IGDB (que solo da una oficial).
async function buscarJuegoEnSteamGridDB(nombre) {
  const res = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(nombre)}`, {
    headers: { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` }
  });
  const data = await res.json();
  return data?.data?.[0]?.id || null; // el primer resultado suele ser el más relevante
}

app.get('/steamgriddb/images/:mediaId', async (req, res) => {
  try {
    const mediaId = parseInt(req.params.mediaId);
    const media = await prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return res.status(404).json({ error: 'No encontrado' });

    const sgdbId = await buscarJuegoEnSteamGridDB(media.tituloOriginal || media.titulo);
    if (!sgdbId) return res.json({ covers: [], heroes: [] });

    const headers = { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` };

    // "grids" en formato vertical (carátula tipo póster) = dimensiones 600x900
    const resCovers = await fetch(`https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?dimensions=600x900`, { headers });
    const dataCovers = await resCovers.json();

    // "heroes" = imagen ancha tipo banner
    const resHeroes = await fetch(`https://www.steamgriddb.com/api/v2/heroes/game/${sgdbId}`, { headers });
    const dataHeroes = await resHeroes.json();

    res.json({
      covers: (dataCovers?.data || []).map(g => g.url),
      heroes: (dataHeroes?.data || []).map(h => h.url)
    });
  } catch (error) {
    console.error('ERROR EN GET /steamgriddb/images/:mediaId:', error);
    res.status(500).json({ error: 'Error al buscar imágenes en SteamGridDB' });
  }
});

// --- GUARDAR UN JUEGO DESDE IGDB ---
app.post('/media/igdb', async (req, res) => {
  try {
    const { igdbId } = req.body;
    const token = await getIgdbToken();

    const body = `fields name,cover.url,first_release_date,summary; where id = ${igdbId};`;
    const response = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': process.env.IGDB_CLIENT_ID,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'Content-Type': 'text/plain'
      },
      body
    });
    const data = await response.json();
    const juego = data[0];
    if (!juego) return res.status(404).json({ error: 'Juego no encontrado en IGDB' });

    const portadaUrl = juego.cover
      ? `https:${juego.cover.url.replace('t_thumb', 't_cover_big')}`
      : null;

    // IGDB no trae banners tipo "hero" (solo la carátula oficial), así que para el banner
    // por defecto pedimos a SteamGridDB y nos quedamos con el primer resultado.
    // Si no encuentra nada o falla la petición, el juego se guarda igualmente sin banner
    // (el usuario siempre puede elegir uno a mano con "Cambiar carátula / banner").
    let backdropUrl = null;
    try {
      const sgdbId = await buscarJuegoEnSteamGridDB(juego.name);
      if (sgdbId) {
        const resHeroes = await fetch(`https://www.steamgriddb.com/api/v2/heroes/game/${sgdbId}`, {
          headers: { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` }
        });
        const dataHeroes = await resHeroes.json();
        backdropUrl = dataHeroes?.data?.[0]?.url || null;
      }
    } catch (e) {
      console.error('No se pudo obtener banner de SteamGridDB para', juego.name, e);
    }

    const nuevoMedia = await prisma.media.create({
      data: {
        igdbId: juego.id,
        titulo: juego.name,
        tituloOriginal: juego.name,
        tipo: 'VIDEOJUEGO',
        anio: juego.first_release_date
          ? new Date(juego.first_release_date * 1000).getFullYear()
          : null,
        portada: portadaUrl,
        backdrop: backdropUrl,
        sinopsis: juego.summary || null,
        sinopsisTraducciones: {}
      }
    });

    res.json(nuevoMedia);
  } catch (error) {
    console.error('ERROR EN POST /media/igdb:', error);
    res.status(500).json({ error: 'Error al guardar el juego' });
  }
});

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

// --- IDIOMA / REGIÓN: el frontend los manda en cada petición (?language=&region=) ---
// leídos de las preferencias guardadas del usuario (o localStorage si no ha iniciado sesión).
// Si no llegan, caen a los valores por defecto de siempre.
function getLang(req) {
  return req.query.language || 'es-ES';
}
function getRegion(req) {
  return req.query.region || 'ES';
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

// --- MI CATÁLOGO: solo lo que YO he marcado de alguna forma (visto, like, watchlist, nota, o en alguna lista) ---
app.get('/media/mine', requireAuth, async (req, res) => {
  try {
    const interacciones = await prisma.userMedia.findMany({
      where: {
        userId: req.userId,
        OR: [
          { watched: true },
          { liked: true },
          { watchlist: true },
          { rating: { not: null } }
        ]
      },
      select: { mediaId: true }
    });

    const itemsEnListas = await prisma.listItem.findMany({
      where: { list: { userId: req.userId } },
      select: { mediaId: true }
    });

    const mediaIds = [...new Set([
      ...interacciones.map(i => i.mediaId),
      ...itemsEnListas.map(i => i.mediaId)
    ])];

    const mediaItems = await prisma.media.findMany({ where: { id: { in: mediaIds } } });
    res.json(mediaItems);
  } catch (error) {
    console.error('ERROR EN GET /media/mine:', error);
    res.status(500).json({ error: 'Error al obtener tu catálogo' });
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
    const url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(searchQuery)}&language=${getLang(req)}&api_key=${process.env.TMDB_API_KEY}`;
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
    const lang = getLang(req);
    const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=${lang}`);
    const data = await response.json();

    const backdropUrl = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null;
    const posterUrl = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;

    const newMedia = await prisma.media.create({
      data: {
        tmdbId: data.id,
        titulo: data.title || data.name,
        tituloOriginal: data.original_title || data.original_name || data.title || data.name,
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
      orderBy: { updatedAt: 'desc' }
    });

    const mediaIds = entries.map(e => e.mediaId);
    const mediaItems = await prisma.media.findMany({ where: { id: { in: mediaIds } } });

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

app.patch('/media/:id/backdrop', async (req, res) => {
  try {
    const { id } = req.params;
    const { newBackdropUrl } = req.body;
    const updatedMedia = await prisma.media.update({
      where: { id: parseInt(id) },
      data: { backdrop: newBackdropUrl }
    });
    res.json(updatedMedia);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el banner' });
  }
});

// --- RUTAS PARA EL LOBBY ---
app.get('/tmdb/now_playing', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/movie/now_playing?api_key=${apiKey}&language=${getLang(req)}&page=1`);
    const data = await response.json();
    res.json(data.results);
  } catch (error) {
    res.status(500).json({ error: "Error" });
  }
});

app.get('/tmdb/popular', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/movie/popular?api_key=${apiKey}&language=${getLang(req)}&page=1`);
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
    const response = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${getLang(req)}&sort_by=vote_count.desc&page=1`);
    const data = await response.json();
    res.json(data.results || []);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener las populares históricas" });
  }
});

// --- POPULARES HISTÓRICAS, PAGINADAS DE 42 EN 42 ---
app.get('/tmdb/popular-historico/page/:page', async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const apiKey = process.env.TMDB_API_KEY;

    const itemsPerPage = 42;
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = page * itemsPerPage;

    const startTmdbPage = Math.floor(startIndex / 20) + 1;
    const endTmdbPage = Math.ceil(endIndex / 20);

    let combined = [];

    for (let i = startTmdbPage; i <= endTmdbPage; i++) {
      const response = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${getLang(req)}&sort_by=vote_count.desc&page=${i}`);
      const data = await response.json();
      if (data.results) combined.push(...data.results);
    }

    const offsetDentroDeCombined = startIndex - (startTmdbPage - 1) * 20;
    const resultado = combined.slice(offsetDentroDeCombined, offsetDentroDeCombined + itemsPerPage);

    res.json({ results: resultado });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener populares históricas" });
  }
});

// --- RUTA PARA EL LOBBY DE UN AÑO (Solo 20 resultados para la vista previa) ---
app.get('/tmdb/year/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${getLang(req)}&primary_release_year=${year}&sort_by=popularity.desc&page=1`);
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

    const itemsPerPage = 42;
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = page * itemsPerPage;

    const startTmdbPage = Math.floor(startIndex / 20) + 1;
    const endTmdbPage = Math.ceil(endIndex / 20);

    let combined = [];

    for (let i = startTmdbPage; i <= endTmdbPage; i++) {
      const response = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${getLang(req)}&primary_release_year=${year}&sort_by=popularity.desc&page=${i}`);
      const data = await response.json();
      if (data.results) combined.push(...data.results);
    }

    const uniqueCombined = Array.from(new Map(combined.map(m => [m.id, m])).values());

    const offset = startIndex % 20;
    const finalResults = uniqueCombined.slice(offset, offset + itemsPerPage);

    res.json({ page, results: finalResults });
  } catch (error) {
    console.error("Error obteniendo pelis paginadas:", error);
    res.status(500).json({ error: "Error al obtener películas" });
  }
});

// --- RUTA PARA OBTENER PRECUELA Y SECUELA (COLECCIÓN) ---
// --- BUSCA EN WIKIDATA EL ORDEN NARRATIVO REAL (P155 "sigue a" / P156 "seguido por") ---
async function buscarOrdenNarrativoWikidata(imdbId) {
  try {
    const sparql = `
      SELECT ?followsImdb ?followedByImdb WHERE {
        ?film wdt:P345 "${imdbId}" .
        OPTIONAL { ?film wdt:P155 ?follows . ?follows wdt:P345 ?followsImdb . }
        OPTIONAL { ?film wdt:P156 ?followedBy . ?followedBy wdt:P345 ?followedByImdb . }
      } LIMIT 1
    `;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const wdRes = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'MediaTrackerApp/1.0 (proyecto personal)'
      }
    });
    const wdData = await wdRes.json();
    const binding = wdData.results?.bindings?.[0];
    return {
      followsImdb: binding?.followsImdb?.value || null,
      followedByImdb: binding?.followedByImdb?.value || null
    };
  } catch (e) {
    return { followsImdb: null, followedByImdb: null };
  }
}

app.get('/tmdb/collection/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;

    const movieRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=${getLang(req)}`);
    const movieData = await movieRes.json();

    if (!movieData.belongs_to_collection) {
      return res.json({ prequel: null, sequel: null, nombreColeccion: null, parts: [] });
    }

    const collectionId = movieData.belongs_to_collection.id;
    const colRes = await fetch(`https://api.themoviedb.org/3/collection/${collectionId}?api_key=${apiKey}&language=${getLang(req)}`);
    const colData = await colRes.json();

    const parts = colData.parts.sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    const currentIndex = parts.findIndex(p => p.id === parseInt(tmdbId));

    // Por defecto: orden por fecha de estreno (como hasta ahora)
    let prequel = currentIndex > 0 ? parts[currentIndex - 1] : null;
    let sequel = currentIndex < parts.length - 1 ? parts[currentIndex + 1] : null;

    // Afinamos con el orden NARRATIVO real de Wikidata, si lo tiene documentado
    try {
      const extRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${apiKey}`);
      const extData = await extRes.json();

      if (extData.imdb_id) {
        const { followsImdb, followedByImdb } = await buscarOrdenNarrativoWikidata(extData.imdb_id);

        const buscarPeliculaPorImdb = async (imdb) => {
          const findRes = await fetch(`https://api.themoviedb.org/3/find/${imdb}?api_key=${apiKey}&external_source=imdb_id&language=${getLang(req)}`);
          const findData = await findRes.json();
          return findData.movie_results?.[0] || null;
        };

        if (followsImdb) {
          const encontrada = await buscarPeliculaPorImdb(followsImdb);
          if (encontrada) prequel = parts.find(p => p.id === encontrada.id) || encontrada;
        }
        if (followedByImdb) {
          const encontrada = await buscarPeliculaPorImdb(followedByImdb);
          if (encontrada) sequel = parts.find(p => p.id === encontrada.id) || encontrada;
        }
      }
    } catch (e) {
      // si Wikidata falla, nos quedamos con el orden por fecha de estreno
    }

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
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=${getLang(req)}&append_to_response=credits`
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

// --- DÓNDE VER (datos de JustWatch a través de TMDB) ---
app.get('/tmdb/watch-providers/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const region = req.query.region || 'ES';

    const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${apiKey}`);
    const data = await response.json();

    const paisData = data.results?.[region] || null;

    res.json({
      link: paisData?.link || null,
      flatrate: paisData?.flatrate || [],
      rent: paisData?.rent || [],
      buy: paisData?.buy || [],
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener dónde ver" });
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

    const { password: _, ...userSinPassword } = newUser;
    res.status(201).json(userSinPassword);
  } catch (error) {
    console.error('ERROR DETALLADO EN REGISTRO:', error);
    if (error.code === 'P2002') {
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

// --- BUSCA EN WIKIDATA SI ESTA PELÍCULA (por su IMDb ID) ES UN REMAKE DE OTRA ---
async function buscarRemakeEnWikidata(tmdbId) {
  try {
    const apiKey = process.env.TMDB_API_KEY;

    const extRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${apiKey}`);
    const extData = await extRes.json();
    const imdbId = extData.imdb_id;
    if (!imdbId) return null;

    const sparql = `
      SELECT ?originalLabel ?imdbId WHERE {
        ?film wdt:P345 "${imdbId}" .
        ?film wdt:P144 ?original .
        ?original wdt:P31/wdt:P279* wd:Q11424 .
        OPTIONAL { ?original wdt:P345 ?imdbId . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
      } LIMIT 1
    `;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const wdRes = await fetch(url, {
      headers: {
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'MediaTrackerApp/1.0 (proyecto personal)'
      }
    });
    const wdData = await wdRes.json();
    const binding = wdData.results?.bindings?.[0];
    if (!binding || !binding.imdbId) return null;

    const findRes = await fetch(`https://api.themoviedb.org/3/find/${binding.imdbId.value}?api_key=${apiKey}&external_source=imdb_id`);
    const findData = await findRes.json();
    const originalTmdb = findData.movie_results?.[0];
    if (!originalTmdb) return null;

    return originalTmdb.id;
  } catch (error) {
    console.error('Error consultando Wikidata para remake:', error);
    return null;
  }
}

// --- RUTA PARA OBTENER UNA SOLA PELÍCULA POR SU ID ---
app.get('/media/:id', async (req, res) => {
  try {
    const idParam = parseInt(req.params.id);
    let mediaItem = await prisma.media.findUnique({ where: { id: idParam } });
    if (!mediaItem) return res.status(404).json({ error: 'No encontrado' });

    if (!mediaItem.remakeChecked && mediaItem.tmdbId && mediaItem.tipo === 'PELICULA') {
      const remakeOfTmdbId = await buscarRemakeEnWikidata(mediaItem.tmdbId);
      mediaItem = await prisma.media.update({
        where: { id: idParam },
        data: { remakeOfTmdbId, remakeChecked: true }
      });
    }

    const lang = getLang(req);
    const apiKey = process.env.TMDB_API_KEY;

    // El registro local (mediaItem.titulo / .sinopsis) se guardó en el idioma que estuviera
    // activo la primera vez que alguien abrió esta ficha, y no se actualiza solo.
    // Para que la ficha respete el idioma elegido AHORA, pedimos una versión fresca a TMDB
    // en ese idioma y la superponemos, sin tocar lo que hay guardado en la base de datos
    // (así el dato local sigue sirviendo de fallback si TMDB falla, y el slug/tituloOriginal
    // nunca se ve afectado por este overlay).
    let tituloMostrado = mediaItem.titulo;
    let sinopsisMostrada = mediaItem.sinopsis;
    if (mediaItem.tmdbId) {
      try {
        const liveRes = await fetch(`https://api.themoviedb.org/3/movie/${mediaItem.tmdbId}?api_key=${apiKey}&language=${lang}`);
        const live = await liveRes.json();
        if (live && !live.status_code) {
          tituloMostrado = live.title || tituloMostrado;
          sinopsisMostrada = live.overview || sinopsisMostrada;
        }
      } catch (e) {
        // si TMDB falla, nos quedamos con lo que había en caché local
      }
    }

    // Para juegos: traducimos el resumen (viene de IGDB, siempre en inglés) al idioma elegido.
    // Se traduce solo la primera vez por idioma, y se guarda en caché para no volver a llamar
    // al traductor cada vez que se abre la ficha.
    if (mediaItem.tipo === 'VIDEOJUEGO' && mediaItem.sinopsis) {
      if (lang.startsWith('en')) {
        sinopsisMostrada = mediaItem.sinopsis; // ya está en inglés, el idioma original
      } else {
        const cache = mediaItem.sinopsisTraducciones || {};
        const cacheParaError = /LIMIT EXCEEDED|INVALID|ERROR/i.test(cache[lang] || '');
        if (cache[lang] && !cacheParaError) {
          sinopsisMostrada = cache[lang];
        } else {
          const traducido = await traducirTexto(mediaItem.sinopsis, lang);
          sinopsisMostrada = traducido;
          const nuevaCache = { ...cache, [lang]: traducido };
          mediaItem = await prisma.media.update({
            where: { id: idParam },
            data: { sinopsisTraducciones: nuevaCache }
          });
        }
      }
    }

    let remakeOf = null;
    if (mediaItem.remakeOfTmdbId) {
      try {
        const r = await fetch(`https://api.themoviedb.org/3/movie/${mediaItem.remakeOfTmdbId}?api_key=${apiKey}&language=${lang}`);
        const original = await r.json();
        remakeOf = {
          tmdbId: mediaItem.remakeOfTmdbId,
          titulo: original.title,
          anio: original.release_date ? original.release_date.split('-')[0] : null
        };
      } catch (e) {
        remakeOf = null;
      }
    }

    res.json({ ...mediaItem, titulo: tituloMostrado, sinopsis: sinopsisMostrada, remakeOf });
  } catch (error) {
    console.error('ERROR EN GET /media/:id:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// --- OBTENER MI ESTADO PERSONAL CON UNA PELÍCULA ---
app.get('/media/:id/status', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const status = await prisma.userMedia.findUnique({
      where: { userId_mediaId: { userId: req.userId, mediaId } }
    });

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

// --- OBTENER MI PERFIL (avatar, username, etc) ---
app.get('/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { password: _, ...userSinPassword } = user;
    res.json(userSinPassword);
  } catch (error) {
    console.error('ERROR EN GET /auth/me:', error);
    res.status(500).json({ error: 'Error al obtener el perfil' });
  }
});

// --- ACTUALIZAR MI AVATAR (recibe la imagen ya recortada, en base64) ---
app.patch('/auth/me/avatar', requireAuth, async (req, res) => {
  try {
    const { avatar } = req.body;
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { avatar }
    });
    const { password: _, ...userSinPassword } = user;
    res.json(userSinPassword);
  } catch (error) {
    console.error('ERROR EN PATCH /auth/me/avatar:', error);
    res.status(500).json({ error: 'Error al actualizar el avatar' });
  }
});

// --- ACTUALIZAR MIS PREFERENCIAS DE IDIOMA Y REGIÓN ---
// idioma: código ISO 639-1 + país tipo "en-US" (formato que espera TMDB en el parámetro `language`)
// region: código ISO 3166-1 tipo "US" (formato que espera TMDB en `watch/providers` y `discover`)
app.patch('/auth/me/preferences', requireAuth, async (req, res) => {
  try {
    const { idioma, region } = req.body;

    const data = {};
    if (idioma) {
      if (!/^[a-z]{2}-[A-Z]{2}$/.test(idioma)) {
        return res.status(400).json({ error: 'Formato de idioma inválido (ej: en-US)' });
      }
      data.idioma = idioma;
    }
    if (region) {
      if (!/^[A-Z]{2}$/.test(region)) {
        return res.status(400).json({ error: 'Formato de región inválido (ej: US)' });
      }
      data.region = region;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    const user = await prisma.user.update({ where: { id: req.userId }, data });
    const { password: _, ...userSinPassword } = user;
    res.json(userSinPassword);
  } catch (error) {
    console.error('ERROR EN PATCH /auth/me/preferences:', error);
    res.status(500).json({ error: 'Error al actualizar las preferencias' });
  }
});

// --- MIS PELÍCULAS FAVORITAS (máximo 3, ordenadas) ---
app.get('/favorites', requireAuth, async (req, res) => {
  try {
    const favs = await prisma.favorite.findMany({
      where: { userId: req.userId },
      orderBy: { orden: 'asc' }
    });
    const mediaIds = favs.map(f => f.mediaId);
    const mediaItems = await prisma.media.findMany({ where: { id: { in: mediaIds } } });
    const resultado = favs.map(f => mediaItems.find(m => m.id === f.mediaId)).filter(Boolean);
    res.json(resultado);
  } catch (error) {
    console.error('ERROR EN GET /favorites:', error);
    res.status(500).json({ error: 'Error al obtener favoritos' });
  }
});

// --- GUARDAR MIS FAVORITAS (reemplaza la lista entera) ---
app.put('/favorites', requireAuth, async (req, res) => {
  try {
    const { mediaIds } = req.body; // array de ids locales, en el orden deseado
    await prisma.favorite.deleteMany({ where: { userId: req.userId } });
    const creadas = await Promise.all(
      (mediaIds || []).slice(0, 7).map((mediaId, index) =>
        prisma.favorite.create({ data: { userId: req.userId, mediaId, orden: index } })
      )
    );
    res.json(creadas);
  } catch (error) {
    console.error('ERROR EN PUT /favorites:', error);
    res.status(500).json({ error: 'Error al guardar favoritos' });
  }
});

// --- ACTUALIZAR MI ESTADO PERSONAL CON UNA PELÍCULA ---
app.patch('/media/:id/status', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const { watched, liked, watchlist, rating, customPoster } = req.body;

    const data = {};
    if (watched !== undefined) data.watched = watched;
    if (liked !== undefined) data.liked = liked;
    if (watchlist !== undefined) data.watchlist = watchlist;
    if (rating !== undefined) data.rating = rating;
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

    let tmdbAvg = null;
    const media = await prisma.media.findUnique({ where: { id: mediaId }, select: { tmdbId: true } });

    if (media?.tmdbId) {
      try {
        const apiKey = process.env.TMDB_API_KEY;
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${media.tmdbId}?api_key=${apiKey}`);
        const tmdbData = await tmdbRes.json();
        if (tmdbData.vote_average) tmdbAvg = tmdbData.vote_average;
      } catch (e) { }
    }

    if (tmdbAvg === null && count === 0) {
      return res.json({ average: null, count: 0 });
    }

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

// --- MIS LISTAS: obtener todas (con miniaturas y, opcionalmente, si contienen una película concreta) ---
app.get('/lists', requireAuth, async (req, res) => {
  try {
    const mediaId = req.query.mediaId ? parseInt(req.query.mediaId) : null;
    const lists = await prisma.list.findMany({
      where: { userId: req.userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });

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

// --- BORRAR UNA LISTA ENTERA ---
app.delete('/lists/:id', requireAuth, async (req, res) => {
  try {
    const listId = parseInt(req.params.id);

    const list = await prisma.list.findUnique({ where: { id: listId } });
    if (!list || list.userId !== req.userId) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }

    // Borramos primero las películas que contiene (ListItem), luego la lista
    await prisma.listItem.deleteMany({ where: { listId } });
    await prisma.list.delete({ where: { id: listId } });

    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE LIST:', error);
    res.status(500).json({ error: 'Error al borrar la lista' });
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

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});