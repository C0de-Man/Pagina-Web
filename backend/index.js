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

    // Pedimos también game_type del propio juego (el que se está consultando,
    // no el juego base) — es lo que de verdad indica qué TIPO de relación es
    // esta: DLC, expansión, remaster, port, update... IGDB metía todo bajo
    // "parent_game" indistintamente, así que había que mirar el game_type
    // para no etiquetarlo todo como "DLC" por defecto.
    const body = `fields parent_game.name, parent_game.cover.url, parent_game.first_release_date, game_type; where id = ${igdbId};`;
    const response = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body });
    const data = await response.json();
    const juegoActual = data[0] || {};
    let base = juegoActual.parent_game;

    // Si el propio DLC no tiene relleno su parent_game, buscamos al revés: el
    // juego base que sí lo tenga listado en dlcs/expansions/standalone_expansions/bundles.
    if (!base) {
      const bodyInverso = `fields name, cover.url, first_release_date; where dlcs = (${igdbId}) | expansions = (${igdbId}) | standalone_expansions = (${igdbId}) | bundles = (${igdbId});`;
      const respInverso = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: bodyInverso });
      const dataInverso = await respInverso.json();
      base = dataInverso[0];
    }

    if (!base) return res.json(null);

    // Etiqueta según el game_type REAL de este juego (no del juego base).
    // IGDB category/game_type: 1 dlc_addon, 2 expansion, 3 bundle,
    // 4 standalone_expansion, 9 remaster, 10 expanded_game, 11 port, 14 update.
    // 8 (remake) no debería llegar aquí porque ya se descarta más arriba.
    const ETIQUETAS_POR_TIPO = {
      1: 'DLC',
      2: 'Expansión',
      3: 'Bundle',
      4: 'Expansión',
      9: 'Remaster',
      10: 'Edición ampliada',
      11: 'Port',
      14: 'Update',
    };
    const etiqueta = ETIQUETAS_POR_TIPO[juegoActual.game_type] || 'DLC';

    res.json({
      igdbId: base.id,
      titulo: base.name,
      anio: base.first_release_date
        ? new Date(base.first_release_date * 1000).getFullYear()
        : null,
      portada: base.cover?.url
        ? `https:${base.cover.url.replace('t_thumb', 't_cover_big')}`
        : null,
      etiqueta,
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

    // Antes limitaba a 20 resultados. Para que el buscador muestre TODO lo
    // que coincida, subimos al máximo que admite IGDB en una sola petición
    // (500) — de sobra para cualquier búsqueda real, sin necesidad de paginar.
    const body = `search "${searchQuery}"; fields name,cover.url,first_release_date,summary; limit 500;`;

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
      if (ids.length > 0) {
        // Usamos game_type, NO category: el resto del proyecto (ver
        // calcularColeccionDesdeIgdb y /igdb/dlc-of) ya descubrió que
        // "category" es el campo VIEJO de IGDB, que se ha ido quedando cada
        // vez más vacío — "game_type" es el que de verdad usan hoy la
        // mayoría de los juegos. Filtrar por category dejaba prácticamente
        // sin resultados cualquier categoría que no fuera Main Game.
        // "Main Game" (id 0) sigue siendo un caso especial: muchos juegos
        // normales tienen game_type vacío (null) en vez de puesto
        // explícitamente a 0, así que si el 0 está entre las categorías
        // elegidas, aceptamos también los que tienen game_type = null.
        const condicionBase = ids.length === 1 ? `game_type = ${ids[0]}` : `game_type = (${ids.join(',')})`;
        const partes = [condicionBase];
        if (ids.includes(0)) partes.push('game_type = null');
        condiciones.push(partes.length > 1 ? `(${partes.join(' | ')})` : partes[0]);
      }
    }

    if (genero) condiciones.push(`genres = (${parseInt(genero)})`);
    if (plataforma) condiciones.push(`platforms = (${parseInt(plataforma)})`);

    if (ratingMin || ratingMax) {
      const min = ratingMin ? parseFloat(ratingMin) * 20 : 0;
      const max = ratingMax ? parseFloat(ratingMax) * 20 : 100;
      condiciones.push(`total_rating != null & total_rating >= ${min} & total_rating <= ${max}`);
    }

    const where = condiciones.length > 0 ? `where ${condiciones.join(' & ')};` : '';
    // OJO: "sort hypes desc" se usaba antes aquí para el modo "año", pero
    // IGDB EXCLUYE de los resultados cualquier juego donde el campo de
    // ordenación esté vacío — y "hypes" (anticipación/wishlist) solo lo
    // tienen rellenado un puñado de juegos muy esperados. En la práctica,
    // esto hacía que el catálogo por año devolviera casi siempre 0 o muy
    // pocos resultados en cuanto se combinaba con cualquier filtro, porque
    // la inmensa mayoría de juegos no tienen hypes. Ordenamos por
    // first_release_date en su lugar: todo juego que pasa el filtro de año
    // tiene ese campo relleno por definición, así que no se pierde nadie.
    const sort = modo === 'popular' ? 'sort total_rating_count desc;' : 'sort first_release_date desc;';

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
  const headers = {
    'Client-ID': process.env.IGDB_CLIENT_ID,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'text/plain',
  };

  // Paso 1: averiguar a qué collections/franchises pertenece ESTE juego.
  // Consulta ligera — todavía no pedimos los juegos de cada una aquí.
  const queryBase = `
    fields name, collections.id, collections.name, franchises.id, franchises.name;
    where id = ${igdbId};
  `;
  const respBase = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryBase });
  if (!respBase.ok) throw new Error(`IGDB respondió ${respBase.status}`);

  const dataBase = await respBase.json();
  const juegoActual = dataBase[0];
  if (!juegoActual) return null;

  const collections = juegoActual.collections || [];
  const franchises = juegoActual.franchises || [];
  if (collections.length === 0 && franchises.length === 0) return null;

  // Nombre para mostrar: preferimos la primera collection (suele ser más
  // específica, p. ej. "Resident Evil" en vez de "Capcom Survival Horror");
  // si no hay ninguna, usamos la primera franchise.
  const nombre = collections[0]?.name || franchises[0]?.name || null;
  if (!nombre) return null;

  // Paso 2: pedimos los juegos de esas collections/franchises con consultas
  // de NIVEL SUPERIOR (where collections = (...) / where franchises = (...)),
  // no como lista anidada dentro del juego (collections.games.*). IGDB aplica
  // un límite implícito a las listas anidadas dentro de un único registro, lo
  // que estaba dejando fuera las primeras entregas de sagas largas (p. ej.
  // "Resident Evil" y "Resident Evil 2" desaparecían de la saga al consultar
  // desde su propia ficha, aunque sí aparecían consultando desde otra
  // entrega). Con una consulta de nivel superior y "limit" explícito alto,
  // ese tope oculto deja de aplicar.
  // version_parent: cuando una entrada es un SKU/edición concreta ("Launch
  // Edition", "Ultimate Edition"...) de OTRO juego ya existente en IGDB, este
  // campo apunta a esa versión canónica. Lo pedimos para poder usar siempre
  // el juego "de verdad" en vez de la edición de tienda.
  const camposJuego = [
    'name', 'slug', 'cover.url', 'first_release_date', 'id', 'game_type', 'status',
    'version_parent.name', 'version_parent.slug', 'version_parent.cover.url',
    'version_parent.first_release_date', 'version_parent.id',
  ].join(', ');

  const collectionIds = collections.map((c) => c.id);
  const franchiseIds = franchises.map((f) => f.id);

  const [respColecciones, respFranquicias] = await Promise.all([
    collectionIds.length > 0
      ? fetchIgdb('https://api.igdb.com/v4/games', {
          method: 'POST',
          headers,
          body: `fields ${camposJuego}; where collections = (${collectionIds.join(',')}); limit 500;`,
        })
      : Promise.resolve(null),
    franchiseIds.length > 0
      ? fetchIgdb('https://api.igdb.com/v4/games', {
          method: 'POST',
          headers,
          body: `fields ${camposJuego}; where franchises = (${franchiseIds.join(',')}); limit 500;`,
        })
      : Promise.resolve(null),
  ]);

  if (respColecciones && !respColecciones.ok) throw new Error(`IGDB respondió ${respColecciones.status}`);
  if (respFranquicias && !respFranquicias.ok) throw new Error(`IGDB respondió ${respFranquicias.status}`);

  const datosColecciones = respColecciones ? await respColecciones.json() : [];
  const datosFranquicias = respFranquicias ? await respFranquicias.json() : [];

  // Las "collections" de IGDB ya vienen bien acotadas al propio juego, así
  // que las aceptamos todas. Las "franchises" son mucho más amplias y a veces
  // arrastran crossovers/cameos con personajes prestados (p. ej. Marvel vs.
  // Capcom, Puzzle Fighter o Teppen para la franquicia de Resident Evil), así
  // que de ahí solo colamos los que además tengan el nombre de la saga en el
  // propio título.
  const juegosPorId = new Map();
  for (const g of datosColecciones || []) juegosPorId.set(g.id, g);

  const nombreSaga = nombre.toLowerCase();
  for (const g of datosFranquicias || []) {
    if (juegosPorId.has(g.id)) continue;
    if (g.name && g.name.toLowerCase().includes(nombreSaga)) {
      juegosPorId.set(g.id, g);
    }
  }

  // Red de seguridad: el propio juego consultado siempre debe estar presente,
  // pase lo que pase con las dos consultas de arriba.
  if (!juegosPorId.has(igdbId)) {
    juegosPorId.set(igdbId, juegoActual);
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

// --- PORTS Y REMASTERS DE UN JUEGO (pestaña "Version") ---
// Mismo patrón en cascada que getIgdbDlcsUpdates: campo directo del juego
// (ports/remasters) → búsqueda inversa por parent_game filtrando por category
// (11 = Port, 9 = Remaster) → como último recurso, búsqueda de texto por
// nombre exigiendo coincidencia estricta de prefijo (igual que con los
// updates), para no colar secuelas ni juegos sin relación real.
async function getIgdbVersiones(igdbId) {
  const token = await getIgdbToken();

  const headers = {
    'Client-ID': process.env.IGDB_CLIENT_ID,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'text/plain',
  };

  const queryPrincipal = `
    fields name, ports.name, ports.cover.url, ports.first_release_date, ports.status,
           remasters.name, remasters.cover.url, remasters.first_release_date, remasters.status;
    where id = ${igdbId};
  `;

  // category 9 = Remaster, category 11 = Port.
  const queryInverso = `
    fields name, cover.url, first_release_date, category, status;
    where parent_game = ${igdbId} & category = (9,11);
    limit 50;
  `;

  const [resPrincipal, resInverso] = await Promise.all([
    fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryPrincipal }),
    fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryInverso }),
  ]);

  if (!resPrincipal.ok || !resInverso.ok) {
    throw new Error(`IGDB respondió ${resPrincipal.status} / ${resInverso.status}`);
  }

  const [dataPrincipal, dataInverso] = await Promise.all([
    resPrincipal.json(),
    resInverso.json(),
  ]);

  const juego = dataPrincipal[0] || {};
  const inversoPorts = (dataInverso || []).filter((g) => g.category === 11);
  const inversoRemasters = (dataInverso || []).filter((g) => g.category === 9);

  const yaHayPorts = (juego.ports || []).length > 0 || inversoPorts.length > 0;
  const yaHayRemasters = (juego.remasters || []).length > 0 || inversoRemasters.length > 0;

  let portsTexto = [];
  let remastersTexto = [];
  if ((!yaHayPorts || !yaHayRemasters) && juego.name) {
    const queryTexto = `
      search "${juego.name}";
      fields name, cover.url, first_release_date, category;
      limit 30;
    `;
    const respTexto = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryTexto });
    if (respTexto.ok) {
      const dataTexto = await respTexto.json();
      const nombreBaseNormalizado = juego.name.toLowerCase();
      const cumplePrefijo = (g) => {
        if (!g.name || g.id === igdbId) return false;
        const nombreNormalizado = g.name.toLowerCase();
        if (!nombreNormalizado.startsWith(nombreBaseNormalizado)) return false;
        const resto = nombreNormalizado.slice(nombreBaseNormalizado.length);
        if (resto !== '' && /^[a-z0-9]/.test(resto)) return false; // pegado sin separador
        if (/^\s*\d/.test(resto)) return false; // "... 2", "... 3"... (secuela)
        return true;
      };
      if (!yaHayPorts) {
        portsTexto = (dataTexto || []).filter(
          (g) => cumplePrefijo(g) && (g.category === 11 || g.name.toLowerCase().includes('port'))
        );
      }
      if (!yaHayRemasters) {
        remastersTexto = (dataTexto || []).filter(
          (g) => cumplePrefijo(g) && (g.category === 9 || g.name.toLowerCase().includes('remaster'))
        );
      }
    }
  }

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

  const porAnioAsc = (a, b) => (a.anio || 9999) - (b.anio || 9999);

  const idsPortsDirectos = new Set((juego.ports || []).map((g) => g.id));
  const portsInversosSinDup = inversoPorts.filter((g) => !idsPortsDirectos.has(g.id));
  const portsTodos = [...(juego.ports || []), ...portsInversosSinDup, ...portsTexto]
    .map(arreglar)
    .sort(porAnioAsc);

  const idsRemastersDirectos = new Set((juego.remasters || []).map((g) => g.id));
  const remastersInversosSinDup = inversoRemasters.filter((g) => !idsRemastersDirectos.has(g.id));
  const remastersTodos = [...(juego.remasters || []), ...remastersInversosSinDup, ...remastersTexto]
    .map(arreglar)
    .sort(porAnioAsc);

  return {
    ports: portsTodos.filter((g) => !g.cancelado),
    remasters: remastersTodos.filter((g) => !g.cancelado),
  };
}

