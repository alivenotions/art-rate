const { Redis } = require('@upstash/redis');

const ALLOWED_KEYS = ['ratings', 'tweaks'];

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { key } = req.query;
  if (!ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Invalid key' });

  const kvKey = `phonograph:${key}`;

  try {
    if (req.method === 'GET') {
      const data = await redis.get(kvKey);
      return res.json(data || {});
    }
    if (req.method === 'POST') {
      await redis.set(kvKey, JSON.stringify(req.body));
      return res.json({ ok: true });
    }
    return res.status(405).end();
  } catch (e) {
    console.error(`KV error (${key}):`, e.message);
    return res.status(500).json({ error: 'Storage unavailable' });
  }
};
