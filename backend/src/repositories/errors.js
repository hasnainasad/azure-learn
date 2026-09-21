// Errors every repository implementation (Mongo now, maybe SQL later) throws the same way,
// so routes never need to know which database is underneath.
class DuplicateEmailError extends Error {
  constructor(message = 'Email already registered') {
    super(message);
    this.name = 'DuplicateEmailError';
  }
}

module.exports = { DuplicateEmailError };
