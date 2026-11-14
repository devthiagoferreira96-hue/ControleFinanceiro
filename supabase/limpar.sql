-- =====================================================================
-- LIMPAR TUDO no Supabase (para recomeçar do zero durante os testes)
-- Apaga TODAS as contas, os dados, o histórico e os códigos de recuperação.
-- NÃO tem volta. Cole no SQL Editor > New query > Run.
-- Depois disso, a tabela e as regras continuam prontas: não precisa rodar o schema.sql de novo.
-- =====================================================================
delete from public.caixa_historico;
delete from public.caixa_dados;
delete from public.caixa_recuperacao;
delete from auth.users;
