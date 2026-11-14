// =====================================================================
// DADOS: NA NUVEM E NO APARELHO
// Tudo é cifrado aqui no aparelho com a senha do sistema e guardado em dois lugares:
//   - no próprio aparelho (IndexedDB), para abrir rápido e funcionar sem internet;
//   - na nuvem (Supabase), para não perder nada e usar no celular e no computador.
//
// São duas "caixas":
//   "conta" -> nome do usuário e as duas "fechaduras" da chave dos dados
//              (uma abre com a senha, a outra com o código de recuperação)
//   "dados" -> todas as tabelas, cifradas com a chave dos dados
// Veja cofre.js para entender a criptografia. A nuvem só recebe as caixas já cifradas.
//
// Sincronização: cada gravação vai primeiro para o aparelho e logo depois para a nuvem.
// Cada caixa tem um número de versão na nuvem. Se outro aparelho gravou antes,
// as duas versões são juntadas linha por linha (nada se perde) e gravadas de novo.
// Sem internet, as mudanças ficam no aparelho e sobem quando a conexão voltar.
// =====================================================================
import { criarConsultas, tabelasVazias, TABELAS } from './consulta-local.js';
import {
  chaveDoSegredo, novoSal, cifrar, decifrar, novaChaveDosDados, usarChave, trancar, destrancar,
  gerarCodigoRecuperacao, normalizarCodigo,
} from './cofre.js';
import * as armazenamento from './armazenamento.js';
import * as nuvem from './nuvem.js';
import { mesclarTabelas } from './mesclar.js';

let mudancas = 0; // conta cada mudança feita na memória (para saber se algo mudou durante um envio)
const banco = { tabelas: tabelasVazias(), aoMudar: () => { mudancas++; agendarGravacao(); } };
let chave = null;        // chave dos dados pronta para uso (só na memória, enquanto desbloqueado)
let bytesDaChave = null; // os mesmos bytes, para criar fechaduras novas (troca de senha/código)
let timer = null;
let fila = Promise.resolve(); // gravações e sincronizações acontecem uma de cada vez, na ordem

const VERIFICADOR_V1 = 'caixa-ok'; // usado só para abrir dados da versão anterior

/** Coloca uma tarefa na fila (nunca duas ao mesmo tempo) */
function naFila(tarefa) {
  const p = fila.then(tarefa);
  fila = p.catch(() => {});
  return p;
}

// Várias abas/janelas abertas (ou o app instalado + o navegador): quem grava avisa as outras,
// e elas recarregam os dados antes de continuar.
const ESTA_ABA = crypto.randomUUID();
const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel('controle-financeiro-nuvem') : null;
if (canal) {
  canal.onmessage = (e) => {
    if (e.data?.de === ESTA_ABA) return;
    if (e.data?.tipo === 'mudou') recarregarDoAparelho();
    if (e.data?.tipo === 'apagado') location.reload();
  };
}
const avisarOutrasAbas = (tipo) => canal?.postMessage({ tipo, de: ESTA_ABA });
const avisarTelas = () => window.dispatchEvent(new Event('caixa:dados-externos'));

/** Lê de novo os dados gravados no aparelho (quando outra aba mudou alguma coisa) */
async function recarregarDoAparelho() {
  if (!chave) return;
  if (timer) gravarAgora(); // algo desta aba ainda não gravado vai primeiro
  return naFila(async () => {
    const salvo = await armazenamento.ler('dados');
    if (marcaDe(salvo) === marcaAtual) return; // nada mudou
    await carregarDados();
    avisarTelas();
  }).catch((e) => console.error('Não foi possível recarregar os dados', e));
}

/** Ao voltar para o app: confere o aparelho (outras abas) e a nuvem (outros aparelhos) */
async function recarregar() {
  await recarregarDoAparelho();
  return sincronizar();
}

function agendarGravacao() {
  clearTimeout(timer);
  timer = setTimeout(gravarAgora, 150);
}

