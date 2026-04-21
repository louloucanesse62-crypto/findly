const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const app = express();

const FREESOUND_KEY = process.env.FREESOUND_KEY;
const PEXELS_KEY = process.env.PEXELS_KEY;
const GIPHY_KEY = process.env.GIPHY_KEY;
const GROQ_KEY = process.env.GROQ_KEY;

const VALID_CODES = ['FINDLY-ALPHA', 'FINDLY-BETA', 'FINDLY-GAMMA', 'FINDLY-DELTA'];

const usedIPs = {};
const premiumIPs = new Set();

app.use(express.json());
app.use(express.static('public'));

function getIP(req) {
  return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
}

// EMAIL CONFIG
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'findlyfaq@gmail.com',
    pass: process.env.EMAIL_PASS
  }
});

// ENVOI EMAIL
app.post('/send-email', async (req, res) => {
  const { email } = req.body;

  try {
    await transporter.sendMail({
      from: 'findlyfaq@gmail.com',
      to: 'findlyfaq@gmail.com',
      subject: 'Nouveau client Findly',
      text: 'Email: ' + email
    });

    res.json({ success: true });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// GROQ
async function reformulerRecherche(query) {
  try {
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama3-8b-8192',
      messages: [
        {
          role: 'system',
          content: 'Give 3-5 english keywords for media search only.'
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
    return query;
  }
}

// STATUS
app.get('/status', function(req, res) {
  const ip = getIP(req);

  res.json({
    isPremium: premiumIPs.has(ip),
    hasSearched: usedIPs[ip] || false
  });
});

// SEARCH
app.get('/search', async function(req, res) {
  const query = req.query.q;
  const ip = getIP(req);
  const isPremium = premiumIPs.has(ip);
  const limit = isPremium ? 50 : 3;

  if (!query) return res.json({ error: 'Pas de recherche' });

  if (!isPremium && usedIPs[ip]) {
    return res.json({ blocked: true });
  }

  if (!isPremium) {
    usedIPs[ip] = true;
  }

  const queryEN = await reformulerRecherche(query);

  try {
    const [soundsRes, videosRes, gifsRes] = await Promise.all([
      axios.get(`https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(queryEN)}&fields=id,name,previews,duration&page_size=${limit}&token=${FREESOUND_KEY}`),
      axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(queryEN)}&per_page=${limit}`, {
        headers: { Authorization: PEXELS_KEY }
      }),
      axios.get(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(queryEN)}&limit=${limit}`)
    ]);

    res.json({
      sounds: soundsRes.data.results || [],
      videos: videosRes.data.videos || [],
      gifs: gifsRes.data.data || []
    });

  } catch (error) {
    res.json({ error: error.message });
  }
});

// CODE PREMIUM
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

app.listen(3000, function() {
  console.log('Serveur lancé sur port 3000');
});
