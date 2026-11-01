# Permission audit

Generated from the database catalog after applying: `20261031000000_scopeflow_schema.sql`, `20261101000000_v1_1_agreement.sql`.
Roles: `anon` = anyone with the public key (client portal, signed-out visitors); `authenticated` = a signed-in freelancer.

## Tables

| Table | RLS on | anon read | anon write | signed-in read | signed-in write | Policies |
| --- | --- | --- | --- | --- | --- | --- |
| activity_log | yes | — | — | yes | — | own activity (select) |
| beta_allowlist | yes | — | — | — | — | none (no API access) |
| change_order_decisions | yes | — | — | yes | — | own change order decisions (select) |
| change_orders | yes | — | — | yes | — | own change orders (select) |
| clients | yes | — | — | yes | — | own clients (select) |
| deliverables | yes | — | — | yes | — | own deliverables (select) |
| milestones | yes | — | — | yes | — | own milestones (select) |
| portal_rate_limits | yes | — | — | — | — | none (no API access) |
| profiles | yes | — | — | yes | — | own profile (select) |
| projects | yes | — | — | yes | — | own projects (select) |
| revision_requests | yes | — | — | yes | — | own revision requests (select) |
| scope_decisions | yes | — | — | yes | — | own scope decisions (select) |
| scope_snapshots | yes | — | — | yes | — | own snapshots (select) |
| share_links | yes | — | — | columns only | — | own share links (select) |

`share_links`: signed-in users may read only (created_at, expires_at, id, project_id, revoked_at) — never `token_hash`.

**Result:** 14 tables, 0 without Row Level Security, 0 writable directly by API roles. All writes go through the functions below.

## Functions

| Function | Runs as owner | search_path pinned | anon | signed-in | PUBLIC | Authorization |
| --- | --- | --- | --- | --- | --- | --- |
| `health()` | yes | yes | yes | yes | — | none needed — returns 'ok' |
| `portal_decide_change_order(p_token text, p_change_order_id uuid, p_decision decision, p_client_name text, p_comment text)` | yes | yes | yes | yes | — | client link (hashed token, expiry, revocation, rate limits) |
| `portal_decide_scope(p_token text, p_snapshot_id uuid, p_decision decision, p_client_name text, p_comment text)` | yes | yes | yes | yes | — | client link (hashed token, expiry, revocation, rate limits) |
| `portal_request_revision(p_token text, p_kind revision_kind, p_deliverable_id uuid, p_description text, p_client_name text, p_request_id uuid)` | yes | yes | yes | yes | — | client link (hashed token, expiry, revocation, rate limits) |
| `portal_view(p_token text)` | yes | yes | yes | yes | — | client link (hashed token, expiry, revocation, rate limits) |
| `_handle_new_user()` | yes | yes | — | — | — | sign-up trigger only (beta allowlist) |
| `cancel_project(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `complete_change_order_work(p_change_order_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `complete_onboarding(p_full_name text, p_business_name text, p_currency text)` | yes | yes | — | yes | — | signed-in user's own rows |
| `complete_project(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `create_change_order(p_project_id uuid, p jsonb)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `delete_draft_project(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `mark_notifications_seen()` | yes | yes | — | yes | — | signed-in user's own rows |
| `recall_scope(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `resolve_revision(p_revision_id uuid, p_note text)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `revoke_share_link(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `rotate_share_link(p_project_id uuid, p_expires_in_days integer)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `save_project(p_project_id uuid, p jsonb)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `send_scope(p_project_id uuid, p_link_days integer)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `set_milestone_paid(p_milestone_id uuid, p_paid boolean, p_note text)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `unread_notification_count()` | yes | yes | — | yes | — | signed-in user's own rows |
| `withdraw_change_order(p_change_order_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `_build_scope(p_project_id uuid)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_clean_name(p_name text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_forbid_mutation()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_guard_change_order_terms()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_guard_revision_classification()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_hash_token(p_token text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_issue_link(p_project_id uuid, p_days integer)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_log(p_project uuid, p_actor actor_type, p_actor_name text, p_event text, p_summary text, p_meta jsonb)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_new_token()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_owned_project(p_id uuid)` | — | yes | — | — | — | signed-in user's own rows |
| `_portal_error(p_code text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_portal_gate(p_token text, p_lock boolean, p_write boolean, OUT o_project projects, OUT o_error text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_rate_hit(p_bucket text, p_window_seconds integer, p_max integer)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_request_meta()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_trusted_client_ip()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_uid()` | — | yes | — | — | — | signed-in user's own rows |
| `_window_start(p_seconds integer)` | — | yes | — | — | — | internal helper (not callable from the API) |

**Result:** 22 owner-privileged functions; 0 without a pinned search_path; 0 without a recognised authorization check; 0 executable by PUBLIC. Callable by anyone with the public key: `health`, `portal_decide_change_order`, `portal_decide_scope`, `portal_request_revision`, `portal_view`.
