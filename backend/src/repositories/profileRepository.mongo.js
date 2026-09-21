// Stores each user's risk assessment: the CURRENT one plus every earlier one (history).
// Advice firms have to keep the assessments a recommendation was based on, so retakes
// are appended, never overwritten.
//
// One document per user, written with a single atomic upsert:
//   $set  current = the new assessment
//   $push history = the same assessment
// (No sorting or extra indexes needed, which keeps Cosmos DB request charges low.)
const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    current: { type: mongoose.Schema.Types.Mixed },
    // default: undefined stops Mongoose adding "history: []" on insert, which would clash with $push
    history: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  },
  { minimize: false },
);

const ProfileModel = mongoose.models.Profile || mongoose.model('Profile', profileSchema);

const profileRepository = {
  // -> { userId, current, history } or null
  async getByUserId(userId) {
    const doc = await ProfileModel.findOne({ userId }).lean();
    if (!doc) return null;
    return { userId: doc.userId, current: doc.current || null, history: doc.history || [] };
  },

  // Saves a new assessment and returns it
  async save(userId, assessment) {
    await ProfileModel.updateOne(
      { userId },
      { $set: { current: assessment }, $push: { history: assessment } },
      { upsert: true },
    );
    return assessment;
  },
};

module.exports = { profileRepository, ProfileModel };
