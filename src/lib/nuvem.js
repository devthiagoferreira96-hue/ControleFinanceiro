// =====================================================================
// NUVEM (Supabase): login e as duas "caixas" de dados de cada usuário.
//
// Na nuvem fica exatamente o que antes ficava só no aparelho:
//   "conta" -> nome do usuário e as fechaduras da chave dos dados
//   "dados" -> todas as tabelas, CIFRADAS com a senha do sistema
// Ou seja: o Supabase guarda os dados, mas não consegue lê-los.
// Conversa com o Supabase direto pela internet (fetch), sem bibliotecas.
// =====================================================================
import { normalizarCodigo } from './cofre.js';

// As chaves vêm de variáveis de ambiente (.env.local no computador, Secrets no GitHub), nunca do código.
const env = import.meta.env || {};
const URL_BASE = String(env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const CHAVE = String(env.VITE_SUPABASE_ANON_KEY || '').trim();
const GUARDA = 'caixa-nuvem-sessao';

export const configurada = () => /^https:\/\/\S+$/.test(URL_BASE) && CHAVE.length > 20;

export class ErroNuvem extends Error {
  constructor(mensagem, { status = 0, offline = false, semSessao = false } = {}) {
    super(mensagem);
    this.status = status;
    this.offline = offline;
    this.semSessao = semSessao;
  }
}

// ---------- Sessão (fica no aparelho: entra uma vez e continua conectado)
let sessao = lerSessao();
function lerSessao() {
  try { return JSON.parse(localStorage.getItem(GUARDA)) || null; } catch { return null; }
}
function guardarSessao(s) {
  sessao = s?.access_token
    ? {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: Number(s.expires_at) || Math.floor(Date.now() / 1000) + Number(s.expires_in || 3600),
        usuario: { id: s.user?.id ?? s.usuario?.id, email: s.user?.email ?? s.usuario?.email },
      }
    : null;
  try {
    if (sessao) localStorage.setItem(GUARDA, JSON.stringify(sessao));
    else localStorage.removeItem(GUARDA);
  } catch { /* sem armazenamento: continua só nesta visita */ }
  return sessao;
}

export const logado = () => Boolean(sessao?.refresh_token && sessao?.usuario?.id);
export const usuarioNuvem = () => sessao?.usuario || null;

// ---------- Pedidos ao Supabase
const MENSAGENS = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'Esta conta ainda espera a confirmação do e-mail. No Supabase, desligue "Confirm email" (Authentication > Sign In / Providers > Email).'],
  [/already (been )?registered|already exists/i, 'Já existe uma conta com esse e-mail. Toque em "Entrar".'],
  [/invalid email|unable to validate email|email address .* is invalid/i, 'Confira o e-mail digitado.'],
  [/rate limit|too many/i, 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'],
  [/signups? not allowed|signup is disabled/i, 'O cadastro de contas novas está desligado neste Supabase.'],
  [/same.*password|different from the old/i, 'A senha nova precisa ser diferente da anterior.'],
  [/relation .*caixa_(dados|recuperacao).* does not exist|could not find the (table|function)/i, 'O banco da nuvem ainda não foi preparado (falta rodar o arquivo supabase/schema.sql).'],
];
function traduzir(json, status) {
  const original = json?.msg || json?.error_description || json?.message || json?.error || '';
  for (const [re, texto] of MENSAGENS) if (re.test(original)) return texto;
  if (status === 401 || status === 403) return 'Sua sessão na nuvem expirou. Entre de novo.';
  if (status >= 500) return 'A nuvem está com problema agora. Seus dados continuam guardados no aparelho; tente mais tarde.';
  return original || 'Não foi possível falar com a nuvem. Tente de novo.';
}

