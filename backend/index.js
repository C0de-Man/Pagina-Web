require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
// Por defecto Express limita el cuerpo de las peticiones a 100kb, que se
// queda corto para las imágenes de banner recortadas que se guardan como
// base64 (BannerCropModal/AvatarCropModal) — sin subir esto, esas peticiones
// fallaban con "PayloadTooLargeError" sin que el frontend llegara a
// enterarse de por qué.
app.use(express.json({ limit: '10mb' }));

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
    // Igual que en /igdb/catalogo: ordenamos por popularidad (total_rating_count),
    // no por fecha de lanzamiento, para que el carrusel muestre primero los
    // más populares de ese año.
    const body = `fields name,cover.url,first_release_date,summary; where first_release_date >= ${desde} & first_release_date <= ${hasta}; sort total_rating_count desc; limit 20;`;
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
    // Mismo motivo que arriba: sort por hypes excluye a casi todos los juegos.
    const body = `fields name,cover.url,first_release_date,summary; where first_release_date >= ${desde} & first_release_date <= ${hasta}; sort first_release_date desc; limit ${itemsPerPage}; offset ${offset};`;
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
    // Antes: "sort hypes desc" (casi todos los juegos no tienen ese campo
    // relleno, así que IGDB los excluía y el catálogo por año quedaba casi
    // vacío) y luego "sort first_release_date desc" (evitaba el problema
    // pero no ordenaba por popularidad, que es lo que de verdad se quería
    // ver primero). total_rating_count SÍ está lo bastante extendido — es
    // el mismo campo que ya usa /igdb/popular con éxito — así que ahora se
    // usa también en modo "año" para mostrar los más populares de ESE año
    // primero, no solo los históricos de siempre.
    const orden = req.query.orden === 'asc' ? 'asc' : 'desc';
    const sort = `sort total_rating_count ${orden};`;

    const token = await getIgdbToken();
    const headers = {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain'
    };
    const body = `fields name,cover.url,first_release_date,summary; ${where} ${sort} limit ${itemsPerPage}; offset ${offset};`;

    // LOG TEMPORAL DE DIAGNÓSTICO — bórralo en cuanto encontremos el bug de "Platform"
    console.log('[DEBUG catálogo juegos] query recibida:', req.query);
    console.log('[DEBUG catálogo juegos] where construido:', where);

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
  // revés TODO lo que cuelgue de este juego (parent_game = X). Usamos
  // game_type, NO category: como ya se descubrió en /igdb/catalogo,
  // "category" es el campo VIEJO de IGDB y se deja cada vez más vacío en
  // entradas nuevas — de hecho ESE era el bug real de "More content" vacío
  // en juegos recién salidos (Resident Evil Requiem y sus DLCs/updates
  // tenían category = null, así que "category != (3,5,8,9)" los excluía a
  // TODOS sin querer, null incluido). Para no arriesgarnos a que pase lo
  // mismo con game_type en el futuro, aquí NO filtramos dentro de la query
  // — traemos todo lo que cuelgue de este juego y clasificamos después, en
  // JS, tratando game_type ausente/null como "no es mod/remake/remaster/
  // bundle" (o sea, se admite como DLC salvo que se demuestre lo contrario).
  const queryInverso = `
    fields name, cover.url, first_release_date, game_type, status, version_parent;
    where parent_game = ${igdbId};
    limit 50;
  `;

  // Mods: se buscan al revés por parent_game + game_type 5.
  const queryMods = `
    fields name, cover.url, first_release_date, status;
    where parent_game = ${igdbId} & game_type = 5;
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

  // game_type: 3 bundle, 5 mod, 8 remake, 9 remaster — esos NO van aquí (los
  // mods ya se piden aparte arriba; remakes/remasters van a la sección de
  // saga; bundles son packs/compilaciones). game_type ausente/null se trata
  // como "sí es DLC" en vez de excluirlo — SALVO que tenga version_parent
  // relleno: eso significa que esta entrada no es contenido nuevo, sino una
  // EDICIÓN/SKU concreta de otro juego ya existente (misma idea que
  // version_parent en GameCollectionLinks) — p. ej. la versión de PS2/Xbox
  // de un juego con varias versiones por plataforma, que sin este filtro se
  // colaba como "DLC" al no tener game_type puesto.
  // game_type: 3 bundle, 5 mod, 8 remake, 9 remaster, 10 expanded_game,
  // 11 port — ninguno de esos va aquí (los mods ya se piden aparte arriba;
  // remakes/remasters van a la sección de saga; bundles son packs; expanded
  // game/port son versiones alternativas del MISMO juego —p. ej. la versión
  // de otra plataforma—, no contenido nuevo). game_type ausente/null se
  // sigue tratando como "sí es DLC" — SALVO que tenga version_parent
  // relleno (edición/SKU concreta de otro juego ya existente).
  const TIPOS_EXCLUIDOS = [3, 5, 8, 9, 10, 11];
  const dataInversoUtil = (dataInverso || []).filter(
    (g) => !TIPOS_EXCLUIDOS.includes(g.game_type) && !g.version_parent
  );

  // De lo que queda, lo que tenga game_type = 14 (update) va a "updates"; el
  // resto (dlc_addon, expansion, episode, season, pack, o sin game_type) se
  // suma a los DLCs directos.
  const dataUpdates = dataInversoUtil.filter((g) => g.game_type === 14);
  const dataInversoSinUpdates = dataInversoUtil.filter((g) => g.game_type !== 14);

  const juego = dataPrincipal[0] || {};

  // Algunos "updates" (game_type 14) tampoco tienen relleno su propio
  // parent_game en IGDB, así que la búsqueda por relación (arriba) no los
  // encuentra. Como último recurso, para estos SÍ hacemos una búsqueda de
  // texto por el nombre del juego base, filtrando a que el nombre del
  // update lo contenga (evita falsos positivos de nombres parecidos, igual
  // que hacemos con SteamGridDB).
  let updatesEncontrados = dataUpdates || [];
  if (updatesEncontrados.length === 0 && juego.name) {
    const queryUpdatesPorTexto = `
      search "${juego.name}";
      fields name, cover.url, first_release_date, game_type;
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
        return g.game_type === 14 || nombreNormalizado.includes('update');
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

  // LOG TEMPORAL DE DIAGNÓSTICO — bórralo en cuanto encontremos el bug de "More content"
  console.log('[DEBUG dlcs-updates] resultado final:', JSON.stringify({ dlcs, updates, mods }, null, 2));

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

  // game_type 9 = Remaster, game_type 11 = Port. Usamos game_type, NO
  // category, por el mismo motivo que en getIgdbDlcsUpdates: category se
  // deja vacío (null) en entradas nuevas, y "category = (9,11)" excluye
  // también los null. No filtramos dentro de la query — clasificamos
  // después, en JS.
  const queryInverso = `
    fields name, cover.url, first_release_date, game_type, status;
    where parent_game = ${igdbId};
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
  const inversoPorts = (dataInverso || []).filter((g) => g.game_type === 11);
  const inversoRemasters = (dataInverso || []).filter((g) => g.game_type === 9);

  const yaHayPorts = (juego.ports || []).length > 0 || inversoPorts.length > 0;
  const yaHayRemasters = (juego.remasters || []).length > 0 || inversoRemasters.length > 0;

  let portsTexto = [];
  let remastersTexto = [];
  if ((!yaHayPorts || !yaHayRemasters) && juego.name) {
    const queryTexto = `
      search "${juego.name}";
      fields name, cover.url, first_release_date, game_type;
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
          (g) => cumplePrefijo(g) && (g.game_type === 11 || g.name.toLowerCase().includes('port'))
        );
      }
      if (!yaHayRemasters) {
        remastersTexto = (dataTexto || []).filter(
          (g) => cumplePrefijo(g) && (g.game_type === 9 || g.name.toLowerCase().includes('remaster'))
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

// --- LISTA PLANA DE EDICIONES/VERSIONES PARA EL DESPLEGABLE "Version played"
// DEL MODAL DE LOG ---
// Incluye el juego original + cualquier game_type 9 (remaster), 10
// (expanded_game) u 11 (port) que cuelgue de él por parent_game — el mismo
// concepto de "es una versión del mismo juego, no contenido nuevo" que ya
// se usa para excluirlas de "More content".
app.get('/igdb/ediciones/:igdbId', async (req, res) => {
  try {
    const igdbId = parseInt(req.params.igdbId, 10);
    if (Number.isNaN(igdbId)) return res.status(400).json({ error: 'igdbId inválido' });

    const token = await getIgdbToken();
    const headers = {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain'
    };

    const queryBase = `fields name, platforms.id, platforms.name; where id = ${igdbId};`;
    const queryVersiones = `fields name, game_type, platforms.id, platforms.name; where parent_game = ${igdbId}; limit 50;`;

    const [resBase, resVersiones] = await Promise.all([
      fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryBase }),
      fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryVersiones }),
    ]);
    const dataBase = await resBase.json();
    const dataVersiones = await resVersiones.json();

    const base = dataBase[0];
    const TIPOS_VERSION = [9, 10, 11];
    const versiones = (dataVersiones || []).filter((g) => TIPOS_VERSION.includes(g.game_type));

    // Si el título tiene plataformas, las añadimos entre paréntesis: varias
    // versiones suelen compartir el mismo nombre (una por plataforma), y sin
    // esto son indistinguibles en el desplegable.
    const conPlataformas = (nombre, g) => {
      const plataformas = (g.platforms || []).map((p) => p.name).join(', ');
      return plataformas ? `${nombre} (${plataformas})` : nombre;
    };

    const opciones = [
      { igdbId, titulo: conPlataformas(base?.name || 'Original', base || {}), plataformas: base?.platforms || [] },
      ...versiones.map((v) => ({ igdbId: v.id, titulo: conPlataformas(v.name, v), plataformas: v.platforms || [] })),
    ];

    res.json(opciones);
  } catch (err) {
    console.error('ERROR EN GET /igdb/ediciones/:igdbId:', err);
    res.status(500).json({ error: 'Error al obtener las ediciones del juego' });
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

// --- EQUIVALENCIAS DE NUMERACIÓN ÁRABE/ROMANA ---
// SteamGridDB no sigue un criterio fijo: muchas sagas numeradas están
// catalogadas con números romanos ("Red Dead Redemption II") aunque el
// nombre "oficial" del juego (el que tenemos guardado, vía IGDB) use
// arábigos ("Red Dead Redemption 2"). Comparando el texto tal cual, "2" y
// "ii" nunca coinciden — con esta tabla las tratamos como la misma palabra
// en ambas búsquedas (exacta y flexible).
const NUMEROS_ROMANOS = { '2': 'ii', '3': 'iii', '4': 'iv', '5': 'v', '6': 'vi', '7': 'vii', '8': 'viii', '9': 'ix', '10': 'x' };
const NUMEROS_ROMANOS_INVERSO = Object.fromEntries(Object.entries(NUMEROS_ROMANOS).map(([arabigo, romano]) => [romano, arabigo]));
// Si la palabra es un número romano conocido (de la tabla de arriba), la
// convierte a su equivalente arábigo; si no, la deja tal cual.
function canonicalizarNumero(palabra) {
  return NUMEROS_ROMANOS_INVERSO[palabra] || palabra;
}

// --- VINCULACIONES MANUALES DE STEAMGRIDDB ---
// Para juegos que la búsqueda por nombre no localiza (apóstrofes raros,
// nombre distinto al oficial en SteamGridDB, título muy nuevo o poco
// indexado...), se salta la búsqueda automática y se usa directamente este
// ID. Se saca de la URL de la ficha del juego en steamgriddb.com/game/XXXXXX
// — la clave es el igdbId del juego (el que ya tenemos guardado en Media).
const SGDB_MANUAL = {
  327999: 5467461, // Kota's New Journey — la búsqueda por nombre no la encontraba
};

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
  const normalizar = (s) =>
    (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim()
      .split(' ').map(canonicalizarNumero).join(' ');
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

  const normalizar = (s) =>
    (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim()
      .split(' ').map(canonicalizarNumero).join(' ');
  const palabrasNombre = normalizar(nombre).split(' ').filter(Boolean);

  const coincideEnLasPrimerasPalabras = (candidatoNombre) => {
    const palabrasCandidato = normalizar(candidatoNombre).split(' ').filter(Boolean);
    // El candidato NUNCA puede tener MENOS palabras que el título que
    // buscamos: si las tiene, es que le falta información respecto al
    // título original (p. ej. "Red Dead Redemption" frente a "Red Dead
    // Redemption 2") — eso es un juego distinto, no una edición/versión del
    // mismo. Solo se permite que el candidato tenga IGUALES o MÁS palabras
    // (sufijos de edición, como "... The Complete Edition").
    if (palabrasCandidato.length < palabrasNombre.length) return false;
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

// --- Trae TODAS las carátulas de SteamGridDB para un juego --- La API de
// SteamGridDB pagina de 50 en 50 (no admite pedir más por página), así que
// hay que ir pidiendo página a página hasta que una página devuelva menos de
// 50 resultados — eso es lo que de verdad indica que ya no queda nada más (el
// campo "total" que devuelve la propia API es poco fiable, a veces cuenta
// duplicado, así que no nos fiamos de él para decidir cuándo parar).
// Sin tope artificial de páginas (antes había uno en 4 = 200 carátulas, que
// se quedaba corto en juegos muy populares como Disco Elysium). Se deja un
// tope de seguridad muy alto (60 páginas = 3000 carátulas) solo para evitar
// un bucle infinito de verdad si la API de SteamGridDB tuviera algún fallo
// devolviendo siempre 50 resultados sin parar nunca — en la práctica, para
// cualquier juego real, esto siempre se para solo mucho antes de llegar ahí.
const SGDB_MAX_PAGINAS_SEGURIDAD = 60;
async function obtenerTodasLasGridsSteamGridDB(sgdbId, headers) {
  let todas = [];
  for (let pagina = 0; pagina < SGDB_MAX_PAGINAS_SEGURIDAD; pagina++) {
    const resp = await fetch(
      // Sin restricción de dimensiones ni de tipo (se piden también todas
      // las animadas), y nsfw/humor/epilepsy en "any" para no filtrar nada.
      // nsfw=any&humor=any&epilepsy=any: por defecto SteamGridDB filtra estas
      // etiquetas; aquí se piden todas, sin descartar ninguna por su tag.
      // Sin filtro de dimensiones (antes solo 600x900/342x482/660x930,
      // descartando carátulas en otros tamaños válidos como 920x430 o
      // 1024x1024) ni de tipo (incluye animadas) — nsfw/humor/epilepsy en
      // "any" para no descartar tampoco por etiqueta. Se pide literalmente
      // todo lo que haya, a petición explícita.
      `https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?types=static,animated&nsfw=any&humor=any&epilepsy=any&page=${pagina}`,
      { headers }
    );
    const data = await resp.json();
    const pagina_data = data?.data || [];
    // LOG TEMPORAL DE DIAGNÓSTICO — quitar cuando encontremos la causa.
    if (pagina === 0) {
      console.log(`[SGDB MIME DEBUG] ${pagina_data.length} resultados. Primeras 5:`);
      pagina_data.slice(0, 5).forEach((g, i) => {
        console.log(`  [${i}] style=${g.style} mime=${g.mime} url=${g.url} thumb=${g.thumb}`);
      });
    }
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

    // Si hay una vinculación manual para este juego, nos la saltamos y
    // usamos ese ID directamente — si no, buscamos por nombre como siempre.
    const sgdbId = SGDB_MANUAL[media.igdbId] || (await buscarJuegoEnSteamGridDB(media.tituloOriginal || media.titulo, media.anio));

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

      // "heroes" = imagen ancha tipo banner (mismos filtros que las carátulas)
      const resHeroes = await fetch(`https://www.steamgriddb.com/api/v2/heroes/game/${sgdbId}?types=static,animated&nsfw=any&humor=any&epilepsy=any`, { headers });
      const dataHeroes = await resHeroes.json();
      // LOG TEMPORAL DE DIAGNÓSTICO — quitar cuando encontremos la causa.
      const heroesData = dataHeroes?.data || [];
      console.log(`[SGDB MIME DEBUG - HEROES] ${heroesData.length} resultados. Primeras 5:`);
      heroesData.slice(0, 5).forEach((h, i) => {
        console.log(`  [${i}] style=${h.style} mime=${h.mime} url=${h.url} thumb=${h.thumb}`);
      });
      heroes = heroesData.map(h => h.url);
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

// --- HELPER: como requireAuth pero sin bloquear la petición ---
// Para rutas públicas (como GET /media/:id, que se puede ver sin login) que
// además quieren saber, SI hay sesión, quién pregunta — para poder mezclar
// personalizaciones (customPoster/customBackdrop) sin exigir estar logueado
// para ver la ficha.
function getUserIdOpcional(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.userId;
  } catch (error) {
    return null;
  }
}

// --- HELPER: mezclar customPoster/customBackdrop en resultados EN CRUDO de TMDB ---
// A diferencia de GET /media/:id (que ya trabaja sobre TU base de datos),
// estas rutas (/tmdb/popular, /tmdb/buscar, etc.) devuelven objetos tal cual
// los da TMDB — no saben si ese título ya está guardado en tu base de datos
// ni si lo has personalizado. Aquí se cruza por tmdbId y, si hay sesión y
// personalización, se inyecta en el mismo campo "portada"/"backdrop" que ya
// usa MovieCard como fallback (pelicula.portada), sin tocar poster_path.
async function mezclarCustomPosters(items, userId) {
  if (!userId || !items || items.length === 0) return items;

  const tmdbIds = items.map((i) => i.id).filter(Boolean);
  if (tmdbIds.length === 0) return items;

  const mediaLocal = await prisma.media.findMany({
    where: { tmdbId: { in: tmdbIds } },
    select: { id: true, tmdbId: true }
  });
  if (mediaLocal.length === 0) return items;

  const mediaIds = mediaLocal.map((m) => m.id);
  const personalizaciones = await prisma.userMedia.findMany({
    where: { userId, mediaId: { in: mediaIds } },
    select: { mediaId: true, customPoster: true, customBackdrop: true }
  });
  if (personalizaciones.length === 0) return items;

  const mediaIdPorTmdbId = new Map(mediaLocal.map((m) => [m.tmdbId, m.id]));
  const personalizacionPorMediaId = new Map(personalizaciones.map((p) => [p.mediaId, p]));

  return items.map((item) => {
    const mediaId = mediaIdPorTmdbId.get(item.id);
    const mia = mediaId ? personalizacionPorMediaId.get(mediaId) : null;
    if (!mia || (!mia.customPoster && !mia.customBackdrop)) return item;
    return {
      ...item,
      ...(mia.customPoster ? { portada: mia.customPoster } : {}),
      ...(mia.customBackdrop ? { backdrop: mia.customBackdrop } : {})
    };
  });
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
// --- ADMIN: recalcular en inglés la carátula/banner COMPARTIDOS (Media.portada
// / Media.backdrop) de todas las películas y series ya guardadas. ---
// Solo toca el valor por defecto compartido — la personalización de cada
// usuario (UserMedia.customPoster/customBackdrop) sigue funcionando igual y
// puede seguir siendo de cualquier región, esto no la afecta ni la borra.
app.post('/admin/media/refresh-covers-english', requireAuth, requireAdmin, async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const items = await prisma.media.findMany({
      where: { tipo: { in: ['PELICULA', 'SERIE'] }, tmdbId: { not: null } },
      select: { id: true, tmdbId: true, tipo: true },
    });

    let actualizados = 0;
    let sinCambios = 0;
    let fallidos = 0;

    // Secuencial, no en paralelo: con catálogos grandes, disparar cientos de
    // peticiones a TMDB de golpe puede toparse con su límite de peticiones,
    // igual que ya pasaba con IGDB antes de meterle una cola (ver fetchIgdb).
    for (const item of items) {
      try {
        const endpointTmdb = item.tipo === 'SERIE' ? 'tv' : 'movie';
        const resp = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${item.tmdbId}?api_key=${apiKey}&language=en-US`);
        const data = await resp.json();
        if (!data || data.status_code) { fallidos++; continue; }

        const nuevaPortada = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;
        const nuevoBackdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null;

        if (!nuevaPortada && !nuevoBackdrop) { sinCambios++; continue; }

        await prisma.media.update({
          where: { id: item.id },
          data: {
            ...(nuevaPortada ? { portada: nuevaPortada } : {}),
            ...(nuevoBackdrop ? { backdrop: nuevoBackdrop } : {}),
          },
        });
        actualizados++;
      } catch (e) {
        fallidos++;
      }
    }

    res.json({ ok: true, total: items.length, actualizados, sinCambios, fallidos });
  } catch (error) {
    console.error('ERROR EN POST /admin/media/refresh-covers-english:', error);
    res.status(500).json({ error: 'Error al recalcular las carátulas' });
  }
});

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

// --- CARÁTULAS/BANNERS DE CATÁLOGO SIEMPRE EN INGLÉS, AUNQUE EL TÍTULO/
// SINOPSIS RESPETEN TU IDIOMA ---
// TMDB devuelve una imagen distinta según el "language" que le pidas (a
// veces con el título traducido dibujado en la propia carátula) — mismo
// motivo que ya se corrigió en POST /media/tmdb, pero aquí aplicado a las
// REJILLAS de catálogo (lobby, populares, año, búsqueda...), que hasta ahora
// seguían mostrando la carátula en tu idioma porque pedían la lista entera
// (título+imagen) de una sola vez en ese idioma.
//
// urlOriginal: la URL exacta ya usada para pedir la lista (con su
// "language=xx-XX"). Se reconstruye la misma URL pero en inglés, se pide
// también, y se le injerta poster_path/backdrop_path a cada resultado por
// id — sin tocar título/overview/lo demás, que se queda en tu idioma.
async function conCaratulasIngles(urlOriginal, resultadosOriginales) {
  if (!resultadosOriginales || resultadosOriginales.length === 0) return resultadosOriginales;
  if (!/language=/.test(urlOriginal)) return resultadosOriginales;

  const urlIngles = urlOriginal.replace(/language=[^&]+/, 'language=en-US');
  if (urlIngles === urlOriginal) return resultadosOriginales; // ya se pidió en inglés, nada que hacer

  try {
    const respIngles = await fetch(urlIngles);
    const dataIngles = await respIngles.json();
    const listaIngles = dataIngles.results || (Array.isArray(dataIngles) ? dataIngles : []);
    // Clave de emparejamiento: id+media_type si el resultado lo trae (caso
    // del buscador multi, que mezcla película/serie/persona y podría tener
    // ids numéricos coincidentes entre tipos distintos); si no lo trae
    // (discover/movie, que es solo películas), basta con el id.
    const clave = (m) => (m.media_type ? `${m.media_type}-${m.id}` : String(m.id));
    const porClave = new Map(listaIngles.map((m) => [clave(m), m]));

    return resultadosOriginales.map((item) => {
      const ingles = porClave.get(clave(item));
      if (!ingles) return item;
      return {
        ...item,
        poster_path: ingles.poster_path || item.poster_path,
        backdrop_path: ingles.backdrop_path || item.backdrop_path,
      };
    });
  } catch (e) {
    console.error('No se pudieron obtener carátulas en inglés, se dejan las del idioma pedido:', e.message);
    return resultadosOriginales;
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

    // Mezcla tu portada/banner personalizados (si los tienes) por encima de
    // los compartidos — mismo criterio que GET /media/:id.
    const misPersonalizaciones = await prisma.userMedia.findMany({
      where: { userId: req.userId, mediaId: { in: mediaIds } },
      select: { mediaId: true, customPoster: true, customBackdrop: true }
    });
    const mapaPersonalizaciones = new Map(misPersonalizaciones.map(p => [p.mediaId, p]));
    const resultado = mediaItems.map(item => {
      const mia = mapaPersonalizaciones.get(item.id);
      return {
        ...item,
        portada: mia?.customPoster || item.portada,
        backdrop: mia?.customBackdrop || item.backdrop
      };
    });
    res.json(resultado);
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
    let resultados = await conCaratulasIngles(urlPagina(1), primeraData.results || []);
    const totalPaginas = Math.min(primeraData.total_pages || 1, TOPE_PAGINAS);

    if (totalPaginas > 1) {
      const restoPaginas = await Promise.all(
        Array.from({ length: totalPaginas - 1 }, (_, i) => {
          const p = i + 2;
          return fetch(urlPagina(p))
            .then((r) => r.json())
            .then((d) => conCaratulasIngles(urlPagina(p), d.results || []))
            .catch(() => []);
        })
      );
      for (const pagina of restoPaginas) resultados = resultados.concat(pagina);
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

    const resultadoFinal = await mezclarCustomPosters(sinDuplicados, getUserIdOpcional(req));
    res.json(resultadoFinal);
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
    // Antes esto SIEMPRE pedía a /movie/, aunque tipo fuera 'SERIE' — con
    // un id de serie eso da 404 en TMDB. Ahora usamos /tv/ o /movie/ según
    // el tipo real que se está guardando.
    const esSerie = tipo === 'SERIE';
    const endpointTmdb = esSerie ? 'tv' : 'movie';
    const response = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${tmdbId}?api_key=${apiKey}&language=${lang}`);
    const data = await response.json();

    // La carátula/banner se piden SIEMPRE en inglés (language=en-US), aunque
    // el título/sinopsis respeten tu idioma — TMDB devuelve una carátula
    // distinta (a veces con el título traducido dibujado en la propia
    // imagen) según el idioma pedido, y por defecto queremos la versión en
    // inglés, no la traducida. Si por lo que sea TMDB no tiene poster/backdrop
    // en inglés para este título, caemos a los que ya vinieron en "data"
    // arriba (mejor eso que quedarnos sin carátula).
    let dataImagenes = data;
    if (lang && !lang.startsWith('en')) {
      try {
        const respImagenes = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${tmdbId}?api_key=${apiKey}&language=en-US`);
        const dataEn = await respImagenes.json();
        if (dataEn && !dataEn.status_code) dataImagenes = dataEn;
      } catch (e) {
        // si falla, nos quedamos con "data" (el mismo idioma que el resto de la ficha)
      }
    }

    const backdropUrl = dataImagenes.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${dataImagenes.backdrop_path}`
      : (data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null);
    const posterUrl = dataImagenes.poster_path
      ? `https://image.tmdb.org/t/p/w500${dataImagenes.poster_path}`
      : (data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null);
    // Las series usan name/first_air_date en vez de title/release_date.
    const fechaLanzamiento = data.release_date || data.first_air_date || null;

    const newMedia = await prisma.media.create({
      data: {
        tmdbId: data.id,
        titulo: data.title || data.name,
        tituloOriginal: data.original_title || data.original_name || data.title || data.name,
        tipo: tipo || "PELICULA",
        anio: fechaLanzamiento ? parseInt(fechaLanzamiento.split('-')[0]) : null,
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
        if (!item) return null;
        return {
          ...item,
          portada: e.customPoster || item.portada,
          backdrop: e.customBackdrop || item.backdrop,
          fechaVisto: e.updatedAt,
          rating: e.rating,
          liked: e.liked
        };
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
        if (!item) return null;
        return {
          ...item,
          portada: e.customPoster || item.portada,
          backdrop: e.customBackdrop || item.backdrop,
          fechaAgregado: e.updatedAt
        };
      })
      .filter(Boolean);

    res.json(resultado);
  } catch (error) {
    console.error('ERROR EN GET WATCHLIST:', error);
    res.status(500).json({ error: 'Error al obtener la watchlist' });
  }
});

// --- MIS JUEGOS EN CURSO ("Currently Playing", playStatus = 'PLAYING') ---
app.get('/media/playing', requireAuth, async (req, res) => {
  try {
    const entries = await prisma.userMedia.findMany({
      where: { userId: req.userId, playStatus: 'PLAYING' },
      orderBy: { updatedAt: 'desc' }
    });

    const mediaIds = entries.map(e => e.mediaId);
    const mediaItems = await prisma.media.findMany({ where: { id: { in: mediaIds } } });

    const resultado = entries
      .map(e => {
        const item = mediaItems.find(m => m.id === e.mediaId);
        if (!item) return null;
        return {
          ...item,
          portada: e.customPoster || item.portada,
          backdrop: e.customBackdrop || item.backdrop,
        };
      })
      .filter(Boolean);

    res.json(resultado);
  } catch (error) {
    console.error('ERROR EN GET /media/playing:', error);
    res.status(500).json({ error: 'Error al obtener los juegos en curso' });
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

// --- RESEÑAS (pestaña "Reviews" del perfil): mezcla WatchLog.review
// (películas/series) y GameLog.review (juegos) en una sola lista, ordenada
// por fecha descendente. La usan tanto la ruta privada (/media/reviews, tu
// propia sesión) como la pública (/users/:username/reviews, sin sesión),
// para no duplicar la lógica de combinar+ordenar entre las dos.
async function construirResenas(userId) {
  const [watchLogs, gameLogs] = await Promise.all([
    prisma.watchLog.findMany({
      where: { userId, review: { not: null } },
      orderBy: { fechaVisto: 'desc' },
    }),
    prisma.gameLog.findMany({
      where: { userId, review: { not: null } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // review: { not: null } no descarta strings vacíos (""), así que se filtra
  // aparte tras traerlos.
  const watchLogsConTexto = watchLogs.filter((w) => w.review && w.review.trim());
  const gameLogsConTexto = gameLogs.filter((g) => g.review && g.review.trim());

  const mediaIds = [...new Set([...watchLogsConTexto.map((w) => w.mediaId), ...gameLogsConTexto.map((g) => g.mediaId)])];
  const mediaItems = await prisma.media.findMany({ where: { id: { in: mediaIds } } });

  const personalizaciones = await prisma.userMedia.findMany({
    where: { userId, mediaId: { in: mediaIds } },
    select: { mediaId: true, customPoster: true, rating: true, liked: true, watchlist: true },
  });
  const persPorMediaId = new Map(personalizaciones.map((p) => [p.mediaId, p]));

  const resenasPeliculas = watchLogsConTexto
    .map((w) => {
      const item = mediaItems.find((m) => m.id === w.mediaId);
      if (!item) return null;
      const pers = persPorMediaId.get(w.mediaId);
      return {
        ...item, // id, tmdbId, igdbId, tituloOriginal... todo lo que urlFicha() pueda necesitar
        logId: `watchlog-${w.id}`, // clave de React única — NO usar como id de urlFicha
        mediaId: w.mediaId,
        portada: pers?.customPoster || item.portada,
        review: w.review,
        rating: pers?.rating ?? null, // nota general de la película (UserMedia), no por log
        liked: pers?.liked ?? false,
        watchlist: pers?.watchlist ?? false,
        rewatch: w.rewatch,
        fecha: w.fechaVisto,
      };
    })
    .filter(Boolean);

  const resenasJuegos = gameLogsConTexto
    .map((g) => {
      const item = mediaItems.find((m) => m.id === g.mediaId);
      if (!item) return null;
      const pers = persPorMediaId.get(g.mediaId);
      return {
        ...item, // id, tmdbId, igdbId, tituloOriginal... todo lo que urlFicha() pueda necesitar
        logId: `gamelog-${g.id}`, // clave de React única — NO usar como id de urlFicha
        mediaId: g.mediaId,
        portada: pers?.customPoster || item.portada,
        review: g.review,
        rating: g.rating ?? null, // nota de ESTE log concreto (GameLog sí la guarda por log)
        liked: pers?.liked ?? false,
        watchlist: pers?.watchlist ?? false,
        logNombre: g.nombre,
        plataforma: g.plataforma || null,
        jugadoEn: g.jugadoEn || null,
        propiedad: g.propiedad || null,
        edicion: g.edicion || null,
        fechaInicio: g.fechaInicio,
        fechaFin: g.fechaFin,
        minutosJugados: g.minutosJugados ?? null,
        fecha: g.fechaFin || g.fechaInicio || g.createdAt,
      };
    })
    .filter(Boolean);

  return [...resenasPeliculas, ...resenasJuegos].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}

// --- MIS RESEÑAS (privado, tu propia sesión) ---
app.get('/media/reviews', requireAuth, async (req, res) => {
  try {
    const resenas = await construirResenas(req.userId);
    res.json(resenas);
  } catch (error) {
    console.error('ERROR EN GET /media/reviews:', error);
    res.status(500).json({ error: 'Error al obtener las reseñas' });
  }
});

// --- RESEÑAS DE UN USUARIO (público, sin sesión) ---
app.get('/users/:username/reviews', async (req, res) => {
  try {
    const username = req.params.username;
    const usuario = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const resenas = await construirResenas(usuario.id);
    res.json(resenas);
  } catch (error) {
    console.error('ERROR EN GET /users/:username/reviews:', error);
    res.status(500).json({ error: 'Error al obtener las reseñas del usuario' });
  }
});

// --- REGISTROS DE VISIONADO (películas/series) ---
// Versión simplificada de los logs de juegos: aquí el modal manda todo de
// una vez (fecha, reseña, si es un rewatch), así que basta con un único
// POST que crea el registro completo — no hace falta el patrón de "crear
// vacío y luego PATCH" que usa GameLog para sus pestañas editables.
app.get('/media/:id/watchlogs', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id, 10);
    const watchLogs = await prisma.watchLog.findMany({
      where: { userId: req.userId, mediaId },
      orderBy: { fechaVisto: 'desc' },
    });
    res.json(watchLogs);
  } catch (error) {
    console.error('ERROR EN GET /media/:id/watchlogs:', error);
    res.status(500).json({ error: 'Error al obtener los registros de visionado' });
  }
});

app.post('/media/:id/watchlogs', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id, 10);
    const { fechaVisto, review, rewatch } = req.body;

    const nuevo = await prisma.watchLog.create({
      data: {
        userId: req.userId,
        mediaId,
        fechaVisto: fechaVisto ? new Date(fechaVisto) : new Date(),
        review: review || null,
        rewatch: !!rewatch,
      },
    });
    res.status(201).json(nuevo);
  } catch (error) {
    console.error('ERROR EN POST /media/:id/watchlogs:', error);
    res.status(500).json({ error: 'Error al guardar el registro de visionado' });
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
// Antes escribía directo en Media (compartida por todos los usuarios: si uno
// la cambiaba, cambiaba para todo el mundo). Ahora se guarda en UserMedia,
// por usuario+película, igual que ya se hacía con customPoster desde
// PATCH /media/:id/status pero sin usarse nunca de verdad hasta ahora.
app.patch('/media/:id/poster', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const { newPosterUrl } = req.body;
    const userMedia = await prisma.userMedia.upsert({
      where: { userId_mediaId: { userId: req.userId, mediaId } },
      update: { customPoster: newPosterUrl },
      create: { userId: req.userId, mediaId, customPoster: newPosterUrl }
    });
    res.json(userMedia);
  } catch (error) {
    console.error('ERROR EN PATCH /media/:id/poster:', error);
    res.status(500).json({ error: "Error al actualizar la portada" });
  }
});

app.patch('/media/:id/backdrop', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const { newBackdropUrl } = req.body;
    const userMedia = await prisma.userMedia.upsert({
      where: { userId_mediaId: { userId: req.userId, mediaId } },
      update: { customBackdrop: newBackdropUrl },
      create: { userId: req.userId, mediaId, customBackdrop: newBackdropUrl }
    });
    res.json(userMedia);
  } catch (error) {
    console.error('ERROR EN PATCH /media/:id/backdrop:', error);
    res.status(500).json({ error: 'Error al actualizar el banner' });
  }
});

// --- Traduce los filtros del sidebar de películas (rating y duración) a
// query params de TMDB discover/movie. Devuelve un string listo para
// concatenar directamente a la URL (con "&" delante de cada parámetro, o
// "" si no hay filtros activos).
function construirFiltrosDiscoverMovie(query) {
  let params = '';

  const anio = parseInt(query.anio);
  if (!isNaN(anio) && anio > 1800) params += `&primary_release_year=${anio}`;

  const ratingMin = parseFloat(query.ratingMin);
  const ratingMax = parseFloat(query.ratingMax);
  if (!isNaN(ratingMin) && ratingMin > 0) params += `&vote_average.gte=${ratingMin}`;
  if (!isNaN(ratingMax) && ratingMax < 10) params += `&vote_average.lte=${ratingMax}`;

  // Duración en categorías fijas, no rango libre: Corta <90min / Media
  // 90-150min / Larga >150min.
  if (query.duracion === 'corta') {
    params += `&with_runtime.lte=89`;
  } else if (query.duracion === 'media') {
    params += `&with_runtime.gte=90&with_runtime.lte=150`;
  } else if (query.duracion === 'larga') {
    params += `&with_runtime.gte=151`;
  }

  return params;
}

// --- RUTAS PARA EL LOBBY ---
app.get('/tmdb/now_playing', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${apiKey}&language=${getLang(req)}&page=1`;
    const response = await fetch(url);
    const data = await response.json();
    const resultado = await conCaratulasIngles(url, data.results);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: "Error" });
  }
});

app.get('/tmdb/popular', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/movie/popular?api_key=${apiKey}&language=${getLang(req)}&page=1`;
    const response = await fetch(url);
    const data = await response.json();
    const conIngles = await conCaratulasIngles(url, data.results);
    const resultado = await mezclarCustomPosters(conIngles, getUserIdOpcional(req));
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: "Error" });
  }
});

// --- PELÍCULAS MÁS POPULARES DE LA HISTORIA (por número de votos, no por tendencia del momento) ---
app.get('/tmdb/popular-historico', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${getLang(req)}&sort_by=vote_count.desc&page=1`;
    const response = await fetch(url);
    const data = await response.json();
    const conIngles = await conCaratulasIngles(url, data.results || []);
    const resultado = await mezclarCustomPosters(conIngles, getUserIdOpcional(req));
    res.json(resultado);
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

    const paramsFiltro = construirFiltrosDiscoverMovie(req.query);
    const orden = req.query.orden === 'asc' ? 'asc' : 'desc';

    let combined = [];

    for (let i = startTmdbPage; i <= endTmdbPage; i++) {
      const url = `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${getLang(req)}&sort_by=vote_count.${orden}&page=${i}${paramsFiltro}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.results) combined.push(...(await conCaratulasIngles(url, data.results)));
    }

    const offsetDentroDeCombined = startIndex - (startTmdbPage - 1) * 20;
    const resultado = combined.slice(offsetDentroDeCombined, offsetDentroDeCombined + itemsPerPage);
    const resultadoFinal = await mezclarCustomPosters(resultado, getUserIdOpcional(req));

    res.json({ results: resultadoFinal });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener populares históricas" });
  }
});

// --- RUTA PARA EL LOBBY DE UN AÑO (Solo 20 resultados para la vista previa) ---
app.get('/tmdb/year/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${getLang(req)}&primary_release_year=${year}&sort_by=popularity.desc&page=1`;
    const response = await fetch(url);
    const data = await response.json();
    const conIngles = await conCaratulasIngles(url, data.results || []);
    const resultado = await mezclarCustomPosters(conIngles, getUserIdOpcional(req));
    res.json(resultado);
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

    // 'anio' en la query string NO se pasa aquí: el año ya viene fijado por
    // la propia ruta (:year). Si lo dejamos pasar también a
    // construirFiltrosDiscoverMovie, el fetch a TMDB acababa llevando
    // "primary_release_year" DOS VECES en la misma URL — lo cual podía
    // hacer que TMDB devolviera 0 resultados en vez del catálogo real.
    const { anio, ...queryFiltro } = req.query;
    const paramsFiltro = construirFiltrosDiscoverMovie(queryFiltro);
    const orden = req.query.orden === 'asc' ? 'asc' : 'desc';

    // LOG TEMPORAL DE DIAGNÓSTICO — bórralo en cuanto confirmemos que ya no pasa
    console.log('[DEBUG movies year] year:', year, 'query:', req.query, 'paramsFiltro:', paramsFiltro);

    let combined = [];

    for (let i = startTmdbPage; i <= endTmdbPage; i++) {
      const url = `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${getLang(req)}&primary_release_year=${year}&sort_by=popularity.${orden}&page=${i}${paramsFiltro}`;
      const response = await fetch(url);
      const data = await response.json();
      // LOG TEMPORAL DE DIAGNÓSTICO — bórralo junto con el de arriba
      if (!data.results) console.log('[DEBUG movies year] TMDB respondió sin resultados:', JSON.stringify(data));
      if (data.results) combined.push(...(await conCaratulasIngles(url, data.results)));
    }

    const uniqueCombined = Array.from(new Map(combined.map(m => [m.id, m])).values());

    const offset = startIndex % 20;
    const finalResults = uniqueCombined.slice(offset, offset + itemsPerPage);
    const finalResultsPersonalizados = await mezclarCustomPosters(finalResults, getUserIdOpcional(req));

    res.json({ page, results: finalResultsPersonalizados });
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
      // Antes solo el nombre (string). Ahora {id, nombre}: hace falta el id
      // de TMDB para poder enlazar cada estudio a su propia filmografía
      // (GET /tmdb/company/:companyId) — el nombre solo no basta para eso.
      estudios: data.production_companies?.map(c => ({ id: c.id, nombre: c.name })) || [],
      paises: data.production_countries?.map(c => c.name) || [],
      cast: data.credits?.cast?.slice(0, 15).map(a => ({
        id: a.id,
        nombre: a.name,
        personaje: a.character,
        foto: a.profile_path ? `https://image.tmdb.org/t/p/w185${a.profile_path}` : null
      })) || [],
      director: director
        ? {
            nombre: director.name,
            id: director.id,
            foto: director.profile_path ? `https://image.tmdb.org/t/p/w185${director.profile_path}` : null
          }
        : null,
      guionistas: guionistas.map(g => ({
        nombre: g.name,
        id: g.id,
        foto: g.profile_path ? `https://image.tmdb.org/t/p/w185${g.profile_path}` : null
      }))
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener detalles" });
  }
});

