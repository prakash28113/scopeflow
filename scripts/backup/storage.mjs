/**
 * Backs up Supabase Storage (the public `blog` bucket: blog images) into the same encrypted backup file as the database,
 * and restores it into a folder for checking. No new secret and no cost: the bucket is public, so each object is read
 * from its public URL; the list of objects comes from the same read-only database query the backup already uses.
 *
 * Fail-closed: an object that is listed but can't be read, a size that doesn't match, a bucket that isn't public (it would
 * need a service key, which is the owner's decision), or a total over the size cap, fails the backup. Nothing is skipped quietly.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export const STORAGE_BUCKETS = ["blog"];
/** The whole Storage part of one backup. GitHub artifacts and the 15-minute job both stay comfortable below this. */
export const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** Object names we agree to write to disk or request: relative, no `..`, no backslashes, no control characters. */
export function safeName(name) {
  return typeof name === "string" && name.length > 0 && name.length < 512 && !name.startsWith("/") && !/\\|[\u0000-\u001f]/.test(name) && !name.split("/").some((p) => p === ".." || p === "." || p === "");
}

const encodePath = (name) => name.split("/").map(encodeURIComponent).join("/");

async function download(fetch, url, { retries = 3, timeoutMs = 30_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; ; attempt++) {
    let status = 0; // 0 = no answer (network error or timeout)
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      status = res.status;
    } catch {
      status = 0;
    }
    const retryable = status === 0 || status === 429 || status >= 500;
    if (!retryable || attempt >= retries) throw new Error(status ? `HTTP ${status}` : "network error or timeout");
    await sleep(attempt * 2000);
  }
}

/** Reads every object of every backed-up bucket. `sql(query)` returns row objects; `fetch` is the global fetch. */
export async function exportStorage({ sql, fetch, supabaseUrl, buckets = STORAGE_BUCKETS, maxTotalBytes = MAX_TOTAL_BYTES, sleep }) {
  const out = { buckets: {} };
  let total = 0;
  for (const id of buckets) {
    const [cfg] = await sql(`select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = ${lit(id)}`);
    if (!cfg) {
      out.buckets[id] = { config: null, objects: [] };
      continue; // the bucket doesn't exist (yet): nothing to back up, and the manifest records that
    }
    if (!cfg.public) throw new Error(`Storage bucket "${id}" is not public, so it can't be backed up without a service key. Ask the owner (docs/RECOVERY.md, section 6).`);
    const rows = await sql(`select name, coalesce((metadata->>'size')::bigint, 0)::bigint as size, metadata->>'mimetype' as mimetype from storage.objects where bucket_id = ${lit(id)} order by name`);
    const objects = [];
    for (const r of rows) {
      if (!safeName(r.name)) throw new Error(`Storage object name in "${id}" is not safe to back up (${JSON.stringify(String(r.name).slice(0, 60))}).`);
      let bytes;
      try {
        bytes = await download(fetch, `${supabaseUrl}/storage/v1/object/public/${id}/${encodePath(r.name)}`, { sleep });
      } catch (e) {
        throw new Error(`Could not read Storage object "${id}/${r.name}" (${e.message}). The backup was not saved.`);
      }
      if (Number(r.size) > 0 && bytes.length !== Number(r.size)) throw new Error(`Storage object "${id}/${r.name}" is ${bytes.length} bytes but Storage lists ${r.size}. The backup was not saved.`);
      total += bytes.length;
      if (total > maxTotalBytes) throw new Error(`Storage is over the ${Math.round(maxTotalBytes / 1048576)} MB backup limit. Ask the owner how to store it (docs/RECOVERY.md, section 6).`);
      objects.push({ name: r.name, size: bytes.length, mimetype: r.mimetype ?? null, sha256: sha256(bytes), data: bytes.toString("base64") });
    }
    out.buckets[id] = { config: { public: true, file_size_limit: cfg.file_size_limit ?? null, allowed_mime_types: cfg.allowed_mime_types ?? null }, objects };
  }
  return out;
}

/** What the manifest records for Storage: per bucket, per object, name → size and SHA-256. */
export function storageManifest(storage) {
  return Object.fromEntries(
    Object.entries(storage?.buckets ?? {}).map(([id, b]) => [id, { exists: b.config !== null, objects: Object.fromEntries(b.objects.map((o) => [o.name, { size: o.size, sha256: o.sha256 }])) }]),
  );
}

/** Problems with the Storage part of a backup: any object whose bytes don't match its recorded size or SHA-256. */
export function checkStorage(storage) {
  const problems = [];
  for (const [id, b] of Object.entries(storage?.buckets ?? {})) {
    for (const o of b.objects) {
      if (!safeName(o.name)) problems.push(`${id}/${JSON.stringify(o.name)}: unsafe name`);
      else {
        const bytes = Buffer.from(o.data, "base64");
        if (bytes.length !== o.size || sha256(bytes) !== o.sha256) problems.push(`${id}/${o.name}: contents don't match the checksum`);
      }
    }
  }
  return problems;
}

/** Storage paths that database rows point to but the backup doesn't hold (e.g. a post whose cover image was deleted). */
export function findStorageReferences(backup, bucket = "blog") {
  const held = new Set((backup.storage?.buckets?.[bucket]?.objects ?? []).map((o) => o.name));
  const re = new RegExp(`/storage/v1/object/public/${bucket}/([^\\s"'<>)\\]]+)`, "g");
  const missing = new Set();
  let referenced = 0;
  for (const [table, rows] of Object.entries(backup.tables ?? {})) {
    if (!table.startsWith("public.")) continue;
    for (const m of JSON.stringify(rows).matchAll(re)) {
      referenced++;
      let name;
      try { name = decodeURIComponent(m[1].replace(/\\+$/, "")); } catch { name = m[1]; }
      if (!held.has(name)) missing.add(name);
    }
  }
  return { referenced, missing: [...missing].sort() };
}

/**
 * Writes the objects of a backup into `dir` (a throwaway folder by default) and reads them back to prove they are
 * byte-identical. Never writes outside `dir`. Returns { dir, files, bytes }. Uploading them to a live bucket is a
 * separate, owner-run step (docs/RECOVERY.md): this function only recreates the files.
 */
export function restoreStorage(backup, dir = mkdtempSync(join(tmpdir(), "scopeflow-storage-"))) {
  const problems = checkStorage(backup.storage);
  if (problems.length) throw new Error(`Storage restore refused: ${problems.join("; ")}`);
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const [id, b] of Object.entries(backup.storage?.buckets ?? {})) {
    for (const o of b.objects) {
      const target = resolve(root, id, ...o.name.split("/"));
      if (!target.startsWith(join(root, id) + sep)) throw new Error(`Storage restore refused: "${o.name}" would leave the restore folder.`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(o.data, "base64"));
      const back = readFileSync(target);
      if (sha256(back) !== o.sha256) throw new Error(`Restored file ${id}/${o.name} does not match its checksum.`);
      files++;
      bytes += back.length;
    }
  }
  return { dir: root, files, bytes };
}

export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });
