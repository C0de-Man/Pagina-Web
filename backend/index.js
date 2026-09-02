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

    const body = `fields first_release_date, platforms.name, genres.name, involved_companies.company.id, involved_companies.company.name, involved_companies.developer, involved_companies.publisher; where id = ${igdbId};`;
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

    if (!juego) return res.json({ plataformas: [], generos: [], desarrolladoras: [], distribuidoras: [], fechaLanzamiento: null });

    const companies = juego.involved_companies || [];

    // Antes solo el nombre (string). Ahora {id, nombre}: hace falta el id
    // de IGDB para poder enlazar cada developer/publisher a su propia
    // ficha (GET /igdb/company/:companyId).
    res.json({
      // IGDB da first_release_date como timestamp Unix en SEGUNDOS (no ms)
      fechaLanzamiento: juego.first_release_date ? juego.first_release_date * 1000 : null,
      plataformas: (juego.platforms || []).map(p => p.name),
      generos: (juego.genres || []).map(g => g.name),
      desarrolladoras: companies.filter(c => c.developer).map(c => ({ id: c.company?.id, nombre: c.company?.name })),
      distribuidoras: companies.filter(c => c.publisher).map(c => ({ id: c.company?.id, nombre: c.company?.name })),
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
// --- FICHA DE UNA COMPAÑÍA DE IGDB (developer/publisher): nombre/logo + juegos ---
// IGDB no deja filtrar games directamente por "involved_companies.company = X"
// en una sola consulta con fiabilidad, así que va en dos pasos: 1) qué
// involved_company (developer o publisher) tiene esta company, 2) qué juegos
// cuelgan de esas involved_companies.
app.get('/igdb/company/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const token = await getIgdbToken();
    const headers = {
      'Client-ID': process.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'text/plain',
    };

    const [respCompany, respInvolved] = await Promise.all([
      fetchIgdb('https://api.igdb.com/v4/companies', {
        method: 'POST',
        headers,
        body: `fields name, logo.image_id, country; where id = ${companyId};`,
      }),
      fetchIgdb('https://api.igdb.com/v4/involved_companies', {
        method: 'POST',
        headers,
        body: `fields game; where company = ${companyId} & (developer = true | publisher = true); limit 500;`,
      }),
    ]);

    const dataCompany = await respCompany.json();
    const company = dataCompany[0];
    if (!company) return res.status(404).json({ error: 'Compañía no encontrada' });

    const dataInvolved = await respInvolved.json();
    const gameIds = [...new Set((dataInvolved || []).map((ic) => ic.game).filter(Boolean))];

    let juegos = [];
    if (gameIds.length > 0) {
      const respJuegos = await fetchIgdb('https://api.igdb.com/v4/games', {
        method: 'POST',
        headers,
        body: `fields name, cover.url, first_release_date; where id = (${gameIds.join(',')}); sort first_release_date desc; limit 500;`,
      });
      const dataJuegos = await respJuegos.json();
      juegos = (dataJuegos || []).map((g) => ({
        igdbId: g.id,
        titulo: g.name,
        anio: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
        portada: g.cover?.url ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}` : null,
      }));
    }

    res.json({
      id: company.id,
      nombre: company.name,
      logo: company.logo?.image_id ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${company.logo.image_id}.png` : null,
      pais: company.country || null,
      juegos,
    });
  } catch (error) {
    console.error('ERROR EN GET /igdb/company/:companyId:', error);
    res.status(500).json({ error: 'Error al obtener la compañía' });
  }
});

app.get('/igdb/search', async (req, res) => {
  try {
    const searchQuery = req.query.q;
    if (!searchQuery) return res.status(400).json({ error: 'Falta término' });

    const token = await getIgdbToken();

    // Antes limitaba a 20 resultados. Para que el buscador muestre TODO lo
    // que coincida, subimos al máximo que admite IGDB en una sola petición
    // (500) — de sobra para cualquier búsqueda real, sin necesidad de paginar.
    // game_type y platforms.name se piden para poder filtrar: solo juegos
    // base (fuera DLCs/expansiones/bundles/mods/episodios/remasters/ports/
    // updates; se queda remake) y sin juguetes electrónicos standalone.
    const body = `search "${searchQuery}"; fields name,cover.url,first_release_date,summary,game_type,platforms.name,version_parent; limit 500;`;

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

    // Mismo criterio de game_type que en calcularColeccionDesdeIgdb: fuera
    // DLC (1), expansión (2), bundle (3), expansión independiente (4),
    // mod (5), episodio/temporada (6/7), remaster (9), edición ampliada
    // (10), port (11), pack (13), update (14). Se queda remake (8) y lo que
    // no tenga game_type puesto (null = se trata como juego base).
    const TIPOS_EXCLUIDOS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14];
    const PLATAFORMAS_EXCLUIDAS = ['Handheld Electronic LCD', 'Plug & Play', 'V.Smile', 'LeapTV'];

    const filtrados = (data || [])
      .filter((juego) => !TIPOS_EXCLUIDOS.includes(juego.game_type))
      .filter((juego) => !juego.version_parent) // sin ediciones/SKUs concretos de otro juego ya listado
      .filter((juego) => !(juego.platforms || []).some((p) => PLATAFORMAS_EXCLUIDAS.includes(p.name)));

    // IGDB devuelve las URLs sin "https:" y en tamaño miniatura (t_thumb) — las arreglamos aquí
    const arreglados = filtrados.map(juego => ({
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
    const arreglados = (data || []).map(arreglarCoverIgdb);
    const final = await mezclarCaratulasJuegos(arreglados, getUserIdOpcional(req));
    res.json(final);
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
    const arreglados = (data || []).map(arreglarCoverIgdb);
    const final = await mezclarCaratulasJuegos(arreglados, getUserIdOpcional(req));
    res.json({ results: final });
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
    const arreglados = (data || []).map(arreglarCoverIgdb);
    const final = await mezclarCaratulasJuegos(arreglados, getUserIdOpcional(req));
    res.json(final);
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

    // Antes este endpoint devolvía la carátula tal cual la diera IGDB en ese
    // momento, sin comprobar si el juego ya está guardado con otra carátula
    // (la elegida a mano, o simplemente la que se guardó al añadirlo por
    // primera vez) — a diferencia de /igdb/popular, /igdb/year y sus versiones
    // paginadas, que sí hacen este cruce. Resultado: el grid de "Games" podía
    // mostrar una carátula distinta a la que se ve en cualquier otro sitio de
    // la app para el mismo juego.
    const arreglados = (data || []).map(arreglarCoverIgdb);
    const final = await mezclarCaratulasJuegos(arreglados, getUserIdOpcional(req));
    res.json({ page, totalPaginas, results: final });
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

// --- PALABRAS CLAVE MANUALES PARA FRANQUICIAS DEMASIADO AMPLIAS ---
// Cuando un juego NO tiene una Collection propia en IGDB y solo cuelga de
// una Franchise muy genérica (p. ej. "Batman", que mezcla Arkham, LEGO
// Batman, Brave and the Bold...), filtrar solo por el nombre de la
// franquicia entera arrastra títulos sin relación real con la saga que
// se está viendo. Aquí se fuerza a mano un nombre de saga más concreto y
// la palabra clave con la que filtrar — clave: id de la FRANCHISE de IGDB
// (temporalmente se imprime por consola para poder sacarlo, ver log de
// diagnóstico más abajo).
const PALABRA_CLAVE_FRANQUICIA_MANUAL = {
  // Se rellena en el paso 2, con el id real de la franquicia "Batman".
};

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

  // Si no hay Collection propia, miramos si la Franchise tiene una
  // palabra clave manual configurada arriba — así una franquicia genérica
  // no arrastra TODO lo que lleve ese nombre, solo la sub-saga concreta
  // definida a mano.
  const overrideFranquicia = collections.length === 0 ? PALABRA_CLAVE_FRANQUICIA_MANUAL[franchises[0]?.id] : null;

  // Si el juego pertenece a VARIAS collections de IGDB a la vez, no todas
  // representan una saga real: algunas son agrupaciones amplias tipo
  // "Marvel" (todo lo que comparte editorial/universo, sin relación de
  // precuela/secuela real) que mezclarían títulos sin relación entre sí.
  // Como saga ESTRICTA elegimos siempre la collection más PEQUEÑA (menos
  // juegos) de las que tenga este juego — cuanto más concreta es una
  // collection, menos juegos agrupa; las amplias tipo "Marvel" tienen decenas.
  let collectionElegida = collections[0] || null;
  if (collections.length > 1) {
    const conteos = await Promise.all(
      collections.map((c) =>
        fetchIgdb('https://api.igdb.com/v4/games/count', {
          method: 'POST',
          headers,
          body: `where collections = (${c.id});`,
        }).then((r) => r.json()).catch(() => ({ count: Infinity }))
      )
    );
    let mejorIdx = 0;
    for (let i = 1; i < collections.length; i++) {
      if ((conteos[i]?.count ?? Infinity) < (conteos[mejorIdx]?.count ?? Infinity)) mejorIdx = i;
    }
    collectionElegida = collections[mejorIdx];
  }

  const nombre = collectionElegida?.name || overrideFranquicia?.nombre || franchises[0]?.name || null;
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
    'platforms.name',
    'version_parent.name', 'version_parent.slug', 'version_parent.cover.url',
    'version_parent.first_release_date', 'version_parent.id',
  ].join(', ');

  // Si el juego ya pertenece a una Collection específica de IGDB (p.ej.
  // "Batman: Arkham"), esa Collection YA es una saga cerrada y correcta —
  // no hace falta ni conviene mezclarla con la Franchise amplia (p.ej.
  // "Batman"), que arrastra títulos sin relación real con esta saga
  // concreta (spin-offs, juegos para niños, remakes de otra saga...).
  // Franchise solo se usa como red de seguridad cuando el juego NO tiene
  // ninguna Collection propia — así sagas curadas por IGDB (Collection) se
  // mantienen separadas de franquicias genéricas por marca (Franchise).
  const collectionIds = collectionElegida ? [collectionElegida.id] : [];
  const franchiseIds = collectionIds.length === 0 ? franchises.map((f) => f.id) : [];

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

  const nombreSaga = (overrideFranquicia?.palabraClave || nombre).toLowerCase();
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

// --- EXCLUSIONES MANUALES DE LA PESTAÑA "FRANCHISE" ---
// IGDB no tiene ningún campo que distinga "juego real de esta IP" de "mod/
// personaje jugable/curiosidad que solo la menciona" (p. ej. un moveset de
// Smash Bros, un personaje dentro de otro juego tipo Marvel Heroes). Como no
// hay forma automática de detectar esto, se añade a mano el igdbId de lo
// que se vaya viendo que no pinta nada en la franquicia.
const EXCLUSIONES_FRANQUICIA_MANUAL = new Set([
  123456, // Marvel: Ultimate Alliance
  789012, // Marvel: Ultimate Alliance 2
  345678, // LEGO Marvel Super Heroes
]);

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

    const queryBase = `fields name, first_release_date, platforms.id, platforms.name; where id = ${igdbId};`;
    const queryVersiones = `fields name, game_type, first_release_date, platforms.id, platforms.name; where parent_game = ${igdbId}; limit 50;`;
    // IGDB representa las ediciones concretas de un mismo juego (Collector's
    // Edition, GOTY Edition, Deluxe Edition...) como entradas SEPARADAS que
    // apuntan de vuelta al juego "canónico" mediante version_parent — no
    // mediante parent_game (ese campo es para DLCs/remasters/ports/bundles,
    // ver arriba). Sin esta consulta aparte, esas ediciones nunca aparecían
    // en el desplegable "Version played".
    const queryEdicionesPorVersionParent = `fields name, game_type, platforms.id, platforms.name; where version_parent = ${igdbId}; limit 50;`;

    const [resBase, resVersiones, resEdicionesVersionParent] = await Promise.all([
      fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryBase }),
      fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryVersiones }),
      fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryEdicionesPorVersionParent }),
    ]);
    const dataBase = await resBase.json();
    const dataVersiones = await resVersiones.json();
    const dataEdicionesVersionParent = await resEdicionesVersionParent.json();

    const base = dataBase[0];
    // 3 bundle (GOTY/Complete Edition...), 9 remaster, 10 expanded_game,
    // 11 port. Todos comparten el mismo espíritu: son la MISMA obra jugable
    // en distinta presentación/plataforma, no contenido nuevo — por eso
    // tienen sentido como "versión jugada" del mismo log, junto al original.
    const TIPOS_VERSION = [3, 9, 10, 11];
    let versiones = (dataVersiones || []).filter((g) => TIPOS_VERSION.includes(g.game_type));

    // Las ediciones encontradas por version_parent se admiten TODAS, sin
    // filtrar por game_type — a diferencia de parent_game, aquí el propio
    // hecho de que apunten a este juego como su version_parent ya confirma
    // que son una edición/SKU concreta del mismo juego (Collector's Edition,
    // GOTY Edition, Deluxe Edition, Definitive Edition...), sea cual sea su
    // game_type (o aunque no lo tengan puesto).
    const idsYaVistos = new Set(versiones.map((v) => v.id));
    for (const ed of dataEdicionesVersionParent || []) {
      if (!idsYaVistos.has(ed.id)) {
        versiones.push(ed);
        idsYaVistos.add(ed.id);
      }
    }

    // Respaldo por texto: algunas ediciones/bundles tienen su parent_game en
    // IGDB apuntando a otra cosa (un DLC, un map pack...) en vez de al juego
    // base — mismo problema ya visto con updates/ports/remasters huérfanos.
    // Buscamos por el nombre del juego base y nos quedamos con lo que
    // empiece igual (mismo criterio de prefijo que getIgdbVersiones), para
    // no colar secuelas con nombre parecido.
    if (base?.name) {
      // Se pide también version_parent.id y first_release_date: los
      // remakes que comparten el MISMO nombre exacto que el juego original
      // (p. ej. "Resident Evil 4" 2005 y 2023) hacían que este respaldo por
      // texto colara las ediciones antiguas del original (Wii Edition,
      // Zeebo Edition, Mobile Edition...) en la lista del remake, porque
      // solo comprobaba que el NOMBRE empezara igual — nunca que la
      // edición perteneciera de verdad a ESTE juego. Se comprueban dos
      // cosas, en este orden:
      //   1) Si tiene version_parent puesto, que apunte EXACTAMENTE a este
      //      igdbId (el criterio más fiable, cuando está disponible).
      //   2) Si no tiene version_parent (bastantes ediciones antiguas no lo
      //      llevan puesto en absoluto), se compara el AÑO de lanzamiento:
      //      una edición de hace 10-15 años casi seguro es del juego
      //      original, no de un remake reciente con el mismo nombre — se
      //      descarta si la diferencia de años es mayor de 5.
      const queryTexto = `search "${base.name}"; fields name, game_type, first_release_date, platforms.id, platforms.name, version_parent.id; limit 30;`;
      const respTexto = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryTexto });
      if (respTexto.ok) {
        const dataTexto = await respTexto.json();
        const nombreBaseNormalizado = base.name.toLowerCase();
        const idsYaVistos = new Set([igdbId, ...versiones.map((v) => v.id)]);
        const anioBase = base.first_release_date ? new Date(base.first_release_date * 1000).getFullYear() : null;
        const candidatosTexto = (dataTexto || []).filter((g) => {
          if (!g.name || idsYaVistos.has(g.id) || !TIPOS_VERSION.includes(g.game_type)) return false;

          if (g.version_parent) {
            return g.version_parent.id === igdbId;
          }

          if (anioBase !== null && g.first_release_date) {
            const anioCandidato = new Date(g.first_release_date * 1000).getFullYear();
            if (Math.abs(anioCandidato - anioBase) > 5) return false;
          }

          const nombreNormalizado = g.name.toLowerCase();
          if (!nombreNormalizado.startsWith(nombreBaseNormalizado)) return false;
          const resto = nombreNormalizado.slice(nombreBaseNormalizado.length);
          if (resto !== '' && /^[a-z0-9]/.test(resto)) return false; // pegado sin separador
          if (/^\s*\d/.test(resto)) return false; // "... 2", "... 3"... (secuela)
          return true;
        });
        versiones = [...versiones, ...candidatosTexto];
      }
    }

    // Antes se metían TODAS las plataformas seguidas en el texto de cada
    // opción — con ediciones tipo "Franchise Pack" (6+ plataformas), el
    // texto se volvía kilométrico y se cortaba contra el borde de la
    // ventana en el <select> nativo (que no se puede ensanchar de forma
    // fiable con CSS, su desplegable lo dibuja el propio navegador/SO).
    // Ahora se muestran como mucho 2 plataformas y, si hay más, "+N more".
    const conPlataformas = (nombre, g) => {
      const nombresPlataformas = (g.platforms || []).map((p) => p.name);
      const anio = g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null;
      const nombreConAnio = anio ? `${nombre} (${anio})` : nombre;
      if (nombresPlataformas.length === 0) return nombreConAnio;
      const primeras = nombresPlataformas.slice(0, 2).join(', ');
      const resto = nombresPlataformas.length - 2;
      const sufijoPlataformas = resto > 0 ? `${primeras} +${resto} more` : primeras;
      return `${nombreConAnio} — ${sufijoPlataformas}`;
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

// --- TODOS LOS JUEGOS DE LA MISMA FRANQUICIA/IP (sin relación narrativa) ---
// A diferencia de calcularColeccionDesdeIgdb (que da la saga estricta,
// filtrada por nombre para no arrastrar spin-offs sin relación real), esto
// da TODO lo que IGDB etiquete bajo la misma Franchise — pensado como
// pestaña aparte de solo lectura ("todo lo de Spider-Man", incluyendo
// juegos que no forman parte de ninguna precuela/secuela).
async function obtenerFranquiciaAmplia(igdbId) {
  const token = await getIgdbToken();
  const headers = {
    'Client-ID': process.env.IGDB_CLIENT_ID,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'text/plain',
  };

  const queryBase = `fields franchises.id, franchises.name; where id = ${igdbId};`;
  const respBase = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryBase });
  if (!respBase.ok) throw new Error(`IGDB respondió ${respBase.status}`);
  const dataBase = await respBase.json();
  const franchise = dataBase[0]?.franchises?.[0];
  if (!franchise) return null;

  const body = `fields name, cover.url, first_release_date, status, game_type, platforms.name, version_parent; where franchises = (${franchise.id}); sort first_release_date asc; limit 500;`;
  const resp = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body });
  if (!resp.ok) throw new Error(`IGDB respondió ${resp.status}`);
  const data = await resp.json();

  const TIPOS_EXCLUIDOS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14];
  const PLATAFORMAS_EXCLUIDAS = ['Handheld Electronic LCD', 'Plug & Play', 'V.Smile', 'LeapTV'];
  const juegos = (data || [])
    .filter((g) => g.status !== 6)
    .filter((g) => !TIPOS_EXCLUIDOS.includes(g.game_type))
    .filter((g) => !g.version_parent)
    .filter((g) => !(g.platforms || []).some((p) => PLATAFORMAS_EXCLUIDAS.includes(p.name)))
    .map((g) => ({
      igdbId: g.id,
      titulo: g.name,
      anio: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
      portada: g.cover?.url ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}` : null,
    }));

  return { nombre: franchise.name, juegos };
}

// --- OTRAS COLECCIONES OFICIALES A LAS QUE PERTENECE ESTE JUEGO (aparte de
// la saga curada principal) ---
// Un juego puede estar en más de una Collection de IGDB a la vez (su propia
// saga + una colección "crossover"/"team-up" más amplia, p. ej.). Esto
// devuelve cada una de esas Collections EXTRA como grupo de solo lectura,
// sin tocar ni guardar nada en CuratedCollection — igual que la franquicia,
// se recalcula en cada visita.
async function obtenerOtrasColecciones(igdbId, nombrePrincipal) {
  const token = await getIgdbToken();
  const headers = {
    'Client-ID': process.env.IGDB_CLIENT_ID,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'text/plain',
  };

  const queryBase = `fields collections.id, collections.name; where id = ${igdbId};`;
  const respBase = await fetchIgdb('https://api.igdb.com/v4/games', { method: 'POST', headers, body: queryBase });
  if (!respBase.ok) throw new Error(`IGDB respondió ${respBase.status}`);
  const dataBase = await respBase.json();
  const collections = dataBase[0]?.collections || [];

  const nombrePrincipalNormalizado = (nombrePrincipal || '').toLowerCase();
  const otras = collections.filter((c) => c.name.toLowerCase() !== nombrePrincipalNormalizado);
  if (otras.length === 0) return [];

  const TIPOS_EXCLUIDOS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14];
  const PLATAFORMAS_EXCLUIDAS = ['Handheld Electronic LCD', 'Plug & Play', 'V.Smile', 'LeapTV'];
  const camposJuego = 'name, cover.url, first_release_date, status, game_type, platforms.name, version_parent';

  const resultados = [];
  for (const col of otras) {
    const resp = await fetchIgdb('https://api.igdb.com/v4/games', {
      method: 'POST', headers,
      body: `fields ${camposJuego}; where collections = (${col.id}); sort first_release_date asc; limit 500;`,
    });
    if (!resp.ok) continue;
    const data = await resp.json();
    const juegos = (data || [])
      .filter((g) => g.status !== 6)
      .filter((g) => !TIPOS_EXCLUIDOS.includes(g.game_type))
      .filter((g) => !g.version_parent)
      .filter((g) => !(g.platforms || []).some((p) => PLATAFORMAS_EXCLUIDAS.includes(p.name)))
      .map((g) => ({
        igdbId: g.id,
        titulo: g.name,
        anio: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
        portada: g.cover?.url ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}` : null,
      }));
    if (juegos.length > 1) resultados.push({ nombre: col.name, juegos });
  }
  return resultados;
}

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
  const PLATAFORMAS_EXCLUIDAS_SAGA = ['Handheld Electronic LCD', 'Plug & Play', 'V.Smile', 'LeapTV'];
  let gamesFiltrados = collection.games
    .filter((g) => g.status === 6 || !TIPOS_EXCLUIDOS.includes(g.game_type))
    .filter((g) => !(g.platforms || []).some((p) => PLATAFORMAS_EXCLUIDAS_SAGA.includes(p.name)));

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
      const respuesta = await construirRespuestaDesdeCurated(itemExistente.collectionId, igdbId);

      let franquicia = null;
      let otrasColecciones = [];
      try {
        franquicia = await obtenerFranquiciaAmplia(igdbId);
        otrasColecciones = await obtenerOtrasColecciones(igdbId, respuesta.collection?.nombre);
      } catch (e) {
        console.error('Error obteniendo agrupaciones adicionales:', e.message);
      }

      return res.json({ ...respuesta, franquicia, otrasColecciones });
    }

    let franquicia = null;
    try {
      franquicia = await obtenerFranquiciaAmplia(igdbId);
    } catch (e) {
      console.error('Error obteniendo franquicia amplia:', e.message);
    }

    const calculada = await calcularColeccionDesdeIgdb(igdbId);
    if (!calculada) {
      return res.json({ collection: null, games: [], cancelados: [], otros: [], prequel: null, sequel: null, franquicia, otrasColecciones: [] });
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

    const respuesta = await construirRespuestaDesdeCurated(nuevaCollection.id, igdbId);
    let otrasColecciones = [];
    try {
      otrasColecciones = await obtenerOtrasColecciones(igdbId, respuesta.collection?.nombre);
    } catch (e) {
      console.error('Error obteniendo otras colecciones:', e.message);
    }
    return res.json({ ...respuesta, franquicia, otrasColecciones });

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

  const normalizar = (s) =>
    (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim()
      .split(' ').map(canonicalizarNumero).join(' ');
  const nombreNormalizado = normalizar(nombre);
  const palabrasNombre = nombreNormalizado.split(' ').filter(Boolean);

  const todos = data?.data || [];

  // Candidatos con nombre EXACTO (caso normal, sin ambigüedad).
  const exactos = todos.filter((c) => normalizar(c.name) === nombreNormalizado);

  // Candidatos con SUFIJO (ediciones/subtítulos distintos, como "The
  // Incredible Hulk: The Official Videogame" para "The Incredible Hulk") —
  // mismo criterio de prefijo que ya usa buscarJuegoEnSteamGridDBFlexible.
  // Antes solo se probaban como último recurso si la búsqueda exacta no
  // encontraba NADA; ahora se incluyen desde el principio para poder
  // compararlos por año junto con los exactos, y así no perder frente a un
  // "exacto" que en realidad es un juego distinto con el mismo nombre.
  const conSufijo = todos.filter((c) => {
    const palabrasCandidato = normalizar(c.name).split(' ').filter(Boolean);
    if (palabrasCandidato.length <= palabrasNombre.length) return false; // ya está en "exactos" o es más corto
    const n = Math.min(4, palabrasNombre.length, palabrasCandidato.length);
    if (n < 2) return false;
    for (let i = 0; i < n; i++) {
      if (palabrasNombre[i] !== palabrasCandidato[i]) return false;
    }
    return true;
  });

  const idsExactos = new Set(exactos.map((c) => c.id));
  const candidatos = [...exactos, ...conSufijo.filter((c) => !idsExactos.has(c.id))].slice(0, 10);

  if (candidatos.length === 0) return null;
  if (candidatos.length === 1 || !anio) return candidatos[0].id;

  // Con varios candidatos (mismo nombre exacto, o exacto + con sufijo),
  // comprobamos el año real de cada uno en SteamGridDB y nos quedamos
  // SIEMPRE con el más cercano al año que ya tenemos guardado — sea cual
  // sea la diferencia, en vez de exigir un margen fijo y rendirnos si
  // ninguno lo cumple (eso hacía caer al primero de la lista sin mirar el
  // año en absoluto).
  const detalles = await Promise.all(
    candidatos.map((c) =>
      fetch(`https://www.steamgriddb.com/api/v2/games/id/${c.id}`, {
        headers: { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` }
      }).then((r) => r.json()).catch(() => null)
    )
  );

  const conAnio = candidatos
    .map((c, i) => {
      const anioSgdb = detalles[i]?.data?.release_date
        ? new Date(detalles[i].data.release_date * 1000).getFullYear()
        : null;
      return { id: c.id, anioSgdb };
    })
    .filter((c) => c.anioSgdb !== null);

  if (conAnio.length === 0) return candidatos[0].id;

  const masCercano = conAnio.reduce((mejor, actual) =>
    Math.abs(actual.anioSgdb - anio) < Math.abs(mejor.anioSgdb - anio) ? actual : mejor
  );

  return masCercano.id;
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
async function obtenerTodasLasGridsSteamGridDB(sgdbId, headers, ocultarNsfw) {
  let todas = [];
  const nsfwParam = ocultarNsfw ? 'false' : 'any';
  for (let pagina = 0; pagina < SGDB_MAX_PAGINAS_SEGURIDAD; pagina++) {
    const resp = await fetch(
      `https://www.steamgriddb.com/api/v2/grids/game/${sgdbId}?types=static,animated&nsfw=${nsfwParam}&humor=any&epilepsy=any&page=${pagina}`,
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

    // El frontend manda ?ocultarNsfw=true/false según la preferencia
    // guardada del usuario (activada por defecto). Cualquier valor que no
    // sea explícitamente "false" se trata como "sí, ocultar".
    const ocultarNsfw = req.query.ocultarNsfw !== 'false';

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
      covers = await obtenerTodasLasGridsSteamGridDB(sgdbId, headers, ocultarNsfw);

      // "heroes" = imagen ancha tipo banner (mismos filtros que las carátulas)
      const nsfwParamHeroes = ocultarNsfw ? 'false' : 'any';
      const resHeroes = await fetch(`https://www.steamgriddb.com/api/v2/heroes/game/${sgdbId}?types=static,animated&nsfw=${nsfwParamHeroes}&humor=any&epilepsy=any`, { headers });
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
        covers = await obtenerTodasLasGridsSteamGridDB(sgdbIdAlternativo, headers, ocultarNsfw);
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
    // cual — sin volver a preguntarle nada a IGDB/SteamGridDB.
    const existente = await prisma.media.findFirst({ where: { igdbId: parseInt(igdbId, 10) } });
    if (existente) return res.json(existente);

    const token = await getIgdbToken();

    // parent_game se pide para poder heredar el banner del juego base
    // cuando esto sea un DLC/update/expansión sin banner propio disponible.
    const body = `fields name,cover.url,first_release_date,summary,parent_game.id,parent_game.name; where id = ${igdbId};`;
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

    // Si sigue sin banner y esto es un DLC/update/expansión (tiene
    // parent_game), heredamos el banner del juego base: primero miramos si
    // ya está guardado en nuestra base de datos (más rápido, sin más
    // peticiones), y si no, lo buscamos igual que arriba pero con el
    // nombre/id del juego base.
    if (!backdropUrl && juego.parent_game) {
      try {
        const baseGuardado = await prisma.media.findFirst({
          where: { igdbId: juego.parent_game.id },
          select: { backdrop: true },
        });
        if (baseGuardado?.backdrop) {
          backdropUrl = baseGuardado.backdrop;
        } else {
          const sgdbIdBase = await buscarJuegoEnSteamGridDB(juego.parent_game.name);
          if (sgdbIdBase) {
            const resHeroesBase = await fetch(`https://www.steamgriddb.com/api/v2/heroes/game/${sgdbIdBase}`, {
              headers: { Authorization: `Bearer ${process.env.STEAMGRIDDB_API_KEY}` }
            });
            const dataHeroesBase = await resHeroesBase.json();
            backdropUrl = dataHeroesBase?.data?.[0]?.url || null;
          }
          if (!backdropUrl) {
            const artworksBase = await obtenerArtworksIgdb(juego.parent_game.id);
            backdropUrl = artworksBase[0] || null;
          }
        }
      } catch (e) {
        console.error('No se pudo heredar banner del juego base para', juego.name, e);
      }
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

// --- ACTIVIDAD RECIENTE DE MIS AMIGOS (para "New from friends" en la home) ---
// Cualquier cosa que sigas (Follow ACCEPTED) haya marcado como vista/jugada,
// tenga reseña escrita o no — a diferencia de /media/reviews, que solo
// enseña las que SÍ tienen texto. La forma de cada item es la MISMA que ya
// usa /media/reviews (compatible con <ReviewDetailModal>), con "actor"
// añadido encima para saber de quién es la actividad.
app.get('/friends/activity', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;

    const siguiendo = await prisma.follow.findMany({
      where: { followerId: req.userId, estado: 'ACCEPTED' },
      select: { followingId: true },
    });
    const idsAmigos = siguiendo.map((f) => f.followingId);
    if (idsAmigos.length === 0) return res.json([]);

    const entradas = await prisma.userMedia.findMany({
      where: { userId: { in: idsAmigos }, watched: true },
      orderBy: { lastActivityAt: 'desc' },
      take: limit,
    });
    if (entradas.length === 0) return res.json([]);

    const mediaIds = [...new Set(entradas.map((e) => e.mediaId))];
    const userIds = [...new Set(entradas.map((e) => e.userId))];

    const [mediaItems, usuarios, watchLogs, gameLogs] = await Promise.all([
      prisma.media.findMany({ where: { id: { in: mediaIds } } }),
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, avatar: true } }),
      // Todos los logs, no solo los que tienen reseña — de aquí sacamos
      // también los detalles de "para cuándo lo viste" (rewatch) o, en
      // juegos, plataforma/horas/etc., aunque no haya texto escrito.
      prisma.watchLog.findMany({
        where: { userId: { in: userIds }, mediaId: { in: mediaIds } },
        orderBy: { fechaVisto: 'desc' },
      }),
      prisma.gameLog.findMany({
        where: { userId: { in: userIds }, mediaId: { in: mediaIds } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const mediaPorId = new Map(mediaItems.map((m) => [m.id, m]));
    const usuarioPorId = new Map(usuarios.map((u) => [u.id, u]));

    // El log MÁS RECIENTE por usuario+media (ya vienen ordenados desc, así
    // que el primero que encontremos por esa clave es el bueno).
    const watchLogPorClave = new Map();
    for (const w of watchLogs) {
      const clave = `${w.userId}-${w.mediaId}`;
      if (!watchLogPorClave.has(clave)) watchLogPorClave.set(clave, w);
    }
    const gameLogPorClave = new Map();
    for (const g of gameLogs) {
      const clave = `${g.userId}-${g.mediaId}`;
      if (!gameLogPorClave.has(clave)) gameLogPorClave.set(clave, g);
    }

    const resultado = entradas
      .map((e) => {
        const item = mediaPorId.get(e.mediaId);
        const actor = usuarioPorId.get(e.userId);
        if (!item || !actor) return null;

        const clave = `${e.userId}-${e.mediaId}`;
        const esJuego = item.tipo === 'VIDEOJUEGO';
        const wLog = !esJuego ? watchLogPorClave.get(clave) : null;
        const gLog = esJuego ? gameLogPorClave.get(clave) : null;

        return {
          actor,
          // Misma forma que /media/reviews (para reutilizar ReviewDetailModal tal cual)
          ...item,
          id: item.id,
          mediaId: item.id,
          portada: e.customPoster || item.portada,
          logId: wLog ? `watchlog-${wLog.id}` : gLog ? `gamelog-${gLog.id}` : null,
          rating: esJuego ? gLog?.rating ?? null : e.rating,
          liked: e.liked,
          watchlist: e.watchlist,
          rewatch: wLog?.rewatch || false,
          review: esJuego ? gLog?.review || null : wLog?.review || null,
          logNombre: gLog?.nombre || null,
          plataforma: gLog?.plataforma || null,
          jugadoEn: gLog?.jugadoEn || null,
          propiedad: gLog?.propiedad || null,
          edicion: gLog?.edicion || null,
          fechaInicio: gLog?.fechaInicio || null,
          fechaFin: gLog?.fechaFin || null,
          minutosJugados: gLog?.minutosJugados ?? null,
          fecha: e.lastActivityAt,
        };
      })
      .filter(Boolean);

    res.json(resultado);
  } catch (error) {
    console.error('ERROR EN GET /friends/activity:', error);
    res.status(500).json({ error: 'Error al obtener la actividad de tus amigos' });
  }
});

// --- HELPER: ¿puede "miUserId" ver el catálogo/listas/reseñas de "usuario"? ---
// true si: el propio dueño, o la cuenta es pública, o (siendo privada) hay
// un Follow con estado ACCEPTED de miUserId hacia usuario.id. Se usa en
// TODAS las rutas públicas de perfil (watched, reviews, lists...) para que
// una cuenta privada quede tapada de verdad en todos los sitios a la vez,
// no solo en la página principal del perfil.
async function puedeVerContenidoPrivado(usuario, miUserId) {
  if (!usuario.isPrivate) return true;
  if (miUserId === usuario.id) return true;
  if (!miUserId) return false;
  const follow = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: miUserId, followingId: usuario.id } },
  });
  return follow?.estado === 'ACCEPTED';
}

// --- ORDENA los items de una lista según ordenPor/ordenDireccion ---
// "items" ya viene como array de ListItem CON su Media incluida bajo
// item.media (ver cómo se llama a esta función) y item.orden/createdAt
// propios del ListItem. Para NOTA_MEDIA y MI_NOTA se necesita consultar
// UserMedia aparte — se hace aquí dentro para no repetir la consulta en
// cada sitio que ordena una lista (privada, pública, ambas).
async function ordenarItemsDeLista(listItems, ordenPor, ordenDireccion, ownerId) {
  const dir = ordenDireccion === 'ASC' ? 1 : -1;

  if (ordenPor === 'MANUAL') {
    return [...listItems].sort((a, b) => dir === 1 ? a.orden - b.orden : b.orden - a.orden);
    // Nota: MANUAL con dir=-1 no tiene mucho sentido de cara al usuario (el
    // orden que arrastraste a mano ya es el que es), pero se deja coherente
    // con el resto en vez de ignorar la dirección sin más.
  }

  if (ordenPor === 'FECHA') {
    return [...listItems].sort((a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
  }

  if (ordenPor === 'NOMBRE') {
    return [...listItems].sort((a, b) => dir * (a.media?.titulo || '').localeCompare(b.media?.titulo || ''));
  }

  if (ordenPor === 'NOTA_MEDIA' || ordenPor === 'MI_NOTA') {
    const mediaIds = listItems.map((li) => li.mediaId);
    const ratings = await prisma.userMedia.findMany({
      where: { mediaId: { in: mediaIds }, rating: { not: null } },
      select: { mediaId: true, userId: true, rating: true },
    });

    const notaMediaPorMediaId = new Map();
    const miNotaPorMediaId = new Map();
    const porMedia = new Map();
    for (const r of ratings) {
      if (!porMedia.has(r.mediaId)) porMedia.set(r.mediaId, []);
      porMedia.get(r.mediaId).push(r.rating);
      if (r.userId === ownerId) miNotaPorMediaId.set(r.mediaId, r.rating);
    }
    for (const [mediaId, notas] of porMedia) {
      notaMediaPorMediaId.set(mediaId, notas.reduce((a, b) => a + b, 0) / notas.length);
    }

    const mapa = ordenPor === 'NOTA_MEDIA' ? notaMediaPorMediaId : miNotaPorMediaId;
    return [...listItems].sort((a, b) => dir * ((mapa.get(a.mediaId) ?? -1) - (mapa.get(b.mediaId) ?? -1)));
  }

  return listItems;
}


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

// --- HELPER: mezclar portada/backdrop en resultados EN CRUDO de TMDB ---
// A diferencia de GET /media/:id (que ya trabaja sobre TU base de datos),
// estas rutas (/tmdb/popular, /tmdb/buscar, etc.) devuelven objetos tal cual
// los da TMDB — no saben si ese título ya está guardado en tu base de datos
// ni qué portada tiene fijada. Antes esta función SOLO aplicaba tu
// personalización manual (UserMedia.customPoster) y, si no habías
// personalizado nada, se quedaba con lo que TMDB diera en ESA petición
// concreta — que puede no coincidir con lo que TMDB dio la vez que se
// guardó el título (Media.portada), haciendo que la misma película se vea
// con una carátula distinta en el catálogo que en su propia ficha.
// Ahora se aplican los DOS niveles, en orden: tu personalización (si
// existe) > la portada compartida ya guardada (si el título existe en tu
// base de datos) > lo que traiga TMDB en crudo (si no está guardado todavía).
async function mezclarCustomPosters(items, userId) {
  if (!items || items.length === 0) return items;

  const tmdbIds = items.map((i) => i.id).filter(Boolean);
  if (tmdbIds.length === 0) return items;

  // OJO: TMDB numera películas y series en espacios de IDs independientes,
  // así que una película guardada puede tener el MISMO tmdbId numérico que
  // una serie distinta (y viceversa). Antes esta función cruzaba solo por
  // tmdbId, así que le colaba la carátula de una película a una serie con
  // el mismo número (el título salía bien porque viene en crudo de TMDB,
  // pero la carátula se pisaba con la de otro título sin relación). Ahora
  // se pide también "tipo" y se cruza por tmdbId + tipo, igual que ya se
  // corrigió en el frontend para el link (dbId).
  const mediaLocal = await prisma.media.findMany({
    where: { tmdbId: { in: tmdbIds } },
    select: { id: true, tmdbId: true, tipo: true, portada: true, backdrop: true }
  });
  if (mediaLocal.length === 0) return items;

  const tipoEsperado = (mediaType) => (mediaType === 'tv' ? 'SERIE' : 'PELICULA');
  const claveDe = (tmdbId, tipo) => `${tmdbId}-${tipo}`;

  const mediaIdPorClave = new Map(mediaLocal.map((m) => [claveDe(m.tmdbId, m.tipo), m.id]));
  const compartidaPorClave = new Map(mediaLocal.map((m) => [claveDe(m.tmdbId, m.tipo), { portada: m.portada, backdrop: m.backdrop }]));

  let personalizacionPorMediaId = new Map();
  if (userId) {
    const mediaIds = mediaLocal.map((m) => m.id);
    const personalizaciones = await prisma.userMedia.findMany({
      where: { userId, mediaId: { in: mediaIds } },
      select: { mediaId: true, customPoster: true, customBackdrop: true }
    });
    personalizacionPorMediaId = new Map(personalizaciones.map((p) => [p.mediaId, p]));
  }

  return items.map((item) => {
    const clave = claveDe(item.id, tipoEsperado(item.media_type));
    const mediaId = mediaIdPorClave.get(clave);
    const compartida = compartidaPorClave.get(clave);
    const mia = mediaId ? personalizacionPorMediaId.get(mediaId) : null;

    const portadaFinal = mia?.customPoster || compartida?.portada || null;
    const backdropFinal = mia?.customBackdrop || compartida?.backdrop || null;

    if (!portadaFinal && !backdropFinal) return item;
    return {
      ...item,
      ...(portadaFinal ? { portada: portadaFinal } : {}),
      ...(backdropFinal ? { backdrop: backdropFinal } : {})
    };
  });
}

// --- HELPER: mezclar portada compartida/personalizada en resultados EN
// CRUDO de IGDB (equivalente a mezclarCustomPosters, pero para juegos,
// cruzando por igdbId en vez de tmdbId). Mismo motivo: /igdb/popular,
// /igdb/year/:year, /igdb/catalogo/page/:page... devuelven la carátula que
// IGDB dé en ESE momento, que puede no coincidir con la que se guardó la
// vez que el juego se añadió (Media.portada) ni con la que hayas elegido a
// mano (UserMedia.customPoster).
async function mezclarCaratulasJuegos(juegos, userId) {
  if (!juegos || juegos.length === 0) return juegos;

  const igdbIds = juegos.map((j) => j.id).filter(Boolean);
  if (igdbIds.length === 0) return juegos;

  const mediaLocal = await prisma.media.findMany({
    where: { igdbId: { in: igdbIds } },
    select: { id: true, igdbId: true, portada: true }
  });
  if (mediaLocal.length === 0) return juegos;

  const mediaIdPorIgdbId = new Map(mediaLocal.map((m) => [m.igdbId, m.id]));
  const portadaCompartidaPorIgdbId = new Map(mediaLocal.map((m) => [m.igdbId, m.portada]));

  let personalizacionPorMediaId = new Map();
  if (userId) {
    const mediaIds = mediaLocal.map((m) => m.id);
    const personalizaciones = await prisma.userMedia.findMany({
      where: { userId, mediaId: { in: mediaIds } },
      select: { mediaId: true, customPoster: true }
    });
    personalizacionPorMediaId = new Map(personalizaciones.map((p) => [p.mediaId, p]));
  }

  return juegos.map((juego) => {
    const mediaId = mediaIdPorIgdbId.get(juego.id);
    const mia = mediaId ? personalizacionPorMediaId.get(mediaId) : null;
    const portadaFinal = mia?.customPoster || portadaCompartidaPorIgdbId.get(juego.id) || null;

    if (!portadaFinal) return juego;
    // El resto de la app (GameCard y similares) lee la carátula desde
    // juego.cover.url — mismo campo que arreglarCoverIgdb ya deja listo.
    return { ...juego, cover: { ...(juego.cover || {}), url: portadaFinal } };
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

        const nuevaPortada = data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : null;
        const nuevoBackdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null;

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

    let franquicia = null;
    try {
      franquicia = await obtenerFranquiciaAmplia(igdbId);
    } catch (e) {
      console.error('Error obteniendo franquicia amplia tras reset:', e.message);
    }
    res.json({ ...(await construirRespuestaDesdeCurated(collectionId, igdbId)), franquicia });
  } catch (error) {
    console.error('ERROR EN POST /admin/curated-collections/:collectionId/reset:', error);
    res.status(500).json({ error: 'Error al reiniciar la colección' });
  }
});

// --- REINICIAR TODAS LAS SAGAS DE GOLPE (solo admin) ---
// Mismo criterio que el reset individual, pero recorre TODAS las
// CuratedCollection existentes. Usa el igdbId del primer item de cada una
// como "ancla" para recalcular desde IGDB — cualquier juego de la saga vale,
// calcularColeccionDesdeIgdb siempre encuentra la misma Collection/Franchise
// a partir de cualquiera de sus miembros.
app.post('/admin/curated-collections/reset-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const colecciones = await prisma.curatedCollection.findMany({
      include: { items: { take: 1, orderBy: { orden: 'asc' } } },
    });

    let actualizadas = 0;
    let sinCambios = 0;
    let fallidas = 0;

    // Secuencial, no en paralelo: evita disparar decenas de peticiones a
    // IGDB de golpe (mismo criterio que ya usas en refresh-covers-english).
    for (const coleccion of colecciones) {
      const igdbIdAncla = coleccion.items[0]?.igdbId;
      if (!igdbIdAncla) { sinCambios++; continue; }

      try {
        const calculada = await calcularColeccionDesdeIgdb(igdbIdAncla);
        if (!calculada) { sinCambios++; continue; }

        await prisma.curatedCollectionItem.deleteMany({ where: { collectionId: coleccion.id } });
        await prisma.curatedCollection.update({
          where: { id: coleccion.id },
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
        actualizadas++;
      } catch (e) {
        console.error(`Error reiniciando saga "${coleccion.nombre}" (id ${coleccion.id}):`, e.message);
        fallidas++;
      }
    }

    res.json({ ok: true, total: colecciones.length, actualizadas, sinCambios, fallidas });
  } catch (error) {
    console.error('ERROR EN POST /admin/curated-collections/reset-all:', error);
    res.status(500).json({ error: 'Error al reiniciar todas las sagas' });
  }
});

// --- REINICIAR ABSOLUTAMENTE TODO (sagas de juegos, sagas de
// películas/series y universos) a como quedaría recalculado desde cero,
// según las reglas actuales — borra CUALQUIER edición manual (juegos/
// películas/series añadidos a mano, orden manual, "Other" personalizado...).
// Solo admin. No se puede deshacer. ---
app.post('/admin/reset-absolutamente-todo', requireAuth, requireAdmin, async (req, res) => {
  try {
    const resultado = { juegos: { total: 0, actualizadas: 0 }, sagas: { total: 0, actualizadas: 0, sinFuente: 0 }, universos: { total: 0, actualizados: 0 } };

    // --- 1. Sagas de juegos (CuratedCollection) ---
    const coleccionesJuegos = await prisma.curatedCollection.findMany({
      include: { items: { take: 1, orderBy: { orden: 'asc' } } },
    });
    resultado.juegos.total = coleccionesJuegos.length;
    for (const coleccion of coleccionesJuegos) {
      const igdbIdAncla = coleccion.items[0]?.igdbId;
      if (!igdbIdAncla) continue;
      try {
        const calculada = await calcularColeccionDesdeIgdb(igdbIdAncla);
        if (!calculada) continue;
        await prisma.curatedCollectionItem.deleteMany({ where: { collectionId: coleccion.id } });
        await prisma.curatedCollection.update({
          where: { id: coleccion.id },
          data: {
            nombre: calculada.nombre,
            items: {
              create: calculada.todos.map((g, index) => ({
                igdbId: g.igdbId, titulo: g.titulo, anio: g.anio, portada: g.portada, cancelado: g.cancelado, orden: index,
              })),
            },
          },
        });
        resultado.juegos.actualizadas++;
      } catch (e) {
        console.error(`Error reiniciando saga de juego "${coleccion.nombre}":`, e.message);
      }
    }

    // --- 2. Sagas de películas/series (CuratedMovieCollection) ---
    const sagasPeliculas = await prisma.curatedMovieCollection.findMany();
    resultado.sagas.total = sagasPeliculas.length;
    for (const saga of sagasPeliculas) {
      if (!saga.tmdbCollectionId) {
        // Sagas de serie suelta (sin Collection de TMDB): no hay de dónde
        // recalcular, así que no se tocan — solo se avisa de cuántas hay.
        resultado.sagas.sinFuente++;
        continue;
      }
      try {
        const calculada = await calcularColeccionMovieDesdeTmdb(saga.tmdbCollectionId, 'en-US');
        if (!calculada) continue;
        await prisma.curatedMovieCollectionItem.deleteMany({ where: { collectionId: saga.id } });
        await prisma.curatedMovieCollection.update({
          where: { id: saga.id },
          data: {
            nombre: calculada.nombre,
            items: {
              create: calculada.items.map((it, index) => ({
                tmdbId: it.tmdbId, tipo: it.tipo, titulo: it.titulo, anio: it.anio, portada: it.portada, orden: index,
              })),
            },
          },
        });
        resultado.sagas.actualizadas++;
      } catch (e) {
        console.error(`Error reiniciando saga de películas "${saga.nombre}":`, e.message);
      }
    }

    // --- 3. Universos (CinematicUniverse): se vacían y se reconstruyen desde
    // sus fuentes guardadas (collection/company/keyword), exactamente como
    // si se importaran por primera vez. ---
    const apiKey = process.env.TMDB_API_KEY;
    const universos = await prisma.cinematicUniverse.findMany({ include: { fuentes: true } });
    resultado.universos.total = universos.length;

    for (const universo of universos) {
      if (universo.fuentes.length === 0) continue; // universo sin fuentes = todo manual, no se toca

      try {
        await prisma.cinematicUniverseItem.deleteMany({ where: { universeId: universo.id } });

        for (const fuente of universo.fuentes) {
          let peliculas = [];

          if (fuente.tipo === 'collection') {
            const r = await fetch(`https://api.themoviedb.org/3/collection/${fuente.tmdbId}?api_key=${apiKey}`);
            const d = await r.json();
            if (d.parts) peliculas = d.parts.map((p) => ({ ...p, __pestañaFija: d.name || 'Collection', __tipoTmdb: 'movie' }));
          } else if (fuente.tipo === 'company') {
            let pagina = 1, totalPaginas = 1;
            do {
              const r = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&with_companies=${fuente.tmdbId}&sort_by=primary_release_date.asc&page=${pagina}`);
              const d = await r.json();
              peliculas.push(...(d.results || []).map((p) => ({ ...p, __tipoTmdb: 'movie' })));
              totalPaginas = d.total_pages || 1;
              pagina++;
            } while (pagina <= totalPaginas && pagina <= 10);
          } else if (fuente.tipo === 'keyword') {
            for (const tipoTmdb of ['movie', 'tv']) {
              let pagina = 1, totalPaginas = 1;
              do {
                const r = await fetch(`https://api.themoviedb.org/3/discover/${tipoTmdb}?api_key=${apiKey}&with_keywords=${fuente.tmdbId}&sort_by=${tipoTmdb === 'movie' ? 'primary_release_date.asc' : 'first_air_date.asc'}&page=${pagina}`);
                const d = await r.json();
                peliculas.push(...(d.results || []).map((p) => ({ ...p, __tipoTmdb: tipoTmdb })));
                totalPaginas = d.total_pages || 1;
                pagina++;
              } while (pagina <= totalPaginas && pagina <= 10);
            }
          }

          const idsExistentes = new Set(
            (await prisma.cinematicUniverseItem.findMany({ where: { universeId: universo.id }, select: { tmdbId: true } })).map((e) => e.tmdbId)
          );
          const ordenPorPestaña = {};

          for (const p of peliculas) {
            if (idsExistentes.has(p.id)) continue;

            let pestaña = p.__pestañaFija || 'Other';
            if (!p.__pestañaFija && p.__tipoTmdb === 'movie') {
              try {
                const detR = await fetch(`https://api.themoviedb.org/3/movie/${p.id}?api_key=${apiKey}`);
                const det = await detR.json();
                if (det.belongs_to_collection?.name) pestaña = det.belongs_to_collection.name;
              } catch (e) { }
            }

            if (ordenPorPestaña[pestaña] === undefined) {
              const max = await prisma.cinematicUniverseItem.aggregate({ where: { universeId: universo.id, pestaña }, _max: { orden: true } });
              ordenPorPestaña[pestaña] = (max._max.orden ?? -1) + 1;
            }

            const titulo = p.__tipoTmdb === 'movie' ? p.title : p.name;
            const fechaTexto = p.__tipoTmdb === 'movie' ? p.release_date : p.first_air_date;

            await prisma.cinematicUniverseItem.create({
              data: {
                universeId: universo.id,
                tmdbId: p.id,
                tipo: p.__tipoTmdb === 'movie' ? 'PELICULA' : 'SERIE',
                titulo,
                anio: fechaTexto ? new Date(fechaTexto).getFullYear() : null,
                fechaEstreno: fechaTexto ? new Date(fechaTexto) : null,
                portada: p.poster_path ? `https://image.tmdb.org/t/p/w780${p.poster_path}` : null,
                pestaña,
                orden: ordenPorPestaña[pestaña]++,
              },
            });
            idsExistentes.add(p.id);
          }
        }

        // Reordenar por fecha dentro de cada pestaña, igual que ya hace refresh.
        const todosLosItems = await prisma.cinematicUniverseItem.findMany({ where: { universeId: universo.id } });
        const porPestaña = new Map();
        for (const item of todosLosItems) {
          if (!porPestaña.has(item.pestaña)) porPestaña.set(item.pestaña, []);
          porPestaña.get(item.pestaña).push(item);
        }
        const actualizaciones = [];
        for (const items of porPestaña.values()) {
          const ordenados = [...items].sort((a, b) => {
            const fechaA = a.fechaEstreno ? new Date(a.fechaEstreno).getTime() : a.anio ? new Date(a.anio, 0, 1).getTime() : Infinity;
            const fechaB = b.fechaEstreno ? new Date(b.fechaEstreno).getTime() : b.anio ? new Date(b.anio, 0, 1).getTime() : Infinity;
            return fechaA - fechaB;
          });
          ordenados.forEach((item, index) => {
            if (item.orden !== index) actualizaciones.push(prisma.cinematicUniverseItem.update({ where: { id: item.id }, data: { orden: index } }));
          });
        }
        if (actualizaciones.length > 0) await prisma.$transaction(actualizaciones);

        resultado.universos.actualizados++;
      } catch (e) {
        console.error(`Error reiniciando universo "${universo.nombre}":`, e.message);
      }
    }

    res.json({ ok: true, ...resultado });
  } catch (error) {
    console.error('ERROR EN POST /admin/reset-absolutamente-todo:', error);
    res.status(500).json({ error: 'Error al reiniciar todo' });
  }
});

// --- REORDENAR POR FECHA (cronológico) TODAS LAS SAGAS DE PELÍCULAS/SERIES
// Y TODOS LOS UNIVERSOS, de golpe (solo admin) ---
// No borra ni recalcula nada desde TMDB — solo reescribe el campo "orden" en
// la base de datos para que coincida con el orden por año, que es el
// criterio que ahora se usa siempre. También resetea ordenUniverso a null
// en los universos, para que la pestaña "todas" vuelva a caer en orden
// cronológico puro (en vez de quedarse con un orden manual antiguo).
app.post('/admin/reordenar-todo-por-fecha', requireAuth, requireAdmin, async (req, res) => {
  try {
    let sagasActualizadas = 0;
    let universosActualizados = 0;

    // --- CuratedMovieCollection (sagas de películas/series) ---
    const sagas = await prisma.curatedMovieCollection.findMany({
      include: { items: true },
    });
    for (const saga of sagas) {
      const ordenados = [...saga.items].sort((a, b) => (a.anio ?? Infinity) - (b.anio ?? Infinity));
      const actualizaciones = ordenados
        .map((item, index) =>
          item.orden !== index
            ? prisma.curatedMovieCollectionItem.update({ where: { id: item.id }, data: { orden: index } })
            : null
        )
        .filter(Boolean);
      if (actualizaciones.length > 0) {
        await prisma.$transaction(actualizaciones);
        sagasActualizadas++;
      }
    }

    // --- CinematicUniverse (universos de cine/TV) ---
    const universos = await prisma.cinematicUniverse.findMany({ include: { items: true } });
    for (const universo of universos) {
      const porPestaña = new Map();
      for (const item of universo.items) {
        if (!porPestaña.has(item.pestaña)) porPestaña.set(item.pestaña, []);
        porPestaña.get(item.pestaña).push(item);
      }

      const actualizaciones = [];
      for (const items of porPestaña.values()) {
        const ordenados = [...items].sort((a, b) => {
          const fechaA = a.fechaEstreno ? new Date(a.fechaEstreno).getTime() : a.anio ? new Date(a.anio, 0, 1).getTime() : Infinity;
          const fechaB = b.fechaEstreno ? new Date(b.fechaEstreno).getTime() : b.anio ? new Date(b.anio, 0, 1).getTime() : Infinity;
          return fechaA - fechaB;
        });
        ordenados.forEach((item, index) => {
          const data = {};
          if (item.orden !== index) data.orden = index;
          if (item.ordenUniverso !== null) data.ordenUniverso = null;
          if (Object.keys(data).length > 0) {
            actualizaciones.push(prisma.cinematicUniverseItem.update({ where: { id: item.id }, data }));
          }
        });
      }
      if (actualizaciones.length > 0) {
        await prisma.$transaction(actualizaciones);
        universosActualizados++;
      }
    }

    res.json({ ok: true, sagasActualizadas, totalSagas: sagas.length, universosActualizados, totalUniversos: universos.length });
  } catch (error) {
    console.error('ERROR EN POST /admin/reordenar-todo-por-fecha:', error);
    res.status(500).json({ error: 'Error al reordenar por fecha' });
  }
});

// --- CREAR UN UNIVERSO CINEMATOGRÁFICO NUEVO ---
app.post('/admin/cinematic-universes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre' });
    const universo = await prisma.cinematicUniverse.create({ data: { nombre: nombre.trim() } });
    res.json(universo);
  } catch (error) {
    console.error('ERROR EN POST /admin/cinematic-universes:', error);
    res.status(500).json({ error: 'Error al crear el universo' });
  }
});

