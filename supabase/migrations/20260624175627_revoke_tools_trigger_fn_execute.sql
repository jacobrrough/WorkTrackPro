-- The updated_at trigger helper must not be callable as an API RPC. Supabase grants EXECUTE on
-- new functions to anon/authenticated by default, so revoke it explicitly — matching the
-- trigger-fn lockdown in 20260609142517_security_revoke_trigger_fns_and_tighten_rls. The
-- tool_take/tool_assign/tool_put_away/tool_retire RPCs intentionally stay authenticated-callable.
revoke all on function public.touch_tools_updated_at() from anon, authenticated;
