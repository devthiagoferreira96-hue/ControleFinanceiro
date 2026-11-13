-- =====================================================================
-- Controle Financeiro (Caixa da Família) - banco na nuvem (Supabase)
-- Cole tudo no Supabase em: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema.
--
-- Cada usuário tem só duas linhas: "conta" e "dados", já CIFRADAS no aparelho
-- com a senha do sistema. O banco guarda, mas não consegue ler o conteúdo.
-- Ninguém vê ou mexe nas linhas de outra pessoa (Row Level Security).
-- Toda alteração guarda uma cópia anterior em caixa_historico (proteção extra).
-- =====================================================================

create table if not exists public.caixa_dados (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chave text not null check (chave in ('conta', 'dados')),
  valor jsonb not null,
  versao bigint not null default 1,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, chave)
);

alter table public.caixa_dados enable row level security;

drop policy if exists "dono_le" on public.caixa_dados;
drop policy if exists "dono_cria" on public.caixa_dados;
drop policy if exists "dono_altera" on public.caixa_dados;
drop policy if exists "dono_apaga" on public.caixa_dados;
create policy "dono_le" on public.caixa_dados for select to authenticated using ((select auth.uid()) = user_id);
create policy "dono_cria" on public.caixa_dados for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dono_altera" on public.caixa_dados for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dono_apaga" on public.caixa_dados for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.caixa_dados from anon;
grant select, insert, update, delete on public.caixa_dados to authenticated;

-- ---------------------------------------------------------------------
-- Gravar com controle de versão: só grava se ninguém gravou antes
-- (p_versao = versão que o aparelho conhece; 0 = só cria; -1 = grava sempre).
-- Retorna a versão nova, ou -1 se outro aparelho gravou antes (o app junta e tenta de novo).
-- ---------------------------------------------------------------------
create or replace function public.gravar_dado(p_chave text, p_valor jsonb, p_versao bigint)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v bigint;
begin
  if auth.uid() is null then
    raise exception 'É preciso entrar na conta';
  end if;

  if p_versao < 0 then
    insert into public.caixa_dados as d (user_id, chave, valor, versao)
    values (auth.uid(), p_chave, p_valor, 1)
    on conflict (user_id, chave) do update
      set valor = excluded.valor, versao = d.versao + 1, atualizado_em = now()
    returning d.versao into v;
  elsif p_versao = 0 then
    insert into public.caixa_dados (user_id, chave, valor, versao)
    values (auth.uid(), p_chave, p_valor, 1)
    on conflict (user_id, chave) do nothing
    returning versao into v;
  else
    update public.caixa_dados
       set valor = p_valor, versao = versao + 1, atualizado_em = now()
     where user_id = auth.uid() and chave = p_chave and versao = p_versao
    returning versao into v;
  end if;

  return coalesce(v, -1);
end;
$$;

revoke all on function public.gravar_dado(text, jsonb, bigint) from public, anon;
grant execute on function public.gravar_dado(text, jsonb, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- Histórico: cópias anteriores (também cifradas), para recuperar em caso de acidente.
-- Guarda uma cópia a cada 6 horas de uso (e sempre antes de apagar), até 120 cópias
-- por usuário (cerca de 1 mês de uso diário). Só o dono consegue ver as suas.
-- ---------------------------------------------------------------------
create table if not exists public.caixa_historico (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  chave text not null,
  valor jsonb not null,
  versao bigint not null,
  motivo text not null,
  guardado_em timestamptz not null default now()
);
create index if not exists caixa_historico_usuario on public.caixa_historico (user_id, chave, id desc);

alter table public.caixa_historico enable row level security;
drop policy if exists "dono_le_historico" on public.caixa_historico;
create policy "dono_le_historico" on public.caixa_historico for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.caixa_historico from anon;
revoke insert, update, delete on public.caixa_historico from authenticated;
grant select on public.caixa_historico to authenticated;

create or replace function public.guardar_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' or not exists (
    select 1 from public.caixa_historico h
     where h.user_id = old.user_id and h.chave = old.chave
       and h.guardado_em > now() - interval '6 hours'
  ) then
    insert into public.caixa_historico (user_id, chave, valor, versao, motivo)
    values (old.user_id, old.chave, old.valor, old.versao, lower(tg_op));

    delete from public.caixa_historico
     where user_id = old.user_id and chave = old.chave
       and id not in (
         select id from public.caixa_historico
          where user_id = old.user_id and chave = old.chave
          order by id desc limit 120
       );
  end if;
  return null;
end;
$$;

revoke all on function public.guardar_historico() from public, anon, authenticated;

drop trigger if exists caixa_dados_historico on public.caixa_dados;
create trigger caixa_dados_historico
  after update or delete on public.caixa_dados
  for each row execute function public.guardar_historico();
