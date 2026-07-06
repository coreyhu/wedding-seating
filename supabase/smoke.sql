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
declare cnt int; tiger uuid;
begin
  cnt := (select count(*) from table_guests((select id from guests where name_en = 'Carol Zhao')));
  assert cnt = 4, 'table_guests returns all 4 seated at table 1';
  select id into tiger from guests where name_en = 'Tiger Chen';  -- unseated in seed
  cnt := (select count(*) from table_guests(tiger));
  assert cnt = 0, 'table_guests returns none for an unseated guest';
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
declare r jsonb;
begin
  select import_seating(jsonb_build_object(
    'tables', jsonb_build_array(jsonb_build_object('table_no', 1, 'label_en', 'Peacock', 'label_zh', '孔雀')),
    'guests', jsonb_build_array(
      jsonb_build_object('name_en', 'Carol Zhao', 'name_zh', '赵卡罗', 'table_no', 4, 'seat_no', 1),
      jsonb_build_object('name_en', 'Brand New', 'name_zh', '', 'table_no', 4, 'seat_no', 2)
    ))) into r;
  assert (r->>'new')::int = 1, 'one new guest';
  assert (r->>'imported')::int = 2, 'two seated';
  assert (r->>'deleted')::int >= 1, 'import reports deleted absentees';
  assert (select label_en from tables where table_no = 1) = 'Peacock', 'label applied';
  assert (select table_no from guests where name_en = 'Carol Zhao') = 4, 'carol moved by import';
  -- full override: guests absent from the payload are DELETED, not just unseated
  assert (select count(*) from guests where name_en = 'Kevin Hu') = 0, 'absent guests deleted entirely';
  assert (select count(*) from guests) = 2, 'only the two payload guests remain';
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
    perform import_seating(jsonb_build_object('tables', '[]'::jsonb, 'guests', '[]'::jsonb));
    raise exception 'non-admin wrote via import_seating — is_admin gate broken';
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
  assert has_function_privilege('anon', 'table_guests(uuid)', 'execute'),
    'anon can execute table_guests';
  assert has_function_privilege('authenticated', 'table_guests(uuid)', 'execute'),
    'authenticated can execute table_guests';
  assert not has_function_privilege('anon', 'assign_seat(uuid,int,int)', 'execute'),
    'anon cannot execute assign_seat';
  assert not has_function_privilege('anon', 'unseat(uuid)', 'execute'),
    'anon cannot execute unseat';
  assert not has_function_privilege('anon', 'import_seating(jsonb)', 'execute'),
    'anon cannot execute import_seating';
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
do $$
begin
  perform set_table_label(3, 'Fern', '蕨');
  assert (select label_zh from tables where table_no = 3) = '蕨', 'label set';
  perform set_table_label(3, '', '');
  assert (select label_en from tables where table_no = 3) = 'Table 3', 'empty restores default';
end $$;

do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  begin
    perform set_table_label(1, 'x', 'x');
    raise exception 'non-admin renamed a table — gate broken';
  exception when others then
    if sqlerrm not like '%not authorized%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
end $$;

do $$
declare v_cleared int;
begin
  assert (select count(*) from guests where table_no is not null) > 0, 'precondition: some guests seated';
  v_cleared := unseat_all();
  assert v_cleared > 0, 'unseat_all reports rows cleared';
  assert (select count(*) from guests where table_no is not null) = 0, 'unseat_all clears every seat';
end $$;

do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  begin
    perform unseat_all();
    raise exception 'non-admin cleared seating via unseat_all — gate broken';
  exception when others then
    if sqlerrm not like '%not authorized%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
end $$;

rollback;
select 'SMOKE OK' as result;