// --- LISTAR TODOS LOS UNIVERSOS (para el desplegable "añadir a universo existente") ---
app.get('/admin/cinematic-universes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universos = await prisma.cinematicUniverse.findMany({ orderBy: { nombre: 'asc' } });
    res.json(universos);
  } catch (error) {
    console.error('ERROR EN GET /admin/cinematic-universes:', error);
    res.status(500).json({ error: 'Error al listar universos' });
  }
});

// --- AÑADIR UNA COLECCIÓN DE TMDB ENTERA A UN UNIVERSO (siembra automática) ---
// Trae TODAS las películas de esa Collection de TMDB y las guarda como
// CinematicUniverseItem, agrupadas bajo su propia pestaña. Las que ya
// estuvieran (incluso en otra pestaña del mismo universo) se omiten.
app.post('/admin/cinematic-universes/:universeId/collections', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const { tmdbCollectionId, nombrePestaña } = req.body;
    if (!tmdbCollectionId) return res.status(400).json({ error: 'Falta tmdbCollectionId' });

    const apiKey = process.env.TMDB_API_KEY;
    // Sin &language= aquí a propósito: TMDB cae a inglés por defecto. Igual
    // que el resto del catálogo, las carátulas de universo siempre se
    // guardan en inglés — nunca en tu idioma de la interfaz.
    const r = await fetch(`https://api.themoviedb.org/3/collection/${tmdbCollectionId}?api_key=${apiKey}`);
    const d = await r.json();
    if (!d.parts) return res.status(404).json({ error: 'Colección de TMDB no encontrada' });

    const pestaña = (nombrePestaña || d.name || 'Collection').trim();

    const existentes = await prisma.cinematicUniverseItem.findMany({
      where: { universeId },
      select: { tmdbId: true },
    });
    const idsExistentes = new Set(existentes.map((e) => e.tmdbId));

    const maxOrden = await prisma.cinematicUniverseItem.aggregate({
      where: { universeId, pestaña },
      _max: { orden: true },
    });
    let orden = (maxOrden._max.orden ?? -1) + 1;

    const nuevos = d.parts.filter((p) => !idsExistentes.has(p.id));
    for (const p of nuevos) {
      await prisma.cinematicUniverseItem.create({
        data: {
          universeId,
          tmdbId: p.id,
          titulo: p.title,
          anio: p.release_date ? new Date(p.release_date).getFullYear() : null,
          fechaEstreno: p.release_date ? new Date(p.release_date) : null,
          portada: p.poster_path ? `https://image.tmdb.org/t/p/w780${p.poster_path}` : null,
          pestaña,
          orden: orden++,
        },
      });
    }

    await prisma.cinematicUniverseSource.upsert({
      where: { universeId_tipo_tmdbId: { universeId, tipo: 'collection', tmdbId: parseInt(tmdbCollectionId) } },
      update: {},
      create: { universeId, tipo: 'collection', tmdbId: parseInt(tmdbCollectionId) },
    });

    res.json({ añadidos: nuevos.length, omitidos: d.parts.length - nuevos.length });
  } catch (error) {
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/collections:', error);
    res.status(500).json({ error: 'Error al añadir la colección al universo' });
  }
});