/** Cifra e grava tudo no aparelho e marca para subir para a nuvem */
function gravarAgora() {
  clearTimeout(timer);
  timer = null;
  if (!chave) return fila;
  const instantaneo = { tabelas: structuredClone(banco.tabelas), ultimoBackup: local.ultimoBackup };
  const p = naFila(async () => {
    const cifrado = await cifrar(chave, instantaneo);
    await armazenamento.gravar('dados', cifrado);
    marcaAtual = marcaDe(cifrado);
    await marcarPendente('dados');
    avisarOutrasAbas('mudou');
  }).catch((e) => {
    console.error('Não foi possível salvar no aparelho', e);
    window.dispatchEvent(new CustomEvent('caixa:erro-gravar', { detail: e }));
  });
  agendarEnvio();
  return p;
}

/** Fechadura nova: { sal, chave } a partir de um segredo (senha ou código) */
async function fechadura(segredo) {
  const sal = novoSal();
  return { sal, chave: await trancar(await chaveDoSegredo(segredo, sal), bytesDaChave) };
}

/** Tenta abrir uma fechadura com um segredo. Retorna os bytes da chave dos dados ou null. */
async function abrirFechadura(f, segredo) {
  try {
    return await destrancar(await chaveDoSegredo(segredo, f.sal), f.chave);
  } catch {
    return null; // senha/código errado
  }
}

// marca da última versão lida/gravada (o iv da cifra muda a cada gravação)
let marcaAtual = null;
const marcaDe = (salvo) => (salvo?.iv ? Array.from(salvo.iv).join(',') : null);

async function carregarDados() {
  const salvo = await armazenamento.ler('dados');
  marcaAtual = marcaDe(salvo);
  const dados = salvo ? await decifrar(chave, salvo) : {};
  banco.tabelas = { ...tabelasVazias(), ...(dados.tabelas || {}) };
  local.ultimoBackup = dados.ultimoBackup || null;
}

/** Grava a conta no aparelho e marca para subir para a nuvem */
async function gravarConta(conta) {
  await naFila(async () => {
    await armazenamento.gravar('conta', conta);
    await marcarPendente('conta');
  });
  agendarEnvio();
}

