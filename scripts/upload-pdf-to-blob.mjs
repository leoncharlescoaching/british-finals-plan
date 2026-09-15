// One-off script: uploads the private PDF to Vercel Blob.
// Run this once after creating a PRIVATE Blob store and connecting it to the
// Vercel project (or whenever the PDF content changes).
//
// Usage:
//   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx node scripts/upload-pdf-to-blob.mjs
//
// Get the token from: Vercel dashboard -> your project -> Storage -> your
// Blob store -> ".env.local" tab (copy BLOB_READ_WRITE_TOKEN), or run
// `vercel env pull` in the project to get it automatically. The token is
// only needed for this one-off script — the deployed app itself talks to
// Blob via Vercel's built-in OIDC, no token stored in production env vars.
import { put } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.join(root, '..', 'private', 'british-finals-plan.pdf');
const PDF_PATHNAME = 'british-finals-plan.pdf';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error('Set BLOB_READ_WRITE_TOKEN first — see the comment at the top of this script.');
  process.exit(1);
}

const file = await readFile(pdfPath);
const blob = await put(PDF_PATHNAME, file, {
  access: 'private',
  contentType: 'application/pdf',
  allowOverwrite: true,
  token: process.env.BLOB_READ_WRITE_TOKEN,
});

console.log('Uploaded:', blob.pathname, `(${(file.length / 1024 / 1024).toFixed(1)} MB)`);
console.log('Store URL (not public — requires auth):', blob.url);
