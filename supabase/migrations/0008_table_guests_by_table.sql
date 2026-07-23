-- A guest can tap a table on the public floorplan to see that table's full
-- roster. This intentionally exposes only one table at a time (and only the
-- fields displayed by the guest UI); direct guest-table SELECT remains denied
-- to anonymous users.
create or replace function table_guests_by_table(p_table_no int)
returns table (name_en text, name_zh text, seat_no int)
language sql security definer set search_path = public, extensions as $$
  select g.name_en, g.name_zh, g.seat_no
  from guests g
  where g.table_no = p_table_no
  order by g.seat_no
$$;

revoke execute on function table_guests_by_table(int) from public;
grant execute on function table_guests_by_table(int) to anon, authenticated;
