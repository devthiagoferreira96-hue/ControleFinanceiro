// Telas de apoio da nuvem: aviso de configuração faltando e espera enquanto busca os dados.
// (Entrar, criar conta e recuperar a senha ficam em acesso.js.)
import { esc } from '../lib/format.js';

const app = () => document.getElementById('app');
const marca = (subtitulo) => `
  <div class="mb-6 flex flex-col items-center gap-3 text-center">
    <span class="flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white" aria-hidden="true">R$</span>
    <div><h1 class="text-2xl font-bold">Controle seu caixa</h1>
    <p class="text-stone-600 dark:text-stone-400">${subtitulo}</p></div>
  </div>`;

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
