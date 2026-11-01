# Migration diff — v1.0 → v1.1

File: `supabase/migrations/20261101000000_v1_1_agreement.sql` (additive, re-runnable). Rollback: `supabase/rollback/20261101000000_v1_1_agreement_down.sql`.

## Schema changes

| Object | Change | Compatibility |
| --- | --- | --- |
| `projects.exclusions` | new `text`, nullable, ≤ 4000 chars | existing rows get NULL |
| `projects.terms` | new `text`, nullable, ≤ 4000 chars | existing rows get NULL |
| `projects.extra_revision_cents` | new `bigint`, nullable, 0 – 100,000,000,000 | existing rows get NULL |
| `revision_requests.client_request_id` | new `uuid`, nullable | existing rows get NULL |
| index `revision_requests_client_request_once` | unique (project_id, client_request_id) where not null | ignores old rows (NULL) |
| index `revision_requests_number_once` | unique (deliverable_id, revision_number) where in_scope | existing data already unique (row lock); creation fails safely inside the transaction otherwise |
| index `activity_scope_viewed_once` | unique (metadata→snapshot_id) where event = 'scope.viewed' | new event type only |
| `portal_request_revision` | signature gains `p_request_id uuid default null`; old 5-argument signature dropped | v1.0 calls (5 named args) still resolve; execute re-granted to anon/authenticated, revoked from PUBLIC |

No tables added or dropped. No data rewritten. Row Level Security policies and table grants unchanged.

## Function changes (unified diff of each replaced function)

### `_guard_revision_classification`

```diff
--- v1.0 _guard_revision_classification
+++ v1.1 _guard_revision_classification
@@ -6,8 +6,8 @@
 begin
   if (new.project_id, new.deliverable_id, new.kind, new.description, new.requested_by,
-      new.in_scope, new.revision_number, new.created_at)
+      new.in_scope, new.revision_number, new.created_at, new.client_request_id)
      is distinct from
      (old.project_id, old.deliverable_id, old.kind, old.description, old.requested_by,
-      old.in_scope, old.revision_number, old.created_at) then
+      old.in_scope, old.revision_number, old.created_at, old.client_request_id) then
     raise exception 'Revision request details are immutable' using errcode = '42501';
   end if;
```

### `_build_scope`

```diff
--- v1.0 _build_scope
+++ v1.1 _build_scope
@@ -12,4 +12,7 @@
     'start_date', p.start_date,
     'due_date', p.due_date,
+    'exclusions', p.exclusions,
+    'terms', p.terms,
+    'extra_revision_cents', p.extra_revision_cents,
     'client', jsonb_build_object('name', c.name, 'company', c.company, 'email', c.email),
     'deliverables', coalesce((
```

### `save_project`

```diff
--- v1.0 save_project
+++ v1.1 save_project
@@ -40,5 +40,6 @@
 
   if p_project_id is null then
-    insert into public.projects (owner_id, client_id, title, summary, currency, budget_cents, start_date, due_date)
+    insert into public.projects (owner_id, client_id, title, summary, currency, budget_cents, start_date, due_date,
+                                 exclusions, terms, extra_revision_cents)
     values (v_uid, v_client_id,
             trim(p ->> 'title'),
@@ -47,5 +48,8 @@
             (p ->> 'budget_cents')::bigint,
             nullif(p ->> 'start_date', '')::date,
-            nullif(p ->> 'due_date', '')::date)
+            nullif(p ->> 'due_date', '')::date,
+            nullif(trim(coalesce(p ->> 'exclusions', '')), ''),
+            nullif(trim(coalesce(p ->> 'terms', '')), ''),
+            nullif(p ->> 'extra_revision_cents', '')::bigint)
     returning * into v_project;
     perform public._log(v_project.id, 'freelancer', null, 'project.created', 'Project created');
@@ -59,4 +63,9 @@
            start_date = nullif(p ->> 'start_date', '')::date,
            due_date = nullif(p ->> 'due_date', '')::date,
+           -- Backward compatible: a client that doesn't send these keys (v1.0 app) keeps them.
+           exclusions = case when p ? 'exclusions' then nullif(trim(coalesce(p ->> 'exclusions', '')), '') else exclusions end,
+           terms = case when p ? 'terms' then nullif(trim(coalesce(p ->> 'terms', '')), '') else terms end,
+           extra_revision_cents = case when p ? 'extra_revision_cents' then nullif(p ->> 'extra_revision_cents', '')::bigint
+                                       else extra_revision_cents end,
            updated_at = now()
      where id = p_project_id
```

