// The ONLY file that knows users live in MongoDB/Cosmos.
// Everything else calls create / findByEmail / findById, so swapping the database
// later (e.g. to Azure SQL) means rewriting this one file, not the whole app.
const mongoose = require('mongoose');
const { DuplicateEmailError } = require('./errors');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const UserModel = mongoose.models.User || mongoose.model('User', userSchema);

// Convert a database document into a plain object the rest of the app uses.
function toUser(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    email: doc.email,
    name: doc.name,
    passwordHash: doc.passwordHash,
    createdAt: doc.createdAt,
  };
}

const userRepository = {
  async create({ email, name, passwordHash }) {
    try {
      const doc = await UserModel.create({ email, name, passwordHash });
      return toUser(doc.toObject());
    } catch (err) {
      // 11000 = duplicate key: the unique index on email rejected the insert
      if (err && err.code === 11000) throw new DuplicateEmailError('Email already registered');
      throw err;
    }
  },

  async findByEmail(email) {
    return toUser(await UserModel.findOne({ email }).lean());
  },

  async findById(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return toUser(await UserModel.findById(id).lean());
  },
};

module.exports = { userRepository, UserModel };