// --- IMPORTAR UN UNIVERSO ENTERO POR PRODUCTORA DE TMDB (siembra masiva) ---
// TMDB no tiene el concepto de "universo" — esto es el mejor atajo posible:
// trae TODAS las películas de una compañía (ej. Marvel Studios, id 420) y,
// para cada una, mira a qué Collection propia pertenece para colocarla en
// su pestaña automáticamente. Las que no pertenezcan a ninguna Collection
// van a la pestaña "Other". No es infalible (coproducciones raras pueden
// faltar) — es un punto de partida rápido, no sustituye la revisión manual.
app.post('/admin/cinematic-universes/:universeId/import-by-company', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const { tmdbCompanyId } = req.body;
    if (!tmdbCompanyId) return res.status(400).json({ error: 'Falta tmdbCompanyId' });

    const apiKey = process.env.TMDB_API_KEY;

    // 1. Todas las películas de esa productora (todas las páginas, tope de seguridad 10)
    let peliculas = [];
    let pagina = 1;
    let totalPaginas = 1;
    do {
      const r = await fetch(
        `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&with_companies=${tmdbCompanyId}&sort_by=primary_release_date.asc&page=${pagina}`
      );
      const d = await r.json();
      peliculas.push(...(d.results || []));
      totalPaginas = d.total_pages || 1;
      pagina++;
    } while (pagina <= totalPaginas && pagina <= 10);

    const existentes = await prisma.cinematicUniverseItem.findMany({
      where: { universeId },
      select: { tmdbId: true },
    });
    const idsExistentes = new Set(existentes.map((e) => e.tmdbId));

    const ordenPorPestaña = {};
    let añadidos = 0;

    // Secuencial, no en paralelo: evita disparar decenas de peticiones a
    // TMDB de golpe (mismo criterio que ya usas en refresh-covers-english).
    for (const p of peliculas) {
      if (idsExistentes.has(p.id)) continue;

      let pestaña = 'Other';
      try {
        const detR = await fetch(`https://api.themoviedb.org/3/movie/${p.id}?api_key=${apiKey}`);
        const det = await detR.json();
        if (det.belongs_to_collection?.name) pestaña = det.belongs_to_collection.name;
      } catch (e) {
        // si falla la consulta de detalle, se queda en "Other"
      }

      if (ordenPorPestaña[pestaña] === undefined) {
        const max = await prisma.cinematicUniverseItem.aggregate({
          where: { universeId, pestaña },
          _max: { orden: true },
        });
        ordenPorPestaña[pestaña] = (max._max.orden ?? -1) + 1;
      }

      await prisma.cinematicUniverseItem.create({
        data: {
          universeId,
          tmdbId: p.id,
          titulo: p.title,
          anio: p.release_date ? new Date(p.release_date).getFullYear() : null,
          fechaEstreno: p.release_date ? new Date(p.release_date) : null,
          portada: p.poster_path ? `https://image.tmdb.org/t/p/w780${p.poster_path}` : null,
          pestaña,
          orden: ordenPorPestaña[pestaña]++,
        },
      });
      idsExistentes.add(p.id);
      añadidos++;
    }

    await prisma.cinematicUniverseSource.upsert({
      where: { universeId_tipo_tmdbId: { universeId, tipo: 'company', tmdbId: parseInt(tmdbCompanyId) } },
      update: {},
      create: { universeId, tipo: 'company', tmdbId: parseInt(tmdbCompanyId) },
    });

    res.json({ añadidos, total: peliculas.length });
  } catch (error) {
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/import-by-company:', error);
    res.status(500).json({ error: 'Error al importar por productora' });
  }
});

