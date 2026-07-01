-- Role-level query guard for Neon.
--
-- The concrete app role name is environment-specific. The raw command is:
--   alter role <app_role> set statement_timeout = '15000';
--
-- This migration applies the setting to the role running migrations. If that
-- role is not the production app role, or Neon rejects ALTER ROLE for the
-- migration user, set statement_timeout=15000 for the app role in the Neon
-- Console as the deployment fallback.

do $$
begin
  execute format('alter role %I set statement_timeout = %L', current_user, '15000');
exception
  when insufficient_privilege then
    raise notice 'Could not alter role %. Set statement_timeout=15000 in the Neon Console.', current_user;
end $$;
