// Parses a systemd-style EnvironmentFile (KEY=value per line) as plain text.
// Deliberately does NOT use the shell (no `source`/`. file`): a value containing
// shell metacharacters - most importantly "&" in a Cosmos DB connection string
// like ...?replicaSet=globaldb&retrywrites=false - gets silently mangled if bash
// ever gets to interpret it (& backgrounds a command; so do ;, |, >, <, and # starts
// a comment). Reading the file as data instead of as a script sidesteps all of that,
// the same way systemd's own EnvironmentFile= directive does.
function parseEnvFile(text) {
  const vars = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    vars[line.slice(0, eq)] = line.slice(eq + 1); // everything after the first "=", verbatim
  }
  return vars;
}

module.exports = { parseEnvFile };