// --- VACIAR UN UNIVERSO ENTERO (borra TODOS sus items, sin recalcular nada) ---
// A diferencia de la colección curada de juegos, aquí no hay ninguna fuente
// automática de la que recalcular ("universo" no existe como concepto en
// TMDB) — esto solo deja el universo vacío, listo para volver a rellenarlo
// con "Import whole studio" y/o "Add collection".
app.post('/admin/cinematic-universes/:universeId/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const resultado = await prisma.cinematicUniverseItem.deleteMany({ where: { universeId } });
    res.json({ ok: true, borrados: resultado.count });
  } catch (error) {
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/reset:', error);
    res.status(500).json({ error: 'Error al vaciar el universo' });
  }
});

// --- BORRAR UN UNIVERSO ENTERO (la fila en sí, no solo vaciarlo) ---
app.delete('/admin/cinematic-universes/:universeId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    // Cascade en el schema borra items/fases/fuentes automáticamente al
    // borrar el universo — no hace falta borrarlos a mano antes.
    await prisma.cinematicUniverse.delete({ where: { id: universeId } });
    res.json({ ok: true });
  } catch (error) {
    if (error.code === 'P2025') return res.json({ ok: true }); // ya no existía
    console.error('ERROR EN DELETE /admin/cinematic-universes/:universeId:', error);
    res.status(500).json({ error: 'Error al borrar el universo' });
  }
});

// --- IMPORTAR UN UNIVERSO ENTERO POR KEYWORD DE TMDB (siembra masiva, más precisa que por productora) ---
// TMDB tiene "keywords" curadas a mano por la comunidad, como "marvel
// cinematic universe (mcu)" (id 180547, 82 películas exactas) — mucho más
// preciso que filtrar por productora, que arrastra películas de otros
// estudios que casualmente tienen "Marvel" en el nombre de la productora
// (Ghost Rider, Spider-Man 3, Fantastic Four de Sony/Fox, etc.). Encuentras
// el id del keyword en la URL de la página, tipo:
// themoviedb.org/keyword/180547-marvel-cinematic-universe-mcu/movie
// --- IMPORTAR UN UNIVERSO ENTERO POR KEYWORD DE TMDB (siembra masiva, más precisa que por productora) ---
// TMDB tiene "keywords" curadas a mano por la comunidad, como "marvel
// cinematic universe (mcu)" (id 180547, 82 películas exactas) — mucho más
// preciso que filtrar por productora, que arrastra películas de otros
// estudios que casualmente tienen "Marvel" en el nombre de la productora
// (Ghost Rider, Spider-Man 3, Fantastic Four de Sony/Fox, etc.). Encuentras
// el id del keyword en la URL de la página, tipo:
// themoviedb.org/keyword/180547-marvel-cinematic-universe-mcu/movie
//
// Se consulta tanto discover/movie como discover/tv con el mismo keyword id
// (TMDB usa el mismo id de keyword para ambos): un universo como el MCU
// tiene tanto películas como series (Loki, Agents of S.H.I.E.L.D....) bajo
// el mismo keyword, y antes solo se traían las películas.
app.post('/admin/cinematic-universes/:universeId/import-by-keyword', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const { tmdbKeywordId } = req.body;
    if (!tmdbKeywordId) return res.status(400).json({ error: 'Falta tmdbKeywordId' });

    const apiKey = process.env.TMDB_API_KEY;

    // Trae todas las páginas de un tipo (movie o tv) para un keyword dado.
    // Tope de seguridad en 10 páginas (200 resultados), igual que ya se
    // hacía antes para películas.
    const traerTodasLasPaginas = async (tipoTmdb) => {
      let items = [];
      let pagina = 1;
      let totalPaginas = 1;
      do {
        const r = await fetch(
          `https://api.themoviedb.org/3/discover/${tipoTmdb}?api_key=${apiKey}&with_keywords=${tmdbKeywordId}&sort_by=${tipoTmdb === 'movie' ? 'primary_release_date.asc' : 'first_air_date.asc'}&page=${pagina}`
        );
        const d = await r.json();
        items.push(...(d.results || []).map((item) => ({ ...item, __tipoTmdb: tipoTmdb })));
        totalPaginas = d.total_pages || 1;
        pagina++;
      } while (pagina <= totalPaginas && pagina <= 10);
      return items;
    };

    const [peliculas, series] = await Promise.all([
      traerTodasLasPaginas('movie'),
      traerTodasLasPaginas('tv'),
    ]);
    const todosLosItems = [...peliculas, ...series];

    const existentes = await prisma.cinematicUniverseItem.findMany({
      where: { universeId },
      select: { tmdbId: true },
    });
    const idsExistentes = new Set(existentes.map((e) => e.tmdbId));

    const ordenPorPestaña = {};
    let añadidos = 0;

    for (const p of todosLosItems) {
      if (idsExistentes.has(p.id)) continue;

      let pestaña = 'Other';
      try {
        // belongs_to_collection solo existe en el endpoint de detalle de
        // PELÍCULAS de TMDB — las series no tienen ese concepto, así que se
        // quedan directamente en "Other" salvo que se reasignen a mano.
        if (p.__tipoTmdb === 'movie') {
          const detR = await fetch(`https://api.themoviedb.org/3/movie/${p.id}?api_key=${apiKey}`);
          const det = await detR.json();
          if (det.belongs_to_collection?.name) pestaña = det.belongs_to_collection.name;
        }
      } catch (e) {
        // si falla la consulta de detalle, se queda en "Other"
      }

      if (ordenPorPestaña[pestaña] === undefined) {
        const max = await prisma.cinematicUniverseItem.aggregate({
          where: { universeId, pestaña },
          _max: { orden: true },
        });
        ordenPorPestaña[pestaña] = (max._max.orden ?? -1) + 1;
      }

      const titulo = p.__tipoTmdb === 'movie' ? p.title : p.name;
      const fechaTexto = p.__tipoTmdb === 'movie' ? p.release_date : p.first_air_date;

      await prisma.cinematicUniverseItem.create({
        data: {
          universeId,
          tmdbId: p.id,
          tipo: p.__tipoTmdb === 'movie' ? 'PELICULA' : 'SERIE',
          titulo,
          anio: fechaTexto ? new Date(fechaTexto).getFullYear() : null,
          fechaEstreno: fechaTexto ? new Date(fechaTexto) : null,
          portada: p.poster_path ? `https://image.tmdb.org/t/p/w780${p.poster_path}` : null,
          pestaña,
          orden: ordenPorPestaña[pestaña]++,
        },
      });
      idsExistentes.add(p.id);
      añadidos++;
    }

    await prisma.cinematicUniverseSource.upsert({
      where: { universeId_tipo_tmdbId: { universeId, tipo: 'keyword', tmdbId: parseInt(tmdbKeywordId) } },
      update: {},
      create: { universeId, tipo: 'keyword', tmdbId: parseInt(tmdbKeywordId) },
    });

    res.json({ añadidos, total: todosLosItems.length });
  } catch (error) {
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/import-by-keyword:', error);
    res.status(500).json({ error: 'Error al importar por keyword' });
  }
});
// --- REFRESCAR UN UNIVERSO A MANO (vuelve a comprobar TODAS sus fuentes guardadas) ---
// Revisa cada colección/productora/keyword que se usó alguna vez para
// sembrar este universo y añade lo que sea nuevo. Nunca borra ni reordena
// nada de lo que ya tienes editado a mano — solo puede AÑADIR películas que
// no existieran ya.
app.post('/admin/cinematic-universes/:universeId/refresh', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const apiKey = process.env.TMDB_API_KEY;
    const fuentes = await prisma.cinematicUniverseSource.findMany({ where: { universeId } });

    let totalAñadidos = 0;

    for (const fuente of fuentes) {
      const existentes = await prisma.cinematicUniverseItem.findMany({
        where: { universeId },
        select: { tmdbId: true },
      });
      const idsExistentes = new Set(existentes.map((e) => e.tmdbId));

      let peliculas = [];

      if (fuente.tipo === 'collection') {
        const r = await fetch(`https://api.themoviedb.org/3/collection/${fuente.tmdbId}?api_key=${apiKey}`);
        const d = await r.json();
        if (d.parts) peliculas = d.parts.map((p) => ({ ...p, __pestañaFija: d.name || 'Collection' }));
      } else {
        const parametro = fuente.tipo === 'company' ? 'with_companies' : 'with_keywords';
        let pagina = 1;
        let totalPaginas = 1;
        do {
          const r = await fetch(
            `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&${parametro}=${fuente.tmdbId}&sort_by=primary_release_date.asc&page=${pagina}`
          );
          const d = await r.json();
          peliculas.push(...(d.results || []));
          totalPaginas = d.total_pages || 1;
          pagina++;
        } while (pagina <= totalPaginas && pagina <= 10);
      }

      const ordenPorPestaña = {};
      for (const p of peliculas) {
        if (idsExistentes.has(p.id)) continue;

        let pestaña = p.__pestañaFija || 'Other';
        if (!p.__pestañaFija) {
          try {
            const detR = await fetch(`https://api.themoviedb.org/3/movie/${p.id}?api_key=${apiKey}`);
            const det = await detR.json();
            if (det.belongs_to_collection?.name) pestaña = det.belongs_to_collection.name;
          } catch (e) { }
        }

        if (ordenPorPestaña[pestaña] === undefined) {
          const max = await prisma.cinematicUniverseItem.aggregate({
            where: { universeId, pestaña },
            _max: { orden: true },
          });
          ordenPorPestaña[pestaña] = (max._max.orden ?? -1) + 1;
        }

        await prisma.cinematicUniverseItem.create({
          data: {
            universeId,
            tmdbId: p.id,
            titulo: p.title,
            anio: p.release_date ? new Date(p.release_date).getFullYear() : null,
            fechaEstreno: p.release_date ? new Date(p.release_date) : null,
            portada: p.poster_path ? `https://image.tmdb.org/t/p/w780${p.poster_path}` : null,
            pestaña,
            orden: ordenPorPestaña[pestaña]++,
          },
        });
        idsExistentes.add(p.id);
        totalAñadidos++;
      }
    }

    // Tras añadir lo nuevo, reordenamos TODO el universo por fecha de
    // estreno (dentro de cada pestaña por separado) — así lo recién
    // encontrado no se queda pegado al final sin más, sino en su sitio
    // cronológico correcto junto al resto. Esto sustituye cualquier orden
    // manual que hubiera antes del refresh.
    const todosLosItems = await prisma.cinematicUniverseItem.findMany({
      where: { universeId },
      orderBy: [{ pestaña: 'asc' }, { fechaEstreno: 'asc' }],
    });

    const porPestaña = new Map();
    for (const item of todosLosItems) {
      if (!porPestaña.has(item.pestaña)) porPestaña.set(item.pestaña, []);
      porPestaña.get(item.pestaña).push(item);
    }

    const actualizaciones = [];
    for (const items of porPestaña.values()) {
      items.forEach((item, index) => {
        if (item.orden !== index) {
          actualizaciones.push(
            prisma.cinematicUniverseItem.update({ where: { id: item.id }, data: { orden: index } })
          );
        }
      });
    }
    if (actualizaciones.length > 0) {
      await prisma.$transaction(actualizaciones);
    }

    res.json({ ok: true, fuentesRevisadas: fuentes.length, añadidos: totalAñadidos });
  } catch (error) {
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/refresh:', error);
    res.status(500).json({ error: 'Error al refrescar el universo' });
  }
});

// --- AÑADIR UNA PELÍCULA CONCRETA A UN UNIVERSO POR SU ID DE TMDB (a mano) ---
// A diferencia del buscador de texto (que solo aparece en la pestaña propia),
// esto deja pegar directamente el id de TMDB de una película — útil para
// títulos raros que el buscador no encuentra bien, o para añadir sin salir
// de este modal de importación masiva.
app.post('/admin/cinematic-universes/:universeId/add-movie', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const { tmdbId, pestaña } = req.body;
    if (!tmdbId || !pestaña || !pestaña.trim()) {
      return res.status(400).json({ error: 'Faltan datos: tmdbId y pestaña son obligatorios' });
    }

    const apiKey = process.env.TMDB_API_KEY;
    const r = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}`);
    const d = await r.json();
    if (!d.id) return res.status(404).json({ error: 'Película no encontrada en TMDB' });

    const pestañaLimpia = pestaña.trim();
    const maxOrden = await prisma.cinematicUniverseItem.aggregate({
      where: { universeId, pestaña: pestañaLimpia },
      _max: { orden: true },
    });

    const item = await prisma.cinematicUniverseItem.create({
      data: {
        universeId,
        tmdbId: d.id,
        tipo: 'PELICULA',
        titulo: d.title,
        anio: d.release_date ? new Date(d.release_date).getFullYear() : null,
        fechaEstreno: d.release_date ? new Date(d.release_date) : null,
        portada: d.poster_path ? `https://image.tmdb.org/t/p/w780${d.poster_path}` : null,
        pestaña: pestañaLimpia,
        orden: (maxOrden._max.orden ?? -1) + 1,
      },
    });
    res.json(item);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Esta película ya está en el universo' });
    }
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/add-movie:', error);
    res.status(500).json({ error: 'Error al añadir la película' });
  }
});

// --- AÑADIR UNA SERIE A UNA PESTAÑA DE UN UNIVERSO (por id de TMDB) ---
app.post('/admin/cinematic-universes/:universeId/add-series', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const { tmdbId, pestaña } = req.body;
    if (!tmdbId || !pestaña || !pestaña.trim()) {
      return res.status(400).json({ error: 'Faltan datos: tmdbId y pestaña son obligatorios' });
    }

    const apiKey = process.env.TMDB_API_KEY;
    const r = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}`);
    const d = await r.json();
    if (!d.id) return res.status(404).json({ error: 'Serie no encontrada en TMDB' });

    const pestañaLimpia = pestaña.trim();
    const maxOrden = await prisma.cinematicUniverseItem.aggregate({
      where: { universeId, pestaña: pestañaLimpia },
      _max: { orden: true },
    });

    const item = await prisma.cinematicUniverseItem.create({
      data: {
        universeId,
        tmdbId: d.id,
        tipo: 'SERIE',
        titulo: d.name,
        anio: d.first_air_date ? new Date(d.first_air_date).getFullYear() : null,
        fechaEstreno: d.first_air_date ? new Date(d.first_air_date) : null,
        portada: d.poster_path ? `https://image.tmdb.org/t/p/w780${d.poster_path}` : null,
        pestaña: pestañaLimpia,
        orden: (maxOrden._max.orden ?? -1) + 1,
      },
    });
    res.json(item);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Esta serie ya está en el universo' });
    }
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/add-series:', error);
    res.status(500).json({ error: 'Error al añadir la serie' });
  }
});

// --- AÑADIR UNA PELÍCULA SUELTA A UNA PESTAÑA DE UN UNIVERSO (buscador) ---
app.post('/admin/cinematic-universe-items', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { universeId, tmdbId, titulo, anio, fechaEstreno, portada, pestaña, tipo } = req.body;
    if (!universeId || !tmdbId || !titulo || !pestaña) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    const maxOrden = await prisma.cinematicUniverseItem.aggregate({
      where: { universeId, pestaña },
      _max: { orden: true },
    });

    const item = await prisma.cinematicUniverseItem.create({
      data: {
        universeId,
        tmdbId,
        tipo: tipo === 'SERIE' ? 'SERIE' : 'PELICULA',
        titulo,
        anio: anio || null,
        fechaEstreno: fechaEstreno ? new Date(fechaEstreno) : null,
        portada: portada || null,
        pestaña,
        orden: (maxOrden._max.orden ?? -1) + 1,
      },
    });
    res.json(item);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Esta película ya está en el universo' });
    }
    console.error('ERROR EN POST /admin/cinematic-universe-items:', error);
    res.status(500).json({ error: 'Error al añadir la película' });
  }
});

