# Permission audit

Generated from the database catalog after applying: `20261031000000_scopeflow_schema.sql`, `20261101000000_v1_1_agreement.sql`, `20261102000000_subscription_plans.sql`, `20261103000000_v1_2_business_tools.sql`, `20261104000000_upi_payments.sql`, `20261105000000_client_invoices.sql`, `20261106000000_progress_and_expenses.sql`, `20261107000000_payments.sql`, `20261108000000_follow_ups.sql`, `20261109000000_outside_requests.sql`, `20261110000000_deliverable_due_dates.sql`, `20261111000000_quotes.sql`, `20261112000000_razorpay_billing.sql`, `20261113000000_blog.sql`, `20261114000000_blog_images.sql`, `20261115000000_gst_invoicing.sql`, `20261116000000_brand_growth.sql`, `20261117000000_fix_owner_surname.sql`, `20261118000000_quote_numbers.sql`, `20261120000000_billing_activation_needs_payment.sql`, `20261121000000_blog_spelling.sql`, `20261122000000_usage_events.sql`, `20261123000000_owner_notifications.sql`, `20261124000000_activation.sql`, `20261125000000_payment_nudges.sql`, `20261126000000_payment_tds.sql`, `20261127000000_portal_revocation_gate.sql`.
Roles: `anon` = anyone with the public key (client portal, signed-out visitors); `authenticated` = a signed-in freelancer.

## Tables

| Table | RLS on | anon read | anon write | signed-in read | signed-in write | Policies |
| --- | --- | --- | --- | --- | --- | --- |
| activity_log | yes | — | — | yes | — | own activity (select) |
| beta_allowlist | yes | — | — | — | — | none (no API access) |
| billing_checkouts | yes | — | — | — | — | none (no API access) |
| billing_events | yes | — | — | — | — | none (no API access) |
| blog_api_keys | yes | — | — | — | — | none (no API access) |
| blog_authors | yes | — | — | — | — | none (no API access) |
| blog_posts | yes | yes | — | yes | — | published posts are public (select) |
| change_order_decisions | yes | — | — | yes | — | own change order decisions (select) |
| change_orders | yes | — | — | yes | — | own change orders (select) |
| client_invoices | yes | — | — | yes | — | own client invoices (select) |
| clients | yes | — | — | yes | — | own clients (select) |
| deliverables | yes | — | — | yes | — | own deliverables (select) |
| early_access_requests | yes | — | — | yes | — | own early access (select) |
| expenses | yes | — | — | yes | — | own expenses (select) |
| follow_ups | yes | — | — | yes | — | own follow-ups (select) |
| invoices | yes | — | — | yes | — | own invoices (select) |
| milestones | yes | — | — | yes | — | own milestones (select) |
| nudges | yes | — | — | yes | — | own nudges (select) |
| owner_emails | yes | — | — | — | — | none (no API access) |
| payments | yes | — | — | yes | — | own payments (select) |
| plans | yes | yes | — | yes | — | plans are public (select) |
| portal_rate_limits | yes | — | — | — | — | none (no API access) |
| profiles | yes | — | — | yes | — | own profile (select) |
| projects | yes | — | — | yes | — | own projects (select) |
| provider_plans | yes | — | — | — | — | none (no API access) |
| revision_requests | yes | — | — | yes | — | own revision requests (select) |
| scope_decisions | yes | — | — | yes | — | own scope decisions (select) |
| scope_snapshots | yes | — | — | yes | — | own snapshots (select) |
| scope_templates | yes | — | — | yes | — | own templates (select) |
| share_links | yes | — | — | columns only | — | own share links (select) |
| subscription_changes | yes | — | — | yes | — | own subscription changes (select) |
| subscriptions | yes | — | — | — | — | own subscription (select) |
| usage_events | yes | — | — | yes | — | own usage events (select) |

`share_links`: signed-in users may read only (created_at, expires_at, id, project_id, revoked_at) — never `token_hash`.

**Result:** 33 tables, 0 without Row Level Security, 0 writable directly by API roles. All writes go through the functions below.

## Functions

