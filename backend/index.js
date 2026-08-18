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

// --- COLA DE PETICIONES A IGDB ---
// Su API gratuita limita a unas 4 peticiones por segundo. Como cada ficha de
// juego ahora dispara varias llamadas casi a la vez (remake, DLC, updates,
// colección, detalles...), sin esto IGDB responde 429 y esas secciones se
// quedan vacías o con datos viejos. En vez de espaciarlas una a una (que
// notabas lento al recargar), dejamos pasar varias A LA VEZ hasta un límite,
// y el resto espera en cola hasta que se libera un hueco.
const IGDB_MAX_CONCURRENTE = 4;
let igdbPeticionesEnVuelo = 0;
const igdbCola = [];

function procesarColaIgdb() {
  while (igdbPeticionesEnVuelo < IGDB_MAX_CONCURRENTE && igdbCola.length > 0) {
    const tarea = igdbCola.shift();
    igdbPeticionesEnVuelo++;
    tarea().finally(() => {
      igdbPeticionesEnVuelo--;
      procesarColaIgdb();
    });
  }
}

// Caché corta en memoria: varios componentes de una misma ficha (remake, DLC,
// colección, más contenido...) suelen preguntar por el mismo juego casi a la
// vez, con la misma consulta exacta. En vez de volver a preguntarle a IGDB,
// reutilizamos la respuesta si se pidió hace menos de 5 minutos — esto reduce
// muchísimo el número de peticiones reales y, con ello, los 429.
const IGDB_CACHE_TTL_MS = 5 * 60 * 1000;
const igdbCache = new Map();

function fetchIgdb(url, options) {
  const clave = `${url}::${options?.body || ''}`;
  const cacheado = igdbCache.get(clave);
  if (cacheado && Date.now() < cacheado.expira) {
    return Promise.resolve({
      ok: cacheado.ok,
      status: cacheado.status,
      json: async () => JSON.parse(cacheado.bodyText),
    });
  }

  return new Promise((resolve, reject) => {
    const ejecutar = async () => {
      try {
        let res = await fetch(url, options);
        let intentos = 0;
        // Con varias fichas pidiendo datos a la vez, a veces hasta el
        // reintento se topa otra vez con el límite — reintentamos varias
        // veces con espera creciente (1s, 2s, 3s) en vez de solo una.
        while (res.status === 429 && intentos < 3) {
          intentos++;
          await new Promise((r) => setTimeout(r, 1000 * intentos));
          res = await fetch(url, options);
        }

        // Leemos el cuerpo UNA vez aquí (un Response solo se puede leer una
        // vez) y lo guardamos en caché para que la próxima consulta idéntica
        // no tenga que volver a preguntarle a IGDB.
        const bodyText = await res.text();
        if (res.ok) {
          igdbCache.set(clave, { ok: res.ok, status: res.status, bodyText, expira: Date.now() + IGDB_CACHE_TTL_MS });
        }
        resolve({
          ok: res.ok,
          status: res.status,
          json: async () => JSON.parse(bodyText),
        });
      } catch (err) {
        reject(err);
      }
    };
    igdbCola.push(ejecutar);
    procesarColaIgdb();
  });
}

// --- DETALLES DE UN JUEGO: plataformas, desarrollador, distribuidora, géneros ---
app.get('/igdb/details/:igdbId', async (req, res) => {
  try {
    const { igdbId } = req.params;
    const token = await getIgdbToken();

    const body = `fields platforms.name, genres.name, involved_companies.company.name, involved_companies.developer, involved_companies.publisher; where id = ${igdbId};`;
    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
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

    if (!juego) return res.json({ plataformas: [], generos: [], desarrolladoras: [], distribuidoras: [] });

    const companies = juego.involved_companies || [];

    res.json({
      plataformas: (juego.platforms || []).map(p => p.name),
      generos: (juego.genres || []).map(g => g.name),
      desarrolladoras: companies.filter(c => c.developer).map(c => c.company.name),
      distribuidoras: companies.filter(c => c.publisher).map(c => c.company.name),
    });
  } catch (error) {
    console.error('ERROR EN GET /igdb/details:', error);
    res.status(500).json({ error: 'Error al obtener detalles del juego' });
  }
});

// --- DE QUÉ JUEGO ORIGINAL ES REMAKE ---
// IGDB no guarda "esto es un remake de X" en el propio remake; lo guarda al
// revés, en el juego ORIGINAL, como un array remakes: [ids]. Así que buscamos
// qué juego tiene a igdbId dentro de su lista de remakes.
app.get('/igdb/remake-of/:igdbId', async (req, res) => {
  try {
    const { igdbId } = req.params;
    const token = await getIgdbToken();
    const headers = {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain'
    };

    const body = `fields name, cover.url, first_release_date; where remakes = (${igdbId});`;
    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers,
      body
    });
    const data = await response.json();
    const original = data[0];

    if (!original) return res.json(null);

    res.json({
      igdbId: original.id,
      titulo: original.name,
      anio: original.first_release_date
        ? new Date(original.first_release_date * 1000).getFullYear()
        : null,
      portada: original.cover?.url
        ? `https:${original.cover.url.replace('t_thumb', 't_cover_big')}`
        : null,
    });
  } catch (error) {
    console.error('ERROR EN GET /igdb/remake-of/:igdbId:', error);
    res.status(500).json({ error: 'Error al buscar el juego original' });
  }
});

