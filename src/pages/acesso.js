// Telas de acesso. Uma senha só para tudo:
//   - Entrar: e-mail + senha (uma vez em cada aparelho)
//   - Criar conta: e-mail, nome e senha (recebe o código de recuperação)
//   - Esqueci minha senha: e-mail + código de recuperação + senha nova
//   - Ao abrir o sistema num aparelho já conectado: só a senha
import { local } from '../lib/local-db.js';
import * as nuvem from '../lib/nuvem.js';
import { dadosIniciais } from '../lib/exemplo.js';
import { escolherBackup } from '../components/backup.js';
import { mostrarCodigoRecuperacao } from '../components/recuperacao.js';
import { codigoValido } from '../lib/cofre.js';
import { icone, erroNoCampo, limparErros, dialogo, toast, semRepetir } from '../lib/ui.js';
import { esc } from '../lib/format.js';

const app = () => document.getElementById('app');
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const campoEmail = (valor = '') => `
  <div data-campo>
    <label class="rotulo" for="email">E-mail</label>
    <input id="email" name="email" type="email" class="campo" autocomplete="username" inputmode="email" maxlength="120" placeholder="voce@exemplo.com" value="${esc(valor)}">
  </div>`;
const linkTexto = (atributo, texto, forte = false) =>
  `<button type="button" ${atributo} class="cursor-pointer p-2 text-sm ${forte ? 'font-semibold text-brand-700 dark:text-brand-400' : 'text-stone-600 dark:text-stone-400'} underline underline-offset-2">${texto}</button>`;

/** Mostra o erro geral do formulário */
function erroGeral(form, texto) {
  const p = form.querySelector('[data-erro-geral]');
  p.textContent = texto;
  p.classList.toggle('hidden', !texto);
}
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
      <input id="${id}" name="${id}" type="password" class="campo pr-12" autocomplete="${autocomplete}" maxlength="64" ${dica ? `aria-describedby="dica-${id}"` : ''}>
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

// ---------- Entrar (aparelho ainda não conectado)
// aoConectar(senha) é chamado depois do login: traz os dados e abre o sistema
export function telaEntrar(aoConectar, aoCriar, { email = '' } = {}) {
  document.title = 'Entrar · Controle seu caixa';
  app().innerHTML = `
  <main class="grid min-h-dvh place-items-center p-4">
    <div class="w-full max-w-sm animate-entrar">
      ${marca('Entre com o seu e-mail e a sua senha.')}
      <form class="card grid gap-4" novalidate>
        ${campoEmail(email)}
        ${campoSenha('senha', 'Senha', 'current-password')}
        <p data-erro-geral class="-mt-2 hidden text-sm font-medium text-red-700 dark:text-red-400" role="alert"></p>
        <button type="submit" class="btn-primario">Entrar</button>
      </form>
      <div class="mt-4 flex flex-col items-center gap-1">
        ${linkTexto('data-criar', 'Ainda não tenho conta: criar', true)}
        ${linkTexto('data-esqueci', 'Esqueci minha senha')}
      </div>
    </div>
  </main>`;
  const form = app().querySelector('form');
  ligarMostrarSenha(form);
  (email ? form.senha : form.email).focus();
  app().querySelector('[data-criar]').onclick = () => aoCriar(form.email.value.trim());
  app().querySelector('[data-esqueci]').onclick = () => esqueciSemLogin(form.email.value.trim(), aoConectar);
  form.onsubmit = semRepetir(async (e) => {
    e.preventDefault();
    limparErros(form);
    erroGeral(form, '');
    const em = form.email.value.trim().toLowerCase();
    if (!emailValido(em)) return erroNoCampo(form, 'email', 'Escreva um e-mail válido.');
    if (!form.senha.value) return erroNoCampo(form, 'senha', 'Digite sua senha.');
    const botao = form.querySelector('[type=submit]');
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    try {
      await nuvem.entrarComSenha(em, form.senha.value);
    } catch (err) {
      erroGeral(form, err.message);
      botao.disabled = false;
      botao.textContent = 'Entrar';
      return;
    }
    await aoConectar(form.senha.value);
  });
}

