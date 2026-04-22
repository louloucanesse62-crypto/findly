const express = require('express');
const axios = require('axios');
const app = express();

const FREESOUND_KEY = process.env.FREESOUND_KEY || 'XXKUSm9PnHr1YnIWlvGHXJFt5Pj2TmHVMCUEbusS';
const PEXELS_KEY = process.env.PEXELS_KEY || 'KMlGrx95uM9TE4rewp2UfEGwwzmsI9GrRdNFSu44GLU4MFD9yxylCqKL';
const GIPHY_KEY = process.env.GIPHY_KEY || 'cNmyQnqOR8zcEYwcKjoMkdiLb9EOzacj';
const GROQ_KEY = process.env.GROQ_KEY || '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';

const VALID_CODES = ['FINDLY-ALPHA', 'FINDLY-BETA', 'FINDLY-GAMMA', 'FINDLY-DELTA', 'FINDLY-EPSILON', 'FINDLY-ZETA', 'FINDLY-ETA', 'FINDLY-THETA', 'FINDLY-IOTA', 'FINDLY-KAPPA'];

const usedIPs = new Set();
const premiumIPs = new Set();

app.use(express.json());
app.use(express.static('public'));

function getIP(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

async function reformulerRecherche(query) {
  try {
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: 'Tu es un expert en recherche de ressources audio et vidéo. Quand on te donne une recherche en français, tu dois la reformuler en 3-5 mots-clés anglais pertinents pour trouver des sons, vidéos ou GIFs correspondants sur des banques de médias. Réponds UNIQUEMENT avec les mots-clés séparés par des espaces, rien d\'autre.'
        },
        {
          role: 'user',
          content: query
        }
      ],
      max_tokens: 50
    }, {
      headers: {
        'Authorization': 'Bearer ' + GROQ_KEY,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].message.content.trim();
  } catch (e) {
    console.log('Erreur Groq:', e.message);
    return query;
  }
}

app.get('/status', function(req, res) {
  const ip = getIP(req);
  res.json({
    isPremium: premiumIPs.has(ip),
    hasSearched: usedIPs.has(ip)
  });
});

app.get('/preview', async function(req, res) {
  try {
    const [soundsRes, videosRes, gifsRes] = await Promise.all([
      axios.get('https://freesound.org/apiv2/search/text/?query=music&fields=id,name,previews&page_size=3&token=' + FREESOUND_KEY),
      axios.get('https://api.pexels.com/videos/search?query=nature&per_page=3', {
        headers: { 'Authorization': PEXELS_KEY }
      }),
      axios.get('https://api.giphy.com/v1/gifs/trending?api_key=' + GIPHY_KEY + '&limit=3&rating=g')
    ]);
    res.json({
      sounds: soundsRes.data.results || [],
      videos: videosRes.data.videos || [],
      gifs: gifsRes.data.data || []
    });
  } catch (error) {
    res.json({ sounds: [], videos: [], gifs: [] });
  }
});

app.get('/search', async function(req, res) {
  const query = req.query.q;
  const ip = getIP(req);
  const isPremium = premiumIPs.has(ip);
  const limit = isPremium ? 50 : 3;

  if (!query) return res.json({ error: 'Pas de recherche' });

  if (!isPremium && usedIPs.has(ip)) {
    return res.json({ blocked: true });
  }

  if (!isPremium) {
    usedIPs.add(ip);
  }

  const queryEN = await reformulerRecherche(query);
  console.log('Recherche:', query, '→', queryEN);

  try {
    const [soundsRes, videosRes, gifsRes] = await Promise.all([
      axios.get('https://freesound.org/apiv2/search/text/?query=' + encodeURIComponent(queryEN) + '&fields=id,name,previews,duration&page_size=' + limit + '&token=' + FREESOUND_KEY),
      axios.get('https://api.pexels.com/videos/search?query=' + encodeURIComponent(queryEN) + '&per_page=' + Math.min(limit, 80), {
        headers: { 'Authorization': PEXELS_KEY }
      }),
      axios.get('https://api.giphy.com/v1/gifs/search?api_key=' + GIPHY_KEY + '&q=' + encodeURIComponent(queryEN) + '&limit=' + Math.min(limit, 50) + '&rating=g')
    ]);

    res.json({
      query: query,
      queryEN: queryEN,
      sounds: soundsRes.data.results || [],
      videos: videosRes.data.videos || [],
      gifs: gifsRes.data.data || []
    });
  } catch (error) {
    console.log('Erreur search:', error.message);
    res.json({ error: error.message });
  }
});

app.get('/sfx', async function(req, res) {
  const type = req.query.type || 'transition';
  const ip = getIP(req);

  if (!premiumIPs.has(ip)) {
    return res.json({ blocked: true });
  }

  const sfxQueries = {
    transition: 'whoosh swoosh transition swipe',
    impact: 'impact hit punch boom',
    explosion: 'explosion blast boom fire',
    ui: 'click button interface notification beep',
    nature: 'wind rain thunder water ambient',
    scary: 'horror scary creepy dark atmosphere',
    funny: 'cartoon comedy funny boing',
    cinematic: 'cinematic dramatic tension suspense'
  };

  const query = sfxQueries[type] || type;

  try {
    const response = await axios.get('https://freesound.org/apiv2/search/text/?query=' + encodeURIComponent(query) + '&fields=id,name,previews,duration&page_size=50&token=' + FREESOUND_KEY);
    res.json({ sounds: response.data.results || [] });
  } catch (error) {
    res.json({ error: error.message });
  }
});

app.post('/verify-code', function(req, res) {
  const code = req.body.code;
  const ip = getIP(req);
  if (VALID_CODES.includes(code)) {
    premiumIPs.add(ip);
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Serveur lance sur port ' + PORT);
});
