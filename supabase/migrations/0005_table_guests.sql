-- Tablemates for the guest UI's "At your table" list. Keyed by guest id (not
-- table_no) so a roster is only reachable after a name search returns that id —
-- preserving the "anon cannot enumerate the whole guest list" posture that
-- search_guests() establishes. anon has no direct SELECT on guests, hence
-- security definer.
create or replace function table_guests(p_guest_id uuid)
returns table (id uuid, name_en text, name_zh text, seat_no int)
language plpgsql security definer set search_path = public, extensions as $$
declare v_table int;
begin
  select g.table_no into v_table from guests g where g.id = p_guest_id;
  if v_table is null then return; end if;   -- unknown or unseated guest → no rows
  return query
    select g.id, g.name_en, g.name_zh, g.seat_no
    from guests g
    where g.table_no = v_table
    order by g.seat_no;
end $$;

revoke execute on function table_guests(uuid) from public;
grant execute on function table_guests(uuid) to anon, authenticated;