app.get('/igdb/versiones/:igdbId', async (req, res) => {
  try {
    const igdbId = parseInt(req.params.igdbId, 10);
    if (Number.isNaN(igdbId)) return res.status(400).json({ error: 'igdbId inválido' });

    const resultado = await getIgdbVersiones(igdbId);
    res.json(resultado);
  } catch (err) {
    console.error('ERROR EN GET /igdb/versiones/:igdbId:', err);
    res.status(500).json({ error: 'Error al obtener versiones (ports/remasters)' });
  }
});

// --- Construye la respuesta de /igdb/collection a partir de lo GUARDADO en
// CuratedCollection/CuratedCollectionItem (ya no consulta IGDB en absoluto). ---
// --- Calcula una colección DIRECTAMENTE desde IGDB (sin tocar la base de
// datos). La usan tanto la siembra inicial (primera vez que se ve una saga)
// como el botón "Reiniciar" del admin — así las dos siempre usan exactamente
// la misma lógica, sin que se puedan desincronizar entre sí con el tiempo.
// Devuelve null si el juego no pertenece a ninguna saga reconocible, o
// { nombre, todos } donde "todos" ya viene mezclado (juegos + cancelados,
// según status) y ordenado por fecha de lanzamiento.
async function calcularColeccionDesdeIgdb(igdbId) {
  const collection = await getIgdbGameCollection(igdbId);
  if (!collection || !collection.games) return null;

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

  // Justo este paso puede introducir IDs duplicados de verdad: si dos SKUs
  // distintos (p. ej. "Deluxe Edition" y "GOTY Edition") apuntan al MISMO
  // version_parent, ambos se convierten en el mismo juego canónico. Hay que
  // deduplicar por id ANTES de la lógica de nombres de abajo, que ya no
  // colapsa por nombre a propósito (ver comentario más abajo) y dejaría
  // pasar dos copias idénticas con el mismo id — rompiendo las "key" de
  // React en el listado.
  const porId = new Map();
  for (const g of gamesFiltrados) {
    if (!porId.has(g.id)) porId.set(g.id, g);
  }
  gamesFiltrados = Array.from(porId.values());

  // Red de seguridad para cuando IGDB tampoco tiene puesto version_parent:
  // si hay dos entradas con el mismo nombre base (uno con sufijo de edición
  // y otro sin él), nos quedamos con la que NO lleve sufijo.
  const sufijoEdicion = /\s*[-–:]\s*[^-–:]*\b(edici[oó]n|edition)\b[^-–:]*$/i;
  const quitarSufijoEdicion = (nombre) => nombre.replace(sufijoEdicion, '').trim();
  const nombreBase = (nombre) => quitarSufijoEdicion(nombre).toLowerCase();
  const anioDe = (g) => (g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null);

  // OJO: si NINGUNA de las dos entradas lleva sufijo de edición, puede
  // tratarse de dos cosas muy distintas:
  //   a) Dos juegos DISTINTOS que comparten título por casualidad — el caso
  //      típico es un remake con el mismo nombre que el original (p. ej.
  //      "Resident Evil" de 1996 y su remake de 2002, también llamado solo
  //      "Resident Evil"). Aquí SÍ hay que quedarse con los dos.
  //   b) La MISMA versión del juego listada dos veces en IGDB, una entrada
  //      por plataforma/región (p. ej. "Resident Evil 4" de PS2 y de
  //      GameCube, ambas de 2005, sin ningún sufijo que las distinga). Aquí
  //      hay que quedarse con una sola.
  // La forma de distinguir (a) de (b) es el AÑO: si coincide (o ninguna de
  // las dos tiene fecha), es el caso (b) y nos quedamos con la más antigua
  // por fecha exacta ("la original"); si el año es distinto, es el caso (a).
  let resultado = [];
  for (const g of gamesFiltrados) {
    const clave = nombreBase(g.name);
    const idxExistente = resultado.findIndex((r) => nombreBase(r.name) === clave);
    if (idxExistente === -1) {
      resultado.push(g);
      continue;
    }
    const existente = resultado[idxExistente];
    const gEsEdicionEspecial = sufijoEdicion.test(g.name);
    const existenteEsEdicionEspecial = sufijoEdicion.test(existente.name);

    if (gEsEdicionEspecial || existenteEsEdicionEspecial) {
      // Relación edición/SKU de verdad: nos quedamos con el que NO lleve
      // sufijo (si el que ya teníamos SÍ lo llevaba, el nuevo lo sustituye).
      if (existenteEsEdicionEspecial && !gEsEdicionEspecial) {
        resultado[idxExistente] = g;
      }
      continue;
    }

    const anioG = anioDe(g);
    const anioExistente = anioDe(existente);
    if (anioG !== null && anioExistente !== null && anioG !== anioExistente) {
      // Caso (a): años distintos, son juegos de verdad distintos.
      resultado.push(g);
      continue;
    }

    // Caso (b): mismo año (o sin fecha ninguno de los dos) — nos quedamos
    // con la fecha exacta más antigua como "la original".
    const fechaG = g.first_release_date ?? Infinity;
    const fechaExistente = existente.first_release_date ?? Infinity;
    if (fechaG < fechaExistente) {
      resultado[idxExistente] = g;
    }
    // si no, nos quedamos con "existente" (ya guardado)
  }
  gamesFiltrados = resultado;

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

  return { nombre: collection.name, todos };
}

