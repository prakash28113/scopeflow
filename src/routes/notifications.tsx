import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { PageSpinner } from "@/components/app-shell";
import { useProfile } from "@/lib/auth";
import { useDashboard, useNotifications } from "@/lib/queries";
import { openProjects, remindersFrom } from "@/lib/use-reminders";
import { RemindersCard } from "@/components/reminders";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/format";

export default function Notifications() {
  const profile = useProfile();
  const list = useNotifications();
  const dash = useDashboard();
  const qc = useQueryClient();
  // Remember what was unread when the page opened, then mark everything as seen.
  const seenBefore = useRef<string | null>(null);
  if (seenBefore.current === null && profile.data) seenBefore.current = profile.data.notifications_seen_at;

  useEffect(() => {
    if (!list.data) return;
    supabase.rpc("mark_notifications_seen").then(({ error }) => {
      if (!error) {
        qc.setQueryData(["notifications", "count"], 0);
        qc.invalidateQueries({ queryKey: ["profile"] });
      }
    });
  }, [list.data, qc]);

  if (list.isLoading || dash.isLoading || !profile.data) return <PageSpinner />;
  if (list.isError) return <Alert>Couldn't load notifications. Please refresh.</Alert>;
  const items = list.data ?? [];
  const cutoff = seenBefore.current ?? "";

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notifications" description="Everything that needs you, in one place: reminders, and what your clients did on their project pages." />
      {dash.data ? <RemindersCard reminders={remindersFrom(dash.data)} projects={openProjects(dash.data)} /> : null}
      <h2 className="mb-3 text-[15px] font-semibold">Client activity</h2>
      <Card>
        {items.length === 0 ? (
          <EmptyState title="Nothing yet" body="Approvals, change requests and change-order decisions from clients will appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const unread = Boolean(cutoff) && Date.parse(n.created_at) > Date.parse(cutoff);
              return (
                <li key={n.id}>
                  <Link to={`/projects/${n.project_id}`} className={cx("flex gap-3 px-5 py-4 hover:bg-sunken/60", unread && "bg-accent-soft/50")}>
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-accent" : "bg-line-strong")} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        {n.summary}
                        {unread ? <span className="sr-only"> (new)</span> : null}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {n.projects.title} · {formatDateTime(n.created_at)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
