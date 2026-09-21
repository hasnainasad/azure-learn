// In-memory stand-in for profileRepository (same two methods) so tests need no database.
function createMemoryProfileRepo() {
  const profiles = new Map();
  return {
    async getByUserId(userId) {
      const p = profiles.get(userId);
      return p ? JSON.parse(JSON.stringify(p)) : null;
    },
    async save(userId, assessment) {
      const p = profiles.get(userId) || { userId, current: null, history: [] };
      p.current = assessment;
      p.history.push(assessment);
      profiles.set(userId, p);
      return assessment;
    },
  };
}

module.exports = { createMemoryProfileRepo };
