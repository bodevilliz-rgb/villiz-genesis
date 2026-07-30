-- Minimal assertion framework.
--
-- pgTAP is not available in this environment and pulling it in would add a
-- build dependency for four functions. These four are the four we need.
create schema if not exists test;

create table if not exists test.results (
  id         serial primary key,
  suite      text not null,
  name       text not null,
  passed     boolean not null,
  detail     text,
  ran_at     timestamptz not null default now()
);

create or replace function test.ok(p_suite text, p_name text, p_condition boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = test, pg_catalog as $$
begin
  insert into test.results (suite, name, passed, detail)
  values (p_suite, p_name, coalesce(p_condition, false), p_detail);
end;
$$;

create or replace function test.eq(p_suite text, p_name text, p_actual anyelement, p_expected anyelement)
returns void language plpgsql security definer set search_path = test, pg_catalog as $$
begin
  insert into test.results (suite, name, passed, detail)
  values (
    p_suite, p_name,
    p_actual is not distinct from p_expected,
    case when p_actual is not distinct from p_expected then null
         else format('expected %L, got %L', p_expected, p_actual) end
  );
end;
$$;

-- Asserts that a statement is rejected. Used for every negative security test:
-- proving something is blocked matters more than proving something works.
create or replace function test.throws(p_suite text, p_name text, p_sql text, p_expect_sqlstate text default null)
returns void language plpgsql as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;

  if v_state is null then
    perform test.ok(p_suite, p_name, false, 'statement was allowed but should have been rejected');
  elsif p_expect_sqlstate is not null and v_state <> p_expect_sqlstate then
    perform test.ok(p_suite, p_name, false, format('rejected with %s, expected %s', v_state, p_expect_sqlstate));
  else
    perform test.ok(p_suite, p_name, true, format('rejected with %s', v_state));
  end if;
end;
$$;

-- Become a signed-in staff member for the duration of the transaction. This is
-- what PostgREST does per request, so RLS is exercised exactly as in production.
create or replace function test.act_as(p_profile_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_profile_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end;
$$;

create or replace function test.act_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
end;
$$;


grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;