async function construirRespuestaDesdeCurated(collectionId, igdbId) {
  const collection = await prisma.curatedCollection.findUnique({
    where: { id: collectionId },
    include: { items: { orderBy: { orden: 'asc' } } },
  });

  if (!collection) {
    return { collection: null, games: [], cancelados: [], otros: [], indiceActual: -1, prequel: null, sequel: null };
  }

  // Si algún juego de la saga ya está guardado en Media con una carátula
  // personalizada (elegida a mano por el usuario), la preferimos sobre la
  // que se guardó al sembrar la colección — puede haber cambiado después.
  const locales = await prisma.media.findMany({
    where: { igdbId: { in: collection.items.map((i) => i.igdbId) } },
    select: { igdbId: true, portada: true },
  });
  const portadaLocalPorIgdbId = Object.fromEntries(
    locales.filter((l) => l.portada).map((l) => [l.igdbId, l.portada])
  );

  const todos = collection.items.map((item) => ({
    id: item.id, // id de la fila en CuratedCollectionItem — lo necesita el frontend para poder borrarla
    igdbId: item.igdbId,
    titulo: item.titulo,
    anio: item.anio,
    portada: portadaLocalPorIgdbId[item.igdbId] || item.portada,
    cancelado: item.cancelado,
    esOtro: item.esOtro,
  }));

  const games = todos.filter((g) => !g.cancelado && !g.esOtro);
  const cancelados = todos.filter((g) => g.cancelado);
  const otros = todos.filter((g) => g.esOtro);

  const indiceActual = games.findIndex((g) => g.igdbId === igdbId);
  const prequel = indiceActual > 0 ? games[indiceActual - 1] : null;
  const sequel =
    indiceActual >= 0 && indiceActual < games.length - 1 ? games[indiceActual + 1] : null;

  return {
    collection: { id: collection.id, nombre: collection.nombre },
    games,
    cancelados,
    otros,
    indiceActual,
    prequel,
    sequel,
  };
}

