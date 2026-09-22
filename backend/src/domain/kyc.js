// KYC = "Know Your Customer": the identity checks a regulated advisor must do before
// giving investment advice. This slice is STATIC: no real document scanning or
// identity-verification vendor, just the workflow shape (submit -> pending -> approved/rejected).
// Storing the actual document bytes is deliberately deferred to the Blob Storage slice.

const DOCUMENT_TYPES = ['passport', 'driving_licence', 'national_id', 'utility_bill'];
const STATUSES = ['not_submitted', 'pending', 'approved', 'rejected'];

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function str(value, { field, min = 1, max = 200 }) {
  if (typeof value !== 'string') throw new ValidationError(`${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ValidationError(`${field} must be ${min} to ${max} characters`);
  }
  return trimmed;
}

// Age check uses whole calendar years, the way a birthday actually works,
// not just (thisYear - birthYear).
function ageFromDob(dob) {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const hadBirthdayThisYear =
    now.getUTCMonth() > birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

function validateDob(dob) {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw new ValidationError('Date of birth must be in YYYY-MM-DD format');
  }
  const parsed = new Date(dob + 'T00:00:00Z');
  if (Number.isNaN(parsed.getTime())) throw new ValidationError('Date of birth is not a valid date');
  if (parsed.getTime() > Date.now()) throw new ValidationError('Date of birth cannot be in the future');
  const age = ageFromDob(dob);
  if (age < 18) throw new ValidationError('You must be at least 18 years old');
  if (age > 120) throw new ValidationError('Date of birth is not valid');
  return dob;
}

function validateAddress(address) {
  if (!address || typeof address !== 'object') throw new ValidationError('Address is required');
  return {
    line1: str(address.line1, { field: 'Address line 1', max: 200 }),
    city: str(address.city, { field: 'City', max: 100 }),
    postalCode: str(address.postalCode, { field: 'Postal code', min: 2, max: 20 }),
    country: str(address.country, { field: 'Country', max: 100 }),
  };
}

// What the browser sends when submitting KYC details.
function validateKycSubmission(data) {
  if (!data || typeof data !== 'object') throw new ValidationError('KYC details are required');
  const legalName = str(data.legalName, { field: 'Legal name', max: 150 });
  const dob = validateDob(data.dob);
  const address = validateAddress(data.address);
  if (!DOCUMENT_TYPES.includes(data.documentType)) {
    throw new ValidationError('Document type is not valid');
  }
  // We don't store the file itself yet (that's the Blob Storage slice) - just the name,
  // as proof the user picked something, and to show it back to them.
  const documentFileName = str(data.documentFileName, { field: 'Document file name', max: 255 });
  return { legalName, dob, address, documentType: data.documentType, documentFileName };
}

// What an admin sends when reviewing a submission.
function validateDecision(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('A decision is required');
  const { decision, reason } = body;
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new ValidationError('Decision must be "approved" or "rejected"');
  }
  if (decision === 'rejected') {
    return { decision, reason: str(reason, { field: 'Rejection reason', max: 500 }) };
  }
  return { decision, reason: null };
}

module.exports = {
  DOCUMENT_TYPES,
  STATUSES,
  ValidationError,
  validateKycSubmission,
  validateDecision,
  ageFromDob,
};
