function createMemoryKycRepo() {
  const records = new Map();
  const clone = (r) => (r ? JSON.parse(JSON.stringify(r)) : null);

  return {
    async getByUserId(userId) {
      return clone(records.get(userId));
    },
    async submit(userId, data, applicant) {
      const existing = records.get(userId);
      const now = new Date().toISOString();
      const record = {
        userId,
        ...data,
        applicantEmail: applicant.email,
        applicantName: applicant.name,
        status: 'pending',
        submittedAt: now,
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        history: [...((existing && existing.history) || []), { status: 'pending', at: now, by: userId, reason: null }],
      };
      records.set(userId, record);
      return clone(record);
    },
    async listByStatus(status) {
      // Oldest first, same as the real (Cosmos) repository - see kycRepository.mongo.js
      // for why that one sorts in JS instead of asking Mongo to do it.
      return [...records.values()]
        .filter((r) => r.status === status)
        .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
        .map(clone);
    },
    async decide(userId, { decision, reviewedBy, reason }) {
      const record = records.get(userId);
      if (!record || record.status !== 'pending') return false;
      const now = new Date().toISOString();
      record.status = decision;
      record.reviewedAt = now;
      record.reviewedBy = reviewedBy;
      record.rejectionReason = reason;
      record.history.push({ status: decision, at: now, by: reviewedBy, reason });
      return true;
    },
  };
}

module.exports = { createMemoryKycRepo };