### `portal_view`

```diff
--- v1.0 portal_view
+++ v1.1 portal_view
@@ -22,4 +22,15 @@
    where project_id = v.id order by version desc limit 1;
 
+  -- Approval timeline: note the first time the client opens a scope version that is
+  -- still waiting for a decision. Once per version (unique index), never repeated.
+  if v_snap.id is not null and v.status = 'awaiting_approval'
+     and not exists (select 1 from public.scope_decisions where snapshot_id = v_snap.id) then
+    insert into public.activity_log (project_id, actor, actor_name, event, summary, metadata)
+    values (v.id, 'client', v_client.name, 'scope.viewed',
+            format('Client opened scope v%s', v_snap.version),
+            jsonb_build_object('snapshot_id', v_snap.id, 'version', v_snap.version))
+    on conflict ((metadata ->> 'snapshot_id')) where event = 'scope.viewed' do nothing;
+  end if;
+
   return jsonb_build_object(
     'project', jsonb_build_object(
@@ -42,5 +53,7 @@
                'revisions_included', d.revisions_included,
                'revisions_used', (select count(*) from public.revision_requests r
-                                   where r.deliverable_id = d.id and r.kind = 'revision' and r.in_scope))
+                                   where r.deliverable_id = d.id and r.kind = 'revision' and r.in_scope),
+               'revisions_extra', (select count(*) from public.revision_requests r
+                                    where r.deliverable_id = d.id and r.kind = 'revision' and not r.in_scope))
              order by d.position)
         from public.deliverables d where d.project_id = v.id), '[]'::jsonb) end,
```

### `portal_request_revision`

```diff
--- v1.0 portal_request_revision
+++ v1.1 portal_request_revision
@@ -1,5 +1,5 @@
 create or replace function public.portal_request_revision(
   p_token text, p_kind public.revision_kind, p_deliverable_id uuid,
-  p_description text, p_client_name text)
+  p_description text, p_client_name text, p_request_id uuid default null)
 returns jsonb
 language plpgsql
@@ -18,4 +18,5 @@
   v_id uuid;
   v_summary text;
+  v_prior public.revision_requests;
 begin
   select * into g from public._portal_gate(p_token, true, true);
@@ -24,4 +25,19 @@
   end if;
   v := g.o_project;
+
+  -- Retries of the same submission (double tap, network retry) return the original
+  -- result instead of using up another revision. The project row is locked above, so
+  -- this check and the insert below can't interleave with a concurrent request.
+  if p_request_id is not null then
+    select * into v_prior from public.revision_requests
+     where project_id = v.id and client_request_id = p_request_id;
+    if found then
+      return jsonb_build_object('ok', true, 'in_scope', v_prior.in_scope, 'revision_number', v_prior.revision_number,
+                                'revisions_included', (select revisions_included from public.deliverables
+                                                        where id = v_prior.deliverable_id),
+                                'duplicate', true);
+    end if;
+  end if;
+
   if v.status <> 'active' then
     raise exception 'Requests can only be made while the project is in progress' using errcode = '55000';
@@ -56,7 +72,7 @@
 
   insert into public.revision_requests (project_id, deliverable_id, kind, description, requested_by,
-                                        in_scope, revision_number)
+                                        in_scope, revision_number, client_request_id)
   values (v.id, case when p_kind = 'revision' then v_del.id end, p_kind, v_desc, v_name,
-          v_in_scope, v_number)
+          v_in_scope, v_number, p_request_id)
   returning id into v_id;
 
```

