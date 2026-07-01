-- Security hardening: server-side size + content-type limits on the public
-- `customer-proposals` storage bucket.
--
-- WHY
--   The public quote form (src/public/RequestQuote.tsx / RequestQuoteModal) uploads files
--   DIRECTLY to this bucket from the browser BEFORE calling /api/submit-proposal. The anon
--   INSERT policy only checks `bucket_id = 'customer-proposals'`, and Turnstile + the
--   submit-proposal rate limiter gate the FUNCTION, not the storage upload. So anyone holding
--   the (public, in-bundle) anon key could:
--     • upload arbitrarily LARGE objects              -> storage-cost / DoS abuse, and
--     • upload text/html or image/svg+xml which a public bucket serves INLINE -> a
--       stored-content / phishing vector hosted off our own Supabase origin.
--   The bucket had NO file_size_limit and NO allowed_mime_types (unlike `attachments`, which
--   got a size backstop in 20260628120100). This sets both.
--
--   SCOPE / NOT FIXED HERE: this caps per-file SIZE and TYPE only. The anon INSERT policy is
--   unchanged, so a caller can still upload a large NUMBER of (now bounded) files directly,
--   bypassing Turnstile + the submit-proposal rate limiter. Closing that count/rate vector needs
--   a different control (move uploads behind the function via a signed URL issued only after
--   Turnstile, or a per-IP storage-insert limit) — tracked as a separate follow-up.
--
-- SIZE: 26214400 = 25 MB, matching the client cap (MAX_FILE_SIZE_BYTES in RequestQuote.tsx).
--
-- MIME: customers here upload drawings, specs, CAD and photos. Browsers report most CAD
--   (.dwg/.step/.sldprt/.iges) as application/octet-stream or application/x-*, so we allow the
--   whole `application/*` family (covers pdf, zip, office, octet-stream and every CAD variant)
--   plus common raster image types, plaintext and csv, and a couple of video containers for the
--   occasional part clip. We deliberately ENUMERATE image types instead of `image/*` so that
--   image/svg+xml is excluded, and we omit text/html — those two are the classic inline-executed
--   stored-XSS types. (Residual: application/xhtml+xml is technically under application/*; fully
--   closing inline execution for a public bucket needs a serve-layer control —
--   Content-Disposition: attachment or an image proxy — tracked as a broader follow-up, same as
--   noted for the attachments bucket.)
--
-- ROLLBACK:
--   update storage.buckets set file_size_limit = null, allowed_mime_types = null
--   where id = 'customer-proposals';

update storage.buckets
set
  file_size_limit = 26214400,
  allowed_mime_types = array[
    'application/*',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
    'image/heic',
    'image/heif',
    'image/avif',
    'text/plain',
    'text/csv',
    'video/mp4',
    'video/quicktime'
  ]
where id = 'customer-proposals';
