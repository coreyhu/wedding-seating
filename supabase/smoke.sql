\set ON_ERROR_STOP on
begin;
-- simulate an authenticated user for RPC auth checks
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
-- allowlist that user as admin (transaction-local; rolled back at the end)
insert into admins (user_id) values ('11111111-1111-1111-1111-111111111111');

do $$
declare n int;
begin
  select count(*) into n from search_guests('eric');   assert n = 2, 'eric should match 2';
  select count(*) into n from search_guests('e');      assert n = 0, 'short latin returns none';
  select count(*) into n from search_guests('刘');     assert n = 1, 'single CJK matches';
  select count(*) into n from search_guests('jose');   assert n = 1, 'diacritic-insensitive';
  select count(*) into n from search_guests('carolzhao'); assert n = 1, 'space-insensitive';
end $$;

do $$
declare a uuid; b uuid;
begin
  select id into a from guests where name_en = 'Carol Zhao';
  select id into b from guests where name_en = 'Kevin Hu';
  perform assign_seat(a, 1, 2);  -- Kevin sits there → swap
  assert (select seat_no from guests where id = a) = 2, 'carol moved';
  assert (select seat_no from guests where id = b) = 1, 'kevin swapped back';
  perform unseat(b);
  assert (select table_no from guests where id = b) is null, 'kevin unseated';
  perform assign_seat(b, 1, 1);
end $$;

do $$
declare n int;
begin
  select import_guests('[{"name_en":"New Guy","name_zh":"新人"},{"name_en":"Carol Zhao","name_zh":"赵卡罗"},{"name_en":"","name_zh":""}]'::jsonb) into n;
  assert n = 1, format('import inserts only the new row, got %s', n);
end $$;

-- an authenticated user who is NOT in admins must not be able to write
do $$
declare a uuid;
begin
  select id into a from guests where name_en = 'Carol Zhao';
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  begin
    perform assign_seat(a, 2, 3);
    raise exception 'non-admin wrote via assign_seat — is_admin gate broken';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
  begin
    perform unseat(a);
    raise exception 'non-admin wrote via unseat — is_admin gate broken';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
  begin
    perform import_guests('[{"name_en":"Intruder","name_zh":""}]'::jsonb);
    raise exception 'non-admin wrote via import_guests — is_admin gate broken';
  exception when raise_exception then
    if sqlerrm <> 'not authorized' then raise; end if;
  end;
  -- restore the admin sub for any later checks
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
end $$;

-- table grants + RLS must allow the intended reads (checked as the API roles,
-- since the superuser bypasses RLS and would mask missing grants)
do $$
declare n int;
begin
  set local role authenticated;
  select count(*) into n from guests; assert n > 0, 'authenticated reads guests';
  select count(*) into n from tables; assert n = 12, 'authenticated reads tables';
  reset role;
  set local role anon;
  select count(*) into n from tables; assert n = 12, 'anon reads tables';
  reset role;
end $$;

-- function execute privileges: search is public-facing, writes are not
do $$
begin
  assert has_function_privilege('anon', 'search_guests(text)', 'execute'),
    'anon can execute search_guests';
  assert has_function_privilege('authenticated', 'search_guests(text)', 'execute'),
    'authenticated can execute search_guests';
  assert not has_function_privilege('anon', 'assign_seat(uuid,int,int)', 'execute'),
    'anon cannot execute assign_seat';
  assert not has_function_privilege('anon', 'unseat(uuid)', 'execute'),
    'anon cannot execute unseat';
  assert not has_function_privilege('anon', 'import_guests(jsonb)', 'execute'),
    'anon cannot execute import_guests';
  assert has_function_privilege('authenticated', 'assign_seat(uuid,int,int)', 'execute'),
    'authenticated can execute assign_seat';
end $$;

-- anon must not read guests directly
do $$
begin
  set local role anon;
  begin
    perform count(*) from guests;
    raise exception 'anon read guests — RLS/grants broken';
  exception when insufficient_privilege then reset role;
  end;
end $$;
rollback;
select 'SMOKE OK' as result;