// --- QUITAR UNA PELÍCULA DE UN UNIVERSO (no toca Media ni UserMedia) ---
app.delete('/admin/cinematic-universe-items/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.cinematicUniverseItem.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (error) {
    // P2025 = "no encontrado" — probablemente ya se borró antes (doble clic,
    // o dos pestañas abiertas). El resultado que quería el admin (que esa
    // fila no exista) ya es cierto, así que no hace falta tratarlo como error.
    if (error.code === 'P2025') return res.json({ ok: true });
    console.error('ERROR EN DELETE /admin/cinematic-universe-items/:id:', error);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// --- REORDENAR (arrastrar y soltar) DENTRO DE UNA MISMA PESTAÑA ---
// Mismo patrón que /admin/curated-collection-items/reorder: recibe los ids
// YA en el orden final y los numera tal cual.
app.patch('/admin/cinematic-universe-items/reorder', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Falta el array de ids' });
    for (let i = 0; i < ids.length; i++) {
      await prisma.cinematicUniverseItem.update({ where: { id: ids[i] }, data: { orden: i } });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN PATCH /admin/cinematic-universe-items/reorder:', error);
    res.status(500).json({ error: 'Error al reordenar' });
  }
});

// --- REORDENAR A MANO DENTRO DE LA PESTAÑA MEZCLADA DEL UNIVERSO ---
// Igual que el reorder normal, pero escribe en ordenUniverso en vez de
// orden — así no interfiere con el orden propio de cada sub-colección.
// --- FASES ("ventanas") DENTRO DE LA PESTAÑA MEZCLADA DE UN UNIVERSO ---
app.post('/admin/cinematic-universes/:universeId/phases', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre de la fase' });

    const max = await prisma.cinematicUniversePhase.aggregate({
      where: { universeId },
      _max: { orden: true },
    });

    const fase = await prisma.cinematicUniversePhase.create({
      data: { universeId, nombre: nombre.trim(), orden: (max._max.orden ?? -1) + 1 },
    });
    res.json(fase);
  } catch (error) {
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/phases:', error);
    res.status(500).json({ error: 'Error al crear la fase' });
  }
});

// --- FASES ("ventanas") DENTRO DE LA PESTAÑA MEZCLADA DE UN UNIVERSO ---
app.post('/admin/cinematic-universes/:universeId/phases', requireAuth, requireAdmin, async (req, res) => {
  try {
    const universeId = parseInt(req.params.universeId);
    const { nombre } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'Falta el nombre de la fase' });

    const max = await prisma.cinematicUniversePhase.aggregate({
      where: { universeId },
      _max: { orden: true },
    });

    const fase = await prisma.cinematicUniversePhase.create({
      data: { universeId, nombre: nombre.trim(), orden: (max._max.orden ?? -1) + 1 },
    });
    res.json(fase);
  } catch (error) {
    console.error('ERROR EN POST /admin/cinematic-universes/:universeId/phases:', error);
    res.status(500).json({ error: 'Error al crear la fase' });
  }
});

app.delete('/admin/cinematic-universe-phases/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    // las películas que estuvieran en esta fase quedan sin fase (faseId a
    // null automáticamente), no se borran del universo
    await prisma.cinematicUniversePhase.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (error) {
    if (error.code === 'P2025') return res.json({ ok: true });
    console.error('ERROR EN DELETE /admin/cinematic-universe-phases/:id:', error);
    res.status(500).json({ error: 'Error al borrar la fase' });
  }
});

// --- ASIGNAR (O QUITAR) LA FASE DE UNA PELÍCULA CONCRETA ---
app.patch('/admin/cinematic-universe-items/:id/phase', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { faseId } = req.body; // number | null
    const item = await prisma.cinematicUniverseItem.update({
      where: { id },
      data: { faseId: faseId ?? null },
    });
    res.json(item);
  } catch (error) {
    console.error('ERROR EN PATCH /admin/cinematic-universe-items/:id/phase:', error);
    res.status(500).json({ error: 'Error al asignar la fase' });
  }
});

app.delete('/admin/cinematic-universe-phases/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    // las películas que estuvieran en esta fase quedan sin fase (faseId a
    // null automáticamente), no se borran del universo
    await prisma.cinematicUniversePhase.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ ok: true });
  } catch (error) {
    if (error.code === 'P2025') return res.json({ ok: true });
    console.error('ERROR EN DELETE /admin/cinematic-universe-phases/:id:', error);
    res.status(500).json({ error: 'Error al borrar la fase' });
  }
});

// --- ASIGNAR (O QUITAR) LA FASE DE UNA PELÍCULA CONCRETA ---
app.patch('/admin/cinematic-universe-items/:id/phase', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { faseId } = req.body; // number | null
    const item = await prisma.cinematicUniverseItem.update({
      where: { id },
      data: { faseId: faseId ?? null },
    });
    res.json(item);
  } catch (error) {
    console.error('ERROR EN PATCH /admin/cinematic-universe-items/:id/phase:', error);
    res.status(500).json({ error: 'Error al asignar la fase' });
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

    // OJO: TMDB numera películas y series en espacios de IDs independientes,
    // así que puede haber una película guardada con el MISMO tmdbId numérico
    // que la serie (o película) que se está pidiendo ahora. Antes esta
    // comprobación buscaba solo por tmdbId, así que devolvía la fila
    // equivocada (p. ej. una película china sin relación) en vez de crear/
    // consultar la serie real — y el frontend acababa navegando a la ficha
    // de esa otra película. Ahora se exige también que coincida el tipo.
    const existente = await prisma.media.findFirst({
      where: { tmdbId: parseInt(tmdbId, 10), tipo: tipo || 'PELICULA' }
    });
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
      ? `https://image.tmdb.org/t/p/original${dataImagenes.backdrop_path}`
      : (data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null);
    const posterUrl = dataImagenes.poster_path
      ? `https://image.tmdb.org/t/p/w780${dataImagenes.poster_path}`
      : (data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : null);
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
      orderBy: { lastActivityAt: 'desc' }
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
          fechaVisto: e.lastActivityAt,
          rating: e.rating,
          liked: e.liked,
          playStatus: e.playStatus
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
      orderBy: { lastActivityAt: 'desc' }
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
          fechaAgregado: e.lastActivityAt
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
    // "En curso" ahora cubre tanto juegos (PLAYING) como series (WATCHING)
    const entries = await prisma.userMedia.findMany({
      where: { userId: req.userId, playStatus: { in: ['PLAYING', 'WATCHING'] } },
      orderBy: { lastActivityAt: 'desc' }
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
      select: { id: true, isPrivate: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const puedeVer = await puedeVerContenidoPrivado(usuario, getUserIdOpcional(req));
    if (!puedeVer) return res.status(403).json({ error: 'Este perfil es privado', isPrivate: true });

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

// --- EDITAR/BORRAR UN REGISTRO DE VISIONADO YA EXISTENTE ---
// Mismo patrón de comprobación de dueño que ya usan PATCH/DELETE /logs/:logId
// (juegos): se busca el registro primero y se comprueba que userId coincide
// con quien pregunta, antes de tocar nada.
app.patch('/watchlogs/:watchLogId', requireAuth, async (req, res) => {
  try {
    const watchLogId = parseInt(req.params.watchLogId, 10);
    const log = await prisma.watchLog.findUnique({ where: { id: watchLogId } });
    if (!log || log.userId !== req.userId) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    const { fechaVisto, review, rewatch } = req.body;
    const data = {};
    if (fechaVisto !== undefined) data.fechaVisto = fechaVisto ? new Date(fechaVisto) : new Date();
    if (review !== undefined) data.review = review;
    if (rewatch !== undefined) data.rewatch = !!rewatch;

    const actualizado = await prisma.watchLog.update({ where: { id: watchLogId }, data });
    res.json(actualizado);
  } catch (error) {
    console.error('ERROR EN PATCH /watchlogs/:watchLogId:', error);
    res.status(500).json({ error: 'Error al actualizar el registro de visionado' });
  }
});

app.delete('/watchlogs/:watchLogId', requireAuth, async (req, res) => {
  try {
    const watchLogId = parseInt(req.params.watchLogId, 10);
    const log = await prisma.watchLog.findUnique({ where: { id: watchLogId } });
    if (!log || log.userId !== req.userId) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    await prisma.watchLog.delete({ where: { id: watchLogId } });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE /watchlogs/:watchLogId:', error);
    res.status(500).json({ error: 'Error al borrar el registro de visionado' });
  }
});

// --- RUTA PARA OBTENER IMÁGENES DE TMDB ---
app.get('/tmdb/images/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    if (!tmdbId || tmdbId === 'undefined' || tmdbId === 'null') return res.status(400).json({ error: "Sin tmdbId" });
    const apiKey = process.env.TMDB_API_KEY;
    const endpointTmdb = req.query.tipo === 'SERIE' ? 'tv' : 'movie';
    const response = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${tmdbId}/images?api_key=${apiKey}`);
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

function construirFiltrosDiscoverTv(query) {
  let params = '';

  const anio = parseInt(query.anio);
  if (!isNaN(anio) && anio > 1800) params += `&first_air_date_year=${anio}`;

  const ratingMin = parseFloat(query.ratingMin);
  const ratingMax = parseFloat(query.ratingMax);
  if (!isNaN(ratingMin) && ratingMin > 0) params += `&vote_average.gte=${ratingMin}`;
  if (!isNaN(ratingMax) && ratingMax < 10) params += `&vote_average.lte=${ratingMax}`;

  // Duración de EPISODIO (with_runtime en discover/tv filtra por duración
  // de episodio, no de la serie entera — no hay equivalente a "duración
  // total" con series). Mismas franjas que en películas por consistencia.
  if (query.duracion === 'corta') {
    params += `&with_runtime.lte=29`;
  } else if (query.duracion === 'media') {
    params += `&with_runtime.gte=30&with_runtime.lte=59`;
  } else if (query.duracion === 'larga') {
    params += `&with_runtime.gte=60`;
  }

  return params;
}

// --- SERIES MÁS POPULARES DE LA HISTORIA, PAGINADAS DE 42 EN 42 ---
app.get('/tmdb/tv/popular-historico/page/:page', async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const apiKey = process.env.TMDB_API_KEY;

    const itemsPerPage = 42;
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = page * itemsPerPage;
    const startTmdbPage = Math.floor(startIndex / 20) + 1;
    const endTmdbPage = Math.ceil(endIndex / 20);

    const paramsFiltro = construirFiltrosDiscoverTv(req.query);
    const orden = req.query.orden === 'asc' ? 'asc' : 'desc';

    let combined = [];
    for (let i = startTmdbPage; i <= endTmdbPage; i++) {
      const url = `https://api.themoviedb.org/3/discover/tv?api_key=${apiKey}&language=${getLang(req)}&sort_by=vote_count.${orden}&page=${i}${paramsFiltro}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.results) combined.push(...(await conCaratulasIngles(url, data.results)));
    }

    const offsetDentroDeCombined = startIndex - (startTmdbPage - 1) * 20;
    const resultado = combined.slice(offsetDentroDeCombined, offsetDentroDeCombined + itemsPerPage);
    const resultadoFinal = await mezclarCustomPosters(resultado, getUserIdOpcional(req));

    res.json({ results: resultadoFinal });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener series populares históricas" });
  }
});

// --- SERIES DE UN AÑO, PAGINADAS DE 42 EN 42 ---
app.get('/tmdb/tv/year/:year/page/:page', async (req, res) => {
  try {
    const year = req.params.year;
    const page = parseInt(req.params.page) || 1;
    const apiKey = process.env.TMDB_API_KEY;

    const itemsPerPage = 42;
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = page * itemsPerPage;
    const startTmdbPage = Math.floor(startIndex / 20) + 1;
    const endTmdbPage = Math.ceil(endIndex / 20);

    const { anio, ...queryFiltro } = req.query;
    const paramsFiltro = construirFiltrosDiscoverTv(queryFiltro);
    const orden = req.query.orden === 'asc' ? 'asc' : 'desc';

    let combined = [];
    for (let i = startTmdbPage; i <= endTmdbPage; i++) {
      const url = `https://api.themoviedb.org/3/discover/tv?api_key=${apiKey}&language=${getLang(req)}&first_air_date_year=${year}&sort_by=popularity.${orden}&page=${i}${paramsFiltro}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.results) combined.push(...(await conCaratulasIngles(url, data.results)));
    }

    const offsetDentroDeCombined = startIndex - (startTmdbPage - 1) * 20;
    const resultado = combined.slice(offsetDentroDeCombined, offsetDentroDeCombined + itemsPerPage);
    const resultadoFinal = await mezclarCustomPosters(resultado, getUserIdOpcional(req));

    res.json({ results: resultadoFinal });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener series por año" });
  }
});

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

// --- SERIES DEL AÑO (para el lobby de /series) ---
app.get('/tmdb/tv/year/:year', async (req, res) => {
  try {
    const { year } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/discover/tv?api_key=${apiKey}&language=${getLang(req)}&first_air_date_year=${year}&sort_by=popularity.desc&page=1`;
    const response = await fetch(url);
    const data = await response.json();
    const conIngles = await conCaratulasIngles(url, data.results || []);
    const resultado = await mezclarCustomPosters(conIngles, getUserIdOpcional(req));
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener series" });
  }
});

// --- SERIES MÁS POPULARES DE LA HISTORIA (por número de votos) ---
app.get('/tmdb/tv/popular-historico', async (req, res) => {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/discover/tv?api_key=${apiKey}&language=${getLang(req)}&sort_by=vote_count.desc&page=1`;
    const response = await fetch(url);
    const data = await response.json();
    const conIngles = await conCaratulasIngles(url, data.results || []);
    const resultado = await mezclarCustomPosters(conIngles, getUserIdOpcional(req));
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener las series populares históricas" });
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

// Ahora acepta un universeId forzado opcional: cuando una película
// pertenece a VARIOS universos a la vez (p. ej. "AVP: Alien vs. Predator"
// metida a mano tanto en "Aliens" como en "Predator"), antes se usaba
// findFirst y solo se mostraba el primero que la BD devolviera — el resto
// quedaba invisible. Con el universeId forzado, construirRespuestaUniversos
// (ver más abajo) puede pedir la respuesta de CADA universo por separado.
async function construirRespuestaUniverso(tmdbId, idioma, universeIdForzado) {
  let universeId = universeIdForzado;
  if (!universeId) {
    const itemExistente = await prisma.cinematicUniverseItem.findFirst({
      where: { tmdbId },
      select: { universeId: true },
    });
    if (!itemExistente) return null;
    universeId = itemExistente.universeId;
  }

  const universe = await prisma.cinematicUniverse.findUnique({
    where: { id: universeId },
    include: {
      items: { orderBy: { orden: 'asc' } },
      fases: { orderBy: { orden: 'asc' } },
    },
  });
  if (!universe) return null;

  // Los títulos se GUARDAN siempre en inglés a propósito al importar (igual
  // que las carátulas, para que las fases se vean consistentes entre sí sin
  // importar en qué idioma se sembró el universo) — pero al MOSTRARLOS sí
  // deben respetar tu idioma, como en el resto de la app. Se pide el título
  // real en tu idioma para cada item, sin tocar lo guardado en la base de
  // datos. Si tu idioma ya es inglés, nos ahorramos todas estas peticiones.
  let items = universe.items;
  if (idioma && !idioma.startsWith('en')) {
    const apiKey = process.env.TMDB_API_KEY;
    const traducidos = await Promise.all(
      items.map(async (item) => {
        try {
          const endpointTmdb = item.tipo === 'SERIE' ? 'tv' : 'movie';
          const r = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${item.tmdbId}?api_key=${apiKey}&language=${idioma}`);
          const d = await r.json();
          const tituloTraducido = d.title || d.name;
          if (tituloTraducido && tituloTraducido.trim()) {
            return { ...item, titulo: tituloTraducido };
          }
          return item;
        } catch (e) {
          return item; // si falla para uno solo, se queda con el título en inglés
        }
      })
    );
    items = traducidos;
  }

  const pestañasMap = new Map();
  for (const item of items) {
    if (!pestañasMap.has(item.pestaña)) pestañasMap.set(item.pestaña, []);
    pestañasMap.get(item.pestaña).push(item);
  }

  return {
    id: universe.id,
    nombre: universe.nombre,
    fases: universe.fases,
    pestañas: Array.from(pestañasMap.entries()).map(([nombre, items]) => ({ nombre, items })),
  };
}

// --- TODOS los universos a los que pertenece esta película/serie (no solo
// el primero). Devuelve un array, uno por cada CinematicUniverse distinto
// que tenga un item con este tmdbId. Vacío si no pertenece a ninguno. ---
async function construirRespuestaUniversos(tmdbId, idioma) {
  const itemsExistentes = await prisma.cinematicUniverseItem.findMany({
    where: { tmdbId },
    select: { universeId: true },
    distinct: ['universeId'],
  });
  if (itemsExistentes.length === 0) return [];

  const universos = await Promise.all(
    itemsExistentes.map((it) => construirRespuestaUniverso(tmdbId, idioma, it.universeId))
  );
  return universos.filter(Boolean);
}

// --- COLECCIONES DE PELÍCULAS/SERIES CURADAS A MANO ---

// Trae las partes en crudo de una Collection de TMDB, en el mismo formato
// que ya usa el resto del proyecto para sembrar CuratedMovieCollection.
async function calcularColeccionMovieDesdeTmdb(tmdbCollectionId, idioma) {
  const apiKey = process.env.TMDB_API_KEY;
  const r = await fetch(`https://api.themoviedb.org/3/collection/${tmdbCollectionId}?api_key=${apiKey}&language=${idioma || 'en-US'}`);
  const d = await r.json();
  if (!d.parts) return null;
  const items = d.parts
    .map((p) => ({
      tmdbId: p.id,
      tipo: 'PELICULA',
      titulo: p.title,
      anio: p.release_date ? new Date(p.release_date).getFullYear() : null,
      portada: p.poster_path ? `https://image.tmdb.org/t/p/w780${p.poster_path}` : null,
      fechaEstreno: p.release_date || null,
    }))
    .sort((a, b) => (a.fechaEstreno || '9999').localeCompare(b.fechaEstreno || '9999'));
  return { nombre: d.name || 'Collection', items };
}

