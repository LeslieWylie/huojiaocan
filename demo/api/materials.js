import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://live-teacher-guide-roy-leos-projects.vercel.app/materials/';
const allowed = new Map([
  ['九年级语文上册-学生教材.pdf', '九年级语文上册-学生教材.pdf'],
  ['九年级语文上册-教师用书.pdf', '九年级语文上册-教师教学用书.pdf'],
  ['九年级语文上册-教师教学用书.pdf', '九年级语文上册-教师教学用书.pdf'],
]);

const PDF_PARTS = {
  '九年级语文上册-学生教材.pdf': { prefix: 'textbook', size: 9458150, partBytes: 1800000, count: 6 },
  '九年级语文上册-教师用书.pdf': { prefix: 'teacher-guide', size: 16100566, partBytes: 1800000, count: 9 },
  '九年级语文上册-教师教学用书.pdf': { prefix: 'teacher-guide', size: 16100566, partBytes: 1800000, count: 9 },
};
const PART_ORIGIN = 'https://live-teacher-guide-roy-leos-projects.vercel.app/pdf-parts/';

function localPath(name) {
  const candidate = path.resolve(process.cwd(), 'public', 'materials', name);
  const root = path.resolve(process.cwd(), 'public', 'materials') + path.sep;
  return candidate.startsWith(root) ? candidate : null;
}

function parseRange(range, size) {
  if (!range || !range.startsWith('bytes=')) return null;
  const [rawStart, rawEnd] = range.slice(6).split('-', 2);
  let start = rawStart ? Number(rawStart) : Math.max(0, size - Number(rawEnd || 0));
  let end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return 'invalid';
  end = Math.min(end, size - 1);
  return { start, end };
}

async function readPdfPart(spec, index, name) {
  const local = path.resolve(process.cwd(), 'public', 'pdf-parts', `${spec.prefix}-${String(index).padStart(3, '0')}.bin`);
  try {
    if (fs.statSync(local).isFile()) return fs.promises.readFile(local);
  } catch {
    // Production functions may not include the static bundle on disk.
  }
  const upstream = await fetch(`${PART_ORIGIN}${spec.prefix}-${String(index).padStart(3, '0')}.bin`);
  if (!upstream.ok) throw new Error(`pdf_part_${name}_${index}`);
  return Buffer.from(await upstream.arrayBuffer());
}

async function serveChunkedPdf(req, res, name, spec) {
  const range = parseRange(req.headers.range, spec.size);
  if (range === 'invalid') {
    res.setHeader('Content-Range', `bytes */${spec.size}`);
    return res.status(416).end();
  }
  const first = range ? Math.floor(range.start / spec.partBytes) : 0;
  const last = range ? Math.floor(range.end / spec.partBytes) : spec.count - 1;
  const parts = [];
  try {
    for (let index = first; index <= last; index += 1) parts.push(await readPdfPart(spec, index, name));
  } catch {
    return res.status(503).json({ ok: false, error: 'material_unavailable' });
  }
  let body = Buffer.concat(parts);
  if (range) {
    const base = first * spec.partBytes;
    body = body.subarray(range.start - base, range.end - base + 1);
  }
  res.status(range ? 206 : 200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', 'inline');
  if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${spec.size}`);
  if (req.method === 'HEAD') return res.end();
  return res.send(body);
}

export default async function handler(req, res) {
  const name = decodeURIComponent(String(req.query?.file || '').replace(/^\/+/, ''));
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }
  if (!allowed.has(name)) return res.status(404).json({ ok: false, error: 'material_not_found' });

  // Keep the PDF in the same deployment as the API. This avoids a fragile
  // cross-deployment hop and preserves Range requests in the browser viewer.
  const local = localPath(name);
  try {
    const stat = local && fs.statSync(local);
    if (stat?.isFile()) {
      const range = parseRange(req.headers.range, stat.size);
      if (range === 'invalid') {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      const start = range ? range.start : 0;
      const end = range ? range.end : stat.size - 1;
      res.status(range ? 206 : 200);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Disposition', 'inline');
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(local, { start, end }).pipe(res);
    }
  } catch {
    // Fall through to the compatibility origin below.
  }

  if (PDF_PARTS[name]) return serveChunkedPdf(req, res, name, PDF_PARTS[name]);

  const upstreamName = allowed.get(name);
  const headers = {}; if (req.headers.range) headers.Range = req.headers.range;
  const upstream = await fetch(`${ORIGIN}${encodeURIComponent(upstreamName)}`, { headers });
  if (!upstream.ok && upstream.status !== 206) return res.status(upstream.status).end();
  res.status(upstream.status); res.setHeader('Content-Type', 'application/pdf');
  for (const key of ['content-length','content-range','accept-ranges','etag','last-modified']) if (upstream.headers.get(key)) res.setHeader(key, upstream.headers.get(key));
  if (req.method === 'HEAD') return res.end();
  return res.send(Buffer.from(await upstream.arrayBuffer()));
}