async function pedir(caminho, { metodo = 'GET', corpo, comLogin = true, token, cabecalhos = {} } = {}) {
  const h = { apikey: CHAVE, 'Content-Type': 'application/json', ...cabecalhos };
  // sem login, só a chave pública vai no "apikey" (funciona com as chaves antigas e as novas "publishable")
  // chave antiga (JWT "anon") também vai no Authorization quando não há login
  const acesso = token || (comLogin ? await tokenValido() : (CHAVE.startsWith('eyJ') ? CHAVE : null));
  if (acesso) h.Authorization = `Bearer ${acesso}`;
  let resp;
  try {
    resp = await fetch(URL_BASE + caminho, {
      method: metodo,
      headers: h,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      cache: 'no-store',
    });
  } catch {
    throw new ErroNuvem('Sem conexão com a internet.', { offline: true });
  }
  const texto = await resp.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = { message: texto }; }
  if (!resp.ok) throw new ErroNuvem(traduzir(json, resp.status), { status: resp.status });
  return json;
}

// O "crachá" de acesso vale 1 hora; antes de vencer, é renovado sozinho.
let renovando = null;
async function tokenValido() {
  if (!logado()) throw new ErroNuvem('Entre na sua conta da nuvem.', { semSessao: true, status: 401 });
  if (sessao.expires_at * 1000 - 60_000 > Date.now()) return sessao.access_token;
  renovando ||= (async () => {
    try {
      const s = await pedir('/auth/v1/token?grant_type=refresh_token', {
        metodo: 'POST', comLogin: false, corpo: { refresh_token: sessao.refresh_token },
      });
      guardarSessao(s);
    } catch (e) {
      if (!e.offline && (e.status === 400 || e.status === 401 || e.status === 403)) {
        guardarSessao(null);
        window.dispatchEvent(new Event('caixa:nuvem-saiu'));
        throw new ErroNuvem('Sua sessão na nuvem terminou. Entre de novo.', { semSessao: true, status: 401 });
      }
      throw e;
    } finally {
      renovando = null;
    }
  })();
  await renovando;
  return sessao.access_token;
}

// ---------- Login
const voltarPara = () => location.origin + location.pathname;

export async function entrar(email, senha) {
  const s = await pedir('/auth/v1/token?grant_type=password', { metodo: 'POST', comLogin: false, corpo: { email, password: senha } });
  return guardarSessao(s);
}

/** Cria a conta. Retorna { confirmar: true } quando o Supabase exige confirmar o e-mail. */
export async function cadastrar(email, senha) {
  const r = await pedir(`/auth/v1/signup?redirect_to=${encodeURIComponent(voltarPara())}`, {
    metodo: 'POST', comLogin: false, corpo: { email, password: senha },
  });
  if (r?.access_token) { guardarSessao(r); return { confirmar: false }; }
  // e-mail que já tinha conta: o Supabase responde "ok" mas sem identidades
  if (Array.isArray(r?.identities) && r.identities.length === 0) {
    throw new ErroNuvem('Já existe uma conta com esse e-mail. Toque em "Entrar".');
  }
  return { confirmar: true };
}

async function trocarSenhaDaNuvem(senha) {
  await pedir('/auth/v1/user', { metodo: 'PUT', corpo: { password: senha } });
}

export async function sair() {
  if (logado()) await pedir('/auth/v1/logout', { metodo: 'POST' }).catch(() => {});
  guardarSessao(null);
}

// ---------- Uma senha só
// O login da nuvem usa o e-mail e a MESMA senha do sistema. Para o servidor nunca ver a senha
// verdadeira (que também cifra os dados), ele recebe uma senha derivada dela.
// O código de recuperação também recupera o acesso: o banco guarda só uma "prova" dele,
// embaralhada (bcrypt), e com ela troca a senha da nuvem (supabase/schema.sql: recuperar_acesso).
const codificar = new TextEncoder();
const emailLimpo = (e) => String(e || '').trim().toLowerCase();

