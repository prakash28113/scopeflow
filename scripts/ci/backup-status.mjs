/**
 * Backup readiness gate for releases. A release does not start unless the daily backup is healthy:
 *   1. the latest completed Backup run on main succeeded (a newer failed run counts, even if an older one was green),
 *   2. it finished within the last 36 hours (the backup runs daily, so this allows one missed night),
 *   3. that run still has a non-expired, non-trivial encrypted artifact.
 * The backup job itself decrypts the file, checks its manifest and restores it into a fresh database before it uploads
 * anything, so a green run with an artifact means the content was verified.
 * Fails closed: if GitHub can't be asked, the release does not start. The only way past it is a typed override,
 * which is written loudly on the release page. Read-only: one GET for the runs, one for the artifacts.
 */
export const MAX_AGE_HOURS = 36;
export const MIN_ARTIFACT_BYTES = 1024;
export const OVERRIDE_PHRASE = "RELEASE WITHOUT FRESH BACKUP";
const hoursSince = (iso, now) => Math.floor((now.getTime() - new Date(iso).getTime()) / 36e5);

/** Pure decision. `runs` newest first or not (sorted here); `artifacts` are those of the latest completed run. */
export function evaluateGate({ runs, artifacts, now = new Date() }) {
  const done = (runs ?? []).filter((r) => r.status === "completed").sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!done.length) return { ok: false, text: "no completed Backup run found on main." };
  const latest = done[0];
  if (latest.head_branch && latest.head_branch !== "main") return { ok: false, text: `the latest Backup run (#${latest.id}) was not on main.` };
  if (latest.conclusion !== "success") {
    const good = done.find((r) => r.conclusion === "success");
    return { ok: false, text: `the latest Backup run (#${latest.id}) ${latest.conclusion}.${good ? ` The last good backup is ${hoursSince(good.updated_at ?? good.created_at, now)} hours old.` : " No successful backup is on record."}` };
  }
  const age = hoursSince(latest.updated_at ?? latest.created_at, now);
  if (age > MAX_AGE_HOURS) return { ok: false, text: `the latest good backup (run #${latest.id}) is ${age} hours old; the limit is ${MAX_AGE_HOURS}.` };
  const file = (artifacts ?? []).find((a) => /^scopeflow-backup-\d{4}-\d{2}-\d{2}$/.test(a.name) && !a.expired);
  if (!file) return { ok: false, text: `run #${latest.id} succeeded but has no unexpired encrypted backup artifact.` };
  if (!(file.size_in_bytes >= MIN_ARTIFACT_BYTES)) return { ok: false, text: `the backup artifact of run #${latest.id} is too small (${file.size_in_bytes} bytes) to be a real backup.` };
  return { ok: true, text: `run #${latest.id} succeeded ${age} hour${age === 1 ? "" : "s"} ago; artifact ${file.name} (${Math.round(file.size_in_bytes / 1024)} KB).` };
}

/** Asks GitHub (read-only) and decides. Never throws. `override` must equal OVERRIDE_PHRASE to pass a failing gate. */
export async function checkBackupGate({ fetch, repo, token, override = "", now = new Date() }) {
  const decide = (g) => (g.ok ? g : override === OVERRIDE_PHRASE ? { ok: true, overridden: true, text: `OVERRIDDEN. ${g.text}` } : g);
  try {
    if (!repo || !token) return decide({ ok: false, text: "this run has no GitHub token to read the backup status." });
    const api = (path) => fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000) });
    const res = await api("actions/workflows/backup.yml/runs?branch=main&status=completed&per_page=10");
    if (!res.ok) return decide({ ok: false, text: `GitHub answered ${res.status} when reading the backup runs.` });
    const runs = (await res.json()).workflow_runs ?? [];
    const latest = runs.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    let artifacts = [];
    if (latest?.conclusion === "success") {
      const a = await api(`actions/runs/${latest.id}/artifacts`);
      if (!a.ok) return decide({ ok: false, text: `GitHub answered ${a.status} when reading the backup artifacts.` });
      artifacts = (await a.json()).artifacts ?? [];
    }
    return decide(evaluateGate({ runs, artifacts, now }));
  } catch {
    return decide({ ok: false, text: "GitHub didn't answer when reading the backup status." });
  }
}