// --- SAGA DE UN VIDEOJUEGO (precuela/secuela + colección completa) ---
app.get('/igdb/collection/:igdbId', async (req, res) => {
  try {
    const igdbId = parseInt(req.params.igdbId, 10);
    if (Number.isNaN(igdbId)) {
      return res.status(400).json({ error: 'igdbId inválido' });
    }

    // Si esta saga ya está guardada a mano en la base de datos (porque ya se
    // vio antes, o porque un admin ya la editó), servimos desde ahí y no
    // volvemos a tocar IGDB para nada — así lo que el admin edite no se
    // sobrescribe nunca al volver a entrar.
    const itemExistente = await prisma.curatedCollectionItem.findFirst({
      where: { igdbId },
      select: { collectionId: true },
    });
    if (itemExistente) {
      return res.json(await construirRespuestaDesdeCurated(itemExistente.collectionId, igdbId));
    }

    const calculada = await calcularColeccionDesdeIgdb(igdbId);
    if (!calculada) {
      return res.json({ collection: null, games: [], cancelados: [], otros: [], prequel: null, sequel: null });
    }

    // Primera vez que se ve esta saga: la guardamos como semilla editable en
    // vez de solo devolverla. A partir de aquí, esta saga ya no se vuelve a
    // calcular desde IGDB (ver el bloque de arriba con curatedCollectionItem).
    const nuevaCollection = await prisma.curatedCollection.create({
      data: {
        nombre: calculada.nombre,
        items: {
          create: calculada.todos.map((g, index) => ({
            igdbId: g.igdbId,
            titulo: g.titulo,
            anio: g.anio,
            portada: g.portada,
            cancelado: g.cancelado,
            orden: index,
          })),
        },
      },
    });

    return res.json(await construirRespuestaDesdeCurated(nuevaCollection.id, igdbId));

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

// --- BÚSQUEDA DE RESPALDO EN STEAMGRIDDB, MÁS FLEXIBLE ---
// Solo se usa cuando la búsqueda exacta de arriba no encuentra el juego o no
// tiene ninguna imagen del tamaño que buscamos. Muchos juegos están en
// SteamGridDB bajo el nombre de una versión concreta ("Grand Theft Auto IV:
// The Complete Edition", "... & Episodes From Liberty City"...) en vez del
// nombre "pelado" que tenemos guardado — la coincidencia exacta los descarta,
// aunque tengan cientos de carátulas disponibles para el mismo juego.
// Aquí relajamos la comparación: basta con que coincidan las primeras
// palabras (mínimo 2, hasta 4) del nombre, así "Grand Theft Auto IV" case
// con "Grand Theft Auto IV: The Complete Edition" pero NO con "Grand Theft
// Auto V" (la 4ª palabra ya no coincide).
async function buscarJuegoEnSteamGridDBFlexible(nombre) {
  const res = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(nombre)}`, {
    headers: { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` }
  });
  const data = await res.json();

  const normalizar = (s) => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
  const palabrasNombre = normalizar(nombre).split(' ').filter(Boolean);

  const coincideEnLasPrimerasPalabras = (candidatoNombre) => {
    const palabrasCandidato = normalizar(candidatoNombre).split(' ').filter(Boolean);
    const n = Math.min(4, palabrasNombre.length, palabrasCandidato.length);
    if (n < 2) return false; // títulos demasiado cortos, no arriesgamos
    for (let i = 0; i < n; i++) {
      if (palabrasNombre[i] !== palabrasCandidato[i]) return false;
    }
    return true;
  };

  const candidato = (data?.data || []).find((c) => coincideEnLasPrimerasPalabras(c.name));
  return candidato ? candidato.id : null;
}

