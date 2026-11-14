// Telas da conta na nuvem: entrar/criar conta (uma vez por aparelho), trocar a senha da nuvem
// pelo link do e-mail e o aviso de configuração faltando.
import * as nuvem from '../lib/nuvem.js';
import { icone, erroNoCampo, limparErros, dialogo, toast, semRepetir } from '../lib/ui.js';
import { esc } from '../lib/format.js';

const app = () => document.getElementById('app');
const marca = (subtitulo) => `
  <div class="mb-6 flex flex-col items-center gap-3 text-center">
    <span class="flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white" aria-hidden="true">R$</span>
    <div><h1 class="text-2xl font-bold">Controle seu caixa</h1>
    <p class="text-stone-600 dark:text-stone-400">${subtitulo}</p></div>
  </div>`;

const campoSenha = (id, rotulo, autocomplete, dica = '') => `
  <div data-campo>
    <label class="rotulo" for="${id}">${rotulo}</label>
    <div class="relative">
      <input id="${id}" name="${id}" type="password" class="campo pr-12" autocomplete="${autocomplete}" maxlength="72" ${dica ? `aria-describedby="dica-${id}"` : ''}>
      <button type="button" data-ver="${id}" class="btn-icone absolute inset-y-0 right-0" aria-label="Mostrar senha" aria-pressed="false">${icone('olho')}</button>
    </div>
    ${dica ? `<p id="dica-${id}" class="dica">${dica}</p>` : ''}
  </div>`;

function ligarMostrarSenha(raiz) {
  raiz.querySelectorAll('[data-ver]').forEach((b) => (b.onclick = () => {
    const campo = raiz.querySelector(`#${b.dataset.ver}`);
    const ver = campo.type === 'password';
    campo.type = ver ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(ver));
    b.setAttribute('aria-label', ver ? 'Esconder senha' : 'Mostrar senha');
  }));
}

const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------- Entrar ou criar a conta da nuvem
export function telaNuvem(aoEntrar, { aviso = '', criar = false } = {}) {
  document.title = 'Entrar · Controle seu caixa';
  app().innerHTML = `
  <main class="grid min-h-dvh place-items-center p-4">
    <div class="w-full max-w-sm animate-entrar">
      ${marca(criar ? 'Crie sua conta na nuvem para guardar os dados com segurança.' : 'Entre na sua conta da nuvem.')}
      <form class="card grid gap-4" novalidate>
        ${aviso ? `<p class="rounded-xl bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-950 dark:text-brand-100" role="status">${esc(aviso)}</p>` : ''}
        <div data-campo>
          <label class="rotulo" for="email">E-mail</label>
          <input id="email" name="email" type="email" class="campo" autocomplete="email" inputmode="email" maxlength="120" placeholder="voce@exemplo.com">
        </div>
        ${campoSenha('senha', criar ? 'Crie uma senha para a nuvem' : 'Senha da nuvem', criar ? 'new-password' : 'current-password', criar ? 'Pelo menos 6 caracteres.' : '')}
        ${criar ? campoSenha('confirmar', 'Repita a senha', 'new-password') : ''}
        <p id="erro-nuvem" class="erro-campo -mt-2 hidden" role="alert"></p>
        <button type="submit" class="btn-primario">${criar ? 'Criar conta' : 'Entrar'}</button>
      </form>
      <div class="mt-4 flex flex-col items-center gap-1">
        <button type="button" data-trocar class="cursor-pointer p-2 text-sm font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-400">${criar ? 'Já tenho conta: entrar' : 'Ainda não tenho conta: criar'}</button>
        ${criar ? '' : '<button type="button" data-esqueci class="cursor-pointer p-2 text-sm text-stone-600 underline underline-offset-2 dark:text-stone-400">Esqueci a senha da nuvem</button>'}
      </div>
    </div>
  </main>`;

  const form = app().querySelector('form');
  const erro = app().querySelector('#erro-nuvem');
  ligarMostrarSenha(form);
  form.email.focus();
  app().querySelector('[data-trocar]').onclick = () => telaNuvem(aoEntrar, { criar: !criar });
  app().querySelector('[data-esqueci]')?.addEventListener('click', () => esqueciSenhaNuvem(form.email.value.trim()));

  form.onsubmit = semRepetir(async (e) => {
    e.preventDefault();
    limparErros(form);
    erro.classList.add('hidden');
    const email = form.email.value.trim().toLowerCase();
    const senha = form.senha.value;
    let ok = true;
    if (!emailValido(email)) { erroNoCampo(form, 'email', 'Escreva um e-mail válido.'); ok = false; }
    if (criar && senha.length < 6) { erroNoCampo(form, 'senha', 'A senha precisa ter pelo menos 6 caracteres.'); ok = false; }
    else if (!criar && !senha) { erroNoCampo(form, 'senha', 'Digite a senha.'); ok = false; }
    else if (criar && form.confirmar.value !== senha) { erroNoCampo(form, 'confirmar', 'As duas senhas estão diferentes.'); ok = false; }
    if (!ok) return form.querySelector('[aria-invalid]').focus();

    const botao = form.querySelector('[type=submit]');
    const texto = botao.textContent;
    botao.disabled = true;
    botao.textContent = criar ? 'Criando…' : 'Entrando…';
    try {
      if (criar) {
        const r = await nuvem.cadastrar(email, senha);
        if (r.confirmar) {
          return telaNuvem(aoEntrar, { aviso: `Enviamos um e-mail para ${email}. Abra a mensagem e toque no link para confirmar; depois entre aqui.` });
        }
      } else {
        await nuvem.entrar(email, senha);
      }
      await aoEntrar();
    } catch (err) {
      erro.textContent = err.message;
      erro.classList.remove('hidden');
      botao.disabled = false;
      botao.textContent = texto;
    }
  });
}

