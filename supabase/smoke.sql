\set ON_ERROR_STOP on
begin;
-- simulate an authenticated user for RPC auth checks
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

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