// --- Trae TODAS las carátulas de SteamGridDB para un juego, no solo las
// primeras 50 --- La API de SteamGridDB pagina de 50 en 50 (no admite pedir
// más por página), así que hay que ir pidiendo página a página. Ponemos un
// tope de páginas para no disparar peticiones sin fin en juegos muy
// populares con cientos de carátulas subidas (con MAX_PAGINAS = 4 llegamos
// hasta 200, de sobra para elegir sin sobrecargar el desplegable).
// Nota: el campo "total" que devuelve la propia API de SteamGridDB es poco
// fiable (a veces cuenta duplicado), así que en vez de fiarnos de ese número
// paramos en cuanto una página devuelve menos de 50 resultados — eso es lo
// que de verdad indica que ya no queda nada más.
const SGDB_MAX_PAGINAS = 4;
async function obtenerTodasLasGridsSteamGridDB(sgdbId, headers) {
  let todas = [];
  for (let pagina = 0; pagina < SGDB_MAX_PAGINAS; pagina++) {
    const resp = await fetch(
      `https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?dimensions=600x900,342x482,660x930&page=${pagina}`,
      { headers }
    );
    const data = await resp.json();
    const pagina_data = data?.data || [];
    todas = todas.concat(pagina_data.map((g) => g.url));
    if (pagina_data.length < 50) break; // última página, no hace falta seguir
  }
  return todas;
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
      // "grids" en formato vertical (carátula tipo póster). Antes solo
      // pedíamos 600x900 — pero muchos juegos tienen carátulas subidas por
      // la comunidad en otros tamaños verticales habituales (342x482,
      // 660x930) y ninguna en 600x900 concretamente, lo que dejaba la
      // pestaña "Carátula" vacía aunque SÍ hubiera opciones disponibles.
      covers = await obtenerTodasLasGridsSteamGridDB(sgdbId, headers);

      // "heroes" = imagen ancha tipo banner
      const resHeroes = await fetch(`https://www.steamgriddb.com/api/v2/heroes/game/${sgdbId}`, { headers });
      const dataHeroes = await resHeroes.json();
      heroes = (dataHeroes?.data || []).map(h => h.url);
    }

    // Si la búsqueda exacta no encontró ninguna carátula (aunque el juego
    // SÍ exista en SteamGridDB bajo otro nombre, tipo edición/versión — "The
    // Complete Edition", "& Episodes From Liberty City"...), probamos con la
    // búsqueda flexible antes de rendirnos y caer al respaldo de IGDB.
    if (covers.length === 0) {
      const sgdbIdAlternativo = await buscarJuegoEnSteamGridDBFlexible(media.tituloOriginal || media.titulo);
      if (sgdbIdAlternativo && sgdbIdAlternativo !== sgdbId) {
        covers = await obtenerTodasLasGridsSteamGridDB(sgdbIdAlternativo, headers);
      }
    }

    // Si SteamGridDB no tiene ninguna carátula en ningún tamaño (o no
    // encontró el juego), al menos ofrecemos la carátula oficial de IGDB
    // como opción, en vez de dejar la pestaña completamente vacía.
    if (covers.length === 0 && media.igdbId) {
      try {
        const token = await getIgdbToken();
        const body = `fields cover.url; where id = ${media.igdbId};`;
        const respIgdb = await fetchIgdb('https://api.igdb.com/v4/games', {
          method: 'POST',
          headers: {
            'Client-ID': process.env.IGDB_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/plain',
          },
          body,
        });
        const dataIgdb = await respIgdb.json();
        const coverUrl = dataIgdb?.[0]?.cover?.url;
        if (coverUrl) {
          covers = [`https:${coverUrl.replace('t_thumb', 't_cover_big')}`];
        }
      } catch (e) {
        console.error('No se pudo obtener carátula de respaldo desde IGDB', e);
      }
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

    // Si este juego ya está guardado, devolvemos la fila que ya existe tal
    // cual — sin volver a preguntarle nada a IGDB/SteamGridDB. Esto es
    // importante: sin esta comprobación, cada vez que se navegaba a un juego
    // (p. ej. desde precuela/secuela en la saga) se creaba una fila NUEVA en
    // la base de datos con la carátula/banner por defecto de IGDB, en vez de
    // reutilizar la que ya tenías — así que cualquier carátula personalizada
    // que hubieras elegido a mano se "perdía" (en realidad no se borraba,
    // pero acababas viendo una fila duplicada distinta, con la de IGDB).
    const existente = await prisma.media.findFirst({ where: { igdbId: parseInt(igdbId, 10) } });
    if (existente) return res.json(existente);

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

// --- MIDDLEWARE: solo administradores ---
// Se usa SIEMPRE encadenado después de requireAuth (que es quien rellena
// req.userId), nunca solo: app.post('/ruta', requireAuth, requireAdmin, handler).
// Cualquier ruta que permita editar/borrar/reordenar colecciones curadas a
// mano debe llevar este middleware; ver usuarios normales solo deben poder
// leer esos datos (rutas GET normales, sin este middleware).
async function requireAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'No tienes permisos de administrador' });
    }
    next();
  } catch (error) {
    console.error('ERROR EN requireAdmin:', error);
    res.status(500).json({ error: 'Error al comprobar permisos de administrador' });
  }
}

// --- COLECCIONES CURADAS: quitar un juego de una saga (solo admin) ---
// Esto SOLO borra la fila de CuratedCollectionItem: nunca toca Media ni
// UserMedia, así que el catálogo del usuario (visto/liked/watchlist/nota)
// no se ve afectado aunque el juego borrado ya estuviera guardado ahí.
app.delete('/admin/curated-collection-items/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'id inválido' });

    const item = await prisma.curatedCollectionItem.findUnique({ where: { id } });
    if (!item) return res.status(404).json({ error: 'No encontrado' });

    await prisma.curatedCollectionItem.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE /admin/curated-collection-items/:id:', error);
    res.status(500).json({ error: 'Error al eliminar el juego de la colección' });
  }
});

// --- COLECCIONES CURADAS: guardar el nuevo orden tras arrastrar y soltar (solo admin) ---
// Recibe la lista de ids de CuratedCollectionItem YA en el orden final (tal
// como ha quedado en el frontend tras soltar) y pone orden = posición en esa
// lista. Se usa una vez por cada pestaña (Juegos / Cancelados) por separado,
// nunca mezclando ids de las dos — el frontend solo manda los de la pestaña
// que se acaba de reordenar.
app.patch('/admin/curated-collection-items/reorder', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Falta la lista de ids en el nuevo orden' });
    }
    const idsLimpios = ids.map((id) => parseInt(id, 10));
    if (idsLimpios.some((id) => Number.isNaN(id))) {
      return res.status(400).json({ error: 'Algún id de la lista no es válido' });
    }

    await prisma.$transaction(
      idsLimpios.map((id, index) =>
        prisma.curatedCollectionItem.update({
          where: { id },
          data: { orden: index },
        })
      )
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN PATCH /admin/curated-collection-items/reorder:', error);
    res.status(500).json({ error: 'Error al reordenar la colección' });
  }
});

