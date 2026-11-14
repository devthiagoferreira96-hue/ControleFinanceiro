// Ponto de partida: conta da nuvem (uma vez por aparelho), depois primeiro acesso (criar usuário)
// ou tela de senha, e então abre o sistema
import './style.css';
import { store } from './lib/store.js';
import { carregarCadastros } from './lib/api.js';
import { local } from './lib/local-db.js';
import { aplicarPreferencias } from './lib/preferencias.js';
import { telaPrimeiroAcesso, telaSenha } from './pages/acesso.js';
import { iniciarApp, redesenharSeSeguro } from './router.js';
import { toast } from './lib/ui.js';
import * as nuvem from './lib/nuvem.js';
import { telaNuvem, telaNovaSenhaNuvem, telaSemConfiguracao, telaCarregando } from './pages/nuvem.js';

aplicarPreferencias();

// App instalável e que abre sem internet (só na versão publicada, não no "npm run dev")
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

async function iniciar() {
  if (!nuvem.configurada()) return telaSemConfiguracao();
  // voltou pelo link do e-mail (confirmar a conta ou trocar a senha da nuvem)
  const retorno = await nuvem.lerRetornoDoEmail().catch((e) => ({ erro: e.message }));
  if (retorno?.tipo === 'recovery') return telaNovaSenhaNuvem(depoisDaNuvem);
  if (!nuvem.logado()) return telaNuvem(depoisDaNuvem, { aviso: retorno?.erro || '' });
  if (retorno?.tipo) toast('E-mail confirmado. Conta da nuvem pronta.');
  return depoisDaNuvem();
}

/** Já conectado à nuvem: traz os dados e segue o fluxo de sempre (senha do sistema) */
async function depoisDaNuvem() {
  telaCarregando();
  await local.conectarNuvem();
  const usuario = await local.usuarioCadastrado();
  if (usuario) telaSenha(usuario, abrirSistema);
  else telaPrimeiroAcesso(abrirSistema);
}

async function abrirSistema() {
  store.usuario = local.usuario;
  await carregarCadastros();
  iniciarApp();
}

/** Bloqueia o sistema: esquece a chave da memória e volta para a tela de senha */
export function bloquear() {
  local.bloquear();
  location.hash = '';
  location.reload();
}

// Pede a senha de novo quando o app fica em segundo plano por mais de 1 minuto
// (no celular, "fechar" o app muitas vezes só o deixa em segundo plano)
const BLOQUEAR_APOS_MS = 60_000;
let saiuEm = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saiuEm = Date.now();
  else if (saiuEm && store.usuario && Date.now() - saiuEm > BLOQUEAR_APOS_MS) bloquear();
});
window.addEventListener('caixa:bloquear', bloquear);

// Outra aba/janela mudou os dados: atualiza esta também
window.addEventListener('caixa:dados-externos', async () => {
  if (!store.usuario) return;
  await carregarCadastros();
  redesenharSeSeguro();
});
// Ao voltar para esta aba, confere se algo mudou (para navegadores sem aviso entre abas)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.usuario) local.recarregar();
});
// Se o aparelho não deixar gravar (sem espaço, modo privado...), avisa em vez de perder em silêncio
window.addEventListener('caixa:erro-gravar', () => {
  toast('Não foi possível salvar neste aparelho. Verifique se há espaço livre e faça um backup agora.', { tipo: 'erro' });
});

// Sessão da nuvem terminou (senha trocada em outro lugar, por exemplo): pede para entrar de novo
window.addEventListener('caixa:nuvem-saiu', () => {
  toast('Sua sessão na nuvem terminou. Entre de novo para continuar salvando na nuvem.', { tipo: 'erro' });
});
// Os dados foram apagados (ou o acesso recriado) em outro aparelho
window.addEventListener('caixa:apagado-na-nuvem', () => {
  location.hash = '';
  location.reload();
});
// Sem internet com mudanças guardadas só aqui / internet de volta
let avisouSemInternet = false;
window.addEventListener('caixa:nuvem-estado', async (e) => {
  if (!store.usuario) return;
  if (e.detail.offline) {
    if (!avisouSemInternet && (await local.temPendencias())) {
      avisouSemInternet = true;
      toast('Sem internet: as mudanças ficam guardadas neste aparelho e vão para a nuvem quando a conexão voltar.');
    }
  } else if (avisouSemInternet) {
    avisouSemInternet = false;
    toast('Conexão de volta: dados salvos na nuvem.');
  }
});

iniciar();
