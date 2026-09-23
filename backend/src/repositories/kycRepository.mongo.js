// One KYC document per user. Same "$set current fields + $push history" atomic-upsert
// pattern as profileRepository, so the whole submit -> approve/reject trail is auditable.
const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true },
    legalName: String,
    dob: String,
    address: mongoose.Schema.Types.Mixed,
    documentType: String,
    documentFileName: String,
    // As of the Blob Storage slice: where the actual file bytes live. documentBlobName is
    // just the userId today (one blob per user, overwritten on resubmission) but is stored
    // explicitly rather than re-derived, in case that naming scheme ever changes.
    documentBlobName: String,
    documentContentType: String,
    documentSize: Number,
    applicantEmail: String, // snapshot at submission time, so the admin list needs no extra lookup
    applicantName: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: String, // admin's user id
    rejectionReason: String,
    history: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  },
  { minimize: false },
);

const KycModel = mongoose.models.Kyc || mongoose.model('Kyc', kycSchema);

function toRecord(doc) {
  if (!doc) return null;
  const { _id, __v, ...rest } = doc;
  return rest;
}

const kycRepository = {
  async getByUserId(userId) {
    return toRecord(await KycModel.findOne({ userId }).lean());
  },

  // Creates or replaces the submission and sets status back to 'pending'.
  async submit(userId, data, applicant) {
    const now = new Date();
    const record = {
      ...data,
      applicantEmail: applicant.email,
      applicantName: applicant.name,
      status: 'pending',
      submittedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
    };
    await KycModel.updateOne(
      { userId },
      { $set: record, $push: { history: { status: 'pending', at: now, by: userId, reason: null } } },
      { upsert: true },
    );
    return { userId, ...record };
  },

  async listByStatus(status) {
    // Sorted in JavaScript, not with Mongo's .sort(). Cosmos DB for MongoDB (RU-based)
    // only orders by paths its automatic indexing policy covers, and a custom field like
    // submittedAt isn't one by default - a server-side sort on it fails with
    // "The index path corresponding to the specified order-by item is excluded."
    // (The equality filter on `status` above is unaffected; that limitation is specific
    // to ORDER BY.) The admin queue is small, so sorting the fetched page here is cheap
    // and sidesteps needing to create and pay RU for an extra index.
    const docs = await KycModel.find({ status }).lean();
    docs.sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
    return docs.map(toRecord);
  },

  // Only succeeds while the record is still 'pending' - stops two admins racing each other,
  // and stops re-approving something that was already decided.
  async decide(userId, { decision, reviewedBy, reason }) {
    const now = new Date();
    const result = await KycModel.updateOne(
      { userId, status: 'pending' },
      {
        $set: { status: decision, reviewedAt: now, reviewedBy, rejectionReason: reason },
        $push: { history: { status: decision, at: now, by: reviewedBy, reason } },
      },
    );
    return result.matchedCount > 0;
  },
};

module.exports = { kycRepository, KycModel };