// --- COLECCIONES CURADAS: añadir un juego nuevo (buscador, solo admin) ---
// El frontend ya trae todo lo necesario del resultado de /igdb/search (name,
// cover, first_release_date), así que aquí no hace falta volver a preguntarle
// nada a IGDB — solo insertar la fila en el sitio correcto.
//
// "En el sitio correcto" = por año, dentro del grupo (juegos, cancelados u
// otros) al que se añade, PERO respetando el orden que el admin ya haya
// dejado a mano con el arrastrar-y-soltar para el resto de juegos: se
// recorre la lista tal como está ahora mismo y se inserta justo antes del
// primer juego con año posterior (los que no tienen año van siempre al
// final, igual que en el resto de la app), en vez de reordenar todo el grupo
// entero por fecha.
app.post('/admin/curated-collection-items', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { collectionId, igdbId, titulo, anio, portada, grupo } = req.body;

    const collectionIdNum = parseInt(collectionId, 10);
    const igdbIdNum = parseInt(igdbId, 10);
    if (Number.isNaN(collectionIdNum) || Number.isNaN(igdbIdNum) || !titulo) {
      return res.status(400).json({ error: 'Faltan datos: collectionId, igdbId y titulo son obligatorios' });
    }
    if (!['juegos', 'cancelados', 'otros'].includes(grupo)) {
      return res.status(400).json({ error: 'grupo debe ser "juegos", "cancelados" u "otros"' });
    }

    const coleccion = await prisma.curatedCollection.findUnique({ where: { id: collectionIdNum } });
    if (!coleccion) return res.status(404).json({ error: 'Colección no encontrada' });

    const esCancelado = grupo === 'cancelados';
    const esOtro = grupo === 'otros';
    const anioNum = anio === null || anio === undefined || anio === '' ? null : parseInt(anio, 10);

    // Lista actual del mismo grupo, en su orden vigente.
    const itemsDelGrupo = await prisma.curatedCollectionItem.findMany({
      where: { collectionId: collectionIdNum, cancelado: esCancelado, esOtro },
      orderBy: { orden: 'asc' },
      select: { id: true, anio: true },
    });

    let indiceInsercion = itemsDelGrupo.length; // por defecto, al final
    if (anioNum !== null) {
      const idx = itemsDelGrupo.findIndex((it) => it.anio !== null && it.anio > anioNum);
      if (idx !== -1) indiceInsercion = idx;
    }

    let nuevoItem;
    try {
      nuevoItem = await prisma.curatedCollectionItem.create({
        data: {
          collectionId: collectionIdNum,
          igdbId: igdbIdNum,
          titulo,
          anio: anioNum,
          portada: portada || null,
          cancelado: esCancelado,
          esOtro,
          orden: itemsDelGrupo.length, // provisional, se recoloca justo debajo
        },
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'Ese juego ya está en esta colección' });
      }
      throw err;
    }

    // Recolocamos: insertamos el id nuevo en su posición y renumeramos orden
    // 0..n-1 para todo el grupo, igual que hace el endpoint de reordenar.
    const idsFinal = itemsDelGrupo.map((it) => it.id);
    idsFinal.splice(indiceInsercion, 0, nuevoItem.id);

    await prisma.$transaction(
      idsFinal.map((id, index) =>
        prisma.curatedCollectionItem.update({ where: { id }, data: { orden: index } })
      )
    );

    res.status(201).json(nuevoItem);
  } catch (error) {
    console.error('ERROR EN POST /admin/curated-collection-items:', error);
    res.status(500).json({ error: 'Error al añadir el juego a la colección' });
  }
});

// --- COLECCIONES CURADAS: reiniciar (solo admin) ---
// Borra TODO lo que haya en la colección (orden manual, juegos borrados,
// juegos añadidos a mano, cancelados marcados a mano, absolutamente todo,
// incluido el grupo "Other") y la vuelve a calcular desde cero con IGDB —
// exactamente lo mismo que pasaría si esta saga no se hubiera visto nunca
// antes. Usa la MISMA función que la siembra inicial (calcularColeccionDesdeIgdb),
// así que nunca se puede desincronizar de cómo se sembraría hoy.
app.post('/admin/curated-collections/:collectionId/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const collectionId = parseInt(req.params.collectionId, 10);
    const igdbId = parseInt(req.body.igdbId, 10);
    if (Number.isNaN(collectionId) || Number.isNaN(igdbId)) {
      return res.status(400).json({ error: 'collectionId e igdbId son obligatorios' });
    }

    const coleccion = await prisma.curatedCollection.findUnique({ where: { id: collectionId } });
    if (!coleccion) return res.status(404).json({ error: 'Colección no encontrada' });

    const calculada = await calcularColeccionDesdeIgdb(igdbId);
    if (!calculada) {
      return res.status(422).json({ error: 'IGDB ya no reconoce ninguna saga para este juego' });
    }

    // Fuera todo lo que hubiera (borrados, añadidos, orden manual, "Other"...)
    await prisma.curatedCollectionItem.deleteMany({ where: { collectionId } });

    await prisma.curatedCollection.update({
      where: { id: collectionId },
      data: {
        nombre: calculada.nombre,
        items: {
          create: calculada.todos.map((g, index) => ({
            igdbId: g.igdbId,
            titulo: g.titulo,
            anio: g.anio,
            portada: g.portada,
            cancelado: g.cancelado,
            orden: index,
          })),
        },
      },
    });

    res.json(await construirRespuestaDesdeCurated(collectionId, igdbId));
  } catch (error) {
    console.error('ERROR EN POST /admin/curated-collections/:collectionId/reset:', error);
    res.status(500).json({ error: 'Error al reiniciar la colección' });
  }
});

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
    const apiKey = process.env.TMDB_API_KEY;
    const lang = getLang(req);

    // Antes solo se pedía la página 1 de TMDB (máx. 20 resultados). Para que
    // el buscador muestre TODO lo que coincida, pedimos página a página hasta
    // agotar total_pages. Tope de seguridad en 20 páginas (400 resultados):
    // con términos de una sola letra o muy genéricos, TMDB puede decir tener
    // cientos de páginas, y no tiene sentido esperar a traerlas todas para
    // un buscador — 400 resultados ya es "todo" en la práctica para
    // cualquier búsqueda con un mínimo de especificidad.
    const TOPE_PAGINAS = 20;
    const urlPagina = (p) => `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(searchQuery)}&language=${lang}&page=${p}&api_key=${apiKey}`;

    const primeraRes = await fetch(urlPagina(1));
    const primeraData = await primeraRes.json();
    let resultados = primeraData.results || [];
    const totalPaginas = Math.min(primeraData.total_pages || 1, TOPE_PAGINAS);

    if (totalPaginas > 1) {
      const restoPaginas = await Promise.all(
        Array.from({ length: totalPaginas - 1 }, (_, i) =>
          fetch(urlPagina(i + 2)).then((r) => r.json()).catch(() => ({ results: [] }))
        )
      );
      for (const pagina of restoPaginas) resultados = resultados.concat(pagina.results || []);
    }

    // TMDB puede devolver el mismo título en más de una página (los
    // resultados se reordenan ligeramente entre peticiones si algo cambia de
    // popularidad de fondo), lo que generaba entradas duplicadas — y con
    // ellas, keys de React repetidas en el frontend. Deduplicamos por
    // media_type+id, que es justo la combinación que usa el frontend como key.
    const vistos = new Set();
    const sinDuplicados = resultados.filter((item) => {
      const clave = `${item.media_type}-${item.id}`;
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });

    res.json(sinDuplicados);
  } catch (error) {
    res.status(500).json({ error: 'Hubo un error al buscar en TMDB' });
  }
});

// --- RUTA PARA GUARDAR DESDE TMDB AUTOMÁTICAMENTE ---
app.post('/media/tmdb', async (req, res) => {
  try {
    const { tmdbId, tipo } = req.body;

    // Igual que en /media/igdb: si ya existe, devolvemos la fila tal cual en
    // vez de crear una duplicada. Antes esta ruta no comprobaba nada porque
    // siempre se llamaba después de comprobar dbId en el frontend — pero
    // ahora las carátulas son enlaces <a> de verdad (para que el clic
    // central/Ctrl+clic abran en pestaña nueva de forma nativa) que pueden
    // apuntar directamente aquí sin haber comprobado antes si ya existe.
    const existente = await prisma.media.findFirst({ where: { tmdbId: parseInt(tmdbId, 10) } });
    if (existente) return res.json(existente);

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

// --- LOGS DE UN VIDEOJUEGO (partidas/reviews, varios logs por juego) ---
// Solo devuelve/edita los logs del propio usuario (nunca los de otros).
app.get('/media/:id/logs', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id, 10);
    const logs = await prisma.gameLog.findMany({
      where: { userId: req.userId, mediaId },
      orderBy: { orden: 'asc' },
    });
    res.json(logs);
  } catch (error) {
    console.error('ERROR EN GET /media/:id/logs:', error);
    res.status(500).json({ error: 'Error al obtener los logs' });
  }
});

