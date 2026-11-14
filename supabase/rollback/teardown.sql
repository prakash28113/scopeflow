-- =====================================================================
-- ScopeFlow — TEARDOWN (destructive, irreversible)
--
-- Removes every database object created by the migrations in
-- supabase/migrations/, including ALL
-- ScopeFlow data (projects, approvals, history). Accounts in auth.users are
-- NOT deleted (remove them in Authentication → Users if needed).
--
-- Use only to abort the beta or to recover from a failed first install.
-- TAKE A BACKUP FIRST (see DEPLOYMENT.md §7). Runs in one transaction:
-- if anything fails, nothing is changed.
-- =====================================================================
begin;

drop trigger if exists on_auth_user_created on auth.users;

-- Quote numbers (if installed).
-- Fix-list migrations (20261120…24): usage counts, owner notification emails, spelling, activation.
drop function if exists public.admin_activation, public.admin_usage_counts, public.log_usage_event,
  public.set_notification_prefs, public.notify_claim, public.notify_mark, public._queue_owner_email,
  public._blog_spelling, public._brand_spelling cascade;
drop table if exists public.usage_events, public.owner_emails cascade;
-- Payment nudges (if installed).
drop function if exists public.record_nudge cascade;
drop table if exists public.nudges cascade;
-- TDS on payments: the columns go with the tables below.
drop function if exists public._number_quote, public._next_quote_number cascade;
-- Brand & growth (if installed).
drop function if exists public.set_signup_source, public._require_feature, public._has_feature, public._blog_unique_meta, public.admin_signup_sources cascade;
-- GST and invoicing (if installed).
drop function if exists public.add_payment, public.archive_client, public.delete_client, public._unarchive_client,
  public._today_india, public._financial_year, public._money, public._gst_state_name, public._clean_state,
  public._clean_gstin cascade;
-- Blog (if installed).
drop table if exists public.blog_api_keys, public.blog_posts, public.blog_authors cascade;
drop function if exists public.blog_publish_with_key, public.revoke_blog_key, public.blog_my_keys, public.create_blog_key,
  public._save_blog_post, public.delete_blog_post, public.save_blog_post, public.blog_my_posts,
  public._slugify, public._require_blog_author, public.is_blog_author cascade;
-- Razorpay billing (if installed).
drop table if exists public.billing_checkouts, public.provider_plans cascade;
drop function if exists
  public.process_razorpay_event, public.billing_mark_cancelling, public.billing_current_subscription,
  public.billing_record_checkout, public.billing_save_provider_plan, public.billing_prepare_checkout
cascade;
-- Subscription plans (if installed).
drop table if exists
  public.early_access_requests, public.invoices, public.billing_events,
  public.subscription_changes, public.subscriptions, public.plans
cascade;
drop function if exists
  public.process_billing_event, public.admin_set_plan, public._set_subscription, public.join_early_access,
  public.my_plan, public._check_plan_limits, public._plan_usage, public._effective_plan,
  public._create_subscription, public._forbid_change
cascade;
-- v1.2 (if installed).
drop function if exists public.update_client, public._quote_totals cascade;
drop function if exists public.set_payment_details cascade;
-- Outside requests (if installed).
drop function if exists public.log_client_request, public.create_client cascade;
drop function if exists public.save_template, public.delete_template, public._check_quote_validity, public._today_anywhere cascade;
-- Follow-ups (if installed).
drop table if exists public.scope_templates cascade;
drop table if exists public.follow_ups cascade;
drop function if exists public.add_follow_up, public.set_follow_up_done, public.delete_follow_up cascade;
-- Payments (if installed).
drop table if exists public.payments cascade;
drop function if exists public.record_payment, public.delete_payment, public._sync_milestone cascade;
-- Progress and expenses (if installed).
drop table if exists public.expenses cascade;
drop function if exists public.set_deliverable_progress, public.add_expense, public.delete_expense cascade;
-- Invoices (if installed).
drop table if exists public.client_invoices cascade;
drop function if exists public.create_invoice, public.void_invoice, public.set_invoice_details,
  public.update_client_billing, public._invoice_guard cascade;

drop table if exists
  public.activity_log,
  public.change_order_decisions,
  public.milestones,
  public.change_orders,
  public.revision_requests,
  public.scope_decisions,
  public.share_links,
  public.scope_snapshots,
  public.deliverables,
  public.projects,
  public.clients,
  public.profiles,
  public.beta_allowlist,
  public.portal_rate_limits
cascade;

drop function if exists
  public._forbid_mutation, public._guard_change_order_terms, public._guard_revision_classification,
  public._handle_new_user, public._uid, public._owned_project, public._log, public._hash_token,
  public._new_token, public._window_start, public._rate_hit, public._trusted_client_ip,
  public._portal_gate, public._portal_error, public._request_meta, public._clean_name, public._build_scope,
  public._issue_link,
  public.complete_onboarding, public.save_project, public.delete_draft_project, public.rotate_share_link,
  public.revoke_share_link, public.send_scope, public.recall_scope, public.resolve_revision,
  public.create_change_order, public.withdraw_change_order, public.complete_change_order_work,
  public.set_milestone_paid, public.complete_project, public.cancel_project,
  public.portal_view, public.portal_decide_scope, public.portal_request_revision,
  public.portal_decide_change_order, public.unread_notification_count, public.mark_notifications_seen,
  public.health
cascade;

drop type if exists
  public.project_status, public.decision, public.revision_kind, public.revision_status,
  public.change_order_status, public.pricing_type, public.milestone_status, public.actor_type
cascade;

-- Restore Supabase's default: new functions in public are executable by the API roles.
alter default privileges in schema public grant execute on functions to public, anon, authenticated;

commit;