| Function | Runs as owner | search_path pinned | anon | signed-in | PUBLIC | Authorization |
| --- | --- | --- | --- | --- | --- | --- |
| `health()` | yes | yes | yes | yes | — | none needed — returns 'ok' |
| `portal_decide_change_order(p_token text, p_change_order_id uuid, p_decision decision, p_client_name text, p_comment text)` | yes | yes | yes | yes | — | client link (hashed token, expiry, revocation, rate limits) |
| `portal_decide_scope(p_token text, p_snapshot_id uuid, p_decision decision, p_client_name text, p_comment text)` | yes | yes | yes | yes | — | client link (hashed token, expiry, revocation, rate limits) |
| `portal_request_revision(p_token text, p_kind revision_kind, p_deliverable_id uuid, p_description text, p_client_name text, p_request_id uuid)` | yes | yes | yes | yes | — | client link (hashed token, expiry, revocation, rate limits) |
| `portal_view(p_token text)` | yes | yes | yes | yes | — | client link (hashed token, expiry, revocation, rate limits) |
| `_create_subscription()` | yes | yes | — | — | — | profile trigger only (Free plan for new accounts) |
| `_handle_new_user()` | yes | yes | — | — | — | sign-up trigger only (beta allowlist) |
| `_number_quote()` | yes | yes | — | — | — | quote-sent trigger only (gives the quote its number) |
| `_queue_owner_email()` | yes | yes | — | — | — | timeline trigger only (queues an email for the project's owner) |
| `add_expense(p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `add_follow_up(p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `add_payment(p_project_id uuid, p jsonb)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `admin_activation()` | yes | yes | — | — | — | no API role — Supabase SQL editor only |
| `admin_set_plan(p_email text, p_plan text, p_status text, p_interval text, p_period_end timestamp with time zone, p_note text)` | yes | yes | — | — | — | no API role — Supabase SQL editor only |
| `admin_signup_sources()` | yes | yes | — | — | — | no API role — Supabase SQL editor only |
| `admin_usage_counts()` | yes | yes | — | — | — | no API role — Supabase SQL editor only |
| `archive_client(p_client_id uuid, p_archived boolean)` | yes | yes | — | yes | — | signed-in user's own rows |
| `billing_current_subscription(p_owner uuid)` | yes | yes | — | — | — | service role only — billing Edge Function, after verifying the user's session |
| `billing_mark_cancelling(p_owner uuid, p_subscription_id text)` | yes | yes | — | — | — | service role only — billing Edge Function, after verifying the user's session |
| `billing_prepare_checkout(p_owner uuid, p_plan text, p_interval text, p_mode text, p_tester boolean)` | yes | yes | — | — | — | service role only — billing Edge Function, after verifying the user's session |
| `billing_record_checkout(p_owner uuid, p_subscription_id text, p_mode text, p_plan text, p_interval text, p_amount integer, p_currency text)` | yes | yes | — | — | — | service role only — billing Edge Function, after verifying the user's session |
| `billing_save_provider_plan(p_mode text, p_plan text, p_interval text, p_amount integer, p_currency text, p_provider_plan_id text)` | yes | yes | — | — | — | service role only — billing Edge Function, after verifying the user's session |
| `blog_my_keys()` | yes | yes | — | yes | — | blog authors only (signed-in account listed in blog_authors) |
| `blog_my_posts()` | yes | yes | — | yes | — | blog authors only (signed-in account listed in blog_authors) |
| `blog_publish_with_key(p_key_hash text, p jsonb)` | yes | yes | — | — | — | service role only — blog Edge Function, after hashing the publishing key |
| `cancel_project(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `complete_change_order_work(p_change_order_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `complete_onboarding(p_full_name text, p_business_name text, p_currency text)` | yes | yes | — | yes | — | signed-in user's own rows |
| `complete_project(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `create_blog_key(p_label text)` | yes | yes | — | yes | — | blog authors only (signed-in account listed in blog_authors) |
| `create_change_order(p_project_id uuid, p jsonb)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `create_client(p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `create_invoice(p_milestone_id uuid, p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `delete_blog_post(p_id uuid)` | yes | yes | — | yes | — | blog authors only (signed-in account listed in blog_authors) |
| `delete_client(p_client_id uuid)` | yes | yes | — | yes | — | signed-in user's own rows |
| `delete_draft_project(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `delete_expense(p_expense_id uuid)` | yes | yes | — | yes | — | signed-in user's own rows |
| `delete_follow_up(p_follow_up_id uuid)` | yes | yes | — | yes | — | signed-in user's own rows |
| `delete_payment(p_payment_id uuid)` | yes | yes | — | yes | — | signed-in user's own rows |
| `delete_template(p_template_id uuid)` | yes | yes | — | yes | — | signed-in user's own rows |
| `is_blog_author()` | yes | yes | — | yes | — | signed-in user's own rows |
| `join_early_access(p_plan text, p_interval text)` | yes | yes | — | yes | — | signed-in user's own rows |
| `log_client_request(p_project_id uuid, p jsonb)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `log_usage_event(p_event text, p_detail text)` | yes | yes | — | yes | — | signed-in user's own rows |
| `mark_notifications_seen()` | yes | yes | — | yes | — | signed-in user's own rows |
| `my_plan()` | yes | yes | — | yes | — | signed-in user's own rows |
| `notify_claim(p_limit integer)` | yes | yes | — | — | — | service role only — notify Edge Function (sends queued owner emails) |
| `notify_mark(p_id uuid, p_ok boolean, p_error text)` | yes | yes | — | — | — | service role only — notify Edge Function (sends queued owner emails) |
| `process_billing_event(p_provider text, p_event_id text, p_event_type text, p_owner uuid, p_plan text, p_interval text, p_period_end timestamp with time zone, p_payload jsonb)` | yes | yes | — | — | — | service role only — future signature-verified payment webhook |
| `process_razorpay_event(p_event_id text, p_mode text, p_event jsonb)` | yes | yes | — | — | — | service role only — billing Edge Function, after verifying Razorpay's signature |
| `recall_scope(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `record_nudge(p_invoice_id uuid, p jsonb)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `record_payment(p_milestone_id uuid, p jsonb)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `resolve_revision(p_revision_id uuid, p_note text)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `revoke_blog_key(p_id uuid)` | yes | yes | — | yes | — | blog authors only (signed-in account listed in blog_authors) |
| `revoke_share_link(p_project_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `rotate_share_link(p_project_id uuid, p_expires_in_days integer)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `save_blog_post(p_id uuid, p jsonb)` | yes | yes | — | yes | — | blog authors only (signed-in account listed in blog_authors) |
| `save_project(p_project_id uuid, p jsonb)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `save_template(p_name text, p_data jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `send_scope(p_project_id uuid, p_link_days integer)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `set_deliverable_progress(p_deliverable_id uuid, p_progress text)` | yes | yes | — | yes | — | signed-in user's own rows |
| `set_follow_up_done(p_follow_up_id uuid, p_done boolean)` | yes | yes | — | yes | — | signed-in user's own rows |
| `set_invoice_details(p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `set_milestone_paid(p_milestone_id uuid, p_paid boolean, p_note text)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `set_notification_prefs(p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `set_payment_details(p_upi_id text)` | yes | yes | — | yes | — | signed-in user's own rows |
| `set_signup_source(p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `unread_notification_count()` | yes | yes | — | yes | — | signed-in user's own rows |
| `update_client(p_client_id uuid, p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `update_client_billing(p_client_id uuid, p jsonb)` | yes | yes | — | yes | — | signed-in user's own rows |
| `void_invoice(p_invoice_id uuid, p_reason text)` | yes | yes | — | yes | — | signed-in user's own rows |
| `withdraw_change_order(p_change_order_id uuid)` | yes | yes | — | yes | — | project owner (owner_id = signed-in user, row locked) |
| `_blog_spelling()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_blog_unique_meta()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_brand_spelling(t text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_build_scope(p_project_id uuid)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_check_plan_limits(p_owner uuid, p_new_project boolean, p_client_email text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_check_quote_validity()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_clean_gstin(p text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_clean_name(p_name text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_clean_state(p text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_effective_plan(p_owner uuid)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_financial_year(p date)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_forbid_change()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_forbid_mutation()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_gst_state_name(p_code text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_guard_change_order_terms()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_guard_revision_classification()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_has_feature(p_owner uuid, p_feature text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_hash_token(p_token text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_invoice_guard()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_issue_link(p_project_id uuid, p_days integer)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_log(p_project uuid, p_actor actor_type, p_actor_name text, p_event text, p_summary text, p_meta jsonb)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_money(p_cents bigint, p_currency text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_new_token()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_next_quote_number(p_owner uuid, p_day date)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_owned_project(p_id uuid)` | — | yes | — | — | — | signed-in user's own rows |
| `_plan_usage(p_owner uuid)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_portal_error(p_code text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_portal_gate(p_token text, p_lock boolean, p_write boolean, OUT o_project projects, OUT o_error text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_quote_totals(p_project_id uuid)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_rate_hit(p_bucket text, p_window_seconds integer, p_max integer)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_request_meta()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_require_blog_author()` | — | yes | — | — | — | signed-in user's own rows |
| `_require_feature(p_owner uuid, p_feature text, p_what text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_save_blog_post(p_id uuid, p jsonb, p_author_name text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_set_subscription(p_owner uuid, p_plan text, p_status text, p_interval text, p_period_end timestamp with time zone, p_grace_until timestamp with time zone, p_source text, p_reference text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_slugify(p text)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_sync_milestone(p_milestone_id uuid)` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_today_anywhere()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_today_india()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_trusted_client_ip()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_uid()` | — | yes | — | — | — | signed-in user's own rows |
| `_unarchive_client()` | — | yes | — | — | — | internal helper (not callable from the API) |
| `_window_start(p_seconds integer)` | — | yes | — | — | — | internal helper (not callable from the API) |

**Result:** 73 owner-privileged functions; 0 without a pinned search_path; 0 without a recognised authorization check; 0 executable by PUBLIC. Callable by anyone with the public key: `health`, `portal_decide_change_order`, `portal_decide_scope`, `portal_request_revision`, `portal_view`.