// --- FICHA DE UNA PERSONA (actor/director/guionista...): biografía + toda su
// filmografía agrupada por rol, con contador por rol (Actor, Director,
// Writer, Producer...) para las pestañas de filtro. ---
// --- PERSONALIZACIONES EN LOTE ---
// Para listas largas (como la filmografía de una persona, que puede tener
// 60+ créditos) no tiene sentido preguntar por cada título uno a uno como
// hace MovieCard con /media/:id/status — aquí se pide de una sola vez la
// personalización de todos los mediaId ya guardados que aparecen en la lista.
app.get('/media/personalizaciones', requireAuth, async (req, res) => {
  try {
    const idsParam = req.query.ids || '';
    const mediaIds = idsParam
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));
    if (mediaIds.length === 0) return res.json({});

    const personalizaciones = await prisma.userMedia.findMany({
      where: { userId: req.userId, mediaId: { in: mediaIds } },
      select: { mediaId: true, customPoster: true, customBackdrop: true }
    });

    const mapa = {};
    personalizaciones.forEach((p) => {
      if (p.customPoster || p.customBackdrop) {
        mapa[p.mediaId] = { customPoster: p.customPoster, customBackdrop: p.customBackdrop };
      }
    });
    res.json(mapa);
  } catch (error) {
    console.error('ERROR EN GET /media/personalizaciones:', error);
    res.status(500).json({ error: 'Error al obtener personalizaciones' });
  }
});

