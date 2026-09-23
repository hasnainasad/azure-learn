const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { validateKycSubmission, validateDecision, validateDocumentFile, MAX_DOCUMENT_BYTES, ValidationError } = require('../domain/kyc');

// What the SUBMITTING user is allowed to see about their own record (no need to hide
// anything from themselves, but keep the shape explicit rather than "whatever's in Mongo").
function publicRecord(r) {
  if (!r) return null;
  const { userId, applicantEmail, applicantName, history, ...rest } = r;
  return rest;
}

function kycRoutes({ kycRepo, userRepo, jwtSecret, blobStore }) {
  const router = express.Router();
  router.use(requireAuth(jwtSecret));

  // Buffers the upload in memory (documents here are capped at 5MB - see MAX_DOCUMENT_BYTES)
  // rather than to disk, since it goes straight on to Blob Storage and never needs to sit
  // on the VM's filesystem at all. Mimetype/size are re-checked by validateDocumentFile;
  // multer's own limit just stops an oversized upload from being buffered in the first place.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES } });

  router.get('/status', async (req, res, next) => {
    try {
      const record = await kycRepo.getByUserId(req.userId);
      res.json({ kyc: publicRecord(record) || { status: 'not_submitted' } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/submit', upload.single('document'), async (req, res, next) => {
    try {
      const existing = await kycRepo.getByUserId(req.userId);
      if (existing && existing.status === 'approved') {
        return res.status(409).json({ error: 'Your identity is already verified' });
      }
      const docMeta = validateDocumentFile(req.file);
      // The form arrives as multipart fields (multer puts non-file fields on req.body as
      // flat strings), so the nested address object validateKycSubmission expects is
      // rebuilt here rather than changing that function's shape.
      const clean = validateKycSubmission({
        legalName: req.body.legalName,
        dob: req.body.dob,
        address: {
          line1: req.body.line1,
          city: req.body.city,
          postalCode: req.body.postalCode,
          country: req.body.country,
        },
        documentType: req.body.documentType,
        documentFileName: docMeta.originalName,
      });
      const user = await userRepo.findById(req.userId);
      // One blob per user: this upload overwrites whatever was there from a previous
      // submission (see the "overwrite on resubmit" decision for this slice), which is
      // just how uploading to the same blob name already behaves - no separate delete step.
      const blobName = req.userId;
      await blobStore.upload(blobName, req.file.buffer, { contentType: docMeta.contentType });
      const record = await kycRepo.submit(
        req.userId,
        {
          ...clean,
          documentBlobName: blobName,
          documentContentType: docMeta.contentType,
          documentSize: docMeta.size,
        },
        { email: user.email, name: user.name },
      );
      res.status(201).json({ kyc: publicRecord(record) });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  // Streams the document straight through from Blob Storage rather than redirecting to a
  // storage URL - the storage account has no public network access (private endpoint
  // only, same as Key Vault), so a direct URL wouldn't resolve from the caller's browser
  // anyway, and this way the browser never needs or gets any storage credential.
  async function streamDocument(res, record) {
    if (!record || !record.documentBlobName) {
      res.status(404).json({ error: 'No document on file' });
      return;
    }
    const { stream, contentType, contentLength } = await blobStore.download(record.documentBlobName);
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(record.documentFileName || 'document')}"`);
    stream.pipe(res);
  }

  // Lets a user see their own uploaded document back (e.g. to confirm what they sent).
  router.get('/document', async (req, res, next) => {
    try {
      const record = await kycRepo.getByUserId(req.userId);
      await streamDocument(res, record);
    } catch (err) {
      next(err);
    }
  });

  // --- Admin only, from here down ---
  router.use('/admin', requireAdmin(userRepo));

  router.get('/admin/pending', async (req, res, next) => {
    try {
      const records = await kycRepo.listByStatus('pending');
      res.json({ records });
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/:userId/document', async (req, res, next) => {
    try {
      const record = await kycRepo.getByUserId(req.params.userId);
      await streamDocument(res, record);
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/:userId/decision', async (req, res, next) => {
    try {
      const { decision, reason } = validateDecision(req.body);
      const ok = await kycRepo.decide(req.params.userId, { decision, reviewedBy: req.adminUser.id, reason });
      if (!ok) return res.status(409).json({ error: 'No pending submission found for that user' });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  return router;
}

module.exports = { kycRoutes };
