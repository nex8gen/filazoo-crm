begin;
insert into public.alipay_login_grants(code_hash, challenge, subject)
values (repeat('a',43),repeat('b',43),repeat('c',43));
do $$
declare n integer;
begin
  if has_table_privilege('anon','public.alipay_login_grants','SELECT') or has_table_privilege('authenticated','public.alipay_login_grants','SELECT') then raise exception 'Grant exposure'; end if;
  if has_function_privilege('authenticated','public.redeem_alipay_login_code(text,text,text)','EXECUTE') then raise exception 'RPC exposure'; end if;
  select count(*) into n from public.redeem_alipay_login_code(repeat('a',43),repeat('x',43),repeat('d',43));
  if n <> 0 then raise exception 'PKCE bypass'; end if;
  select count(*) into n from public.redeem_alipay_login_code(repeat('a',43),repeat('b',43),repeat('d',43));
  if n <> 1 then raise exception 'Valid code not redeemed'; end if;
  select count(*) into n from public.redeem_alipay_login_code(repeat('a',43),repeat('b',43),repeat('e',43));
  if n <> 0 then raise exception 'Code replay'; end if;
  update public.alipay_login_grants set redeemed_at=null,code_expires_at=now()-interval '1 second' where code_hash=repeat('a',43);
  select count(*) into n from public.redeem_alipay_login_code(repeat('a',43),repeat('b',43),repeat('f',43));
  if n <> 0 then raise exception 'Expired code accepted'; end if;
end $$;
rollback;
