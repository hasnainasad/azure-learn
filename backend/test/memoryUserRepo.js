// A fake "database" in a JS Map with the same three methods as the real repository.
// Lets the tests run instantly with no MongoDB. This is the payoff of the repository pattern.
const { DuplicateEmailError } = require('../src/repositories/errors');

function createMemoryUserRepo() {
  const users = new Map();
  let nextId = 1;
  return {
    async create({ email, name, passwordHash }) {
      if ([...users.values()].some((u) => u.email === email)) throw new DuplicateEmailError();
      const user = { id: String(nextId++), email, name, passwordHash, role: 'user', createdAt: new Date() };
      users.set(user.id, user);
      return { ...user };
    },
    async findByEmail(email) {
      const u = [...users.values()].find((x) => x.email === email);
      return u ? { ...u } : null;
    },
    async findById(id) {
      const u = users.get(id);
      return u ? { ...u } : null;
    },
    _count: () => users.size,
    // Test-only helper. Real promotion to admin happens out-of-band via scripts/make-admin.js,
    // never through the app itself.
    _setRole: (id, role) => { users.get(id).role = role; },
  };
}

module.exports = { createMemoryUserRepo };
