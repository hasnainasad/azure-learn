const jwt = require('jsonwebtoken');

// Protects a route: the browser must send  Authorization: Bearer <token>
// The token is signed with our secret, so nobody can forge or alter it.
function requireAuth(jwtSecret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Missing token' });
    }
    try {
      // Pin the algorithm so a token cannot pick a weaker one ("alg" confusion attacks)
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      req.userId = payload.sub;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { requireAuth };
