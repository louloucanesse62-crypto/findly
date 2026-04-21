const express = require('express');
const axios = require('axios');
const app = express();

// 🔐 Clés sécurisées (NE PLUS METTRE EN DUR)
const FREESOUND_KEY = process.env.FREESOUND_KEY;
const PEXELS_KEY = process.env.PEXELS_KEY;
const GIPHY_KEY = process.env.GIPHY_KEY;
const GROQ_KEY = process.env.GROQ_KEY;

// 🎟️ Codes premium
const VALID_CODES = ['FINDLY-ALPHA', 'FINDLY-BETA', 'FINDLY-GAMMA', 'FINDLY-DELTA'];

// 📊 Tracking simple
const usedIPs = new Set();
const premiumIPs = new Set();

app.use(express.json());
app.use(express.static('public'));

// 🔍 Récup IP
function getIP(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

// 🤖 Reformulation IA
async function reformulerRecherche(query) {
  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content:
              "Tu es un expert en recherche. Transforme une phrase française en 3-5 mots-clés anglais. Réponds UNIQUEMENT avec les mots."
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 50
      },
      {
        headers: {
          Authorization: 'Bearer ' + GROQ_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (e) {
    console.log('Erreur Groq:', e.message);
    return query;
  }
}

// 📊 Status utilisateur
app.get('/status', (req, res) => {
  const ip = getIP(req);
  res.json({
    isPremium: premiumIPs.has(ip),
    hasSearched: usedIPs.has(ip)
  });
});

// 🔎 Recherche principale
app.get('/search', async (req, res) => {
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
      axios.get(
        `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(queryEN)}&fields=id,name,previews,duration&page_size=${limit}&token=${FREESOUND_KEY}`
      ),
      axios.get(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(queryEN)}&per_page=${Math.min(limit, 80)}`,
        {
          headers: { Authorization: PEXELS_KEY }
        }
      ),
      axios.get(
        `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(queryEN)}&limit=${Math.min(limit, 50)}&rating=g`
      )
    ]);

    res.json({
      query,
      queryEN,
      sounds: soundsRes.data.results || [],
      videos: videosRes.data.videos || [],
      gifs: gifsRes.data.data || []
    });
  } catch (error) {
    console.log('Erreur search:', error.message);
    res.json({ error: error.message });
  }
});

// 🔊 SFX premium
app.get('/sfx', async (req, res) => {
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
    const response = await axios.get(
      `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(query)}&fields=id,name,previews,duration&page_size=50&token=${FREESOUND_KEY}`
    );

    res.json({ sounds: response.data.results || [] });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// 🔑 Vérification code premium
app.post('/verify-code', (req, res) => {
  const code = req.body.code;
  const ip = getIP(req);

  if (VALID_CODES.includes(code)) {
    premiumIPs.add(ip);
    return res.json({ valid: true });
  }

  res.json({ valid: false });
});

// 🌍 Lancement serveur (Render compatible)
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Serveur lancé sur port ' + PORT);
});