export async function senhaDaNuvem(senha, email) {
  const base = await crypto.subtle.importKey('raw', codificar.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: codificar.encode(`controle-seu-caixa|${emailLimpo(email)}`), iterations: 210_000, hash: 'SHA-256' },
    base, 256,
  );
  return `cx1.${paraBase64(new Uint8Array(bits)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

async function provaDoCodigo(codigo, email) {
  const h = await crypto.subtle.digest('SHA-256', codificar.encode(`recuperacao|${emailLimpo(email)}|${normalizarCodigo(codigo)}`));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const entrarComSenha = async (email, senha) => entrar(emailLimpo(email), await senhaDaNuvem(senha, email));
export const cadastrarComSenha = async (email, senha) => cadastrar(emailLimpo(email), await senhaDaNuvem(senha, email));

/** Troca a senha da nuvem para acompanhar a senha nova do sistema */
export async function definirSenha(senha) {
  if (!logado()) return;
  try {
    await trocarSenhaDaNuvem(await senhaDaNuvem(senha, sessao.usuario.email));
  } catch (e) {
    if (e.status !== 422) throw e; // 422 = já era essa senha (ex.: logo depois de recuperar o acesso)
  }
}

/** Guarda na nuvem a prova do código de recuperação (para recuperar em outro aparelho) */
export async function salvarRecuperacao(codigo) {
  if (!logado()) return;
  await pedir('/rest/v1/rpc/salvar_recuperacao', { metodo: 'POST', corpo: { p_prova: await provaDoCodigo(codigo, sessao.usuario.email) } });
}

/** Esqueci a senha (sem estar conectado): com o código, cria a senha nova da nuvem. true = deu certo */
export async function recuperarAcesso(email, codigo, senhaNova) {
  const ok = await pedir('/rest/v1/rpc/recuperar_acesso', {
    metodo: 'POST', comLogin: false,
    corpo: { p_email: emailLimpo(email), p_prova: await provaDoCodigo(codigo, email), p_nova_senha: await senhaDaNuvem(senhaNova, email) },
  });
  return ok === true;
}

// ---------- Dados (tabela caixa_dados: uma linha "conta" e uma "dados" por usuário)
/** Versão atual de cada caixa na nuvem: { conta: n, dados: n } (0 = não existe) */
export async function versoes() {
  const linhas = await pedir('/rest/v1/caixa_dados?select=chave,versao');
  const v = { conta: 0, dados: 0 };
  for (const l of linhas || []) v[l.chave] = Number(l.versao);
  return v;
}

/** Lê uma caixa: { valor, versao } ou null */
export async function ler(chave) {
  const [linha] = await pedir(`/rest/v1/caixa_dados?select=valor,versao&chave=eq.${chave}`);
  return linha ? { valor: deJson(linha.valor), versao: Number(linha.versao) } : null;
}

/**
 * Grava uma caixa se a versão na nuvem ainda for `versaoEsperada`
 * (0 = só cria se não existir; -1 = grava de qualquer jeito).
 * Retorna a versão nova, ou -1 se alguém (outro aparelho) gravou antes.
 */
export async function gravar(chave, valor, versaoEsperada) {
  const v = await pedir('/rest/v1/rpc/gravar_dado', {
    metodo: 'POST', corpo: { p_chave: chave, p_valor: paraJson(valor), p_versao: versaoEsperada },
  });
  return Number(v);
}

export const apagar = (chave) => pedir(`/rest/v1/caixa_dados?chave=eq.${chave}`, { metodo: 'DELETE', cabecalhos: { Prefer: 'return=minimal' } });

// ---------- Bytes cifrados <-> JSON (o banco guarda texto; a cifra são bytes)
function paraBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const deBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function paraJson(v) {
  if (v instanceof Uint8Array) return { $b64: paraBase64(v), $t: 'u8' };
  if (v instanceof ArrayBuffer) return { $b64: paraBase64(new Uint8Array(v)), $t: 'ab' };
  if (ArrayBuffer.isView(v)) return { $b64: paraBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)), $t: 'u8' };
  if (Array.isArray(v)) return v.map(paraJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, paraJson(x)]));
  return v;
}

export function deJson(v) {
  if (Array.isArray(v)) return v.map(deJson);
  if (v && typeof v === 'object') {
    if (typeof v.$b64 === 'string') {
      const bytes = deBase64(v.$b64);
      return v.$t === 'ab' ? bytes.buffer : bytes;
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deJson(x)]));
  }
  return v;
}