// Construye la respuesta que consume el frontend a partir de lo guardado en
// CuratedMovieCollection/CuratedMovieCollectionItem — no vuelve a tocar TMDB
// para nada salvo prequel/sequel, que sigue calculándose por posición.
async function construirRespuestaMovieCollection(collectionId, tmdbIdActual, idioma) {
  const collection = await prisma.curatedMovieCollection.findUnique({
    where: { id: collectionId },
    include: { items: { orderBy: { orden: 'asc' } } },
  });
  if (!collection) return null;

  // El orden dentro de una saga es SIEMPRE cronológico por año, sin importar
  // si es película o serie.
  let items = [...collection.items].sort((a, b) => (a.anio ?? Infinity) - (b.anio ?? Infinity));
  let nombreMostrado = collection.nombre;

  // Los títulos se guardaron en el idioma que estuviera activo la PRIMERA
  // vez que se sembró esta saga, y nunca se actualizan solos. Para que
  // respeten tu idioma actual (como el resto de la app), se piden en vivo
  // los títulos reales en tu idioma, sin tocar lo guardado en la base de
  // datos. Se aplica siempre, no solo cuando el idioma pedido es distinto
  // de inglés — la saga pudo haberse guardado en cualquier idioma.
  if (idioma) {
    const apiKey = process.env.TMDB_API_KEY;
    items = await Promise.all(
      items.map(async (item) => {
        try {
          const endpointTmdb = item.tipo === 'SERIE' ? 'tv' : 'movie';
          const r = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${item.tmdbId}?api_key=${apiKey}&language=${idioma}`);
          const d = await r.json();
          const tituloTraducido = d.title || d.name;
          return tituloTraducido && tituloTraducido.trim() ? { ...item, titulo: tituloTraducido } : item;
        } catch (e) {
          return item; // si falla para uno solo, se queda con el título guardado
        }
      })
    );

    if (collection.tmdbCollectionId) {
      try {
        const rCol = await fetch(`https://api.themoviedb.org/3/collection/${collection.tmdbCollectionId}?api_key=${apiKey}&language=${idioma}`);
        const dCol = await rCol.json();
        if (dCol.name && dCol.name.trim()) nombreMostrado = dCol.name;
      } catch (e) {
        // si falla, se queda con el nombre guardado
      }
    }
  }

  const indiceActual = items.findIndex((it) => it.tmdbId === tmdbIdActual);
  const prequelItem = indiceActual > 0 ? items[indiceActual - 1] : null;
  const sequelItem = indiceActual >= 0 && indiceActual < items.length - 1 ? items[indiceActual + 1] : null;

  return {
    collection: { id: collection.id, nombre: nombreMostrado, tmdbCollectionId: collection.tmdbCollectionId },
    items: items.map((it) => ({
      id: it.id,
      tmdbId: it.tmdbId,
      tipo: it.tipo,
      titulo: it.titulo,
      anio: it.anio,
      portada: it.portada,
    })),
    prequel: prequelItem
      ? { id: prequelItem.id, tmdbId: prequelItem.tmdbId, tipo: prequelItem.tipo, titulo: prequelItem.titulo, anio: prequelItem.anio, portada: prequelItem.portada }
      : null,
    sequel: sequelItem
      ? { id: sequelItem.id, tmdbId: sequelItem.tmdbId, tipo: sequelItem.tipo, titulo: sequelItem.titulo, anio: sequelItem.anio, portada: sequelItem.portada }
      : null,
  };
}

// --- CREAR/OBTENER una CuratedMovieCollection para una Collection de TMDB
// concreta (películas) o para una serie suelta sin Collection real. Si ya
// existe, la devuelve tal cual (nunca la recalcula/sobrescribe). Si no
// existe y hay tmdbCollectionId, la siembra desde TMDB. Si no existe y es
// una serie suelta (sin Collection), la crea vacía con solo esa serie. ---
async function obtenerOCrearMovieCollection({ tmdbCollectionId, tmdbSeriesId, nombreSerie, idioma }) {
  if (tmdbCollectionId) {
    const existente = await prisma.curatedMovieCollection.findUnique({ where: { tmdbCollectionId } });
    if (existente) return existente;

    const calculada = await calcularColeccionMovieDesdeTmdb(tmdbCollectionId, idioma);
    if (!calculada) return null;

    return prisma.curatedMovieCollection.create({
      data: {
        tmdbCollectionId,
        nombre: calculada.nombre,
        items: {
          create: calculada.items.map((it, index) => ({
            tmdbId: it.tmdbId,
            tipo: it.tipo,
            titulo: it.titulo,
            anio: it.anio,
            portada: it.portada,
            orden: index,
          })),
        },
      },
    });
  }

  if (tmdbSeriesId) {
    const existente = await prisma.curatedMovieCollection.findUnique({ where: { tmdbSeriesId } });
    if (existente) return existente;

    const apiKey = process.env.TMDB_API_KEY;
    const r = await fetch(`https://api.themoviedb.org/3/tv/${tmdbSeriesId}?api_key=${apiKey}&language=${idioma || 'en-US'}`);
    const d = await r.json();

    return prisma.curatedMovieCollection.create({
      data: {
        tmdbSeriesId,
        nombre: nombreSerie || d.name || 'Collection',
        items: {
          create: [{
            tmdbId: tmdbSeriesId,
            tipo: 'SERIE',
            titulo: d.name || nombreSerie || '',
            anio: d.first_air_date ? new Date(d.first_air_date).getFullYear() : null,
            portada: d.poster_path ? `https://image.tmdb.org/t/p/w780${d.poster_path}` : null,
            orden: 0,
          }],
        },
      },
    });
  }

  return null;
}

// --- CREAR UNA SAGA NUEVA DESDE CERO, ANCLADA A ESTA PELÍCULA (sin
// Collection de TMDB) — para cuando quieres empezar a mano una saga que
// TMDB no reconoce como tal. ---
app.post('/admin/movie-collections', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { nombre, tmdbId, tipo, titulo, anio, portada } = req.body;
    if (!nombre || !nombre.trim() || !tmdbId || !titulo) {
      return res.status(400).json({ error: 'Faltan datos: nombre, tmdbId y titulo son obligatorios' });
    }

    const coleccion = await prisma.curatedMovieCollection.create({
      data: {
        nombre: nombre.trim(),
        items: {
          create: [{
            tmdbId: parseInt(tmdbId, 10),
            tipo: tipo === 'SERIE' ? 'SERIE' : 'PELICULA',
            titulo,
            anio: anio || null,
            portada: portada || null,
            orden: 0,
          }],
        },
      },
    });

    res.status(201).json(coleccion);
  } catch (error) {
    console.error('ERROR EN POST /admin/movie-collections:', error);
    res.status(500).json({ error: 'Error al crear la saga' });
  }
});

// --- AÑADIR MANUALMENTE una película/serie a una CuratedMovieCollection ---
app.post('/admin/movie-collections/:collectionId/items', requireAuth, requireAdmin, async (req, res) => {
  try {
    const collectionId = parseInt(req.params.collectionId, 10);
    const { tmdbId, tipo, titulo, anio, portada } = req.body;
    if (!tmdbId || !titulo) return res.status(400).json({ error: 'Faltan datos: tmdbId y titulo son obligatorios' });

    const coleccion = await prisma.curatedMovieCollection.findUnique({ where: { id: collectionId } });
    if (!coleccion) return res.status(404).json({ error: 'Colección no encontrada' });

    const totalActual = await prisma.curatedMovieCollectionItem.count({ where: { collectionId } });

    const item = await prisma.curatedMovieCollectionItem.create({
      data: {
        collectionId,
        tmdbId: parseInt(tmdbId, 10),
        tipo: tipo === 'SERIE' ? 'SERIE' : 'PELICULA',
        titulo,
        anio: anio || null,
        portada: portada || null,
        orden: totalActual,
      },
    });
    res.json(item);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Este título ya está en la colección' });
    }
    console.error('ERROR EN POST /admin/movie-collections/:collectionId/items:', error);
    res.status(500).json({ error: 'Error al añadir el título' });
  }
});

// --- QUITAR una película/serie de una CuratedMovieCollection ---
app.delete('/admin/movie-collections/items/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.curatedMovieCollectionItem.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json({ ok: true });
  } catch (error) {
    if (error.code === 'P2025') return res.json({ ok: true });
    console.error('ERROR EN DELETE /admin/movie-collections/items/:id:', error);
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// --- REORDENAR (arrastrar y soltar) dentro de una CuratedMovieCollection ---
app.patch('/admin/movie-collections/items/reorder', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'Falta el array de ids' });
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.curatedMovieCollectionItem.update({ where: { id: parseInt(id, 10) }, data: { orden: index } })
      )
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN PATCH /admin/movie-collections/items/reorder:', error);
    res.status(500).json({ error: 'Error al reordenar' });
  }
});

// --- REINICIAR una CuratedMovieCollection: borra lo editado a mano y la
// recalcula desde cero desde TMDB (solo tiene sentido si tiene
// tmdbCollectionId; una saga de serie suelta no tiene de dónde recalcular). ---
app.post('/admin/movie-collections/:collectionId/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const collectionId = parseInt(req.params.collectionId, 10);
    const coleccion = await prisma.curatedMovieCollection.findUnique({ where: { id: collectionId } });
    if (!coleccion) return res.status(404).json({ error: 'Colección no encontrada' });
    if (!coleccion.tmdbCollectionId) {
      return res.status(422).json({ error: 'Esta colección no tiene una Collection de TMDB de la que recalcular' });
    }

    const calculada = await calcularColeccionMovieDesdeTmdb(coleccion.tmdbCollectionId, getLang(req));
    if (!calculada) return res.status(422).json({ error: 'TMDB ya no reconoce esta colección' });

    await prisma.curatedMovieCollectionItem.deleteMany({ where: { collectionId } });
    await prisma.curatedMovieCollection.update({
      where: { id: collectionId },
      data: {
        nombre: calculada.nombre,
        items: {
          create: calculada.items.map((it, index) => ({
            tmdbId: it.tmdbId,
            tipo: it.tipo,
            titulo: it.titulo,
            anio: it.anio,
            portada: it.portada,
            orden: index,
          })),
        },
      },
    });

    res.json(await construirRespuestaMovieCollection(collectionId, req.body.tmdbIdActual || coleccion.tmdbCollectionId, getLang(req)));
  } catch (error) {
    console.error('ERROR EN POST /admin/movie-collections/:collectionId/reset:', error);
    res.status(500).json({ error: 'Error al reiniciar la colección' });
  }
});

app.get('/tmdb/collection/:tmdbId', async (req, res) => {
  try {
    const tmdbIdNum = parseInt(req.params.tmdbId, 10);
    const apiKey = process.env.TMDB_API_KEY;
    const idioma = getLang(req);

    const itemExistente = await prisma.curatedMovieCollectionItem.findFirst({
      where: { tmdbId: tmdbIdNum, tipo: 'PELICULA' },
      select: { collectionId: true },
    });

    let respuestaColeccion;
    if (itemExistente) {
      respuestaColeccion = await construirRespuestaMovieCollection(itemExistente.collectionId, tmdbIdNum, idioma);
    } else {
      const movieRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbIdNum}?api_key=${apiKey}&language=${idioma}`);
      const movieData = await movieRes.json();

      if (movieData.belongs_to_collection) {
        const coleccion = await obtenerOCrearMovieCollection({
          tmdbCollectionId: movieData.belongs_to_collection.id,
          idioma,
        });
        respuestaColeccion = coleccion ? await construirRespuestaMovieCollection(coleccion.id, tmdbIdNum, idioma) : null;
      } else {
        respuestaColeccion = null;
      }
    }

    const universos = await construirRespuestaUniversos(tmdbIdNum, idioma);
    const universo = universos[0] || null;

    if (!respuestaColeccion) {
      return res.json({ collection: null, items: [], prequel: null, sequel: null, universo, universos });
    }

    res.json({ ...respuestaColeccion, universo, universos });
  } catch (error) {
    console.error('Error al obtener la colección:', error);
    res.status(500).json({ error: 'Error al obtener colección' });
  }
});

// --- UNIVERSO DE UNA SERIE (las series no tienen "Collection" propia en
// TMDB como las películas, así que aquí solo comprobamos si esta serie ya
// pertenece a un universo guardado — el admin la añade a mano con
// "By series" o el buscador mixto dentro del propio universo) ---
app.get('/tmdb/tv/:tmdbId/universe', async (req, res) => {
  try {
    const tmdbIdNum = parseInt(req.params.tmdbId, 10);
    const idioma = getLang(req);

    // Las series no tienen "Collection" propia en TMDB (a diferencia de las
    // películas), así que no hay forma automática de detectar su saga — pero
    // SÍ puede haberse añadido a mano a una CuratedMovieCollection de
    // películas ya existente (p. ej. "El increíble Hulk - Colección"). Si es
    // así, la tratamos igual que a una película: se sirve como su propia
    // saga, sin pasar por el flujo de "Add to a Cinematic Universe".
    const itemExistente = await prisma.curatedMovieCollectionItem.findFirst({
      where: { tmdbId: tmdbIdNum, tipo: 'SERIE' },
      select: { collectionId: true },
    });

    let respuestaColeccion = null;
    if (itemExistente) {
      respuestaColeccion = await construirRespuestaMovieCollection(itemExistente.collectionId, tmdbIdNum, idioma);
    }

    const universos = await construirRespuestaUniversos(tmdbIdNum, idioma);
    const universo = universos[0] || null;

    if (!respuestaColeccion) {
      return res.json({ collection: null, items: [], prequel: null, sequel: null, universo, universos });
    }

    res.json({ ...respuestaColeccion, universo, universos });
  } catch (error) {
    console.error('Error al obtener el universo de la serie:', error);
    res.status(500).json({ error: 'Error al obtener universo' });
  }
});

// --- RUTA PARA DETALLES COMPLETOS: DURACIÓN, REPARTO, EQUIPO, ESTUDIO, PAÍS, PRESUPUESTO ---
app.get('/tmdb/details/:tmdbId', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    // ?tipo=SERIE viene del frontend cuando la ficha es de una serie; por
    // defecto PELICULA para no romper las llamadas existentes que aún no lo mandan.
    const esSerie = req.query.tipo === 'SERIE';
    const endpointTmdb = esSerie ? 'tv' : 'movie';
    const response = await fetch(
      `https://api.themoviedb.org/3/${endpointTmdb}/${tmdbId}?api_key=${apiKey}&language=${getLang(req)}&append_to_response=credits`
    );
    const data = await response.json();

    // El tagline no tiene el mismo comportamiento que overview: cuando TMDB no
    // tiene traducción, en vez de devolverlo vacío, cae directamente al inglés
    // sin avisar. Si nuestro idioma no es inglés, lo traducimos con MyMemory
    // (mismo traductor que ya usamos para sinopsis de juegos/series).
    const lang = getLang(req);
    let taglineFinal = data.tagline || null;
    if (taglineFinal && !lang.startsWith('en')) {
      taglineFinal = await traducirTexto(taglineFinal, lang);
    }

    // En pelis el director sale en credits.crew con job "Director". En
    // series TMDB no lo pone ahí — el creador va aparte, en created_by.
    const director = esSerie
      ? (data.created_by?.[0]
        ? { name: data.created_by[0].name, id: data.created_by[0].id, profile_path: data.created_by[0].profile_path }
        : null)
      : (data.credits?.crew?.find(p => p.job === 'Director') || null);
    const guionistas = data.credits?.crew?.filter(p => p.job === 'Screenplay' || p.job === 'Writer') || [];
    // Series no tienen "runtime" único, sino episode_run_time (array) o el
    // runtime de la última temporada. Cogemos el primero disponible.
    const runtimeSerie = data.episode_run_time?.[0] || data.last_episode_to_air?.runtime || null;

    res.json({
      runtime: esSerie ? runtimeSerie : (data.runtime || null),
      tagline: taglineFinal,
      fechaEstreno: data.release_date || data.first_air_date || null,
      numeroTemporadas: esSerie ? (data.number_of_seasons || null) : null,
      estadoSerie: esSerie ? (data.status || null) : null, // "Returning Series" | "Ended" | "Canceled"...
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

// TMDB no deja el campo "name" vacío cuando no hay traducción real: genera
// automáticamente un nombre "de relleno" en el idioma pedido (p.ej. "Episodio
// 3", "Temporada 1"). Esta función detecta esos rellenos (además de los
// vacíos de verdad) para saber cuándo hace falta ir a buscar el nombre/
// sinopsis real en otro idioma.
function esNombreGenerico(nombre, numero, tipo) {
  if (!nombre || !nombre.trim()) return true;
  const limpio = nombre.trim().toLowerCase();
  const patrones = tipo === 'temporada'
    ? [`temporada ${numero}`, `season ${numero}`]
    : [`episodio ${numero}`, `episode ${numero}`];
  return patrones.includes(limpio);
}

app.get('/tmdb/tv/:tmdbId/seasons', async (req, res) => {
  try {
    const { tmdbId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const idioma = getLang(req);

    const pedirTemporadas = async (lang) => {
      const url = lang
        ? `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}&language=${lang}`
        : `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}`; // sin language = TMDB devuelve el nombre original
      const r = await fetch(url);
      const d = await r.json();
      return d.seasons || [];
    };

    let seasons = await pedirTemporadas(idioma);

    // Si alguna temporada no tiene nombre en nuestro idioma (TMDB devuelve
    // "" cuando no hay traducción), rellenamos con inglés y, si tampoco,
    // con el nombre original de TMDB.
    const faltanNombres = seasons.some(s => !s.name || !s.name.trim());
    if (faltanNombres) {
      const seasonsEn = await pedirTemporadas('en-US');
      const seasonsOriginal = await pedirTemporadas(null);
      const nombreEnPorNumero = new Map(seasonsEn.map(s => [s.season_number, s.name]));
      const nombreOriginalPorNumero = new Map(seasonsOriginal.map(s => [s.season_number, s.name]));

      seasons = seasons.map(s => {
        if (s.name && s.name.trim()) return s;
        const nombreEn = nombreEnPorNumero.get(s.season_number);
        const nombreFallback = (nombreEn && nombreEn.trim()) ? nombreEn : nombreOriginalPorNumero.get(s.season_number);
        return { ...s, name: nombreFallback || s.name };
      });
    }

    const temporadas = seasons
      .filter(s => s.season_number > 0)
      .map(s => ({
        numero: s.season_number,
        nombre: s.name,
        episodios: s.episode_count,
        fechaEstreno: s.air_date,
        portada: s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : null
      }));
    res.json(temporadas);
  } catch (error) {
    console.error('ERROR EN GET /tmdb/tv/:tmdbId/seasons:', error);
    res.status(500).json({ error: 'Error al obtener temporadas' });
  }
});

app.get('/tmdb/tv/:tmdbId/season/:seasonNumber', async (req, res) => {
  try {
    const { tmdbId, seasonNumber } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const idioma = getLang(req);

    const pedirTemporada = async (lang) => {
      const url = lang
        ? `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${apiKey}&language=${lang}`
        : `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${apiKey}`; // sin language = original de TMDB
      const r = await fetch(url);
      return r.json();
    };

    const data = await pedirTemporada(idioma);
    const episodiosIdioma = data.episodes || [];

    // ¿Falta algo de verdad en nuestro idioma? (sinopsis vacía, nombre "de
    // relleno" de la temporada, o cualquier episodio sin título/sinopsis reales)
    const faltaTemporada = !data.overview?.trim() || esNombreGenerico(data.name, seasonNumber, 'temporada');
    const faltaEpisodio = episodiosIdioma.some(
      (e) => !e.overview?.trim() || esNombreGenerico(e.name, e.episode_number, 'episodio')
    );

    let dataEn = null;
    let dataOriginal = null;

    if (faltaTemporada || faltaEpisodio) {
      dataEn = await pedirTemporada('en-US');
      const episodiosEn = dataEn.episodes || [];

      const siguenFaltando = () => {
        const ft = !data.overview?.trim() && !dataEn.overview?.trim();
        const ftNombre = esNombreGenerico(data.name, seasonNumber, 'temporada') && esNombreGenerico(dataEn.name, seasonNumber, 'temporada');
        const fe = episodiosIdioma.some((e) => {
          const eEn = episodiosEn.find((x) => x.episode_number === e.episode_number);
          const hayOverview = e.overview?.trim() || eEn?.overview?.trim();
          const hayNombre = !esNombreGenerico(e.name, e.episode_number, 'episodio') || (eEn && !esNombreGenerico(eEn.name, e.episode_number, 'episodio'));
          return !hayOverview || !hayNombre;
        });
        return ft || ftNombre || fe;
      };

      if (siguenFaltando()) {
        dataOriginal = await pedirTemporada(null);
      }
    }

    const episodiosEnMap = new Map((dataEn?.episodes || []).map((e) => [e.episode_number, e]));
    const episodiosOriginalMap = new Map((dataOriginal?.episodes || []).map((e) => [e.episode_number, e]));

    const nombreTemporadaFinal = !esNombreGenerico(data.name, seasonNumber, 'temporada')
      ? data.name
      : (dataEn && !esNombreGenerico(dataEn.name, seasonNumber, 'temporada')
        ? dataEn.name
        : (dataOriginal?.name || data.name));

    // Sinopsis de temporada: si la nuestra existe, se queda tal cual (ya
    // está en nuestro idioma, no hace falta traducir nada). Si viene del
    // fallback de inglés/original, y nuestro idioma no es inglés, se
    // traduce con MyMemory antes de devolverla.
    let sinopsisTemporadaFinal = data.overview?.trim() || '';
    if (!sinopsisTemporadaFinal) {
      const candidata = dataEn?.overview?.trim() || dataOriginal?.overview || '';
      sinopsisTemporadaFinal = (candidata && !idioma.startsWith('en'))
        ? await traducirTexto(candidata, idioma)
        : candidata;
    }

    const episodiosFinal = await Promise.all(episodiosIdioma.map(async (e) => {
      const eEn = episodiosEnMap.get(e.episode_number);
      const eOriginal = episodiosOriginalMap.get(e.episode_number);

      const titulo = !esNombreGenerico(e.name, e.episode_number, 'episodio')
        ? e.name
        : (eEn && !esNombreGenerico(eEn.name, e.episode_number, 'episodio')
          ? eEn.name
          : (eOriginal?.name || e.name));

      // Mismo criterio que con la sinopsis de temporada: solo se traduce
      // cuando de verdad viene del fallback (no había sinopsis en nuestro
      // idioma) y nuestro idioma no es ya inglés.
      let sinopsis = e.overview?.trim() || '';
      if (!sinopsis) {
        const candidata = eEn?.overview?.trim() || eOriginal?.overview || '';
        sinopsis = (candidata && !idioma.startsWith('en'))
          ? await traducirTexto(candidata, idioma)
          : candidata;
      }

      return {
        numero: e.episode_number,
        titulo,
        sinopsis,
        fechaEmision: e.air_date,
        duracion: e.runtime || null,
        imagen: e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : null,
        notaMedia: e.vote_average ? Math.round(e.vote_average * 10) / 10 : null
      };
    }));

    res.json({
      nombre: nombreTemporadaFinal,
      sinopsis: sinopsisTemporadaFinal,
      fechaEstreno: data.air_date,
      portada: data.poster_path ? `https://image.tmdb.org/t/p/w300${data.poster_path}` : null,
      episodios: episodiosFinal
    });
  } catch (error) {
    console.error('ERROR EN GET /tmdb/tv/:tmdbId/season/:seasonNumber:', error);
    res.status(500).json({ error: 'Error al obtener la temporada' });
  }
});

// --- PÓSTERS ALTERNATIVOS DE UNA TEMPORADA (para el selector de carátula) ---
app.get('/tmdb/tv/:tmdbId/season/:seasonNumber/images', async (req, res) => {
  try {
    const { tmdbId, seasonNumber } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const response = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}/images?api_key=${apiKey}`);
    const data = await response.json();
    const posters = (data.posters || []).map(p => ({
      url: `https://image.tmdb.org/t/p/w780${p.file_path}`,
      idioma: p.iso_639_1
    }));
    res.json(posters);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener pósters de la temporada' });
  }
});

// --- MI ESTADO POR TEMPORADA DE UNA SERIE (todas de golpe, para pintar
// estrellas/ojo en la lista de temporadas sin una petición por cada una) ---
app.get('/media/:id/seasons/status', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const estados = await prisma.userSeasonWatch.findMany({
      where: { userId: req.userId, mediaId }
    });
    res.json(estados);
  } catch (error) {
    console.error('ERROR EN GET /media/:id/seasons/status:', error);
    res.status(500).json({ error: 'Error al obtener el estado de temporadas' });
  }
});

