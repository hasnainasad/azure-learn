// Reads settings from environment variables (on the VM they come from /etc/api.env).
// Fail fast: a server that starts without its secret would be silently insecure.
function loadConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET is missing or shorter than 32 characters (set it in /etc/api.env)');
  }
  return {
    port: Number(env.PORT) || 3000,
    mongoUrl: env.MONGO_URL || null,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '1h',
  };
}

module.exports = { loadConfig };