app.post('/media/:id/logs', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id, 10);
    const totalExistentes = await prisma.gameLog.count({ where: { userId: req.userId, mediaId } });

    const nuevo = await prisma.gameLog.create({
      data: {
        userId: req.userId,
        mediaId,
        nombre: totalExistentes === 0 ? 'Log' : `Log ${totalExistentes + 1}`,
        orden: totalExistentes,
      },
    });
    res.status(201).json(nuevo);
  } catch (error) {
    console.error('ERROR EN POST /media/:id/logs:', error);
    res.status(500).json({ error: 'Error al crear el log' });
  }
});

// Un único PATCH para todo: renombrar (solo {nombre}) o guardar el formulario
// completo (el resto de campos) — el frontend manda solo lo que ha cambiado.
app.patch('/logs/:logId', requireAuth, async (req, res) => {
  try {
    const logId = parseInt(req.params.logId, 10);
    const log = await prisma.gameLog.findUnique({ where: { id: logId } });
    if (!log || log.userId !== req.userId) {
      return res.status(404).json({ error: 'Log no encontrado' });
    }

    const { nombre, plataforma, jugadoEn, propiedad, fechaInicio, fechaFin, edicion, minutosJugados, rating, review, spoilers } = req.body;

    const data = {};
    if (nombre !== undefined) data.nombre = nombre;
    if (plataforma !== undefined) data.plataforma = plataforma;
    if (jugadoEn !== undefined) data.jugadoEn = jugadoEn;
    if (propiedad !== undefined) data.propiedad = propiedad;
    if (fechaInicio !== undefined) data.fechaInicio = fechaInicio ? new Date(fechaInicio) : null;
    if (fechaFin !== undefined) data.fechaFin = fechaFin ? new Date(fechaFin) : null;
    if (edicion !== undefined) data.edicion = edicion;
    if (minutosJugados !== undefined) data.minutosJugados = minutosJugados;
    if (rating !== undefined) data.rating = rating;
    if (review !== undefined) data.review = review;
    if (spoilers !== undefined) data.spoilers = spoilers;

    const actualizado = await prisma.gameLog.update({ where: { id: logId }, data });
    res.json(actualizado);
  } catch (error) {
    console.error('ERROR EN PATCH /logs/:logId:', error);
    res.status(500).json({ error: 'Error al guardar el log' });
  }
});