// --- MARCAR VISTA/NOTA UNA TEMPORADA ---
app.patch('/media/:id/seasons/:seasonNumber', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const seasonNumber = parseInt(req.params.seasonNumber);
    const { watched, rating, customPoster } = req.body;

    const data = {};
    if (typeof watched === 'boolean') {
      data.watched = watched;
      data.fechaVisto = watched ? new Date() : null;
    }
    if (rating !== undefined) data.rating = rating;
    if (customPoster !== undefined) data.customPoster = customPoster;

    const estado = await prisma.userSeasonWatch.upsert({
      where: { userId_mediaId_seasonNumber: { userId: req.userId, mediaId, seasonNumber } },
      update: data,
      create: { userId: req.userId, mediaId, seasonNumber, watched: watched ?? false, rating: rating ?? null, customPoster: customPoster ?? null, fechaVisto: watched ? new Date() : null }
    });
    res.json(estado);
  } catch (error) {
    console.error('ERROR EN PATCH /media/:id/seasons/:seasonNumber:', error);
    res.status(500).json({ error: 'Error al actualizar la temporada' });
  }
});

// --- MI ESTADO POR EPISODIO DE UNA TEMPORADA CONCRETA ---
app.get('/media/:id/seasons/:seasonNumber/episodes/status', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const seasonNumber = parseInt(req.params.seasonNumber);
    const estados = await prisma.userEpisodeWatch.findMany({
      where: { userId: req.userId, mediaId, seasonNumber }
    });
    res.json(estados);
  } catch (error) {
    console.error('ERROR EN GET /media/:id/seasons/:seasonNumber/episodes/status:', error);
    res.status(500).json({ error: 'Error al obtener el estado de episodios' });
  }
});

// --- MARCAR VISTO/NOTA UN EPISODIO ---
app.patch('/media/:id/seasons/:seasonNumber/episodes/:episodeNumber', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const seasonNumber = parseInt(req.params.seasonNumber);
    const episodeNumber = parseInt(req.params.episodeNumber);
    const { watched, rating } = req.body;

    const data = {};
    if (typeof watched === 'boolean') {
      data.watched = watched;
      data.fechaVisto = watched ? new Date() : null;
    }
    if (rating !== undefined) data.rating = rating;

    const estado = await prisma.userEpisodeWatch.upsert({
      where: { userId_mediaId_seasonNumber_episodeNumber: { userId: req.userId, mediaId, seasonNumber, episodeNumber } },
      update: data,
      create: { userId: req.userId, mediaId, seasonNumber, episodeNumber, watched: watched ?? false, rating: rating ?? null, fechaVisto: watched ? new Date() : null }
    });
    res.json(estado);
  } catch (error) {
    console.error('ERROR EN PATCH /media/:id/seasons/:seasonNumber/episodes/:episodeNumber:', error);
    res.status(500).json({ error: 'Error al actualizar el episodio' });
  }
});

// --- MARCAR/DESMARCAR TODOS LOS EPISODIOS DE UNA TEMPORADA DE GOLPE ---
// El total de episodios se manda desde el frontend (ya lo tiene, viene de
// GET /tmdb/tv/:tmdbId/seasons) para no tener que volver a pedirlo a TMDB
// solo para saber cuántos hay.
app.patch('/media/:id/seasons/:seasonNumber/mark-all', requireAuth, async (req, res) => {
  try {
    const mediaId = parseInt(req.params.id);
    const seasonNumber = parseInt(req.params.seasonNumber);
    const { watched, totalEpisodios } = req.body;
    const total = parseInt(totalEpisodios) || 0;
    if (total <= 0) return res.json({ ok: true });

    const fecha = watched ? new Date() : null;
    await Promise.all(
      Array.from({ length: total }, (_, i) => i + 1).map((episodeNumber) =>
        prisma.userEpisodeWatch.upsert({
          where: { userId_mediaId_seasonNumber_episodeNumber: { userId: req.userId, mediaId, seasonNumber, episodeNumber } },
          update: { watched, fechaVisto: fecha },
          create: { userId: req.userId, mediaId, seasonNumber, episodeNumber, watched, fechaVisto: fecha }
        })
      )
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN PATCH /media/:id/seasons/:seasonNumber/mark-all:', error);
    res.status(500).json({ error: 'Error al marcar los episodios' });
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
// --- FICHA DE UN ESTUDIO: nombre/logo + filmografía (películas Y series,
// paginada de 20 en 20 cada una como da TMDB por defecto) ---
// Antes solo pedía discover/movie — un estudio que hace sobre todo series
// (Pierrot, A-1 Pictures...) se quedaba con la filmografía vacía o incompleta.
app.get('/tmdb/company/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const apiKey = process.env.TMDB_API_KEY;
    const lang = getLang(req);
    const page = parseInt(req.query.page) || 1;

    const urlMovies = `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&language=${lang}&with_companies=${companyId}&sort_by=primary_release_date.desc&page=${page}`;
    const urlSeries = `https://api.themoviedb.org/3/discover/tv?api_key=${apiKey}&language=${lang}&with_companies=${companyId}&sort_by=first_air_date.desc&page=${page}`;

    const [resCompany, resMovies, resSeries] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/company/${companyId}?api_key=${apiKey}`),
      fetch(urlMovies),
      fetch(urlSeries),
    ]);
    const company = await resCompany.json();
    const movies = await resMovies.json();
    const series = await resSeries.json();

    if (!company || company.success === false) {
      return res.status(404).json({ error: 'Estudio no encontrado' });
    }

    const [peliculasEnIngles, seriesEnIngles] = await Promise.all([
      conCaratulasIngles(urlMovies, movies.results || []),
      conCaratulasIngles(urlSeries, series.results || []),
    ]);

    // Etiquetamos cada resultado con su tipo (movies no lo trae por defecto
    // como sí hace search/multi) para que el frontend sepa a qué ficha
    // enlazar, y mezclamos las dos listas por fecha de estreno, más
    // reciente primero.
    const peliculasConTipo = peliculasEnIngles.map((p) => ({ ...p, media_type: 'movie' }));
    const seriesConTipo = seriesEnIngles.map((s) => ({ ...s, media_type: 'tv' }));
    const fechaDe = (item) => item.release_date || item.first_air_date || '';
    const mezclado = [...peliculasConTipo, ...seriesConTipo].sort((a, b) => fechaDe(b).localeCompare(fechaDe(a)));

    const peliculas = await mezclarCustomPosters(mezclado, getUserIdOpcional(req));

    res.json({
      id: company.id,
      nombre: company.name,
      logo: company.logo_path ? `https://image.tmdb.org/t/p/w300${company.logo_path}` : null,
      pais: company.origin_country || null,
      page,
      // Total de páginas: nos quedamos con el mayor de los dos (así el
      // paginador no se corta antes de tiempo si una de las dos listas
      // tiene más páginas que la otra).
      totalPaginas: Math.min(Math.max(movies.total_pages || 1, series.total_pages || 1), 500),
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
    const endpointTmdb = req.query.tipo === 'SERIE' ? 'tv' : 'movie';

    const response = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${tmdbId}/watch/providers?api_key=${apiKey}`);
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
        const endpointTmdb = mediaItem.tipo === 'SERIE' ? 'tv' : 'movie';

        const pedirDetalle = async (langPedido) => {
          const url = langPedido
            ? `https://api.themoviedb.org/3/${endpointTmdb}/${mediaItem.tmdbId}?api_key=${apiKey}&language=${langPedido}`
            : `https://api.themoviedb.org/3/${endpointTmdb}/${mediaItem.tmdbId}?api_key=${apiKey}`; // sin language = original de TMDB
          const r = await fetch(url);
          return r.json();
        };

        const live = await pedirDetalle(lang);
        if (live && !live.status_code) {
          tituloMostrado = live.title || live.name || tituloMostrado;

          if (live.overview && live.overview.trim()) {
            sinopsisMostrada = live.overview;
          } else {
            // No hay sinopsis en nuestro idioma: caemos a inglés y, si tampoco,
            // al idioma original de TMDB — mismo criterio que ya usamos en las
            // temporadas/episodios. Si conseguimos una candidata y nuestro
            // idioma no es inglés, la traducimos con MyMemory antes de usarla.
            const liveEn = await pedirDetalle('en-US');
            let candidata = liveEn?.overview?.trim() || '';
            if (!candidata) {
              const liveOriginal = await pedirDetalle(null);
              candidata = liveOriginal?.overview?.trim() || '';
            }
            if (candidata) {
              sinopsisMostrada = lang.startsWith('en') ? candidata : await traducirTexto(candidata, lang);
            }
            // si no hay candidata en ningún idioma, se queda con lo que hubiera
            // guardado localmente (mediaItem.sinopsis), sin tocar nada
          }
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

// --- MIS NOTIFICACIONES (campana del navbar) ---
// Se resuelve aquí el username/avatar de quien la generó y el nombre de la
// lista (si aplica), en vez de pedírselo al frontend aparte por cada una.
app.get('/notifications', requireAuth, async (req, res) => {
  try {
    const notificaciones = await prisma.notification.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const actorIds = [...new Set(notificaciones.map((n) => n.actorId))];
    const actores = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, username: true, avatar: true },
    });
    const actorPorId = new Map(actores.map((a) => [a.id, a]));

    const listIds = notificaciones.filter((n) => n.listId).map((n) => n.listId);
    const listas = listIds.length > 0
      ? await prisma.list.findMany({ where: { id: { in: listIds } }, select: { id: true, nombre: true } })
      : [];
    const listaPorId = new Map(listas.map((l) => [l.id, l]));

    res.json(
      notificaciones.map((n) => ({
        id: n.id,
        tipo: n.tipo,
        leida: n.leida,
        fecha: n.createdAt,
        actor: actorPorId.get(n.actorId) || null,
        lista: n.listId ? listaPorId.get(n.listId) || null : null,
      }))
    );
  } catch (error) {
    console.error('ERROR EN GET /notifications:', error);
    res.status(500).json({ error: 'Error al obtener las notificaciones' });
  }
});

// --- CUÁNTAS SIN LEER (para el numerito rojo de la campana) ---
app.get('/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const count = await prisma.notification.count({ where: { userId: req.userId, leida: false } });
    res.json({ count });
  } catch (error) {
    console.error('ERROR EN GET /notifications/unread-count:', error);
    res.status(500).json({ error: 'Error al contar notificaciones' });
  }
});

// --- BORRAR UNA NOTIFICACIÓN CONCRETA ---
app.delete('/notifications/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const notificacion = await prisma.notification.findUnique({ where: { id } });
    // Solo puedes borrar tus propias notificaciones — nunca las de otro
    // usuario, aunque sepas el id.
    if (!notificacion || notificacion.userId !== req.userId) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }
    await prisma.notification.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE /notifications/:id:', error);
    res.status(500).json({ error: 'Error al borrar la notificación' });
  }
});

// --- BORRAR TODAS MIS NOTIFICACIONES DE GOLPE ---
app.delete('/notifications', requireAuth, async (req, res) => {
  try {
    await prisma.notification.deleteMany({ where: { userId: req.userId } });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE /notifications:', error);
    res.status(500).json({ error: 'Error al borrar las notificaciones' });
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

// --- CAMBIAR MI USERNAME ---
app.patch('/auth/me/username', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'El nombre de usuario no puede estar vacío' });
    }
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { username: username.trim() },
    });
    const { password: _, ...userSinPassword } = user;
    res.json(userSinPassword);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
    }
    console.error('ERROR EN PATCH /auth/me/username:', error);
    res.status(500).json({ error: 'Error al actualizar el nombre de usuario' });
  }
});

// --- CAMBIAR MI EMAIL Y/O CONTRASEÑA ---
// Exige la contraseña ACTUAL como confirmación, aunque solo se vaya a
// cambiar el email — evita que alguien con la sesión abierta (pero sin
// saber la contraseña real) pueda secuestrar la cuenta cambiando el email
// de recuperación.
app.patch('/auth/me/credentials', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newEmail, newPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: 'Introduce tu contraseña actual' });
    }
    if (!newEmail && !newPassword) {
      return res.status(400).json({ error: 'No hay nada que cambiar' });
    }
    if (newPassword && newPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    const passwordValida = await bcrypt.compare(currentPassword, user.password);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Tu contraseña actual no es correcta' });
    }

    const data = {};
    if (newEmail) data.email = newEmail.trim();
    if (newPassword) data.password = await bcrypt.hash(newPassword, 10);

    const actualizado = await prisma.user.update({ where: { id: req.userId }, data });
    const { password: _, ...userSinPassword } = actualizado;
    res.json(userSinPassword);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Ese email ya está en uso' });
    }
    console.error('ERROR EN PATCH /auth/me/credentials:', error);
    res.status(500).json({ error: 'Error al actualizar tus credenciales' });
  }
});

// --- REINICIAR MI CUENTA (solo admin): borra TODA la actividad guardada
// (visto/watchlist/likes/notas, logs, favoritos, listas, follows,
// notificaciones) pero conserva email, username, contraseña y avatar. ---
app.post('/auth/me/reset-account', requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.$transaction([
      prisma.gameLog.deleteMany({ where: { userId: req.userId } }),
      prisma.watchLog.deleteMany({ where: { userId: req.userId } }),
      prisma.userEpisodeWatch.deleteMany({ where: { userId: req.userId } }),
      prisma.userSeasonWatch.deleteMany({ where: { userId: req.userId } }),
      prisma.userMedia.deleteMany({ where: { userId: req.userId } }),
      prisma.favorite.deleteMany({ where: { userId: req.userId } }),
      prisma.listItem.deleteMany({ where: { list: { userId: req.userId } } }),
      prisma.listLike.deleteMany({ where: { userId: req.userId } }),
      prisma.list.deleteMany({ where: { userId: req.userId } }),
      prisma.follow.deleteMany({ where: { OR: [{ followerId: req.userId }, { followingId: req.userId }] } }),
      prisma.notification.deleteMany({ where: { userId: req.userId } }),
    ]);
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN POST /auth/me/reset-account:', error);
    res.status(500).json({ error: 'Error al reiniciar la cuenta' });
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
          ? `https://image.tmdb.org/t/p/w780${data.poster_path}`
          : null;
        const nuevoCustomBackdrop = personalizacion.customBackdrop && data.backdrop_path
          ? `https://image.tmdb.org/t/p/original${data.backdrop_path}`
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

// --- ACTIVAR/DESACTIVAR CUENTA PRIVADA ---
app.patch('/auth/me/privacy', requireAuth, async (req, res) => {
  try {
    const { isPrivate } = req.body;
    if (typeof isPrivate !== 'boolean') {
      return res.status(400).json({ error: 'isPrivate debe ser true o false' });
    }
    const user = await prisma.user.update({ where: { id: req.userId }, data: { isPrivate } });
    const { password: _, ...userSinPassword } = user;
    res.json(userSinPassword);
  } catch (error) {
    console.error('ERROR EN PATCH /auth/me/privacy:', error);
    res.status(500).json({ error: 'Error al actualizar la privacidad de la cuenta' });
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

    // Cuenta privada → queda PENDING hasta que él la acepte/rechace. Cuenta
    // pública → ACCEPTED al instante, como hasta ahora.
    const estadoInicial = destino.isPrivate ? 'PENDING' : 'ACCEPTED';

    await prisma.follow.create({
      data: { followerId: req.userId, followingId, estado: estadoInicial },
    });

    // Notificación para quien acaba de ser seguido (o para quien recibe la
    // SOLICITUD, si es privada) — dentro del mismo try/catch: si esto falla
    // por lo que sea, no debe tumbar el follow en sí (ya se ha guardado),
    // solo se pierde el aviso.
    await prisma.notification.create({
      data: {
        userId: followingId,
        tipo: estadoInicial === 'PENDING' ? 'FOLLOW_REQUEST' : 'FOLLOW',
        actorId: req.userId,
      },
    });

    res.status(201).json({ ok: true, pendiente: estadoInicial === 'PENDING' });
  } catch (error) {
    if (error.code === 'P2002') {
      // Ya existía la fila (seguido, o solicitud ya mandada antes) — no es
      // un error real, se confirma el estado actual tal cual está.
      const existente = await prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: req.userId, followingId: parseInt(req.params.id) } },
      });
      return res.json({ ok: true, pendiente: existente?.estado === 'PENDING' });
    }
    console.error('ERROR EN POST /users/:id/follow:', error);
    res.status(500).json({ error: 'Error al seguir al usuario' });
  }
});

// --- ACEPTAR UNA SOLICITUD DE SEGUIMIENTO (cuenta privada) ---
app.post('/follow-requests/:followerId/accept', requireAuth, async (req, res) => {
  try {
    const followerId = parseInt(req.params.followerId, 10);
    const solicitud = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId, followingId: req.userId } },
    });
    if (!solicitud || solicitud.estado !== 'PENDING') {
      return res.status(404).json({ error: 'Solicitud no encontrada' });
    }

    await prisma.follow.update({ where: { id: solicitud.id }, data: { estado: 'ACCEPTED' } });

    // Avisamos a quien la mandó de que ya puede ver tu contenido.
    await prisma.notification.create({
      data: { userId: followerId, tipo: 'FOLLOW_ACCEPTED', actorId: req.userId },
    });

    // Borramos la notificación de solicitud original que TÚ recibiste — si
    // no, al volver a abrir la campana seguía apareciendo con los botones
    // Accept/Decline, aunque ya la hubieras resuelto.
    await prisma.notification.deleteMany({
      where: { userId: req.userId, actorId: followerId, tipo: 'FOLLOW_REQUEST' },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN POST /follow-requests/:followerId/accept:', error);
    res.status(500).json({ error: 'Error al aceptar la solicitud' });
  }
});

