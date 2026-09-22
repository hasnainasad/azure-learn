// Must run AFTER requireAuth (needs req.userId already set). Looks the user up fresh
// on every request rather than trusting a "role" claim baked into the token, so revoking
// admin access takes effect immediately instead of waiting for the token to expire.
function requireAdmin(userRepo) {
  return async (req, res, next) => {
    try {
      const user = await userRepo.findById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      req.adminUser = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAdmin };
