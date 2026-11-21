/**
 * Is the daily backup healthy? Reads the latest completed runs of the Backup workflow on main (GitHub Actions API,
 * read-only) so every release says so, instead of a failing backup going unnoticed behind a green release.
 * Informational: it never blocks a release, and it never throws.
 */
export function describeBackups(runs, now = new Date()) {
  const done = (runs ?? []).filter((r) => r.status === "completed").sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!done.length) return { ok: false, text: "No completed backup run found. Run Actions → Backup once and check it passes." };
  const lastGood = done.find((r) => r.conclusion === "success");
  const failedSince = lastGood ? done.indexOf(lastGood) : done.length;
  const age = lastGood ? Math.floor((now.getTime() - new Date(lastGood.created_at).getTime()) / 36e5) : null;
  if (failedSince === 0 && age !== null && age <= 36) return { ok: true, text: `Latest backup succeeded ${age} hour${age === 1 ? "" : "s"} ago.` };
  if (!lastGood) return { ok: false, text: `The last ${done.length} backup run(s) all failed and no successful backup is on record. Fix this before relying on any release.` };
  return { ok: false, text: `The latest backup run failed (${failedSince} in a row); the last good backup is ${age} hours old. See the Backup workflow run and docs/RECOVERY.md.` };
}

export async function backupStatus({ fetch, repo, token }) {
  try {
    if (!repo || !token) return { ok: false, text: "Backup status unavailable (no GitHub token in this run)." };
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/backup.yml/runs?branch=main&per_page=10`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, text: `Backup status unavailable (GitHub answered ${res.status}).` };
    return describeBackups((await res.json()).workflow_runs);
  } catch {
    return { ok: false, text: "Backup status unavailable (GitHub didn't answer)." };
  }
}