function esqueciSenhaNuvem(emailDigitado) {
  const d = dialogo({
    titulo: 'Esqueci a senha da nuvem',
    largura: 'max-w-sm',
    corpo: `
      <form class="grid gap-4" novalidate>
        <p class="text-stone-700 dark:text-stone-300">Vamos enviar um link para o seu e-mail. Abra o link <strong>neste aparelho</strong> para criar uma senha nova da nuvem. Seus dados não são afetados.</p>
        <div data-campo><label class="rotulo" for="email-recuperar">E-mail</label>
        <input id="email-recuperar" name="email" type="email" class="campo" autocomplete="email" inputmode="email" value="${esc(emailDigitado)}"></div>
        <button type="submit" class="btn-primario">Enviar link</button>
      </form>`,
  });
  const f = d.querySelector('form');
  f.email.focus();
  f.onsubmit = semRepetir(async (e) => {
    e.preventDefault();
    limparErros(f);
    const email = f.email.value.trim().toLowerCase();
    if (!emailValido(email)) return erroNoCampo(f, 'email', 'Escreva um e-mail válido.');
    try {
      await nuvem.enviarEmailDeSenha(email);
      d.close();
      toast(`Se existir uma conta com ${email}, o link chega em instantes.`);
    } catch (err) {
      erroNoCampo(f, 'email', err.message);
    }
  });
}

// ---------- Voltou pelo link do e-mail "trocar senha": cria a senha nova da nuvem
export function telaNovaSenhaNuvem(aoTerminar) {
  document.title = 'Nova senha · Controle seu caixa';
  app().innerHTML = `
  <main class="grid min-h-dvh place-items-center p-4">
    <div class="w-full max-w-sm animate-entrar">
      ${marca('Crie a nova senha da sua conta na nuvem.')}
      <form class="card grid gap-4" novalidate>
        ${campoSenha('nova', 'Senha nova da nuvem', 'new-password', 'Pelo menos 6 caracteres.')}
        ${campoSenha('repetir', 'Repita a senha nova', 'new-password')}
        <button type="submit" class="btn-primario">Salvar senha nova</button>
      </form>
    </div>
  </main>`;
  const f = app().querySelector('form');
  ligarMostrarSenha(f);
  f.nova.focus();
  f.onsubmit = semRepetir(async (e) => {
    e.preventDefault();
    limparErros(f);
    if (f.nova.value.length < 6) return erroNoCampo(f, 'nova', 'A senha precisa ter pelo menos 6 caracteres.');
    if (f.nova.value !== f.repetir.value) return erroNoCampo(f, 'repetir', 'As duas senhas estão diferentes.');
    try {
      await nuvem.trocarSenhaDaNuvem(f.nova.value);
      toast('Senha da nuvem trocada.');
      await aoTerminar();
    } catch (err) {
      erroNoCampo(f, 'nova', err.message);
    }
  });
}

// ---------- Ainda faltam as chaves do Supabase (.env.local ou Secrets do GitHub)
export function telaSemConfiguracao() {
  document.title = 'Configuração · Controle seu caixa';
  app().innerHTML = `
  <main class="grid min-h-dvh place-items-center p-4">
    <div class="w-full max-w-md animate-entrar">
      ${marca('Falta ligar o sistema à nuvem.')}
      <div class="card grid gap-3 text-stone-700 dark:text-stone-300">
        <p>Faltam as chaves do Supabase (Project URL e chave publishable/anon).</p>
        <p><strong>No computador:</strong> copie o arquivo <code class="font-mono">.env.example</code> para <code class="font-mono">.env.local</code>, preencha e rode <code class="font-mono">npm run dev</code> de novo.</p>
        <p><strong>No site publicado:</strong> no GitHub, em Settings &gt; Secrets and variables &gt; Actions, crie os secrets <code class="font-mono">VITE_SUPABASE_URL</code> e <code class="font-mono">VITE_SUPABASE_ANON_KEY</code> e publique de novo.</p>
      </div>
    </div>
  </main>`;
}

/** Tela simples de espera enquanto traz os dados da nuvem */
export function telaCarregando(texto = 'Buscando seus dados na nuvem…') {
  app().innerHTML = `<div class="grid min-h-dvh place-items-center text-stone-500" role="status">${esc(texto)}</div>`;
}