// A diferencia de los remakes, IGDB SÍ guarda esta relación en el propio DLC/expansión,
// en el campo parent_game — así que aquí no hace falta búsqueda inversa.
app.get('/igdb/dlc-of/:igdbId', async (req, res) => {
  try {
    const { igdbId } = req.params;
    const token = await getIgdbToken();
    const headers = {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain'
    };

    // Antes filtrábamos por el campo "category" del propio juego, pero IGDB lo
    // deja vacío en bastantes títulos (como pasaba con parent_game). En vez de
    // eso, comprobamos directamente lo único que de verdad queríamos descartar:
    // que el juego sea un REMAKE de otro (esos también traen parent_game
    // relleno, para enlazar contenido incluido, pero no son un DLC).
    const bodyEsRemake = `fields id; where remakes = (${igdbId}); limit 1;`;
    const respEsRemake = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: bodyEsRemake });
    const dataEsRemake = await respEsRemake.json();
    if (Array.isArray(dataEsRemake) && dataEsRemake.length > 0) {
      return res.json(null);
    }

    const body = `fields parent_game.name, parent_game.cover.url, parent_game.first_release_date; where id = ${igdbId};`;
    const response = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body });
    const data = await response.json();
    let base = data[0]?.parent_game;

    // Si el propio DLC no tiene relleno su parent_game, buscamos al revés: el
    // juego base que sí lo tenga listado en dlcs/expansions/standalone_expansions/bundles.
    if (!base) {
      const bodyInverso = `fields name, cover.url, first_release_date; where dlcs = (${igdbId}) | expansions = (${igdbId}) | bundles = (${igdbId});`;
      const respInverso = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: bodyInverso });
      const dataInverso = await respInverso.json();
      base = dataInverso[0];
    }

    if (!base) return res.json(null);

    res.json({
      igdbId: base.id,
      titulo: base.name,
      anio: base.first_release_date
        ? new Date(base.first_release_date * 1000).getFullYear()
        : null,
      portada: base.cover?.url
        ? `https:${base.cover.url.replace('t_thumb', 't_cover_big')}`
        : null,
    });
  } catch (error) {
    console.error('ERROR EN GET /igdb/dlc-of/:igdbId:', error);
    res.status(500).json({ error: 'Error al buscar el juego base' });
  }
});