app.delete('/logs/:logId', requireAuth, async (req, res) => {
  try {
    const logId = parseInt(req.params.logId, 10);
    const log = await prisma.gameLog.findUnique({ where: { id: logId } });
    if (!log || log.userId !== req.userId) {
      return res.status(404).json({ error: 'Log no encontrado' });
    }
    await prisma.gameLog.delete({ where: { id: logId } });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE /logs/:logId:', error);
    res.status(500).json({ error: 'Error al borrar el log' });
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

// Casos comprobados donde Wikidata NO tiene documentada la relación P144
// (based on) entre película y videojuego — ni siquiera del lado del juego, así
// que ni la consulta automática ni el respaldo por nombre lo encuentran (se
// comprobó a mano en el Query Service que el ítem del juego no tiene ningún
// P144). Mismo espíritu que VINCULACIONES_MANUALES: un objeto en el código
// para forzar a mano lo que ninguna API expone. Clave: tmdbId de la PELÍCULA.
const ADAPTACIONES_MANUALES = {
  500: [{ igdbId: 6003 }], // Reservoir Dogs (película, 1992) -> Reservoir Dogs (videojuego, 2006)
  338970: [{ igdbId: 1164 }], // Tomb Raider (película, 2018) -> Tomb Raider (videojuego, 2013)
  588: [{ igdbId: 480 }], // Silent Hill (película, 2006) -> Silent Hill (videojuego, 1999)
  557: [{ igdbId: 19114 }], // Spider-Man (película, 2002) -> Spider-Man: The Movie (videojuego, 2002)
};

// --- BUSCA EN WIKIDATA VIDEOJUEGOS RELACIONADOS CON ESTA PELÍCULA POR ADAPTACIÓN ---
// Reutiliza el mismo P144 ("based on") que ya usa buscarRemakeEnWikidata, pero
// mirando en AMBOS sentidos (?film wdt:P144 ?otro Y ?otro wdt:P144 ?film), ya
// que una adaptación puede ir en cualquier dirección: hay películas basadas en
// un videojuego, y videojuegos basados en una película. Filtramos que el otro
// lado sea instancia de videojuego (Q7889).
//
// Bastantes juegos (sobre todo los más antiguos/desconocidos, como el propio
// "Reservoir Dogs" de 2006) tienen la relación P144 puesta en Wikidata pero NO
// tienen relleno el P5794 (IGDB game ID) — solo ~74% de los juegos en Wikidata
// lo tienen. Para esos casos, en vez de descartarlos, caemos a una búsqueda de
// texto en IGDB por el nombre exacto (no por prefijo, como con los DLCs: aquí
// no hay "nombre base" del que partir), y si hay varias coincidencias con el
// mismo nombre, nos quedamos con la más cercana en año a la fecha de
// publicación que Wikidata tenga del ítem (P577), si la tiene.
//
// Y para el resto de casos, donde ni siquiera el propio P144 está puesto en
// Wikidata (como pasa con Reservoir Dogs — comprobado a mano: el juego no
// tiene esa relación en absoluto), se suma ADAPTACIONES_MANUALES de arriba.
async function buscarAdaptacionesWikidata(tmdbId) {
  try {
    const apiKey = process.env.TMDB_API_KEY;

    const [extRes, movieRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${apiKey}`),
      fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}`),
    ]);
    const extData = await extRes.json();
    const movieData = await movieRes.json();
    const imdbId = extData.imdb_id || null;
    const tituloPelicula = movieData.title || movieData.original_title || null;

    const idsFinal = new Set();
    const pendientesPorNombre = [];

    if (imdbId) {
      try {
        const sparql = `
          SELECT DISTINCT ?otroLabel ?igdbId ?fecha WHERE {
            ?film wdt:P345 "${imdbId}" .
            {
              ?film wdt:P144 ?otro .
            } UNION {
              ?otro wdt:P144 ?film .
            }
            ?otro wdt:P31/wdt:P279* wd:Q7889 .
            OPTIONAL { ?otro wdt:P5794 ?igdbId . }
            OPTIONAL { ?otro wdt:P577 ?fecha . }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
          } LIMIT 20
        `;
        const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
        const wdRes = await fetch(url, {
          headers: {
            'Accept': 'application/sparql-results+json',
            'User-Agent': 'MediaTrackerApp/1.0 (proyecto personal)'
          }
        });
        // Si Wikidata devuelve un error (429 por demasiadas consultas seguidas,
        // 500, etc.), el cuerpo puede venir vacío o no ser JSON válido. Antes
        // esto reventaba TODA la función (incluidas las vinculaciones manuales,
        // que ni llegaban a ejecutarse) porque no estaba en su propio try/catch.
        if (wdRes.ok) {
          const wdData = await wdRes.json();
          const bindings = wdData.results?.bindings || [];

          for (const b of bindings) {
            if (b.igdbId?.value) {
              const n = parseInt(b.igdbId.value, 10);
              if (!Number.isNaN(n)) idsFinal.add(n);
            } else if (b.otroLabel?.value) {
              pendientesPorNombre.push({
                nombre: b.otroLabel.value,
                anio: b.fecha?.value ? new Date(b.fecha.value).getFullYear() : null,
              });
            }
          }
        } else {
          console.error('Wikidata respondió', wdRes.status, 'al consultar adaptaciones; se sigue con IGDB/manuales.');
        }
      } catch (wdError) {
        console.error('Error consultando SPARQL de Wikidata (se sigue con IGDB/manuales):', wdError.message);
      }
    }

    const token = await getIgdbToken();
    const headers = {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    };

    for (const pendiente of pendientesPorNombre) {
      const queryTexto = `search "${pendiente.nombre}"; fields name, cover.url, first_release_date; limit 15;`;
      const respTexto = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryTexto });
      if (!respTexto.ok) continue;
      const dataTexto = await respTexto.json();
      const nombreNormalizado = pendiente.nombre.toLowerCase();
      const candidatos = (dataTexto || []).filter((g) => g.name && g.name.toLowerCase() === nombreNormalizado);
      if (candidatos.length === 0) continue;

      let elegido = candidatos[0];
      if (candidatos.length > 1 && pendiente.anio) {
        elegido = candidatos.reduce((mejor, actual) => {
          const anioActual = actual.first_release_date ? new Date(actual.first_release_date * 1000).getFullYear() : null;
          const anioMejor = mejor.first_release_date ? new Date(mejor.first_release_date * 1000).getFullYear() : null;
          const difActual = anioActual !== null ? Math.abs(anioActual - pendiente.anio) : Infinity;
          const difMejor = anioMejor !== null ? Math.abs(anioMejor - pendiente.anio) : Infinity;
          return difActual < difMejor ? actual : mejor;
        }, candidatos[0]);
      }
      idsFinal.add(elegido.id);
    }

    // TERCERA VÍA, sin depender de Wikidata en absoluto: si a estas alturas
    // seguimos sin nada, buscamos en IGDB por el nombre EXACTO de la
    // película y comprobamos si la sinopsis del juego confirma la relación.
    // Muchos videojuegos "tie-in" de películas (sobre todo 90s/2000s) llevan
    // literalmente en su sinopsis de IGDB algo como "is a video game based
    // on the [Película] film of the same name" — así que si el nombre
    // coincide Y la sinopsis lo confirma explícitamente, lo damos por bueno
    // sin intervención manual. No cubre el caso inverso (película basada en
    // juego, que rara vez lo dice la sinopsis del propio juego) ni juegos
    // cuya sinopsis no lo mencione así.
    if (idsFinal.size === 0 && tituloPelicula) {
      const queryPorTitulo = `
        search "${tituloPelicula}";
        fields name, cover.url, first_release_date, summary, storyline;
        limit 20;
      `;
      const respTitulo = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryPorTitulo });
      if (respTitulo.ok) {
        const dataTitulo = await respTitulo.json();
        const nombreNormalizado = tituloPelicula.toLowerCase();
        const candidatos = (dataTitulo || []).filter((g) => {
          if (!g.name || g.name.toLowerCase() !== nombreNormalizado) return false;
          const texto = `${g.summary || ''} ${g.storyline || ''}`.toLowerCase();
          return texto.includes('based on') && (texto.includes('film') || texto.includes('movie'));
        });
        for (const c of candidatos) idsFinal.add(c.id);
      }
    }

    const manuales = ADAPTACIONES_MANUALES[parseInt(tmdbId, 10)] || [];
    for (const m of manuales) idsFinal.add(m.igdbId);

    if (idsFinal.size === 0) return { videojuegos: [] };

    const idsArray = [...idsFinal];
    const body = `fields name, cover.url, first_release_date; where id = (${idsArray.join(',')}); limit ${idsArray.length};`;
    const respJuegos = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body });
    if (!respJuegos.ok) return { videojuegos: [] };
    const dataJuegos = await respJuegos.json();

    const videojuegos = (dataJuegos || []).map((g) => ({
      igdbId: g.id,
      titulo: g.name,
      portada: g.cover?.url
        ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}`
        : null,
      anio: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
    }));

    return { videojuegos };
  } catch (error) {
    console.error('Error consultando Wikidata para adaptaciones:', error);
    return { videojuegos: [] };
  }
}

app.get('/wikidata/adaptaciones/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const resultado = await buscarAdaptacionesWikidata(tmdbId);
    res.json(resultado);
  } catch (err) {
    console.error('ERROR EN GET /wikidata/adaptaciones/:tmdbId:', err);
    res.status(500).json({ error: 'Error al obtener adaptaciones' });
  }
});

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
      customPoster: null,
      playStatus: null
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
    const { watched, liked, watchlist, rating, customPoster, playStatus } = req.body;

    const data = {};
    if (watched !== undefined) data.watched = watched;
    if (liked !== undefined) data.liked = liked;
    if (watchlist !== undefined) data.watchlist = watchlist;
    if (rating !== undefined) data.rating = rating;
    if (rating !== undefined && rating !== null) data.watched = true;
    if (customPoster !== undefined) data.customPoster = customPoster;
    // playStatus es solo para videojuegos (Playing/Completed/Retired/
    // Shelved/Abandoned). Al elegir un estado, marcamos watched = true
    // automáticamente (igual que ya hace rating); al pulsar "Mark as
    // unplayed" el frontend manda playStatus = null, y aquí lo traducimos
    // también a watched = false.
    if (playStatus !== undefined) {
      data.playStatus = playStatus;
      data.watched = playStatus !== null;
    }

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