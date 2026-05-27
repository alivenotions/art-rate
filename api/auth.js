const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const token = req.cookies?.phonograph_session;
    const expected = process.env.SESSION_SECRET;
    const valid = token && expected && timingSafeEqual(token, expected);
    return res.json({ authenticated: valid });
  }

  if (req.method === 'POST') {
    const { password } = req.body || {};
    const sitePassword = process.env.SITE_PASSWORD;

    if (!password || !sitePassword || !timingSafeEqual(password, sitePassword)) {
      return res.status(401).json({ error: 'Wrong password' });
    }

    const sessionToken = process.env.SESSION_SECRET;
    res.setHeader('Set-Cookie', `phonograph_session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000`);
    return res.json({ ok: true });
  }

  return res.status(405).end();
};
