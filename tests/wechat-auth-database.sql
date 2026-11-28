begin;
insert into public.wechat_login_grants(code_hash, challenge, subject)
values (repeat('a',43),repeat('b',43),repeat('c',43));
do $$
declare n integer;
begin
  if exists (select 1 from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relname='wechat_login_grants' and not c.relrowsecurity) then raise exception 'RLS disabled'; end if;
  if has_table_privilege('anon','public.wechat_login_grants','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','public.wechat_login_grants','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Grant exposure'; end if;
  if has_function_privilege('authenticated','public.redeem_wechat_login_code(text,text,text)','EXECUTE') or has_function_privilege('anon','public.redeem_wechat_login_code(text,text,text)','EXECUTE') then raise exception 'RPC exposure'; end if;
  select count(*) into n from public.redeem_wechat_login_code(repeat('a',43),repeat('x',43),repeat('d',43));
  if n <> 0 then raise exception 'PKCE bypass'; end if;
  select count(*) into n from public.redeem_wechat_login_code(repeat('a',43),repeat('b',43),repeat('d',43));
  if n <> 1 then raise exception 'Valid code not redeemed'; end if;
  if not exists(select 1 from public.wechat_login_grants where access_hash=repeat('d',43) and redeemed_at is not null and access_expires_at > now() and access_expires_at <= now()+interval '5 minutes') then raise exception 'Incorrect token lifetime'; end if;
  select count(*) into n from public.redeem_wechat_login_code(repeat('a',43),repeat('b',43),repeat('e',43));
  if n <> 0 then raise exception 'Code replay'; end if;
  update public.wechat_login_grants set redeemed_at=null,code_expires_at=now()-interval '1 second' where code_hash=repeat('a',43);
  select count(*) into n from public.redeem_wechat_login_code(repeat('a',43),repeat('b',43),repeat('f',43));
  if n <> 0 then raise exception 'Expired code accepted'; end if;
end $$;
set local role service_role;
insert into public.wechat_login_grants(code_hash, challenge, subject) values (repeat('s',43),repeat('t',43),repeat('u',43));
select * from public.redeem_wechat_login_code(repeat('s',43),repeat('t',43),repeat('v',43));
reset role;
rollback;
