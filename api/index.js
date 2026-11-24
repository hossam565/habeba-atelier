const handler = require('../server.js');
module.exports = (req, res) => {
  const u = new URL(req.url, 'http://x'); if (u.searchParams.get('__dbg')) { res.end(JSON.stringify({url: req.url, h: req.headers['x-matched-path'] || null, o: req.headers['x-vercel-original-url'] || null})); return; }
  const p = u.searchParams.get('__p');
  if (p !== null) {
    u.searchParams.delete('__p');
    const qs = u.searchParams.toString();
    req.url = '/' + p.replace(/^\/+/, '') + (qs ? '?' + qs : '');
  }
  return handler(req, res);
};