export const local = {
  usuario: null,
  ultimoBackup: null,
  from: criarConsultas(banco),
  tabelas: () => banco.tabelas,

  /** Já existe um usuário criado (neste aparelho ou trazido da nuvem)? Retorna o nome ou null */
  async usuarioCadastrado() {
    const conta = await armazenamento.ler('conta').catch(() => null);
    return conta?.usuario || null;
  },

  /**
   * Liga este aparelho à conta da nuvem e traz o que já existe lá.
   * Espera no máximo alguns segundos; sem internet, segue com o que está no aparelho.
   */
  async conectarNuvem({ esperarMs = 8000 } = {}) {
    const dono = nuvem.usuarioNuvem()?.id;
    await naFila(async () => {
      const m = await lerSync();
      if (m.dono && m.dono !== dono) {
        // outra conta da nuvem usou este aparelho antes: a cópia local dela não serve
        await Promise.all(['conta', 'dados', 'base'].map((k) => armazenamento.apagar(k)));
        Object.assign(m, syncVazio());
      }
      m.dono = dono;
      await armazenamento.gravar('sync', m);
    });
    const espera = new Promise((ok) => setTimeout(ok, esperarMs));
    await Promise.race([sincronizar(), espera]);
  },

  /** Primeiro acesso: cria o usuário e grava os dados iniciais. Retorna o código de recuperação. */
  async criarConta(usuario, senha, tabelasIniciais) {
    // Só cria com internet e se ainda não houver acesso na nuvem: assim um aparelho
    // nunca cria uma segunda "conta" por cima da que outro aparelho já criou.
    let remotas;
    try {
      remotas = await nuvem.versoes();
    } catch (e) {
      throw new Error(e.offline ? 'Conecte-se à internet para criar o acesso pela primeira vez.' : e.message);
    }
    if (remotas.conta) {
      await local.conectarNuvem();
      throw new Error('Já existe um acesso criado em outro aparelho com esta conta da nuvem. Recarregue a página e entre com a sua senha.');
    }
    bytesDaChave = novaChaveDosDados();
    chave = await usarChave(bytesDaChave);
    const codigo = gerarCodigoRecuperacao();
    this.usuario = usuario;
    this.ultimoBackup = null;
    banco.tabelas = { ...tabelasVazias(), ...tabelasIniciais };
    const dados = await cifrar(chave, { tabelas: banco.tabelas, ultimoBackup: null });
    await naFila(async () => {
      await armazenamento.gravarJuntos({
        conta: {
          versao: 2,
          usuario,
          senha: await fechadura(senha),
          recuperacao: await fechadura(normalizarCodigo(codigo)),
          criada_em: new Date().toISOString(),
        },
        dados,
      });
      await armazenamento.apagar('base');
      const m = await lerSync();
      m.versao = { conta: 0, dados: 0 };
      m.pendente = { conta: true, dados: true };
      await armazenamento.gravar('sync', m);
    });
    marcaAtual = marcaDe(dados);
    pedirArmazenamentoPersistente();
    await sincronizar();
    // o código também recupera o acesso à nuvem (em qualquer aparelho)
    await nuvem.salvarRecuperacao(codigo).catch((e) => console.error('Não foi possível guardar o código na nuvem', e));
    lembrarSenhaUnica();
    return codigo;
  },

  /**
   * Abre os dados com a senha.
   * Retorna { ok: false } se a senha estiver errada, ou { ok: true, codigoNovo? }.
   * `codigoNovo` vem quando os dados eram da versão anterior (sem código) e acabaram de ganhar um.
   */
  async desbloquear(senha) {
    const conta = await armazenamento.ler('conta');
    if (!conta.versao) return migrarVersaoAnterior(conta, senha);
    const bytes = await abrirFechadura(conta.senha, senha);
    if (!bytes) return { ok: false };
    await entrarComChave(conta, bytes);
    // contas da versão com duas senhas: a da nuvem passa a ser a mesma do sistema
    if (!senhaUnicaOk()) nuvem.definirSenha(senha).then(lembrarSenhaUnica).catch(() => {});
    return { ok: true };
  },

  /**
   * Esqueci a senha: abre com o código de recuperação e cria uma senha nova.
   * Também gera um código novo (o antigo pode ter sido visto). Retorna o código novo ou null.
   */
  async recuperarComCodigo(codigo, senhaNova) {
    const conta = await armazenamento.ler('conta');
    if (!conta.versao) return null; // versão anterior não tinha código
    const bytes = await abrirFechadura(conta.recuperacao, normalizarCodigo(codigo));
    if (!bytes) return null;
    await entrarComChave(conta, bytes);
    const novo = gerarCodigoRecuperacao();
    // a nuvem acompanha: senha nova e código novo (precisa de internet)
    await nuvem.definirSenha(senhaNova);
    await nuvem.salvarRecuperacao(novo);
    lembrarSenhaUnica();
    conta.senha = await fechadura(senhaNova);
    conta.recuperacao = await fechadura(normalizarCodigo(novo));
    await gravarConta(conta);
    return novo;
  },

  /** Confere a senha atual (sem mudar nada) */
  async senhaConfere(senha) {
    const conta = await armazenamento.ler('conta');
    return Boolean(await abrirFechadura(conta.senha, senha));
  },

  /** Troca o nome e/ou a senha. A chave dos dados é a mesma: só a fechadura da senha muda. */
  async alterarConta({ usuario, senhaAtual, senhaNova }) {
    const conta = await armazenamento.ler('conta');
    if (senhaNova) {
      if (!(await abrirFechadura(conta.senha, senhaAtual))) throw new Error('A senha atual está incorreta.');
      await nuvem.definirSenha(senhaNova); // a mesma senha entra na nuvem (precisa de internet)
      conta.senha = await fechadura(senhaNova);
    }
    if (usuario) conta.usuario = usuario;
    await gravarConta(conta);
    this.usuario = conta.usuario;
  },

  /** Gera um código de recuperação novo (o antigo deixa de funcionar). Exige a senha atual. */
  async novoCodigo(senhaAtual) {
    const conta = await armazenamento.ler('conta');
    if (!(await abrirFechadura(conta.senha, senhaAtual))) throw new Error('A senha está incorreta.');
    const codigo = gerarCodigoRecuperacao();
    await nuvem.salvarRecuperacao(codigo); // o código novo também recupera o acesso à nuvem
    conta.recuperacao = await fechadura(normalizarCodigo(codigo));
    await gravarConta(conta);
    return codigo;
  },

  /** Troca todos os dados (restaurar backup) */
  async substituir(tabelas) {
    banco.tabelas = { ...tabelasVazias(), ...tabelas };
    mudancas++;
    await gravarAgora();
  },

  async marcarBackup() {
    this.ultimoBackup = new Date().toISOString();
    await gravarAgora();
  },

  /** Esquece a chave da memória (os dados continuam cifrados no aparelho e na nuvem) */
  bloquear() {
    if (timer) gravarAgora();
    chave = null;
    bytesDaChave = null;
    banco.tabelas = tabelasVazias();
  },

  /** Apaga usuário e dados deste aparelho e da nuvem */
  async apagarTudo() {
    try {
      await nuvem.apagar('dados');
      await nuvem.apagar('conta');
    } catch (e) {
      throw new Error(e.offline ? 'Conecte-se à internet para apagar os dados da nuvem.' : e.message);
    }
    this.bloquear();
    await naFila(async () => {
      for (const k of ['dados', 'conta', 'base']) await armazenamento.apagar(k);
      const m = await lerSync();
      await armazenamento.gravar('sync', { ...syncVazio(), dono: m.dono });
    });
    avisarOutrasAbas('apagado');
  },

  /** Há mudanças feitas neste aparelho que ainda não chegaram na nuvem? */
  async temPendencias() {
    const m = await lerSync();
    return Boolean(m.pendente.conta || m.pendente.dados);
  },

  /** Sai da conta da nuvem neste aparelho (só depois de tudo enviado) e limpa a cópia local */
  async sairDaNuvem() {
    if (timer) gravarAgora();
    await sincronizar();
    if (await this.temPendencias()) {
      throw new Error('Ainda há mudanças que não foram para a nuvem. Conecte-se à internet e tente de novo.');
    }
    this.bloquear();
    await naFila(async () => {
      for (const k of ['dados', 'conta', 'base', 'sync']) await armazenamento.apagar(k);
    });
    await nuvem.sair();
    avisarOutrasAbas('apagado');
  },

  recarregar,
  sincronizar,
  gravarAgora,
  TABELAS,
};