/** Esqueci a senha num aparelho ainda não conectado: e-mail + código + senha nova */
function esqueciSemLogin(emailDigitado, aoConectar) {
  let erros = 0;
  const d = dialogo({
    titulo: 'Esqueci minha senha',
    largura: 'max-w-md',
    corpo: `
      <form class="grid gap-4" novalidate>
        <p class="text-stone-700 dark:text-stone-300">Digite o seu e-mail e o <strong>código de recuperação</strong> que apareceu quando a conta foi criada. Depois crie uma senha nova. Seus dados continuam todos lá.</p>
        ${campoEmail(emailDigitado)}
        <div data-campo><label class="rotulo" for="codigo">Código de recuperação</label>
          <input id="codigo" name="codigo" class="campo text-center font-mono text-lg tracking-wider uppercase" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="XXXX-XXXX-XXXX-XXXX"></div>
        ${campoSenha('nova', 'Senha nova', 'new-password', 'Pelo menos 4 caracteres.')}
        ${campoSenha('repetir', 'Repita a senha nova', 'new-password')}
        <button type="submit" class="btn-primario">Criar senha nova</button>
      </form>`,
  });
  const f = d.querySelector('form');
  ligarMostrarSenha(f);
  (emailDigitado ? f.codigo : f.email).focus();
  f.onsubmit = semRepetir(async (e) => {
    e.preventDefault();
    limparErros(f);
    const em = f.email.value.trim().toLowerCase();
    let ok = true;
    if (!emailValido(em)) { erroNoCampo(f, 'email', 'Escreva um e-mail válido.'); ok = false; }
    if (!codigoValido(f.codigo.value)) { erroNoCampo(f, 'codigo', 'Confira o código: são 16 letras e números.'); ok = false; }
    if (f.nova.value.length < 4) { erroNoCampo(f, 'nova', 'A senha precisa ter pelo menos 4 caracteres.'); ok = false; }
    else if (f.nova.value !== f.repetir.value) { erroNoCampo(f, 'repetir', 'As duas senhas estão diferentes.'); ok = false; }
    if (!ok) return f.querySelector('[aria-invalid]').focus();
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    botao.textContent = 'Conferindo…';
    try {
      if (await nuvem.recuperarAcesso(em, f.codigo.value, f.nova.value)) {
        await nuvem.entrarComSenha(em, f.nova.value);
        d.close();
        await aoConectar(f.nova.value, { codigo: f.codigo.value });
        return;
      }
      erros++;
      const espera = erros >= 5 ? 30 : 0;
      erroNoCampo(f, 'codigo', espera ? `E-mail ou código incorreto. Aguarde ${espera} segundos.` : 'E-mail ou código incorreto. Confira as letras e números.');
      setTimeout(() => { botao.disabled = false; botao.textContent = 'Criar senha nova'; }, espera * 1000);
    } catch (err) {
      erroNoCampo(f, 'codigo', err.message);
      botao.disabled = false;
      botao.textContent = 'Criar senha nova';
    }
  });
}

