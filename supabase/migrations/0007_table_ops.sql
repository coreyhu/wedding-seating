-- Rotate every occupant of a table one seat forward (1→2, …, 8→1). The seat
-- numbers form a bijection on 1..8, so the deferred unique constraint tolerates
-- the transient collisions and the result is always valid.
create or replace function rotate_table(p_table_no int)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  set constraints guests_one_per_seat deferred;
  update guests set seat_no = (seat_no % 8) + 1 where table_no = p_table_no;
end $$;

-- Swap two whole tables: every guest at A moves to B (same seat) and vice versa.
create or replace function swap_tables(p_a int, p_b int)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  if p_a = p_b then return; end if;
  set constraints guests_one_per_seat deferred;
  update guests set table_no = case when table_no = p_a then p_b else p_a end
  where table_no in (p_a, p_b);
end $$;

revoke execute on function rotate_table(int) from public, anon, authenticated;
grant execute on function rotate_table(int) to authenticated;
revoke execute on function swap_tables(int, int) from public, anon, authenticated;
grant execute on function swap_tables(int, int) to authenticated;