// --- BUSCAR JUEGOS EN IGDB ---
app.get('/igdb/search', async (req, res) => {
  try {
    const searchQuery = req.query.q;
    if (!searchQuery) return res.status(400).json({ error: 'Falta término' });

    const token = await getIgdbToken();

    const body = `search "${searchQuery}"; fields name,cover.url,first_release_date,summary; limit 20;`;

    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
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

// --- ARTWORKS DE IGDB (imágenes anchas tipo key art) COMO RESPALDO DE BANNER ---
// SteamGridDB no siempre tiene "heroes" para juegos muy nuevos o poco conocidos;
// IGDB sí suele tener artworks, que sirven igual de bien como banner.
async function obtenerArtworksIgdb(igdbId) {
  if (!igdbId) return [];
  try {
    const token = await getIgdbToken();
    const body = `fields artworks.image_id; where id = ${igdbId};`;
    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
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
    const artworks = data?.[0]?.artworks || [];
    return artworks.map((a) => `https://images.igdb.com/igdb/image/upload/t_1080p/${a.image_id}.jpg`);
  } catch (error) {
    console.error('Error obteniendo artworks de IGDB:', error);
    return [];
  }
}

// --- JUEGOS MÁS POPULARES DE LA HISTORIA (por número de valoraciones) ---
app.get('/igdb/popular', async (req, res) => {
  try {
    const token = await getIgdbToken();
    const body = `fields name,cover.url,first_release_date,summary; where total_rating_count != null; sort total_rating_count desc; limit 20;`;
    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
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
    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
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
    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
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
    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
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

// --- CACHÉ SIMPLE PARA GÉNEROS Y PLATAFORMAS (apenas cambian, cache 24h) ---
let igdbGenerosCache = null;
let igdbPlataformasCache = null;
let igdbFiltrosCacheExpira = 0;

// --- LISTAS PARA RELLENAR LOS DESPLEGABLES DEL SIDEBAR DE FILTROS ---
app.get('/igdb/filtros', async (req, res) => {
  try {
    if (igdbGenerosCache && igdbPlataformasCache && Date.now() < igdbFiltrosCacheExpira) {
      return res.json({ generos: igdbGenerosCache, plataformas: igdbPlataformasCache });
    }

    const token = await getIgdbToken();
    const headers = {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain'
    };

    const [resGeneros, resPlataformas] = await Promise.all([
      fetchIgdb('https://api.igdb.com/v4/genres', { method: 'POST', headers, body: 'fields id,name; sort name asc; limit 50;' }),
      fetchIgdb('https://api.igdb.com/v4/platforms', { method: 'POST', headers, body: 'fields id,name; sort name asc; limit 200;' }),
    ]);

    igdbGenerosCache = await resGeneros.json();
    igdbPlataformasCache = await resPlataformas.json();
    igdbFiltrosCacheExpira = Date.now() + 24 * 60 * 60 * 1000;

    res.json({ generos: igdbGenerosCache, plataformas: igdbPlataformasCache });
  } catch (error) {
    console.error('ERROR EN GET /igdb/filtros:', error);
    res.status(500).json({ error: 'Error al obtener géneros y plataformas' });
  }
});

// --- CATÁLOGO DE JUEGOS CON FILTROS, PAGINADO DE 42 EN 42 ---
// Sustituye a /igdb/popular/page/:page y /igdb/year/:year/page/:page: hace lo mismo
// que esas dos (según ?modo=popular|year) pero además acepta filtros opcionales:
// ?categorias=0,10 (ids de categoría IGDB, separados por coma)
// ?estado=upcoming|released  (si se manda, manda sobre ?anio)
// ?anio=2019
// ?genero=<id>  ?plataforma=<id>
// ?ratingMin=0  ?ratingMax=5   (escala 0-5, se convierte a la escala 0-100 de IGDB)
app.get('/igdb/catalogo/page/:page', async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const itemsPerPage = 42;
    const offset = (page - 1) * itemsPerPage;

    const { modo, anio, estado, categorias, genero, plataforma, ratingMin, ratingMax } = req.query;

    const condiciones = [];

    const ahora = Math.floor(Date.now() / 1000);
    if (estado === 'upcoming') {
      condiciones.push(`first_release_date > ${ahora}`);
    } else if (estado === 'released') {
      condiciones.push(`first_release_date <= ${ahora}`);
    } else if (anio) {
      const y = parseInt(anio);
      const desde = Math.floor(new Date(Date.UTC(y, 0, 1)).getTime() / 1000);
      const hasta = Math.floor(new Date(Date.UTC(y, 11, 31, 23, 59, 59)).getTime() / 1000);
      condiciones.push(`first_release_date >= ${desde} & first_release_date <= ${hasta}`);
    }

    if (categorias) {
      const ids = String(categorias).split(',').map((c) => parseInt(c)).filter((n) => !Number.isNaN(n));
      if (ids.length > 0) condiciones.push(`category = (${ids.join(',')})`);
    }

    if (genero) condiciones.push(`genres = (${parseInt(genero)})`);
    if (plataforma) condiciones.push(`platforms = (${parseInt(plataforma)})`);

    if (ratingMin || ratingMax) {
      const min = ratingMin ? parseFloat(ratingMin) * 20 : 0;
      const max = ratingMax ? parseFloat(ratingMax) * 20 : 100;
      condiciones.push(`total_rating != null & total_rating >= ${min} & total_rating <= ${max}`);
    }

    const where = condiciones.length > 0 ? `where ${condiciones.join(' & ')};` : '';
    const sort = modo === 'popular' ? 'sort total_rating_count desc;' : 'sort hypes desc;';

    const token = await getIgdbToken();
    const headers = {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain'
    };
    const body = `fields name,cover.url,first_release_date,summary; ${where} ${sort} limit ${itemsPerPage}; offset ${offset};`;

    const [response, countResponse] = await Promise.all([
      fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body }),
      fetchIgdb('https://api.igdb.com/v4/games/count', { method: 'POST', headers, body: where }),
    ]);
    const data = await response.json();
    const countData = await countResponse.json();
    const totalPaginas = Math.max(1, Math.ceil((countData.count || 0) / itemsPerPage));

    res.json({ page, totalPaginas, results: (data || []).map(arreglarCoverIgdb) });
  } catch (error) {
    console.error('ERROR EN GET /igdb/catalogo/page:', error);
    res.status(500).json({ error: 'Error al obtener el catálogo de juegos' });
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

async function getIgdbGameCollection(igdbId) {
  const token = await getIgdbToken();

  // IGDB reparte a veces los juegos de una misma saga en VARIAS "collections"
  // pequeñas (subseries) en lugar de una sola completa, así que quedarnos solo
  // con "la colección más grande" dejaba fuera títulos (p. ej. Resident Evil
  // clásicos en una collection y los spin-off en otra). Por eso pedimos TODAS
  // las collections Y también "franchises" (la agrupación más amplia de IGDB,
  // pensada para toda la saga) y las combinamos, deduplicando por id.
  // version_parent: cuando una entrada es un SKU/edición concreta ("Launch
  // Edition", "Ultimate Edition"...) de OTRO juego ya existente en IGDB, este
  // campo apunta a esa versión canónica. Lo pedimos para poder usar siempre
  // el juego "de verdad" en vez de la edición de tienda.
  const camposJuego = [
    'name', 'slug', 'cover.url', 'first_release_date', 'id', 'game_type', 'status',
    'version_parent.name', 'version_parent.slug', 'version_parent.cover.url',
    'version_parent.first_release_date', 'version_parent.id',
  ];
  const camposCollections = camposJuego.map((c) => `collections.games.${c}`).join(', ');
  const camposFranchises = camposJuego.map((c) => `franchises.games.${c}`).join(', ');
  const query = `
    fields name, collections.name, ${camposCollections},
           franchises.name, ${camposFranchises};
    where id = ${igdbId};
  `;

  const response = await fetchIgdb('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  });

  if (!response.ok) {
    throw new Error(`IGDB respondió ${response.status}`);
  }

  const data = await response.json();
  const collections = data[0]?.collections || [];
  const franchises = data[0]?.franchises || [];

  // Nombre para mostrar: preferimos la primera collection (suele ser más
  // específica, p. ej. "Resident Evil" en vez de "Capcom Survival Horror");
  // si no hay ninguna, usamos la primera franchise.
  const nombre = collections[0]?.name || franchises[0]?.name || null;
  if (!nombre) return null;

  // Las "collections" de IGDB ya vienen bien acotadas al propio juego, así
  // que las aceptamos todas. Las "franchises" son mucho más amplias y a veces
  // arrastran crossovers/cameos con personajes prestados (p. ej. Marvel vs.
  // Capcom, Puzzle Fighter o Teppen para la franquicia de Resident Evil), así
  // que de ahí solo colamos los que además tengan el nombre de la saga en el
  // propio título.
  const juegosDeCollections = new Map();
  for (const c of collections) {
    for (const g of c.games || []) {
      if (!juegosDeCollections.has(g.id)) juegosDeCollections.set(g.id, g);
    }
  }

  const nombreSaga = nombre.toLowerCase();
  const juegosPorId = new Map(juegosDeCollections);
  for (const f of franchises) {
    for (const g of f.games || []) {
      if (juegosPorId.has(g.id)) continue;
      if (g.name && g.name.toLowerCase().includes(nombreSaga)) {
        juegosPorId.set(g.id, g);
      }
    }
  }

  const gamesCombinados = Array.from(juegosPorId.values());

  if (gamesCombinados.length <= 1) return null;

  return { name: nombre, games: gamesCombinados };
}

// --- VINCULACIONES MANUALES DE DLC/UPDATE/MOD ---
// Para casos comprobados donde IGDB muestra la relación en su propia web pero
// no la expone vía API (ni por parent_game, ni por búsqueda de texto) — como
// "MindsEye: Blacklisted", que su web lista bajo "Related Content > Updates"
// pero cuyo parent_game no viene relleno en ningún endpoint público.
// Clave: igdbId del juego BASE. grupo: 'dlc' | 'update' | 'mod'.
const VINCULACIONES_MANUALES = {
  320873: [ // MindsEye
    { igdbId: 400290, grupo: 'update' }, // MindsEye: Blacklisted
  ],
};

async function getIgdbDlcsUpdates(igdbId) {
  const token = await getIgdbToken();

  const headers = {
    'Client-ID': process.env.IGDB_CLIENT_ID,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'text/plain',
  };

  // DLCs y expansiones: se piden como relación DIRECTA del juego principal
  // (campos dlcs / expansions), que suele ser fiable...
  // standalone_expansions (category 4, p. ej. "Miles Morales") ya NO se excluye
  // aquí: en IGDB varios add-ons oficiales que sí requieren el juego base
  // (p. ej. "Half-Life: Opposing Force" / "Blue Shift") están etiquetados como
  // standalone_expansion en vez de expansion, y si los descartamos desaparecen
  // sin más porque tampoco es seguro que la sección de saga los recoja.
  // status se pide para poder separar lo cancelado (status = 6 en IGDB) del
  // contenido publicado de verdad.
  const queryPrincipal = `
    fields name, dlcs.name, dlcs.cover.url, dlcs.first_release_date, dlcs.status,
           expansions.name, expansions.cover.url, expansions.first_release_date, expansions.status,
           standalone_expansions.name, standalone_expansions.cover.url,
           standalone_expansions.first_release_date, standalone_expansions.status;
    where id = ${igdbId};
  `;

  // ...pero no siempre: hay juegos base sin esos campos rellenos aunque el DLC
  // sí tenga bien puesto su propio parent_game. Por eso también buscamos al
  // revés TODO lo que cuelgue de este juego (parent_game = X), salvo lo que
  // sabemos que no es DLC/update (mods, que tienen su propia consulta abajo;
  // remakes/remasters, que van a la sección de saga; y bundles, que son
  // packs/compilaciones). Ya NO excluimos category 4 (standalone_expansion) por
  // el mismo motivo de arriba. No filtramos por category = 14 de forma estricta
  // para "updates": la propia web de IGDB etiqueta algunas entradas como
  // "Update" sin que su category interno sea literalmente 14 (p. ej. "MindsEye:
  // Blacklisted"), así que clasificamos DESPUÉS según la category que traiga
  // cada una, en vez de descartar la que no encaje.
  const queryInverso = `
    fields name, cover.url, first_release_date, category, status;
    where parent_game = ${igdbId} & category != (3,5,8,9);
    limit 50;
  `;

  // Mods: se buscan al revés por parent_game + category 5.
  const queryMods = `
    fields name, cover.url, first_release_date, status;
    where parent_game = ${igdbId} & category = 5;
    limit 50;
  `;

  const [resPrincipal, resInverso, resMods] = await Promise.all([
    fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryPrincipal }),
    fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryInverso }),
    fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryMods }),
  ]);

  if (!resPrincipal.ok || !resInverso.ok || !resMods.ok) {
    throw new Error(`IGDB respondió ${resPrincipal.status} / ${resInverso.status} / ${resMods.status}`);
  }

  const [dataPrincipal, dataInverso, dataMods] = await Promise.all([
    resPrincipal.json(),
    resInverso.json(),
    resMods.json(),
  ]);

  // De lo encontrado por la vía inversa, lo que tenga category = 14 (update)
  // va a "updates"; el resto (dlc_addon, expansion, episode, season, pack...)
  // se suma a los DLCs directos.
  const dataUpdates = (dataInverso || []).filter((g) => g.category === 14);
  const dataInversoSinUpdates = (dataInverso || []).filter((g) => g.category !== 14);

  const juego = dataPrincipal[0] || {};

  // Algunos "updates" (categoría 14) tampoco tienen relleno su propio parent_game
  // en IGDB, así que la búsqueda por relación (arriba) no los encuentra. Como
  // último recurso, para estos SÍ hacemos una búsqueda de texto por el nombre
  // del juego base, filtrando a que el nombre del update lo contenga (evita
  // falsos positivos de nombres parecidos, igual que hacemos con SteamGridDB).
  let updatesEncontrados = dataUpdates || [];
  if (updatesEncontrados.length === 0 && juego.name) {
    const queryUpdatesPorTexto = `
      search "${juego.name}";
      fields name, cover.url, first_release_date, category;
      limit 30;
    `;
    const respUpdatesTexto = await fetchIgdb('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers,
      body: queryUpdatesPorTexto,
    });
    if (respUpdatesTexto.ok) {
      const dataUpdatesTexto = await respUpdatesTexto.json();
      const nombreBaseNormalizado = juego.name.toLowerCase();
      updatesEncontrados = (dataUpdatesTexto || []).filter((g) => {
        if (!g.name || g.id === igdbId) return false;
        const nombreNormalizado = g.name.toLowerCase();
        // No todos los títulos separan el nombre base del resto con dos
        // puntos (p. ej. "MindsEye Blacklisted" en vez de "MindsEye: Blacklisted"),
        // así que comprobamos que empiece por el nombre base seguido de
        // CUALQUIER separador (":", "-", espacio...), pero bloqueando el caso
        // "nombre base + número" para no confundir "Marvel's Spider-Man" con
        // su secuela "Marvel's Spider-Man 2".
        if (!nombreNormalizado.startsWith(nombreBaseNormalizado)) return false;
        const resto = nombreNormalizado.slice(nombreBaseNormalizado.length);
        if (resto !== '' && /^[a-z0-9]/.test(resto)) return false; // pegado sin separador
        if (/^\s*\d/.test(resto)) return false; // "... 2", "... 3"...
        // No todos los updates llevan la palabra "update" en el título (p. ej.
        // "MindsEye: Blacklisted"), así que también vale si IGDB ya lo tiene
        // categorizado como update (14) — con la comprobación de arriba ya
        // descartamos falsos positivos de secuelas/otros juegos.
        return g.category === 14 || nombreNormalizado.includes('update');
      });
    }
  }

  // status = 6 es "Cancelled" en IGDB.
  const ESTA_CANCELADO = (g) => g.status === 6;

  const arreglar = (g) => ({
    igdbId: g.id,
    titulo: g.name,
    portada: g.cover?.url
      ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}`
      : null,
    anio: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
    cancelado: ESTA_CANCELADO(g),
  });

  // De más antigua a más reciente. Las que no tienen fecha se van al final.
  const porAnioAsc = (a, b) => (a.anio || 9999) - (b.anio || 9999);

  const dlcsDirectos = [
    ...(juego.dlcs || []),
    ...(juego.expansions || []),
    ...(juego.standalone_expansions || []),
  ];

  // Deduplicamos por id: un mismo DLC puede salir tanto por la vía directa
  // como por la inversa.
  const idsYaVistos = new Set(dlcsDirectos.map((g) => g.id));
  const dlcsInversos = dataInversoSinUpdates.filter((g) => !idsYaVistos.has(g.id));

  const dlcsTodos = [...dlcsDirectos, ...dlcsInversos].map(arreglar).sort(porAnioAsc);
  const updatesTodos = updatesEncontrados.map(arreglar).sort(porAnioAsc);
  const modsTodos = (dataMods || []).map(arreglar).sort(porAnioAsc);

  // Lo cancelado NO se muestra en "Más contenido": ya aparece en el modal de
  // la saga (endpoint /igdb/collection), junto con entradas principales
  // canceladas como "Half-Life 2: Episode Three". Aquí simplemente se descarta.
  let dlcs = dlcsTodos.filter((g) => !g.cancelado);
  let updates = updatesTodos.filter((g) => !g.cancelado);
  let mods = modsTodos.filter((g) => !g.cancelado);

  // Aplicamos las vinculaciones manuales de arriba, si las hay para este juego.
  const manuales = VINCULACIONES_MANUALES[igdbId] || [];
  if (manuales.length > 0) {
    const idsYaIncluidos = new Set([...dlcs, ...updates, ...mods].map((g) => g.igdbId));
    for (const m of manuales) {
      if (idsYaIncluidos.has(m.igdbId)) continue;
      const bodyManual = `fields name, cover.url, first_release_date; where id = ${m.igdbId};`;
      const respManual = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: bodyManual });
      if (!respManual.ok) continue;
      const dataManual = await respManual.json();
      const juegoManual = dataManual[0];
      if (!juegoManual) continue;
      const arreglado = arreglar(juegoManual);
      if (arreglado.cancelado) continue; // idem: lo cancelado no va en "Más contenido"
      if (m.grupo === 'update') updates.push(arreglado);
      else if (m.grupo === 'mod') mods.push(arreglado);
      else dlcs.push(arreglado);
    }
    dlcs = dlcs.sort(porAnioAsc);
    updates = updates.sort(porAnioAsc);
    mods = mods.sort(porAnioAsc);
  }

  return { dlcs, updates, mods };
}

// --- DLCs, EXPANSIONES Y UPDATES DE UN JUEGO ---
app.get('/igdb/dlcs-updates/:igdbId', async (req, res) => {
  try {
    const igdbId = parseInt(req.params.igdbId, 10);
    if (Number.isNaN(igdbId)) return res.status(400).json({ error: 'igdbId inválido' });

    const resultado = await getIgdbDlcsUpdates(igdbId);
    res.json(resultado);
  } catch (err) {
    console.error('ERROR EN GET /igdb/dlcs-updates/:igdbId:', err);
    res.status(500).json({ error: 'Error al obtener DLCs/updates' });
  }
});

// --- SAGA DE UN VIDEOJUEGO (precuela/secuela + colección completa) ---
app.get('/igdb/collection/:igdbId', async (req, res) => {
  try {
    const igdbId = parseInt(req.params.igdbId, 10);
    if (Number.isNaN(igdbId)) {
      return res.status(400).json({ error: 'igdbId inválido' });
    }

    const collection = await getIgdbGameCollection(igdbId);

    if (!collection || !collection.games) {
      return res.json({ collection: null, games: [], prequel: null, sequel: null });
    }

    // game_type es el campo "vivo" de IGDB (sustituye al antiguo "category",
    // que en muchas entradas viene vacío). Excluimos DLCs (1), expansiones (2),
    // bundles (3), expansiones independientes (4), mods (5), episodios/
    // temporadas (6/7), packs (13) y updates (14). También excluimos "port" (11),
    // "remaster" (9) y "expanded_game" (10) — en la práctica IGDB mete las
    // "Enhanced/Definitive Edition" bajo el tipo 10, no bajo el 9 oficial de
    // "remaster", así que hay que excluir ambos para conseguir el mismo resultado.
    // Se queda "remake" (8), que sí quieres ver (ej. "The Witcher Remake").
    // EXCEPCIÓN: si el juego está cancelado (status = 6), lo dejamos pasar
    // sin importar su game_type — así un DLC/expansión cancelado (p. ej.
    // "Half-Life: Hostile Takeover") aparece junto a las entradas principales
    // canceladas (p. ej. "Half-Life 2: Episode Three") en el apartado de
    // Cancelados, en vez de mezclarse con el contenido publicado de verdad
    // en la pestaña "Más contenido".
    const TIPOS_EXCLUIDOS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14];
    let gamesFiltrados = collection.games.filter(
      (g) => g.status === 6 || !TIPOS_EXCLUIDOS.includes(g.game_type)
    );

    // Si esta entrada es un SKU/edición concreto de OTRO juego ya existente
    // en IGDB (version_parent relleno), usamos ese juego canónico en su lugar
    // — así "Miles Morales - Launch Edition" pasa a ser directamente
    // "Miles Morales", con su propio id/carátula/fecha reales.
    gamesFiltrados = gamesFiltrados.map((g) => (g.version_parent ? { ...g.version_parent, game_type: g.game_type } : g));

    // Red de seguridad para cuando IGDB tampoco tiene puesto version_parent:
    // si hay dos entradas con el mismo nombre base (uno con sufijo de edición
    // y otro sin él), nos quedamos con la que NO lleve sufijo.
    const sufijoEdicion = /\s*[-–:]\s*[^-–:]*\b(edici[oó]n|edition)\b[^-–:]*$/i;
    const quitarSufijoEdicion = (nombre) => nombre.replace(sufijoEdicion, '').trim();
    const nombreBase = (nombre) => quitarSufijoEdicion(nombre).toLowerCase();

    const porNombreBase = new Map();
    for (const g of gamesFiltrados) {
      const clave = nombreBase(g.name);
      const actual = porNombreBase.get(clave);
      if (!actual) {
        porNombreBase.set(clave, g);
        continue;
      }
      const gEsEdicionEspecial = sufijoEdicion.test(g.name);
      const actualEsEdicionEspecial = sufijoEdicion.test(actual.name);
      // Si el que ya teníamos es una edición especial y el nuevo no lo es,
      // el nuevo gana (preferimos siempre la versión sin sufijo).
      if (actualEsEdicionEspecial && !gEsEdicionEspecial) {
        porNombreBase.set(clave, g);
      }
    }
    gamesFiltrados = Array.from(porNombreBase.values());

    // Si algún juego de la saga ya está en tu base de datos local y tiene una
    // carátula personalizada, la usamos en vez de la de IGDB por defecto.
    const locales = await prisma.media.findMany({
      where: { igdbId: { in: gamesFiltrados.map((g) => g.id) } },
      select: { igdbId: true, portada: true },
    });
    const portadaLocalPorIgdbId = Object.fromEntries(
      locales.filter((l) => l.portada).map((l) => [l.igdbId, l.portada])
    );

    const todos = gamesFiltrados
      .map((g) => ({
        igdbId: g.id,
        // Aunque solo exista ESTA entrada (sin una "versión normal" con la que
        // deduplicar, como pasaba con "Miles Morales - Launch Edition"),
        // igualmente le quitamos el sufijo de edición para mostrar el título
        // limpio — el SKU de tienda no aporta nada útil aquí.
        titulo: quitarSufijoEdicion(g.name),
        slug: g.slug,
        anio: g.first_release_date
          ? new Date(g.first_release_date * 1000).getFullYear()
          : null,
        // Sin fecha (aún no anunciado) → Infinity, así se va al final al ordenar ascendente.
        fechaLanzamiento: g.first_release_date || Infinity,
        portada:
          portadaLocalPorIgdbId[g.id] ||
          (g.cover?.url ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}` : null),
        // status === 6 es "cancelled" en IGDB.
        cancelado: g.status === 6,
      }))
      .sort((a, b) => a.fechaLanzamiento - b.fechaLanzamiento);

    const games = todos.filter((g) => !g.cancelado);
    const cancelados = todos.filter((g) => g.cancelado);

    const indiceActual = games.findIndex((g) => g.igdbId === igdbId);
    const prequel = indiceActual > 0 ? games[indiceActual - 1] : null;
    const sequel =
      indiceActual >= 0 && indiceActual < games.length - 1
        ? games[indiceActual + 1]
        : null;

    res.json({
      collection: { nombre: collection.name },
      games,
      cancelados,
      indiceActual,
      prequel,
      sequel,
    });

  } catch (err) {
    console.error('ERROR EN GET /igdb/collection/:igdbId:', err);
    res.status(500).json({ error: 'Error al obtener la colección de IGDB' });
  }
});