async function entrarComChave(conta, bytes) {
  bytesDaChave = bytes;
  chave = await usarChave(bytes);
  await naFila(carregarDados);
  local.usuario = conta.usuario;
  pedirArmazenamentoPersistente();
  sincronizar(); // agora com a chave: dá para juntar mudanças de outros aparelhos
}

/**
 * Dados criados pela versão anterior (a senha cifrava os dados direto, sem código de recuperação).
 * Abre com a senha, cria a chave dos dados e as duas fechaduras, e cifra tudo de novo.
 */
async function migrarVersaoAnterior(conta, senha) {
  const antiga = await chaveDoSegredo(senha, conta.sal);
  try {
    if ((await decifrar(antiga, conta.verificador)) !== VERIFICADOR_V1) return { ok: false };
  } catch {
    return { ok: false };
  }
  const salvo = await armazenamento.ler('dados');
  const dados = salvo ? await decifrar(antiga, salvo) : {};
  bytesDaChave = novaChaveDosDados();
  chave = await usarChave(bytesDaChave);
  const codigo = gerarCodigoRecuperacao();
  const nova = {
    versao: 2,
    usuario: conta.usuario,
    senha: await fechadura(senha),
    recuperacao: await fechadura(normalizarCodigo(codigo)),
    criada_em: conta.criada_em,
  };
  banco.tabelas = { ...tabelasVazias(), ...(dados.tabelas || {}) };
  local.ultimoBackup = dados.ultimoBackup || null;
  local.usuario = conta.usuario;
  const cifrado = await cifrar(chave, { tabelas: banco.tabelas, ultimoBackup: local.ultimoBackup });
  // dados (cifrados com a chave nova) e conta nova gravados juntos: ou tudo, ou nada
  await naFila(async () => {
    await armazenamento.gravarJuntos({ dados: cifrado, conta: nova });
    await marcarPendente('conta');
    await marcarPendente('dados');
  });
  marcaAtual = marcaDe(cifrado);
  pedirArmazenamentoPersistente();
  agendarEnvio();
  return { ok: true, codigoNovo: codigo };
}

// Marca (por conta da nuvem) que a senha da nuvem já é a mesma do sistema
const MARCA_SENHA = 'caixa-senha-unica';
const senhaUnicaOk = () => { try { return localStorage.getItem(MARCA_SENHA) === nuvem.usuarioNuvem()?.id; } catch { return true; } };
const lembrarSenhaUnica = () => { try { localStorage.setItem(MARCA_SENHA, nuvem.usuarioNuvem()?.id || ''); } catch { /* tanto faz */ } };

