const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const app = express();

const FREESOUND_KEY = process.env.FREESOUND_KEY || 'XXKUSm9PnHr1YnIWlvGHXJFt5Pj2TmHVMCUEbusS';
const PEXELS_KEY = process.env.PEXELS_KEY || 'KMlGrx95uM9TE4rewp2UfEGwwzmsI9GrRdNFSu44GLU4MFD9yxylCqKL';
const GIPHY_KEY = process.env.GIPHY_KEY || 'cNmyQnqOR8zcEYwcKjoMkdiLb9EOzacj';
const GROQ_KEY = process.env.GROQ_KEY || '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';

const VALID_CODES = ['SONRIX-ALPHA', 'SONRIX-BETA', 'SONRIX-GAMMA', 'SONRIX-DELTA', 'SONRIX-EPSILON', 'SONRIX-ZETA', 'SONRIX-ETA', 'SONRIX-THETA', 'SONRIX-IOTA', 'SONRIX-KAPPA'];

const DATA_FILE = path.join('/tmp', 'sonrix_data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch(e) {}
  return { ips: {} };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch(e) {}
}

function getIP(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

function getIPData(ip) {
  const data = loadData();
  const now = Date.now();
  const ipData = data.ips[ip] || { searchUsed: false, catUsed: false, lastReset: now, isPremium: false };
  
  // Reset toutes les 24h
  if (now - ipData.lastReset > 24 * 60 * 60 * 1000) {
    ipData.searchUsed = false;
    ipData.catUsed = false;
    ipData.lastReset = now;
    data.ips[ip] = ipData;
    saveData(data);
  }
  
  return ipData;
}

function updateIPData(ip, updates) {
  const data = loadData();
  const ipData = getIPData(ip);
  data.ips[ip] = { ...ipData, ...updates };
  saveData(data);
}

app.use(express.json());
app.use(express.static('public'));

async function reformulerRecherche(query) {
  try {
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: 'Tu es un expert en recherche de ressources audio et vidéo. Reformule en 3-5 mots-clés anglais pertinents. Réponds UNIQUEMENT avec les mots-clés séparés par des espaces.'
        },
        { role: 'user', content: query }
      ],
      max_tokens: 50
    }, {
      headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' }
    });
    return response.data.choices[0].message.content.trim();
  } catch(e) {
    return query;
  }
}

app.get('/status', function(req, res) {
  const ip = getIP(req);
  const ipData = getIPData(ip);
  const now = Date.now();
  const timeLeft = Math.max(0, 24 * 60 * 60 * 1000 - (now - ipData.lastReset));
  res.json({
    isPremium: ipData.isPremium,
    searchUsed: ipData.searchUsed,
    catUsed: ipData.catUsed,
    timeLeft: timeLeft
  });
});

app.get('/preview', async function(req, res) {
  try {
    const [soundsRes, videosRes, gifsRes] = await Promise.all([
      axios.get('https://freesound.org/apiv2/search/text/?query=music&fields=id,name,previews&page_size=3&token=' + FREESOUND_KEY),
      axios.get('https://api.pexels.com/videos/search?query=nature&per_page=3', { headers: { 'Authorization': PEXELS_KEY } }),
      axios.get('https://api.giphy.com/v1/gifs/trending?api_key=' + GIPHY_KEY + '&limit=3&rating=g')
    ]);
    res.json({
      sounds: soundsRes.data.results || [],
      videos: videosRes.data.videos || [],
      gifs: gifsRes.data.data || []
    });
  } catch(e) {
    res.json({ sounds: [], videos: [], gifs: [] });
  }
});

app.get('/search', async function(req, res) {
  const query = req.query.q;
  const ip = getIP(req);
  const ipData = getIPData(ip);
  const isPremium = ipData.isPremium;
  const limit = isPremium ? 50 : 3;

  if (!query) return res.json({ error: 'Pas de recherche' });

  if (!isPremium && ipData.searchUsed) {
    return res.json({ blocked: true, reason: 'search' });
  }

  if (!isPremium) {
    updateIPData(ip, { searchUsed: true });
  }

  const queryEN = await reformulerRecherche(query);
  console.log('Recherche:', query, '→', queryEN);

  try {
    const [soundsRes, videosRes, gifsRes] = await Promise.all([
      axios.get('https://freesound.org/apiv2/search/text/?query=' + encodeURIComponent(queryEN) + '&fields=id,name,previews,duration&page_size=' + limit + '&token=' + FREESOUND_KEY),
      axios.get('https://api.pexels.com/videos/search?query=' + encodeURIComponent(queryEN) + '&per_page=' + Math.min(limit, 80), { headers: { 'Authorization': PEXELS_KEY } }),
      axios.get('https://api.giphy.com/v1/gifs/search?api_key=' + GIPHY_KEY + '&q=' + encodeURIComponent(queryEN) + '&limit=' + Math.min(limit, 50) + '&rating=g')
    ]);
    res.json({
      query, queryEN,
      sounds: soundsRes.data.results || [],
      videos: videosRes.data.videos || [],
      gifs: gifsRes.data.data || []
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/category', async function(req, res) {
  const query = req.query.q;
  const ip = getIP(req);
  const ipData = getIPData(ip);
  const isPremium = ipData.isPremium;
  const limit = isPremium ? 50 : 3;

  if (!query) return res.json({ error: 'Pas de recherche' });

  if (!isPremium && ipData.catUsed) {
    return res.json({ blocked: true, reason: 'cat' });
  }

  if (!isPremium) {
    updateIPData(ip, { catUsed: true });
  }

  const queryEN = await reformulerRecherche(query);

  try {
    const [soundsRes, videosRes, gifsRes] = await Promise.all([
      axios.get('https://freesound.org/apiv2/search/text/?query=' + encodeURIComponent(queryEN) + '&fields=id,name,previews,duration&page_size=' + limit + '&token=' + FREESOUND_KEY),
      axios.get('https://api.pexels.com/videos/search?query=' + encodeURIComponent(queryEN) + '&per_page=' + Math.min(limit, 80), { headers: { 'Authorization': PEXELS_KEY } }),
      axios.get('https://api.giphy.com/v1/gifs/search?api_key=' + GIPHY_KEY + '&q=' + encodeURIComponent(queryEN) + '&limit=' + Math.min(limit, 50) + '&rating=g')
    ]);
    res.json({
      query, queryEN,
      sounds: soundsRes.data.results || [],
      videos: videosRes.data.videos || [],
      gifs: gifsRes.data.data || []
    });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/sfx', async function(req, res) {
  const type = req.query.type || 'transition';
  const ip = getIP(req);
  const ipData = getIPData(ip);

  if (!ipData.isPremium) return res.json({ blocked: true });

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

  try {
    const response = await axios.get('https://freesound.org/apiv2/search/text/?query=' + encodeURIComponent(sfxQueries[type] || type) + '&fields=id,name,previews,duration&page_size=50&token=' + FREESOUND_KEY);
    res.json({ sounds: response.data.results || [] });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.post('/verify-code', function(req, res) {
  const code = req.body.code;
  const ip = getIP(req);
  if (VALID_CODES.includes(code)) {
    updateIPData(ip, { isPremium: true });
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Sonrix lance sur port ' + PORT);
});