// ---------- Primeiro acesso: criar a conta (e-mail, nome e senha)
// `email` = já conectado na nuvem (só falta criar os dados); senão a conta da nuvem é criada aqui
export function telaPrimeiroAcesso(aoEntrar, restaurando = null, { email = '', conectado = false, aoVoltar = null } = {}) {
  document.title = 'Começar · Controle seu caixa';
  app().innerHTML = `
  <main class="grid min-h-dvh place-items-center p-4">
    <div class="w-full max-w-sm animate-entrar">
      ${marca(restaurando ? 'Crie a sua conta para abrir o backup.' : 'Vamos criar a sua conta.')}
      <form class="card grid gap-4" novalidate>
        ${conectado ? `<p class="text-sm text-stone-600 dark:text-stone-400">Conta: <strong>${esc(nuvem.usuarioNuvem()?.email || '')}</strong></p>` : campoEmail(email)}
        ${restaurando ? `<p class="rounded-xl bg-brand-50 p-3 text-sm text-brand-900 dark:bg-brand-950 dark:text-brand-100">Backup de ${esc(restaurando.usuario || 'usuário')} com ${restaurando.tabelas.lancamentos?.length || 0} lançamentos pronto para restaurar.</p>` : ''}
        <div data-campo>
          <label class="rotulo" for="usuario">Seu nome</label>
          <input id="usuario" name="usuario" class="campo" maxlength="40" autocomplete="username" value="${esc(restaurando?.usuario || '')}" placeholder="Ex.: Thiago">
        </div>
        ${campoSenha('senha', 'Crie uma senha', 'new-password', 'Pelo menos 4 caracteres. Ela é pedida toda vez que o sistema for aberto.')}
        ${campoSenha('confirmar', 'Repita a senha', 'new-password')}
        ${restaurando ? '' : `
        <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
          <input type="checkbox" name="exemplo" class="mt-0.5 size-5 accent-brand-600">
          <span><span class="block font-semibold">Começar com dados de exemplo</span>
          <span class="block text-sm text-stone-600 dark:text-stone-400">Para conhecer o sistema. Depois dá para apagar tudo em Ajustes.</span></span>
        </label>`}
        <div class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" role="note">
          <strong>Guarde bem a senha.</strong> É a mesma para entrar em qualquer aparelho. Na próxima tela você recebe um <strong>código de recuperação</strong>: com ele dá para criar uma senha nova se esquecer.
        </div>
        <p data-erro-geral class="-mt-2 hidden text-sm font-medium text-red-700 dark:text-red-400" role="alert"></p>
        <button type="submit" class="btn-primario">${restaurando ? 'Criar e restaurar' : 'Criar e entrar'}</button>
      </form>
      <div class="mt-4 flex flex-col items-center gap-1">
        ${restaurando ? '' : linkTexto('data-restaurar', 'Já tenho um arquivo de backup', true)}
        ${aoVoltar ? linkTexto('data-voltar-entrar', 'Já tenho conta: entrar') : ''}
      </div>
    </div>
  </main>`;

  const form = app().querySelector('form');
  ligarMostrarSenha(form);
  (form.email && !form.email.value ? form.email : form.usuario).focus();
  const opcoes = { email, conectado, aoVoltar };
  app().querySelector('[data-restaurar]')?.addEventListener('click', async () => {
    const dados = await escolherBackup();
    if (dados) telaPrimeiroAcesso(aoEntrar, dados, { ...opcoes, email: form.email?.value.trim() || email });
  });
  app().querySelector('[data-voltar-entrar]')?.addEventListener('click', () => aoVoltar(form.email?.value.trim() || ''));

  form.onsubmit = semRepetir(async (e) => {
    e.preventDefault();
    limparErros(form);
    erroGeral(form, '');
    const usuario = form.usuario.value.trim();
    const senha = form.senha.value;
    const em = conectado ? '' : form.email.value.trim().toLowerCase();
    let ok = true;
    if (!conectado && !emailValido(em)) { erroNoCampo(form, 'email', 'Escreva um e-mail válido. Ele é o seu login.'); ok = false; }
    if (!usuario) { erroNoCampo(form, 'usuario', 'Escreva seu nome.'); ok = false; }
    if (senha.length < 4) { erroNoCampo(form, 'senha', 'A senha precisa ter pelo menos 4 caracteres.'); ok = false; }
    else if (form.confirmar.value !== senha) { erroNoCampo(form, 'confirmar', 'As duas senhas estão diferentes.'); ok = false; }
    if (!ok) return form.querySelector('[aria-invalid]').focus();

    const botao = form.querySelector('[type=submit]');
    botao.disabled = true;
    botao.textContent = 'Preparando…';
    const tabelas = restaurando ? restaurando.tabelas : dadosIniciais({ comExemplo: form.exemplo?.checked });
    let codigo;
    try {
      if (!conectado) {
        let r;
        try {
          r = await nuvem.cadastrarComSenha(em, senha);
        } catch (err) {
          // e-mail já cadastrado (ex.: tentativa anterior que parou no meio): tenta entrar com a mesma senha
          if (!/Já existe uma conta/.test(err.message)) throw err;
          await nuvem.entrarComSenha(em, senha).catch(() => { throw new Error('Já existe uma conta com esse e-mail. Toque em "Já tenho conta: entrar".'); });
          r = { confirmar: false };
        }
        if (r.confirmar) throw new Error('O Supabase está pedindo confirmação de e-mail. Desligue "Confirm email" em Authentication > Sign In / Providers > Email e tente de novo.');
        await local.conectarNuvem();
      }
      codigo = await local.criarConta(usuario, senha, tabelas);
    } catch (err) {
      erroGeral(form, err.message);
      botao.disabled = false;
      botao.textContent = restaurando ? 'Criar e restaurar' : 'Criar e entrar';
      return;
    }
    await mostrarCodigoRecuperacao(codigo, { motivo: 'criado' });
    if (restaurando) toast('Backup restaurado');
    await aoEntrar();
  });
}

