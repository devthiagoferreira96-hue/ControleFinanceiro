// =====================================================================
// NUVEM (Supabase): login e as duas "caixas" de dados de cada usuário.
//
// Na nuvem fica exatamente o que antes ficava só no aparelho:
//   "conta" -> nome do usuário e as fechaduras da chave dos dados
//   "dados" -> todas as tabelas, CIFRADAS com a senha do sistema
// Ou seja: o Supabase guarda os dados, mas não consegue lê-los.
// Conversa com o Supabase direto pela internet (fetch), sem bibliotecas.
// =====================================================================
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
  [/invalid login credentials/i, 'E-mail ou senha da nuvem incorretos.'],
  [/email not confirmed/i, 'Confirme o seu e-mail primeiro: abra a mensagem que enviamos e toque no link.'],
  [/already (been )?registered|already exists/i, 'Já existe uma conta com esse e-mail. Toque em "Entrar".'],
  [/password should be at least|weak password|at least \d+ characters/i, 'A senha da nuvem precisa ter pelo menos 6 caracteres.'],
  [/invalid email|unable to validate email|email address .* is invalid/i, 'Confira o e-mail digitado.'],
  [/rate limit|too many/i, 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'],
  [/signups? not allowed|signup is disabled/i, 'O cadastro de contas novas está desligado neste Supabase.'],
  [/same.*password|different from the old/i, 'A senha nova precisa ser diferente da anterior.'],
  [/relation .*caixa_dados.* does not exist|could not find the (table|function)/i, 'O banco da nuvem ainda não foi preparado (falta rodar o arquivo supabase/schema.sql).'],
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
  const acesso = token || (comLogin ? await tokenValido() : null);
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

export const enviarEmailDeSenha = (email) =>
  pedir(`/auth/v1/recover?redirect_to=${encodeURIComponent(voltarPara())}`, { metodo: 'POST', comLogin: false, corpo: { email } });

export async function trocarSenhaDaNuvem(senha) {
  await pedir('/auth/v1/user', { metodo: 'PUT', corpo: { password: senha } });
}

export async function sair() {
  if (logado()) await pedir('/auth/v1/logout', { metodo: 'POST' }).catch(() => {});
  guardarSessao(null);
}

/**
 * Volta do link do e-mail (confirmar conta ou trocar a senha): o Supabase manda
 * o acesso no endereço (#access_token=...). Guarda a sessão e limpa o endereço.
 * Retorna { tipo } ('signup', 'recovery'...), { erro } ou null.
 */
export async function lerRetornoDoEmail() {
  const hash = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error_description|error)=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error_description') || p.get('error')) {
    const msg = (p.get('error_description') || '').replace(/\+/g, ' ');
    return { erro: /expired|invalid/i.test(msg) ? 'O link do e-mail expirou ou já foi usado. Peça um novo.' : msg || 'Não foi possível usar o link do e-mail.' };
  }
  const token = p.get('access_token');
  const user = await pedir('/auth/v1/user', { token });
  guardarSessao({
    access_token: token,
    refresh_token: p.get('refresh_token'),
    expires_at: p.get('expires_at'),
    expires_in: p.get('expires_in'),
    user,
  });
  return { tipo: p.get('type') || 'signup' };
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