// --- RECHAZAR UNA SOLICITUD DE SEGUIMIENTO ---
app.post('/follow-requests/:followerId/decline', requireAuth, async (req, res) => {
  try {
    const followerId = parseInt(req.params.followerId, 10);
    await prisma.follow.deleteMany({
      where: { followerId, followingId: req.userId, estado: 'PENDING' },
    });
    // Mismo motivo que en accept: borramos la notificación de solicitud
    // original para que no vuelva a aparecer como pendiente.
    await prisma.notification.deleteMany({
      where: { userId: req.userId, actorId: followerId, tipo: 'FOLLOW_REQUEST' },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN POST /follow-requests/:followerId/decline:', error);
    res.status(500).json({ error: 'Error al rechazar la solicitud' });
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
      select: { id: true, username: true, avatar: true, createdAt: true, isPrivate: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const miUserId = getUserIdOpcional(req);

    const [followersCount, followingCount, miFollow] = await Promise.all([
      prisma.follow.count({ where: { followingId: usuario.id, estado: 'ACCEPTED' } }),
      prisma.follow.count({ where: { followerId: usuario.id, estado: 'ACCEPTED' } }),
      miUserId
        ? prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: miUserId, followingId: usuario.id } },
        })
        : null,
    ]);

    const isSelf = miUserId === usuario.id;
    const isFollowing = miFollow?.estado === 'ACCEPTED';
    const isPending = miFollow?.estado === 'PENDING';
    const puedeVer = usuario.isPrivate ? isSelf || isFollowing : true;

    const datosBase = {
      id: usuario.id,
      username: usuario.username,
      avatar: usuario.avatar,
      miembroDesde: usuario.createdAt,
      followersCount,
      followingCount,
      isSelf,
      isFollowing: miUserId ? isFollowing : null,
      isPending: miUserId ? isPending : null,
      isPrivate: usuario.isPrivate,
    };

    // Cuenta privada y no tienes acceso: ni se consulta el catálogo — se
    // corta aquí mismo, devolviendo solo lo básico (avatar, nombre,
    // contadores, botón de seguir) para que el frontend muestre el aviso de
    // "cuenta privada" en vez del contenido.
    if (!puedeVer) {
      return res.json({ ...datosBase, favoritos: [], actividad: [], jugandoAhora: [] });
    }

    const [favs, vistas, jugandoAhoraEntries] = await Promise.all([
      prisma.favorite.findMany({ where: { userId: usuario.id }, orderBy: { orden: 'asc' } }),
      prisma.userMedia.findMany({
        where: { userId: usuario.id, watched: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      // "Currently Playing": juegos donde el propio dueño del perfil ha
      // puesto el desplegable "Set your played status" en Playing.
      prisma.userMedia.findMany({
        where: { userId: usuario.id, playStatus: { in: ['PLAYING', 'WATCHING'] } },
        orderBy: { updatedAt: 'desc' },
      }),
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

    res.json({ ...datosBase, favoritos, actividad, jugandoAhora });
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
      select: { id: true, isPrivate: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const puedeVer = await puedeVerContenidoPrivado(usuario, getUserIdOpcional(req));
    if (!puedeVer) return res.status(403).json({ error: 'Este perfil es privado', isPrivate: true });

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
    if (liked !== undefined) data.liked = liked;
    if (watchlist !== undefined) data.watchlist = watchlist;
    if (rating !== undefined) data.rating = rating;
    if (rating !== undefined && rating !== null) data.watched = true;
    if (customPoster !== undefined) data.customPoster = customPoster;
    // playStatus: en juegos es Playing/Completed/Retired/Shelved/Abandoned;
    // en series es Watching/Paused/Abandoned. Al elegir un estado, marcamos
    // watched = true automáticamente; al pulsar "Mark as unplayed/unwatched"
    // el frontend manda playStatus = null, y aquí lo traducimos también a
    // watched = false.
    if (playStatus !== undefined) {
      data.playStatus = playStatus;
      data.watched = playStatus !== null;
    }
    // "watched" explícito SIEMPRE pisa lo que playStatus haya derivado justo
    // arriba — hace falta para el caso "Watched" de series, que manda
    // {watched:true, playStatus:null} A LA VEZ (sin esto, el bloque de
    // arriba dejaría watched en false por llevar playStatus:null).
    if (watched !== undefined) data.watched = watched;

    // lastActivityAt es lo que ordena Watched/Watchlist/Currently Playing.
    // Solo se toca cuando pasa algo que de verdad cuenta como actividad —
    // NO cuando solo cambias customPoster/customBackdrop (eso usaría
    // updatedAt igualmente, pero ya no se usa updatedAt para ordenar).
    const camposDeActividadReal = ['watched', 'liked', 'watchlist', 'rating', 'playStatus'];
    const hayActividadReal = camposDeActividadReal.some((campo) => req.body[campo] !== undefined);
    if (hayActividadReal) data.lastActivityAt = new Date();

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
    const media = await prisma.media.findUnique({ where: { id: mediaId }, select: { tmdbId: true, igdbId: true, tipo: true } });

    if (media?.tmdbId) {
      try {
        const apiKey = process.env.TMDB_API_KEY;
        // OJO: esto siempre pedía a /movie/, aunque fuera una serie — con un
        // tmdbId de serie eso da 404 en TMDB, así que vote_average/vote_count
        // salían vacíos y la serie se quedaba sin nota externa con la que
        // ponderar tu voto. Resultado: series sin nota mostrada, y al votar
        // una, tu voto solo contaba consigo mismo (sin los miles de votos
        // reales de TMDB detrás), haciendo que la media saltara mucho más
        // que en una película con el mismo voto tuyo.
        const endpointTmdb = media.tipo === 'SERIE' ? 'tv' : 'movie';
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/${endpointTmdb}/${media.tmdbId}?api_key=${apiKey}`);
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

    // Sin esto, la miniatura de "My Lists" siempre mostraba la carátula
    // compartida, aunque tú hubieras elegido otra a mano con "Cambiar
    // carátula" — que sí se veía correctamente al entrar DENTRO de la lista
    // (MovieCard la aplica por su cuenta). Ahora las dos vistas coinciden.
    const misPersonalizaciones = await prisma.userMedia.findMany({
      where: { userId: req.userId, mediaId: { in: todosMediaIds } },
      select: { mediaId: true, customPoster: true },
    });
    const customPosterPorMediaId = new Map(misPersonalizaciones.filter((p) => p.customPoster).map((p) => [p.mediaId, p.customPoster]));

    res.json(lists.map(l => {
      const portadas = l.items
        .slice(0, 6)
        .map(i => customPosterPorMediaId.get(i.mediaId) || mediaItems.find(m => m.id === i.mediaId)?.portada)
        .filter(Boolean);

      return {
        id: l.id,
        nombre: l.nombre,
        createdAt: l.createdAt,
        totalItems: l.items.length,
        portadas,
        privada: l.privada,
        contieneMedia: mediaId ? l.items.some(i => i.mediaId === mediaId) : undefined
      };
    }));
  } catch (error) {
    console.error('ERROR EN GET LISTS:', error);
    res.status(500).json({ error: 'Error al obtener las listas' });
  }
});

// --- LISTAS DE UN USUARIO (público, sin sesión) ---
// Mismo cálculo de portadas/totalItems que GET /lists, pero para el
// username de la URL en vez de req.userId, y sin exigir sesión.
app.get('/users/:username/lists', async (req, res) => {
  try {
    const username = req.params.username;
    const usuario = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true, isPrivate: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const puedeVer = await puedeVerContenidoPrivado(usuario, getUserIdOpcional(req));
    if (!puedeVer) return res.status(403).json({ error: 'Este perfil es privado', isPrivate: true });

    const miUserId = getUserIdOpcional(req);
    const lists = await prisma.list.findMany({
      where: {
        userId: usuario.id,
        // Las listas privadas (privada=true) solo las ve el propio dueño —
        // esto es aparte de la privacidad de la CUENTA (isPrivate): una
        // cuenta pública puede igualmente tener listas sueltas marcadas
        // como privadas.
        ...(miUserId === usuario.id ? {} : { privada: false }),
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });

    const todosMediaIds = [...new Set(lists.flatMap((l) => l.items.map((i) => i.mediaId)))];
    const mediaItems = await prisma.media.findMany({ where: { id: { in: todosMediaIds } } });

    // Aquí "req.userId" no existe (ruta pública) — se usa el customPoster
    // del DUEÑO de la lista (usuario.id), para que cualquiera que la mire
    // vea exactamente la carátula que ese usuario eligió, no la compartida.
    const personalizacionesDueno = await prisma.userMedia.findMany({
      where: { userId: usuario.id, mediaId: { in: todosMediaIds } },
      select: { mediaId: true, customPoster: true },
    });
    const customPosterPorMediaId = new Map(personalizacionesDueno.filter((p) => p.customPoster).map((p) => [p.mediaId, p.customPoster]));

    res.json(
      lists.map((l) => {
        const portadas = l.items
          .slice(0, 6)
          .map((i) => customPosterPorMediaId.get(i.mediaId) || mediaItems.find((m) => m.id === i.mediaId)?.portada)
          .filter(Boolean);

        return {
          id: l.id,
          nombre: l.nombre,
          createdAt: l.createdAt,
          totalItems: l.items.length,
          portadas,
          privada: l.privada,
        };
      })
    );
  } catch (error) {
    console.error('ERROR EN GET /users/:username/lists:', error);
    res.status(500).json({ error: 'Error al obtener las listas del usuario' });
  }
});

// --- FICHA PÚBLICA DE UNA LISTA CONCRETA (sin sesión) ---
// Se comprueba que la lista sea DE ESE username (no basta con que el id
// exista) — evita que /user/otro/lists/5 muestre una lista de un tercero
// solo porque el id coincide.
app.get('/users/:username/lists/:listId', async (req, res) => {
  try {
    const username = req.params.username;
    const listId = parseInt(req.params.listId, 10);

    const usuario = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true, username: true, isPrivate: true },
    });
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const puedeVer = await puedeVerContenidoPrivado(usuario, getUserIdOpcional(req));
    if (!puedeVer) return res.status(403).json({ error: 'Este perfil es privado', isPrivate: true });

    const list = await prisma.list.findUnique({ where: { id: listId }, include: { items: true } });
    if (!list || list.userId !== usuario.id) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }

    const miUserId = getUserIdOpcional(req);
    // Lista marcada como privada (aparte de la privacidad de la cuenta): solo el dueño.
    if (list.privada && miUserId !== usuario.id) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }

    const mediaIds = list.items.map((i) => i.mediaId);
    const mediaItemsRaw = await prisma.media.findMany({ where: { id: { in: mediaIds } } });

    // Se injerta el customPoster del DUEÑO de la lista directamente en cada
    // item — así el frontend puede pasárselo a MovieCard sin que este tenga
    // que ir a buscarlo por su cuenta (lo cual, en una ficha pública, habría
    // acabado trayendo la personalización de quien MIRA la lista, no la del
    // dueño, si ambos hubieran marcado el mismo título alguna vez).
    const personalizacionesDueno = await prisma.userMedia.findMany({
      where: { userId: usuario.id, mediaId: { in: mediaIds } },
      select: { mediaId: true, customPoster: true },
    });
    const customPosterPorMediaId = new Map(personalizacionesDueno.filter((p) => p.customPoster).map((p) => [p.mediaId, p.customPoster]));

    const mediaPorId = new Map(mediaItemsRaw.map((m) => [m.id, m]));
    const itemsConMedia = list.items.map((li) => ({ ...li, media: mediaPorId.get(li.mediaId) })).filter((li) => li.media);
    const ordenados = await ordenarItemsDeLista(itemsConMedia, list.ordenPor, list.ordenDireccion, usuario.id);

    const mediaItems = ordenados.map((li) => ({
      ...li.media,
      portada: customPosterPorMediaId.get(li.mediaId) || li.media.portada,
    }));

    const likesCount = await prisma.listLike.count({ where: { listId } });

    const yaLeDiLike = miUserId
      ? await prisma.listLike.findUnique({ where: { userId_listId: { userId: miUserId, listId } } })
      : null;

    res.json({
      id: list.id,
      nombre: list.nombre,
      modo: list.modo,
      items: mediaItems,
      autor: usuario.username,
      likesCount,
      isLiked: miUserId ? !!yaLeDiLike : null,
    });
  } catch (error) {
    console.error('ERROR EN GET /users/:username/lists/:listId:', error);
    res.status(500).json({ error: 'Error al obtener la lista' });
  }
});

// --- DAR/QUITAR "ME GUSTA" A UNA LISTA AJENA ---
app.post('/lists/:listId/like', requireAuth, async (req, res) => {
  try {
    const listId = parseInt(req.params.listId, 10);
    const list = await prisma.list.findUnique({ where: { id: listId } });
    if (!list) return res.status(404).json({ error: 'Lista no encontrada' });

    await prisma.listLike.create({ data: { userId: req.userId, listId } });

    // Sin notificarte a ti mismo si por lo que sea le das like a tu propia lista.
    if (list.userId !== req.userId) {
      await prisma.notification.create({
        data: { userId: list.userId, tipo: 'LIST_LIKE', actorId: req.userId, listId },
      });
    }

    res.status(201).json({ ok: true });
  } catch (error) {
    if (error.code === 'P2002') {
      // Ya le habías dado al corazón — no es un error real.
      return res.json({ ok: true });
    }
    console.error('ERROR EN POST /lists/:listId/like:', error);
    res.status(500).json({ error: 'Error al dar like a la lista' });
  }
});

app.delete('/lists/:listId/like', requireAuth, async (req, res) => {
  try {
    const listId = parseInt(req.params.listId, 10);
    await prisma.listLike.deleteMany({ where: { userId: req.userId, listId } });
    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN DELETE /lists/:listId/like:', error);
    res.status(500).json({ error: 'Error al quitar el like de la lista' });
  }
});

// --- LISTAS AJENAS QUE HE MARCADO CON CORAZÓN (para el apartado nuevo de "My Lists") ---
app.get('/lists/liked', requireAuth, async (req, res) => {
  try {
    const likes = await prisma.listLike.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        list: {
          include: {
            items: true,
            // No hay relación directa List -> User en el schema (solo
            // userId suelto), así que el nombre del dueño se resuelve
            // aparte más abajo, no aquí.
          },
        },
      },
    });

    const ownerIds = [...new Set(likes.map((l) => l.list.userId))];
    const owners = await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, username: true } });
    const ownerPorId = new Map(owners.map((o) => [o.id, o.username]));

    const todosMediaIds = [...new Set(likes.flatMap((l) => l.list.items.map((i) => i.mediaId)))];
    const mediaItems = await prisma.media.findMany({ where: { id: { in: todosMediaIds } } });

    // Cada lista con like puede ser de un dueño distinto, así que se piden
    // TODAS las personalizaciones de golpe (de todos los dueños implicados,
    // no las tuyas) y se filtran por userId+mediaId al construir cada una.
    const personalizacionesDuenos = await prisma.userMedia.findMany({
      where: { userId: { in: ownerIds }, mediaId: { in: todosMediaIds } },
      select: { userId: true, mediaId: true, customPoster: true },
    });
    const customPosterPorClave = new Map(
      personalizacionesDuenos.filter((p) => p.customPoster).map((p) => [`${p.userId}-${p.mediaId}`, p.customPoster])
    );

    res.json(
      likes.map((l) => {
        const portadas = l.list.items
          .slice(0, 6)
          .map(
            (i) =>
              customPosterPorClave.get(`${l.list.userId}-${i.mediaId}`) ||
              mediaItems.find((m) => m.id === i.mediaId)?.portada
          )
          .filter(Boolean);

        return {
          id: l.list.id,
          nombre: l.list.nombre,
          totalItems: l.list.items.length,
          portadas,
          autor: ownerPorId.get(l.list.userId) || null,
        };
      })
    );
  } catch (error) {
    console.error('ERROR EN GET /lists/liked:', error);
    res.status(500).json({ error: 'Error al obtener las listas con like' });
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
    const mediaItemsRaw = await prisma.media.findMany({ where: { id: { in: mediaIds } } });

    const misPersonalizaciones = await prisma.userMedia.findMany({
      where: { userId: req.userId, mediaId: { in: mediaIds } },
      select: { mediaId: true, customPoster: true },
    });
    const customPosterPorMediaId = new Map(misPersonalizaciones.filter((p) => p.customPoster).map((p) => [p.mediaId, p.customPoster]));

    const mediaPorId = new Map(mediaItemsRaw.map((m) => [m.id, m]));
    const itemsConMedia = list.items.map((li) => ({ ...li, media: mediaPorId.get(li.mediaId) })).filter((li) => li.media);

    const ordenados = await ordenarItemsDeLista(itemsConMedia, list.ordenPor, list.ordenDireccion, req.userId);

    const items = ordenados.map((li) => ({
      ...li.media,
      portada: customPosterPorMediaId.get(li.mediaId) || li.media.portada,
      listItemId: li.id, // hace falta para el drag-and-drop (reordenar por ListItem, no por Media)
      orden: li.orden,
    }));

    res.json({
      id: list.id,
      nombre: list.nombre,
      privada: list.privada,
      modo: list.modo,
      ordenPor: list.ordenPor,
      ordenDireccion: list.ordenDireccion,
      items,
    });
  } catch (error) {
    console.error('ERROR EN GET LIST:', error);
    res.status(500).json({ error: 'Error al obtener la lista' });
  }
});

// --- EDITAR LOS METADATOS DE UNA LISTA (título, privacidad, modo, orden por defecto) ---
app.patch('/lists/:id', requireAuth, async (req, res) => {
  try {
    const listId = parseInt(req.params.id);
    const list = await prisma.list.findUnique({ where: { id: listId } });
    if (!list || list.userId !== req.userId) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }

    const { nombre, privada, modo, ordenPor, ordenDireccion } = req.body;
    const data = {};
    if (nombre !== undefined) {
      if (!nombre.trim()) return res.status(400).json({ error: 'El nombre de la lista es obligatorio' });
      data.nombre = nombre.trim();
    }
    if (privada !== undefined) data.privada = !!privada;
    if (modo !== undefined) {
      if (!['RANKED', 'GRID'].includes(modo)) return res.status(400).json({ error: 'modo inválido' });
      data.modo = modo;
    }
    if (ordenPor !== undefined) {
      if (!['MANUAL', 'NOMBRE', 'FECHA', 'NOTA_MEDIA', 'MI_NOTA'].includes(ordenPor)) {
        return res.status(400).json({ error: 'ordenPor inválido' });
      }
      data.ordenPor = ordenPor;
    }
    if (ordenDireccion !== undefined) {
      if (!['ASC', 'DESC'].includes(ordenDireccion)) return res.status(400).json({ error: 'ordenDireccion inválido' });
      data.ordenDireccion = ordenDireccion;
    }

    const actualizada = await prisma.list.update({ where: { id: listId }, data });
    res.json(actualizada);
  } catch (error) {
    console.error('ERROR EN PATCH /lists/:id:', error);
    res.status(500).json({ error: 'Error al actualizar la lista' });
  }
});

// --- REORDENAR A MANO LOS ITEMS DE UNA LISTA (arrastrar y soltar) ---
// Mismo patrón que /admin/curated-collection-items/reorder: recibe los
// listItemId YA en el orden final y pone orden = posición en esa lista.
// También pone ordenPor = "MANUAL" de paso — si estabas viendo la lista
// ordenada por nota y arrastras un ítem, lo lógico es que a partir de ahí
// se quede en el orden manual que acabas de dejar, no que "vuelva" a
// ordenarse por nota en el siguiente refresco.
app.patch('/lists/:id/reorder', requireAuth, async (req, res) => {
  try {
    const listId = parseInt(req.params.id);
    const list = await prisma.list.findUnique({ where: { id: listId } });
    if (!list || list.userId !== req.userId) {
      return res.status(404).json({ error: 'Lista no encontrada' });
    }

    const { listItemIds } = req.body;
    if (!Array.isArray(listItemIds) || listItemIds.length === 0) {
      return res.status(400).json({ error: 'Falta la lista de listItemIds en el nuevo orden' });
    }

    await prisma.$transaction([
      ...listItemIds.map((id, index) =>
        prisma.listItem.update({ where: { id: parseInt(id, 10) }, data: { orden: index } })
      ),
      prisma.list.update({ where: { id: listId }, data: { ordenPor: 'MANUAL' } }),
    ]);

    res.json({ ok: true });
  } catch (error) {
    console.error('ERROR EN PATCH /lists/:id/reorder:', error);
    res.status(500).json({ error: 'Error al reordenar la lista' });
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

    // El nuevo item se añade al final del orden manual, no siempre a 0 —
    // así "Add a game" no desordena lo que ya tenías arrastrado a mano.
    const totalActual = await prisma.listItem.count({ where: { listId } });

    const item = await prisma.listItem.create({
      data: { listId, mediaId, orden: totalActual }
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