// ---------- Ao abrir o sistema: pedir a senha
export function telaSenha(usuario, aoEntrar) {
  document.title = 'Entrar · Controle seu caixa';
  let erros = 0;
  app().innerHTML = `
  <main class="grid min-h-dvh place-items-center p-4">
    <div class="w-full max-w-sm animate-entrar">
      ${marca(`Olá, ${esc(usuario)}! Digite sua senha para entrar.`)}
      <form class="card grid gap-4" novalidate>
        <input type="text" name="usuario" value="${esc(usuario)}" autocomplete="username" class="hidden" aria-label="Usuário" aria-hidden="true" tabindex="-1">
        ${campoSenha('senha', 'Senha', 'current-password')}
        <p id="erro-senha-geral" class="erro-campo -mt-2 hidden" role="alert"></p>
        <button type="submit" class="btn-primario">Entrar</button>
      </form>
      <p class="mt-4 text-center"><button type="button" data-esqueci class="cursor-pointer p-2 text-sm text-stone-600 underline underline-offset-2 dark:text-stone-400">Esqueci minha senha</button></p>
    </div>
  </main>`;

  const form = app().querySelector('form');
  const erro = app().querySelector('#erro-senha-geral');
  ligarMostrarSenha(form);
  form.senha.focus();
  app().querySelector('[data-esqueci]').onclick = () => esqueciSenha(aoEntrar);

  form.onsubmit = semRepetir(async (e) => {
    e.preventDefault();
    const botao = form.querySelector('[type=submit]');
    if (!form.senha.value) { erro.textContent = 'Digite sua senha.'; erro.classList.remove('hidden'); return form.senha.focus(); }
    botao.disabled = true;
    botao.textContent = 'Abrindo…';
    const r = await local.desbloquear(form.senha.value);
    if (r.ok) {
      if (r.codigoNovo) await mostrarCodigoRecuperacao(r.codigoNovo, { motivo: 'atualizacao' });
      return aoEntrar();
    }
    erros++;
    // depois de 5 erros, espera um pouco a cada tentativa (dificulta quem tenta adivinhar)
    const espera = erros >= 5 ? 30 : 0;
    erro.textContent = espera ? `Senha incorreta. Aguarde ${espera} segundos para tentar de novo.` : 'Senha incorreta. Tente de novo.';
    erro.classList.remove('hidden');
    form.senha.value = '';
    form.senha.setAttribute('aria-invalid', 'true');
    setTimeout(() => { botao.disabled = false; botao.textContent = 'Entrar'; form.senha.focus(); }, espera * 1000);
  });
}