// --- BUSCAR CARÁTULAS Y BANNERS EN STEAMGRIDDB ---
// SteamGridDB tiene muchas más opciones de carátula por juego que IGDB (que solo da una oficial).
async function buscarJuegoEnSteamGridDB(nombre, anio) {
  const res = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(nombre)}`, {
    headers: { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` }
  });
  const data = await res.json();

  // El autocomplete de SteamGridDB es difuso: si no tiene el juego exacto
  // (habitual en títulos muy nuevos o aún sin salir), devuelve "parecidos"
  // en vez de nada — p. ej. "Code Violet" -> "Code of Princess". Antes
  // aceptábamos igualmente el primer resultado; ahora exigimos que el
  // nombre coincida EXACTAMENTE (normalizado) para no mezclar carátulas
  // de un juego distinto.
  const normalizar = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
  const nombreNormalizado = normalizar(nombre);
  const candidatos = (data?.data || [])
    .filter((c) => normalizar(c.name) === nombreNormalizado)
    .slice(0, 5);

  if (candidatos.length === 0) return null;
  if (candidatos.length === 1 || !anio) return candidatos[0].id;

  // Cuando hay varios juegos con el mismo nombre (remakes/reboots, como
  // "Marathon" 1994 vs "Marathon" 2026), comprobamos el año de lanzamiento de
  // cada candidato en SteamGridDB y nos quedamos con el que coincide con el
  // año que ya tenemos guardado para este juego.
  const detalles = await Promise.all(
    candidatos.map((c) =>
      fetch(`https://www.steamgriddb.com/api/v2/games/id/${c.id}`, {
        headers: { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` }
      }).then((r) => r.json()).catch(() => null)
    )
  );

  // Comparación con ±1 año de margen: es habitual que SteamGridDB e IGDB no
  // coincidan exactamente en la fecha de lanzamiento de juegos muy nuevos o
  // todavía sin fecha cerrada (uno la tiene como "anunciado 2025", el otro
  // como "2026" tras un retraso).
  const coincidencia = detalles.find((d) => {
    const anioSgdb = d?.data?.release_date ? new Date(d.data.release_date * 1000).getFullYear() : null;
    return anioSgdb !== null && Math.abs(anioSgdb - anio) <= 1;
  });

  return coincidencia ? coincidencia.data.id : candidatos[0].id;
}

app.get('/steamgriddb/images/:mediaId', async (req, res) => {
  try {
    const mediaId = parseInt(req.params.mediaId);
    const media = await prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) return res.status(404).json({ error: 'No encontrado' });

    const sgdbId = await buscarJuegoEnSteamGridDB(media.tituloOriginal || media.titulo, media.anio);

    const headers = { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` };
    let covers = [];
    let heroes = [];

    if (sgdbId) {
      // "grids" en formato vertical (carátula tipo póster) = dimensiones 600x900
      const resCovers = await fetch(`https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?dimensions=600x900`, { headers });
      const dataCovers = await resCovers.json();
      covers = (dataCovers?.data || []).map(g => g.url);

      // "heroes" = imagen ancha tipo banner
      const resHeroes = await fetch(`https://www.steamgriddb.com/api/v2/heroes/game/${sgdbId}`, { headers });
      const dataHeroes = await resHeroes.json();
      heroes = (dataHeroes?.data || []).map(h => h.url);
    }

    // Si SteamGridDB no tiene banners (o no encontró el juego), probamos con
    // los artworks de IGDB antes de dejar la pestaña de banner vacía del todo.
    if (heroes.length === 0) {
      heroes = await obtenerArtworksIgdb(media.igdbId);
    }

    res.json({ covers, heroes });
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
    const response = await fetchIgdb('https://api.igdb.com/v4/games', {
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
      if (!backdropUrl) {
        const artworks = await obtenerArtworksIgdb(igdbId);
        backdropUrl = artworks[0] || null;
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
// Nota: renombrada de /search a /tmdb/buscar porque muchos ad-blockers
// bloquean por defecto cualquier URL con el patrón "search?q=" (lo tratan
// como tracking/analytics), lo que provocaba 404 silenciosos en el navegador.
app.get('/tmdb/buscar', async (req, res) => {
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
    res.json({ posters: data.posters || [], backdrops: data.backdrops || [] });
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

    let externaAvg = null;
    const media = await prisma.media.findUnique({ where: { id: mediaId }, select: { tmdbId: true, igdbId: true } });

    if (media?.tmdbId) {
      try {
        const apiKey = process.env.TMDB_API_KEY;
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${media.tmdbId}?api_key=${apiKey}`);
        const tmdbData = await tmdbRes.json();
        if (tmdbData.vote_average) externaAvg = tmdbData.vote_average;
      } catch (e) { }
    } else if (media?.igdbId) {
      try {
        const token = await getIgdbToken();
        const body = `fields total_rating; where id = ${media.igdbId};`;
        const igdbRes = await fetchIgdb('https://api.igdb.com/v4/games', {
          method: 'POST',
          headers: {
            'Client-ID': process.env.IGDB_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'Content-Type': 'text/plain'
          },
          body
        });
        const igdbData = await igdbRes.json();
        // IGDB va de 0 a 100; lo pasamos a la misma escala 0-10 que usa TMDB.
        if (igdbData[0]?.total_rating) externaAvg = igdbData[0].total_rating / 10;
      } catch (e) { }
    }

    if (externaAvg === null && count === 0) {
      return res.json({ average: null, count: 0 });
    }

    const pesoBase = externaAvg !== null ? 1 : 0;
    const sumaTotal = suma + (externaAvg !== null ? externaAvg : 0);
    const totalVotos = count + pesoBase;

    const average = sumaTotal / totalVotos;

    res.json({ average: Math.round(average * 10) / 10, count, tmdbAvg: externaAvg });
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