// Pede ao navegador para não apagar os dados do site quando faltar espaço
function pedirArmazenamentoPersistente() {
  navigator.storage?.persist?.().catch(() => {});
}

// =====================================================================
// SINCRONIZAÇÃO COM A NUVEM
// "sync" (no aparelho) = { dono, versao: {conta, dados}, pendente: {conta, dados} }
// "base" (no aparelho) = a caixa "dados" como estava na última vez que aparelho e nuvem
//                        concordaram; serve para saber o que cada lado mudou depois.
// =====================================================================
const syncVazio = () => ({ dono: null, versao: { conta: 0, dados: 0 }, pendente: { conta: false, dados: false } });
async function lerSync() {
  const m = await armazenamento.ler('sync').catch(() => null);
  const v = syncVazio();
  return m ? { ...v, ...m, versao: { ...v.versao, ...m.versao }, pendente: { ...v.pendente, ...m.pendente } } : v;
}
async function marcarPendente(qual) {
  const m = await lerSync();
  if (m.pendente[qual]) return;
  m.pendente[qual] = true;
  await armazenamento.gravar('sync', m);
}

let timerEnvio = null;
function agendarEnvio() {
  clearTimeout(timerEnvio);
  timerEnvio = setTimeout(() => sincronizar(), 800);
}

// Estado mostrado ao usuário (só avisa quando muda de "sem internet" para "enviado")
let semInternet = false;
function estado(offline) {
  if (offline === semInternet) return;
  semInternet = offline;
  window.dispatchEvent(new CustomEvent('caixa:nuvem-estado', { detail: { offline } }));
}

/** Leva e traz as mudanças entre o aparelho e a nuvem */
function sincronizar() {
  if (!nuvem.configurada() || !nuvem.logado()) return Promise.resolve();
  return naFila(sincronizarAgora).catch((e) => {
    if (e?.offline) return estado(true);
    if (e?.semSessao) return;
    console.error('Não foi possível sincronizar com a nuvem', e);
  });
}

async function sincronizarAgora() {
  const m = await lerSync();
  if (m.dono && m.dono !== nuvem.usuarioNuvem()?.id) return;
  const remotas = await nuvem.versoes();
  const continuar = await sincronizarConta(m, remotas.conta);
  if (continuar) await sincronizarDados(m, remotas.dados);
  await armazenamento.gravar('sync', m);
  estado(false);
}

/** Retorna false quando a sincronização deve parar (dados apagados ou acesso recriado em outro aparelho) */
async function sincronizarConta(m, versaoNuvem) {
  const contaLocal = await armazenamento.ler('conta');

  if (!versaoNuvem) {
    if (m.versao.conta > 0) {
      // Já esteve na nuvem e sumiu: alguém usou "Apagar tudo" em outro aparelho
      for (const k of ['dados', 'conta', 'base']) await armazenamento.apagar(k);
      Object.assign(m, { versao: { conta: 0, dados: 0 }, pendente: { conta: false, dados: false } });
      window.dispatchEvent(new Event('caixa:apagado-na-nuvem'));
      return false;
    }
    if (contaLocal) {
      const v = await nuvem.gravar('conta', contaLocal, 0);
      if (v > 0) { m.versao.conta = v; m.pendente.conta = false; }
    }
    return true;
  }

  if (m.pendente.conta && contaLocal) {
    const v = await nuvem.gravar('conta', contaLocal, m.versao.conta);
    if (v > 0) { m.versao.conta = v; m.pendente.conta = false; return true; }
    // outro aparelho também mudou a conta (nome, senha ou código)
    const remota = await nuvem.ler('conta');
    if (remota && remota.valor.criada_em === contaLocal.criada_em) {
      const v2 = await nuvem.gravar('conta', contaLocal, remota.versao); // mesma conta: vale a mudança daqui
      if (v2 > 0) { m.versao.conta = v2; m.pendente.conta = false; }
      return true;
    }
    return trocarPelaContaDaNuvem(m, remota);
  }

  if (versaoNuvem !== m.versao.conta || !contaLocal) {
    const remota = await nuvem.ler('conta');
    if (!remota) return true;
    if (contaLocal && remota.valor.criada_em !== contaLocal.criada_em && m.versao.conta > 0) {
      return trocarPelaContaDaNuvem(m, remota);
    }
    await armazenamento.gravar('conta', remota.valor);
    m.versao.conta = remota.versao;
    m.pendente.conta = false;
    if (chave && remota.valor.usuario && remota.valor.usuario !== local.usuario) {
      local.usuario = remota.valor.usuario;
      avisarTelas();
    }
  }
  return true;
}