function esqueciSenha(aoEntrar) {
  let erros = 0;
  const d = dialogo({
    titulo: 'Esqueci minha senha',
    largura: 'max-w-md',
    corpo: `
      <form class="grid gap-4" novalidate>
        <p class="text-stone-700 dark:text-stone-300">Digite o <strong>código de recuperação</strong> que você guardou (no WhatsApp ou no papel) e crie uma senha nova. Seus dados continuam todos aqui.</p>
        <div data-campo><label class="rotulo" for="codigo">Código de recuperação</label>
          <input id="codigo" name="codigo" class="campo text-center font-mono text-lg tracking-wider uppercase" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="XXXX-XXXX-XXXX-XXXX" aria-describedby="dica-codigo">
          <p id="dica-codigo" class="dica">16 letras e números. Pode digitar com ou sem os tracinhos.</p></div>
        ${campoSenha('nova', 'Senha nova', 'new-password', 'Pelo menos 4 caracteres.')}
        ${campoSenha('repetir', 'Repita a senha nova', 'new-password')}
        <button type="submit" class="btn-primario">Criar senha nova</button>
        <button type="button" class="cursor-pointer p-2 text-sm text-stone-600 underline underline-offset-2 dark:text-stone-400" data-sem-codigo>Não tenho o código</button>
      </form>`,
  });
  const f = d.querySelector('form');
  ligarMostrarSenha(f);
  f.codigo.focus();
  f.onsubmit = semRepetir(async (e) => {
    e.preventDefault();
    limparErros(f);
    let ok = true;
    if (!codigoValido(f.codigo.value)) { erroNoCampo(f, 'codigo', 'Confira o código: são 16 letras e números.'); ok = false; }
    if (f.nova.value.length < 4) { erroNoCampo(f, 'nova', 'A senha precisa ter pelo menos 4 caracteres.'); ok = false; }
    else if (f.nova.value !== f.repetir.value) { erroNoCampo(f, 'repetir', 'As duas senhas estão diferentes.'); ok = false; }
    if (!ok) return f.querySelector('[aria-invalid]').focus();
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true;
    botao.textContent = 'Conferindo…';
    let codigoNovo;
    try {
      codigoNovo = await local.recuperarComCodigo(f.codigo.value, f.nova.value);
    } catch (err) {
      erroNoCampo(f, 'codigo', err.offline ? 'Conecte-se à internet para criar a senha nova.' : err.message);
      botao.disabled = false;
      botao.textContent = 'Criar senha nova';
      return;
    }
    if (codigoNovo) {
      d.close();
      await mostrarCodigoRecuperacao(codigoNovo, { motivo: 'recuperado' });
      toast('Senha nova criada. Ela vale em todos os aparelhos.');
      return aoEntrar();
    }
    erros++;
    const espera = erros >= 5 ? 30 : 0;
    erroNoCampo(f, 'codigo', espera ? `Código incorreto. Aguarde ${espera} segundos para tentar de novo.` : 'Código incorreto. Confira as letras e números.');
    setTimeout(() => { botao.disabled = false; botao.textContent = 'Criar senha nova'; }, espera * 1000);
  });
  f.querySelector('[data-sem-codigo]').onclick = () => { d.close(); semCodigo(aoEntrar); };
}

/** Sem senha e sem código: a única saída é apagar e começar de novo (podendo restaurar um backup) */
function semCodigo(aoEntrar) {
  const d = dialogo({
    titulo: 'Sem a senha e sem o código',
    largura: 'max-w-md',
    corpo: `
      <div class="grid gap-3 text-stone-700 dark:text-stone-300">
        <p>Para proteger seus dados, eles ficam <strong>trancados</strong>. Sem a senha e sem o código de recuperação, não é possível abrir os dados (nem na nuvem).</p>
        <p>Se você tiver um <strong>arquivo de backup</strong>, pode apagar este acesso, criar um novo e restaurar os dados dele.</p>
      </div>
      <div class="mt-5 grid gap-2">
        <button type="button" class="btn-primario" data-voltar>Voltar e tentar o código de novo</button>
        <button type="button" class="btn-neutro text-red-700 dark:text-red-400" data-zerar>Apagar este acesso e começar do zero</button>
      </div>`,
  });
  d.querySelector('[data-voltar]').onclick = () => { d.close(); esqueciSenha(aoEntrar); };
  d.querySelector('[data-zerar]').onclick = () => {
    d.close();
    const c = dialogo({
      titulo: 'Apagar tudo?',
      largura: 'max-w-sm',
      corpo: `
        <form class="grid gap-3" novalidate>
          <p class="text-stone-700 dark:text-stone-300">Os dados serão <strong>apagados da nuvem e dos aparelhos</strong>. Depois você cria um acesso novo e pode restaurar um backup.</p>
          <div data-campo><label class="rotulo" for="confirmar-apagar">Para confirmar, digite APAGAR</label>
          <input id="confirmar-apagar" name="texto" class="campo uppercase" autocomplete="off"></div>
          <button type="submit" class="btn-perigo">Apagar e começar do zero</button>
        </form>`,
    });
    const f = c.querySelector('form');
    f.texto.focus();
    f.onsubmit = semRepetir(async (e) => {
      e.preventDefault();
      if (f.texto.value.trim().toUpperCase() !== 'APAGAR') return erroNoCampo(f, 'texto', 'Digite APAGAR para confirmar.');
      try {
        await local.apagarTudo();
      } catch (err) {
        return erroNoCampo(f, 'texto', err.message);
      }
      c.close();
      telaPrimeiroAcesso(aoEntrar, null, { conectado: true });
    });
  };
}