app.get('/tmdb/person/:personId', async (req, res) => {
  try {
    const { personId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const lang = getLang(req);

    const response = await fetch(
      `https://api.themoviedb.org/3/person/${personId}?api_key=${apiKey}&language=${lang}&append_to_response=combined_credits`
    );
    const data = await response.json();

    if (!data || data.success === false) {
      return res.status(404).json({ error: 'Persona no encontrada' });
    }

    const foto = data.profile_path ? `https://image.tmdb.org/t/p/w300${data.profile_path}` : null;

    const aFicha = (c, rol) => ({
      tmdbId: c.id,
      tipo: c.media_type === 'tv' ? 'SERIE' : 'PELICULA',
      titulo: c.title || c.name,
      posterPath: c.poster_path || null,
      fecha: c.release_date || c.first_air_date || null,
      rol,
    });

    // "cast" = papeles como actor; "crew" = todo lo demás, agrupado por su
    // "job" real (Director, Writer, Producer, Editor...) para poder mostrar
    // el desglose de pestañas con contador, como en Letterboxd.
    const cast = (data.combined_credits?.cast || []).filter((c) => c.media_type === 'movie' || c.media_type === 'tv');
    const crew = (data.combined_credits?.crew || []).filter((c) => c.media_type === 'movie' || c.media_type === 'tv');

    const porRol = {};
    for (const c of cast) {
      (porRol['Actor'] = porRol['Actor'] || []).push(aFicha(c, c.character || 'Actor'));
    }
    for (const c of crew) {
      const departamento = c.job || c.department || 'Crew';
      (porRol[departamento] = porRol[departamento] || []).push(aFicha(c, departamento));
    }

    // Dentro de cada rol, quitamos duplicados (un mismo título puede
    // aparecer más de una vez en "crew" si la persona tuvo varios "job"
    // distintos dentro del mismo departamento, p. ej. Writer y Screenplay)
    // y ordenamos por fecha, más reciente primero.
    for (const rol of Object.keys(porRol)) {
      const vistos = new Set();
      porRol[rol] = porRol[rol]
        .filter((p) => {
          const clave = `${p.tipo}-${p.tmdbId}`;
          if (vistos.has(clave)) return false;
          vistos.add(clave);
          return true;
        })
        .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    }

    res.json({
      id: data.id,
      nombre: data.name,
      biografia: data.biography || null,
      foto,
      porRol,
    });
  } catch (error) {
    console.error('ERROR EN GET /tmdb/person/:personId:', error);
    res.status(500).json({ error: 'Error al obtener la persona' });
  }
});

// --- DÓNDE VER (datos de JustWatch a través de TMDB) ---
// --- FICHA DE UN ESTUDIO: nombre/logo + filmografía (paginada de 20 en 20, como da TMDB por defecto) ---
app.get('/tmdb/company/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const lang = getLang(req);
    const page = parseInt(req.query.page) || 1;

    const [resCompany, resMovies] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/company/${companyId}?api_key=${apiKey}`),
      fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${lang}&with_companies=${companyId}&sort_by=primary_release_date.desc&page=${page}`),
    ]);
    const company = await resCompany.json();
    const movies = await resMovies.json();

    if (!company || company.success === false) {
      return res.status(404).json({ error: 'Estudio no encontrado' });
    }

    const peliculas = await mezclarCustomPosters(movies.results || [], getUserIdOpcional(req));

    res.json({
      id: company.id,
      nombre: company.name,
      logo: company.logo_path ? `https://image.tmdb.org/t/p/w300${company.logo_path}` : null,
      pais: company.origin_country || null,
      page,
      totalPaginas: Math.min(movies.total_pages || 1, 500), // límite propio de TMDB
      peliculas,
    });
  } catch (error) {
    console.error('ERROR EN GET /tmdb/company/:companyId:', error);
    res.status(500).json({ error: 'Error al obtener el estudio' });
  }
});

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

    // Si quien pregunta tiene sesión, su portada/banner personalizados (si
    // los tiene) pisan a los compartidos de Media — que siguen sirviendo de
    // valor por defecto para cualquiera que no haya personalizado nada.
    let portadaMostrada = mediaItem.portada;
    let backdropMostrado = mediaItem.backdrop;
    const userIdOpcional = getUserIdOpcional(req);
    if (userIdOpcional) {
      const miUserMedia = await prisma.userMedia.findUnique({
        where: { userId_mediaId: { userId: userIdOpcional, mediaId: idParam } }
      });
      if (miUserMedia?.customPoster) portadaMostrada = miUserMedia.customPoster;
      if (miUserMedia?.customBackdrop) backdropMostrado = miUserMedia.customBackdrop;
    }

    res.json({ ...mediaItem, titulo: tituloMostrado, sinopsis: sinopsisMostrada, portada: portadaMostrada, backdrop: backdropMostrado, remakeOf });
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
      customBackdrop: null,
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
// --- BORRAR MI CUENTA Y TODOS MIS DATOS (irreversible) ---
// Requiere confirmar escribiendo tu propio username exacto en el body — una
// protección extra aparte del modal del frontend, para que esta ruta nunca
// se pueda disparar por accidente (ni siquiera con el token robado sin más).
//
// Orden de borrado: todo lo que "cuelga" de tu userId sin onDelete: Cascade
// en el schema (GameLog, WatchLog, UserMedia, Favorite, ListItem/List) hay
// que borrarlo A MANO antes que la fila User — si no, Prisma no te deja
// borrar el User por la relación pendiente. Follow SÍ tiene onDelete:
// Cascade configurado en el schema, así que ese se limpia solo al borrar
// User, no hace falta tocarlo aquí.
app.delete('/auth/me', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (username !== user.username) {
      return res.status(400).json({ error: 'El nombre de usuario no coincide' });
    }

    await prisma.$transaction([
      prisma.gameLog.deleteMany({ where: { userId: req.userId } }),
      prisma.watchLog.deleteMany({ where: { userId: req.userId } }),
      prisma.userMedia.deleteMany({ where: { userId: req.userId } }),
      prisma.favorite.deleteMany({ where: { userId: req.userId } }),
      prisma.listItem.deleteMany({ where: { list: { userId: req.userId } } }),
      prisma.list.deleteMany({ where: { userId: req.userId } }),
      prisma.user.delete({ where: { id: req.userId } }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE /auth/me:', error);
    res.status(500).json({ error: 'Error al eliminar la cuenta' });
  }
});

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
// --- RESETEAR TODAS MIS CARÁTULAS/BANNERS PERSONALIZADOS (customPoster y
// customBackdrop de TODA tu UserMedia, de golpe) ---
// Solo toca tus propias filas (where: { userId: req.userId }): nunca afecta
// a lo que otros usuarios hayan personalizado, ni a la portada/backdrop
// COMPARTIDOS de Media (esos se quedan igual — esto solo quita TU capa de
// personalización, volviendo a la carátula por defecto para ti).
app.post('/auth/me/reset-custom-posters', requireAuth, async (req, res) => {
  try {
    const resultado = await prisma.userMedia.updateMany({
      where: {
        userId: req.userId,
        OR: [{ customPoster: { not: null } }, { customBackdrop: { not: null } }],
      },
      data: { customPoster: null, customBackdrop: null },
    });
    res.json({ ok: true, actualizados: resultado.count });
  } catch (error) {
    console.error('ERROR EN POST /auth/me/reset-custom-posters:', error);
    res.status(500).json({ error: 'Error al resetear las carátulas personalizadas' });
  }
});

// --- PONER MIS CARÁTULAS/BANNERS DE PELÍCULAS Y SERIES EN INGLÉS ---
// Disponible para cualquier usuario (no solo admin), porque a diferencia de
// /admin/media/refresh-covers-english NO toca Media.portada/backdrop
// (el valor compartido de todos) — guarda el resultado como TU propia
// personalización en UserMedia.customPoster/customBackdrop, exactamente
// igual que si hubieras elegido esa carátula a mano con "Cambiar carátula /
// banner". Así cada usuario puede arreglar su propia vista sin afectar a
// los demás ni necesitar permisos especiales.
// --- PONER EN INGLÉS SOLO LAS CARÁTULAS/BANNERS DE PELÍCULAS Y SERIES QUE
// YA TENÍAS PERSONALIZADAS ---
// Disponible para cualquier usuario (no solo admin), porque a diferencia de
// /admin/media/refresh-covers-english NO toca Media.portada/backdrop
// (el valor compartido de todos) — solo actualiza TU personalización que ya
// existía en UserMedia.customPoster/customBackdrop. No crea personalización
// nueva en títulos que nunca hayas tocado: esos siguen usando el valor
// compartido por defecto (que se arregla con el botón de admin o el script,
// no con este).
app.post('/auth/me/set-covers-english', requireAuth, async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;

    // Solo tus filas de UserMedia que YA tienen alguna personalización.
    const personalizadas = await prisma.userMedia.findMany({
      where: {
        userId: req.userId,
        OR: [{ customPoster: { not: null } }, { customBackdrop: { not: null } }],
      },
      select: { mediaId: true, customPoster: true, customBackdrop: true },
    });

    if (personalizadas.length === 0) {
      return res.json({ ok: true, total: 0, actualizados: 0, sinCambios: 0, fallidos: 0 });
    }

    // De esas, solo las que son película/serie con tmdbId — a un juego con
    // carátula personalizada de SteamGridDB no le toca este arreglo, no es
    // un problema de idioma de TMDB.
    const items = await prisma.media.findMany({
      where: {
        id: { in: personalizadas.map((p) => p.mediaId) },
        tipo: { in: ['PELICULA', 'SERIE'] },
        tmdbId: { not: null },
      },
      select: { id: true, tmdbId: true, tipo: true },
    });

    let actualizados = 0;
    let sinCambios = 0;
    let fallidos = 0;

    // Secuencial, no en paralelo — mismo motivo que en el endpoint de admin:
    // evitar disparar cientos de peticiones a TMDB de golpe.
    for (const item of items) {
      try {
        const personalizacion = personalizadas.find((p) => p.mediaId === item.id);
        const endpointTmdb = item.tipo === 'SERIE' ? 'tv' : 'movie';
        const resp = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${item.tmdbId}?api_key=${apiKey}&language=en-US`);
        const data = await resp.json();
        if (!data || data.status_code) { fallidos++; continue; }

        // Solo se actualiza el campo que YA tenías personalizado — si solo
        // habías cambiado la carátula pero no el banner, esto no le añade un
        // banner personalizado nuevo que nunca elegiste.
        const nuevoCustomPoster = personalizacion.customPoster && data.poster_path
          ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
          : null;
        const nuevoCustomBackdrop = personalizacion.customBackdrop && data.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
          : null;

        if (!nuevoCustomPoster && !nuevoCustomBackdrop) { sinCambios++; continue; }

        await prisma.userMedia.update({
          where: { userId_mediaId: { userId: req.userId, mediaId: item.id } },
          data: {
            ...(nuevoCustomPoster ? { customPoster: nuevoCustomPoster } : {}),
            ...(nuevoCustomBackdrop ? { customBackdrop: nuevoCustomBackdrop } : {}),
          },
        });
        actualizados++;
      } catch (e) {
        fallidos++;
      }
    }

    res.json({ ok: true, total: items.length, actualizados, sinCambios, fallidos });
  } catch (error) {
    console.error('ERROR EN POST /auth/me/set-covers-english:', error);
    res.status(500).json({ error: 'Error al poner las carátulas en inglés' });
  }
});

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

// --- BUSCAR USUARIOS POR NOMBRE (para la sección de Friends) ---
// requireAuth: necesitamos saber quién pregunta para poder marcar, por cada
// resultado, si TÚ ya le sigues (isFollowing) — sin sesión no tendría
// sentido ese dato.
app.get('/users/search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (q.length < 2) return res.json([]);

    const usuarios = await prisma.user.findMany({
      where: {
        username: { contains: q, mode: 'insensitive' },
        id: { not: req.userId }, // no te muestres a ti mismo en tu propia búsqueda
      },
      select: { id: true, username: true, avatar: true },
      take: 20,
      orderBy: { username: 'asc' },
    });

    const siguiendo = await prisma.follow.findMany({
      where: { followerId: req.userId, followingId: { in: usuarios.map((u) => u.id) } },
      select: { followingId: true },
    });
    const idsSeguidos = new Set(siguiendo.map((f) => f.followingId));

    res.json(usuarios.map((u) => ({ ...u, isFollowing: idsSeguidos.has(u.id) })));
  } catch (error) {
    console.error('ERROR EN GET /users/search:', error);
    res.status(500).json({ error: 'Error al buscar usuarios' });
  }
});

// --- SEGUIR A UN USUARIO (directo, sin petición/aceptación) ---
app.post('/users/:id/follow', requireAuth, async (req, res) => {
  try {
    const followingId = parseInt(req.params.id);
    if (followingId === req.userId) {
      return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });
    }

    const destino = await prisma.user.findUnique({ where: { id: followingId } });
    if (!destino) return res.status(404).json({ error: 'Usuario no encontrado' });

    await prisma.follow.create({
      data: { followerId: req.userId, followingId },
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    if (error.code === 'P2002') {
      // Ya le seguías — no es un error real, simplemente confirmamos el estado.
      return res.json({ ok: true });
    }
    console.error('ERROR EN POST /users/:id/follow:', error);
    res.status(500).json({ error: 'Error al seguir al usuario' });
  }
});

// --- DEJAR DE SEGUIR A UN USUARIO ---
app.delete('/users/:id/follow', requireAuth, async (req, res) => {
  try {
    const followingId = parseInt(req.params.id);
    await prisma.follow.deleteMany({
      where: { followerId: req.userId, followingId },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE /users/:id/follow:', error);
    res.status(500).json({ error: 'Error al dejar de seguir al usuario' });
  }
});

// --- USUARIOS A LOS QUE SIGO (para la lista "Following" en /perfil/friends) ---
app.get('/users/me/following', requireAuth, async (req, res) => {
  try {
    const siguiendo = await prisma.follow.findMany({
      where: { followerId: req.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        following: { select: { id: true, username: true, avatar: true } },
      },
    });
    res.json(siguiendo.map((f) => ({ ...f.following, isFollowing: true })));
  } catch (error) {
    console.error('ERROR EN GET /users/me/following:', error);
    res.status(500).json({ error: 'Error al obtener a quién sigues' });
  }
});

// --- PERFIL PÚBLICO DE UN USUARIO (por username) ---
// Público (no requireAuth): cualquiera puede ver un perfil. Si hay sesión
// (getUserIdOpcional), añadimos isFollowing/isSelf; si no, esos campos
// llegan como null/false y el frontend simplemente no muestra el botón de
// seguir (o manda a /login si intentas usarlo).
// mode: 'insensitive' — un enlace de perfil compartido (Share profile) debe
// funcionar da igual cómo se escriba la mayúscula/minúscula.
app.get('/users/:username', async (req, res) => {
  try {
    const username = req.params.username;
    const usuario = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true, username: true, avatar: true, createdAt: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const miUserId = getUserIdOpcional(req);

    const [followersCount, followingCount, favs, vistas, jugandoAhoraEntries, yaLeSigo] = await Promise.all([
      prisma.follow.count({ where: { followingId: usuario.id } }),
      prisma.follow.count({ where: { followerId: usuario.id } }),
      prisma.favorite.findMany({ where: { userId: usuario.id }, orderBy: { orden: 'asc' } }),
      prisma.userMedia.findMany({
        where: { userId: usuario.id, watched: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      // "Currently Playing": juegos donde el propio dueño del perfil ha
      // puesto el desplegable "Set your played status" en Playing.
      prisma.userMedia.findMany({
        where: { userId: usuario.id, playStatus: 'PLAYING' },
        orderBy: { updatedAt: 'desc' },
      }),
      miUserId
        ? prisma.follow.findUnique({
            where: { followerId_followingId: { followerId: miUserId, followingId: usuario.id } },
          })
        : null,
    ]);

    const mediaIdsFavoritos = favs.map((f) => f.mediaId);
    const mediaIdsVistas = vistas.map((v) => v.mediaId);
    const mediaIdsJugandoAhora = jugandoAhoraEntries.map((j) => j.mediaId);
    const todosLosMediaIds = [...new Set([...mediaIdsFavoritos, ...mediaIdsVistas, ...mediaIdsJugandoAhora])];
    const mediaItems = await prisma.media.findMany({ where: { id: { in: todosLosMediaIds } } });

    // Favorite no guarda carátula personalizada (eso vive en UserMedia), así
    // que sin esto Favorites siempre mostraba la carátula compartida por
    // defecto aunque el dueño del perfil hubiera elegido otra — a diferencia
    // de Recent activity, que sí la aplica porque viene directamente de
    // UserMedia. Solo hace falta pedir la de los favoritos (los de
    // "actividad" ya vienen con la suya propia en el objeto "vistas").
    const personalizacionesFavoritos = mediaIdsFavoritos.length > 0
      ? await prisma.userMedia.findMany({
          where: { userId: usuario.id, mediaId: { in: mediaIdsFavoritos } },
          select: { mediaId: true, customPoster: true, customBackdrop: true },
        })
      : [];
    const personalizacionPorMediaId = new Map(personalizacionesFavoritos.map((p) => [p.mediaId, p]));

    const favoritos = favs
      .map((f) => {
        const item = mediaItems.find((m) => m.id === f.mediaId);
        if (!item) return null;
        const mia = personalizacionPorMediaId.get(f.mediaId);
        return {
          ...item,
          portada: mia?.customPoster || item.portada,
          backdrop: mia?.customBackdrop || item.backdrop,
        };
      })
      .filter(Boolean);

    const actividad = vistas
      .map((v) => {
        const item = mediaItems.find((m) => m.id === v.mediaId);
        if (!item) return null;
        return {
          ...item,
          portada: v.customPoster || item.portada,
          fechaVisto: v.updatedAt,
          rating: v.rating,
          liked: v.liked,
        };
      })
      .filter(Boolean);

    const jugandoAhora = jugandoAhoraEntries
      .map((j) => {
        const item = mediaItems.find((m) => m.id === j.mediaId);
        if (!item) return null;
        return {
          ...item,
          portada: j.customPoster || item.portada,
        };
      })
      .filter(Boolean);

    res.json({
      id: usuario.id,
      username: usuario.username,
      avatar: usuario.avatar,
      miembroDesde: usuario.createdAt,
      followersCount,
      followingCount,
      isSelf: miUserId === usuario.id,
      isFollowing: miUserId ? !!yaLeSigo : null,
      favoritos,
      actividad,
      jugandoAhora,
    });
  } catch (error) {
    console.error('ERROR EN GET /users/:username:', error);
    res.status(500).json({ error: 'Error al obtener el perfil' });
  }
});

// --- PELÍCULAS/SERIES/JUEGOS VISTOS DE UN USUARIO (público, sin requireAuth) ---
// Igual que GET /media/watched, pero busca al usuario por :username de la URL
// en vez de por el token de quien pregunta, y admite filtrar por ?tipo=
// (PELICULA, SERIE, VIDEOJUEGO...) para las pestañas del perfil público
// (Films, Series, Played...).
app.get('/users/:username/watched', async (req, res) => {
  try {
    const username = req.params.username;
    const tipo = req.query.tipo; // opcional

    const usuario = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const entries = await prisma.userMedia.findMany({
      where: { userId: usuario.id, watched: true },
      orderBy: { updatedAt: 'desc' },
    });

    const mediaIds = entries.map((e) => e.mediaId);
    const mediaItems = await prisma.media.findMany({
      where: {
        id: { in: mediaIds },
        ...(tipo ? { tipo } : {}),
      },
    });

    const resultado = entries
      .map((e) => {
        const item = mediaItems.find((m) => m.id === e.mediaId);
        if (!item) return null;
        return {
          ...item,
          portada: e.customPoster || item.portada,
          backdrop: e.customBackdrop || item.backdrop,
          fechaVisto: e.updatedAt,
          rating: e.rating,
          liked: e.liked,
        };
      })
      .filter(Boolean);

    res.json(resultado);
  } catch (error) {
    console.error('ERROR EN GET /users/:username/watched:', error);
    res.status(500).json({ error: 'Error al obtener las vistas del usuario' });
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

    // Favorite no toca UserMedia para nada, así que aquí sí hace falta una
    // consulta aparte para saber si tienes portada/banner personalizados.
    const misPersonalizaciones = await prisma.userMedia.findMany({
      where: { userId: req.userId, mediaId: { in: mediaIds } },
      select: { mediaId: true, customPoster: true, customBackdrop: true }
    });
    const mapaPersonalizaciones = new Map(misPersonalizaciones.map(p => [p.mediaId, p]));
    const resultado = favs
      .map(f => {
        const item = mediaItems.find(m => m.id === f.mediaId);
        if (!item) return null;
        const mia = mapaPersonalizaciones.get(item.id);
        return {
          ...item,
          portada: mia?.customPoster || item.portada,
          backdrop: mia?.customBackdrop || item.backdrop
        };
      })
      .filter(Boolean);
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
    let externaPeso = 0; // número real de votos que respaldan esa media externa
    const media = await prisma.media.findUnique({ where: { id: mediaId }, select: { tmdbId: true, igdbId: true } });

    if (media?.tmdbId) {
      try {
        const apiKey = process.env.TMDB_API_KEY;
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${media.tmdbId}?api_key=${apiKey}`);
        const tmdbData = await tmdbRes.json();
        if (tmdbData.vote_average) {
          externaAvg = tmdbData.vote_average;
          // vote_count es el número REAL de votos detrás de esa media en
          // TMDB — antes se trataba como "1 voto más", así que una sola
          // valoración tuya podía hundir una media respaldada por miles de
          // votos. Si por lo que sea no viene, 1 como último recurso.
          externaPeso = tmdbData.vote_count || 1;
        }
      } catch (e) { }
    } else if (media?.igdbId) {
      try {
        const token = await getIgdbToken();
        const body = `fields total_rating, total_rating_count; where id = ${media.igdbId};`;
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
        if (igdbData[0]?.total_rating) {
          externaAvg = igdbData[0].total_rating / 10;
          externaPeso = igdbData[0].total_rating_count || 1;
        }
      } catch (e) { }
    }

    if (externaAvg === null && count === 0) {
      return res.json({ average: null, count: 0 });
    }

    const sumaTotal = suma + (externaAvg !== null ? externaAvg * externaPeso : 0);
    const totalVotos = count + externaPeso;

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

// --- PROXY DE IMÁGENES (solo para recortar banners) ---
// BannerCropModal necesita "tocar" la imagen con <canvas> para poder
// recortarla y exportarla como base64, y eso el navegador solo lo permite si
// la imagen se cargó con CORS habilitado por el servidor de origen. TMDB
// suele permitirlo, pero SteamGridDB/IGDB no siempre — el resultado era que
// la imagen ni cargaba en el editor. Pidiéndola aquí, desde el backend (donde
// no aplican las restricciones de CORS del navegador), y devolviéndola ya en
// base64, el problema desaparece sin importar de qué servidor venga.
// Solo se permite proxyear los dominios de imágenes que ya usa la app, para
// no acabar montando sin querer un proxy abierto a cualquier URL.
const DOMINIOS_IMAGEN_PERMITIDOS = [
  'image.tmdb.org',
  'steamgriddb.com',
  'images.igdb.com',
];
app.get('/proxy-imagen', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta el parámetro url' });

    let urlObj;
    try {
      urlObj = new URL(url);
    } catch {
      return res.status(400).json({ error: 'URL inválida' });
    }

    const permitido = DOMINIOS_IMAGEN_PERMITIDOS.some(
      (d) => urlObj.hostname === d || urlObj.hostname.endsWith(`.${d}`)
    );
    if (!permitido) {
      return res.status(403).json({ error: 'Dominio de imagen no permitido' });
    }

    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      return res.status(respuesta.status).json({ error: 'No se pudo descargar la imagen' });
    }

    const buffer = await respuesta.arrayBuffer();
    const contentType = respuesta.headers.get('content-type') || 'image/jpeg';
    const base64 = Buffer.from(buffer).toString('base64');

    res.json({ dataUrl: `data:${contentType};base64,${base64}` });
  } catch (error) {
    console.error('ERROR EN GET /proxy-imagen:', error);
    res.status(500).json({ error: 'Error al descargar la imagen' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});