/** O acesso foi apagado e criado de novo em outro aparelho: a cópia daqui não serve mais */
async function trocarPelaContaDaNuvem(m, remota) {
  await armazenamento.gravar('conta', remota.valor);
  for (const k of ['dados', 'base']) await armazenamento.apagar(k);
  Object.assign(m, { versao: { conta: remota.versao, dados: 0 }, pendente: { conta: false, dados: false } });
  window.dispatchEvent(new Event('caixa:apagado-na-nuvem'));
  return false;
}

async function sincronizarDados(m, versaoNuvem) {
  const dadosLocal = await armazenamento.ler('dados');

  // Nada mudou aqui: só traz a versão da nuvem, se for mais nova
  if (!m.pendente.dados) {
    if (!versaoNuvem || versaoNuvem === m.versao.dados) return;
    const remota = await nuvem.ler('dados');
    if (!remota) return;
    await armazenamento.gravar('dados', remota.valor);
    await armazenamento.gravar('base', remota.valor);
    m.versao.dados = remota.versao;
    if (chave) {
      await carregarDados();
      avisarTelas();
      avisarOutrasAbas('mudou');
    }
    return;
  }

  if (!dadosLocal) { m.pendente.dados = false; return; }

  // Mudou aqui: tenta enviar direto (só dá certo se ninguém gravou na nuvem desde a última vez)
  const esperada = versaoNuvem ? m.versao.dados : 0;
  const v = await nuvem.gravar('dados', dadosLocal, esperada);
  if (v > 0) {
    await armazenamento.gravar('base', dadosLocal);
    m.versao.dados = v;
    m.pendente.dados = false;
    return;
  }

  // Outro aparelho gravou antes. Para juntar, precisa da chave (sistema desbloqueado).
  if (!chave) return;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const remota = await nuvem.ler('dados');
    if (!remota) return; // sumiu enquanto isso: a próxima sincronização envia de novo
    let deLa, base;
    try {
      deLa = await decifrar(chave, remota.valor);
    } catch {
      // não abre com esta chave: o acesso foi recriado em outro aparelho
      window.dispatchEvent(new Event('caixa:apagado-na-nuvem'));
      return;
    }
    const baseSalva = await armazenamento.ler('base');
    try { base = baseSalva ? await decifrar(chave, baseSalva) : null; } catch { base = null; }

    const antesDeJuntar = mudancas;
    const daqui = structuredClone(banco.tabelas);
    let juntas = mesclarTabelas(base?.tabelas || tabelasVazias(), daqui, deLa.tabelas || {}, TABELAS);
    // se a pessoa mexeu em algo enquanto isso, junta essa mudança também
    if (mudancas !== antesDeJuntar) juntas = mesclarTabelas(daqui, banco.tabelas, juntas, TABELAS);
    const ultimoBackup = [local.ultimoBackup, deLa.ultimoBackup].filter(Boolean).sort().pop() || null;
    const cifrado = await cifrar(chave, { tabelas: juntas, ultimoBackup });

    const v2 = await nuvem.gravar('dados', cifrado, remota.versao);
    if (v2 > 0) {
      banco.tabelas = juntas;
      local.ultimoBackup = ultimoBackup;
      await armazenamento.gravar('dados', cifrado);
      await armazenamento.gravar('base', cifrado);
      marcaAtual = marcaDe(cifrado);
      m.versao.dados = v2;
      m.pendente.dados = false;
      avisarTelas();
      avisarOutrasAbas('mudou');
      return;
    }
  }
}

// Confere a nuvem de tempos em tempos enquanto o app está aberto, e quando a internet volta
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => sincronizar());
  setInterval(() => {
    if (document.visibilityState === 'visible') sincronizar();
  }, 20_000);
}
