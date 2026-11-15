-- Security audit: a queued portal mutation must not outlive link revocation or expiry.
-- No table, role, policy or public RPC permissions are broadened. Safe to re-run.
begin;

create or replace function public._portal_gate(
  p_token text, p_lock boolean, p_write boolean,
  out o_project public.projects, out o_error text)
language plpgsql
set search_path = ''
as $$
declare
  v_ip text := public._trusted_client_ip();
  v_ipkey text := case when v_ip is null then null else left(public._hash_token(v_ip), 32) end;
  v_link public.share_links;
begin
  if v_ipkey is not null then
    if coalesce((select hits from public.portal_rate_limits
                  where bucket = 'fail:' || v_ipkey and window_start = public._window_start(3600)), 0) >= 20 then
      o_error := 'rate_limited';
      return;
    end if;
    if not public._rate_hit('ip:' || v_ipkey, 600, 300) then
      o_error := 'rate_limited';
      return;
    end if;
  end if;

  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43}$' then
    select s.* into v_link from public.share_links s
     where s.token_hash = public._hash_token(p_token) and s.revoked_at is null;
  end if;
  if v_link.id is null then
    if v_ipkey is not null then
      perform public._rate_hit('fail:' || v_ipkey, 3600, 2147483647);
    end if;
    o_error := 'invalid_link';
    return;
  end if;
  if v_link.expires_at <= clock_timestamp() then
    o_error := 'expired_link';
    return;
  end if;

  if not public._rate_hit(case when p_write then 'lw:' else 'lr:' end || v_link.id::text,
                          case when p_write then 3600 else 600 end,
                          case when p_write then 30 else 300 end) then
    o_error := 'rate_limited';
    return;
  end if;

  if p_lock then
    select * into o_project from public.projects where id = v_link.project_id for update;
    -- Revocation/rotation use the same project lock. The token may have become
    -- invalid while this request waited for that lock, so authorize again using
    -- a fresh READ COMMITTED snapshot before permitting any client mutation.
    select s.* into v_link from public.share_links s
     where s.token_hash = public._hash_token(p_token) and s.revoked_at is null;
    if v_link.id is null then
      o_error := 'invalid_link';
      return;
    end if;
    if v_link.expires_at <= clock_timestamp() then
      o_error := 'expired_link';
      return;
    end if;
  else
    select * into o_project from public.projects where id = v_link.project_id;
  end if;
end;
$$;

revoke all on function public._portal_gate(text, boolean, boolean) from public, anon, authenticated;

commit;
