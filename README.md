# Caixa da Família

Sistema para controlar os gastos da família: entradas e saídas do caixa, contas a pagar, cartões de crédito com parcelas, relatórios e pagamentos de funcionários e prestadores. Ele substitui a planilha `NOVO_CAIXA.xlsx`.

- **Dados na nuvem (Supabase).** Tudo fica salvo na nuvem e aparece no celular e no computador. Você entra com e-mail e senha da nuvem **uma vez em cada aparelho**.
- **Cifrado antes de sair do aparelho.** A senha do sistema cifra os dados (AES-256); o Supabase guarda, mas não consegue ler.
- **Funciona sem internet.** Uma cópia fica no aparelho; o que for feito sem conexão vai para a nuvem quando ela voltar.
- **Dois aparelhos ao mesmo tempo:** se os dois mudarem algo, as mudanças são juntadas linha por linha (nada se perde).
- **Histórico na nuvem:** o banco guarda cópias anteriores (até ~1 mês) para recuperar em caso de acidente.
- **Começa limpo:** sem categorias e sem cartões; cada usuário cadastra os seus em *Ajustes*.
- **Instala no celular** como um aplicativo (PWA) e funciona no computador também.

**Tecnologias:** JavaScript (ES Modules, sem framework), [Tailwind CSS 4](https://tailwindcss.com), [Vite](https://vite.dev), [Supabase](https://supabase.com) (banco na nuvem, sem bibliotecas extras: usa a API direto), IndexedDB e Web Crypto (já vêm no navegador).

---

## 1. Preparar a nuvem (Supabase), uma vez só

1. Crie um projeto grátis em [supabase.com](https://supabase.com).
2. Em **SQL Editor > New query**, cole todo o arquivo `supabase/schema.sql` e clique em **Run**. Ele cria a tabela, as regras de segurança (cada um só vê os próprios dados) e o histórico.
3. Em **Authentication > URL Configuration**, coloque em **Site URL** o endereço do site: `https://devthiagoferreira96-hue.github.io/ControleFinanceiro/` (e o mesmo em *Redirect URLs*). É para onde os links de e-mail (confirmar conta, trocar senha) levam.
4. Opcional: em **Authentication > Sign In / Providers > Email**, desligue *Confirm email* para entrar sem precisar confirmar o e-mail.
5. Em **Project Settings > API**, pegue a **Project URL** e a chave **anon / publishable**. Elas **não ficam no código**:
   - **No computador:** copie `.env.example` para `.env.local` e preencha (o `.env.local` não vai para o GitHub).
   - **No site publicado:** no GitHub, em *Settings > Secrets and variables > Actions > New repository secret*, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

A chave publishable/anon é feita para ir dentro do site (quem abrir o site consegue vê-la no navegador); ela sozinha não dá acesso a nenhum dado. Quem protege os dados é o login, as regras do banco (cada um só vê os seus) e a cifra com a senha do sistema. **Nunca** use a chave `service_role`/`secret` no projeto.

## 2. Rodar no seu computador

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
npm install
npm run dev
```

Abra o endereço que aparecer no terminal (normalmente http://localhost:5173).

No primeiro acesso, o sistema pede o **e-mail e a senha da nuvem** (crie a conta ali mesmo) e depois **seu nome** e a **senha do sistema**. Marque *Começar com dados de exemplo* para conhecer o sistema; depois, em *Ajustes > Usuário e senha > Apagar tudo*, dá para começar do zero.

## 3. Publicar e instalar no celular

**GitHub Pages (já configurado):**

1. Envie o projeto para o GitHub (`git push`).
2. No repositório, vá em **Settings > Pages > Source** e escolha **GitHub Actions**.
3. Quando a aba **Actions** ficar verde, o site estará em `https://devthiagoferreira96-hue.github.io/ControleFinanceiro/`.

**Instalar:**

- **Android (Chrome):** abra o endereço, toque nos três pontinhos ⋮ e depois em **Instalar app**.
- **iPhone (Safari):** abra o endereço, toque em compartilhar e depois em **Adicionar à Tela de Início**.

Depois de instalado, o sistema abre mesmo sem internet. Quando você publicar uma versão nova, o celular atualiza sozinho na próxima vez que tiver internet; **os dados não são afetados**.

**Já usava a versão antiga (só no aparelho)?** Nela, faça *Ajustes > Backup completo*. Na versão nova, no primeiro acesso, toque em *Já tenho um arquivo de backup*.

## Senha e segurança

- A senha e o código **nunca são guardados**. A partir deles são geradas chaves (PBKDF2, 310 mil repetições), e os dados ficam cifrados com AES-GCM 256 bits. Sem a senha ou o código, os dados guardados no aparelho são ilegíveis.
- A senha é pedida toda vez que o sistema é aberto, e de novo se o app ficar mais de 1 minuto em segundo plano. O cadeado no menu bloqueia na hora.
- Depois de 5 senhas erradas seguidas, o sistema espera 30 segundos entre tentativas.
- **Código de recuperação:** ao criar o acesso, o sistema mostra um código (ex.: `K7QM-2XPA-9TRW-HF4D`) com botões para enviar ao seu WhatsApp, compartilhar ou copiar. Ele aparece só uma vez.
- **Esqueceu a senha?** Na tela de senha, toque em *Esqueci minha senha*, digite o código e crie uma senha nova. Nenhum dado se perde. Depois de usado, o código é trocado por um novo, que é mostrado na hora.
- **Perdeu o código?** Em *Ajustes > Usuário e senha > Novo código de recuperação* (pede a senha), o antigo deixa de valer.
- **Sem a senha e sem o código** não há como abrir os dados: só um backup os traz de volta.
- **Como funciona por dentro:** os dados são cifrados com uma chave aleatória. Essa chave fica guardada em duas "fechaduras", uma aberta pela senha e outra pelo código. A cifra acontece no aparelho; a nuvem só recebe o resultado cifrado (veja `src/lib/cofre.js`).
- **Duas senhas:** a da **nuvem** (e-mail + senha, pedida uma vez por aparelho) diz *de quem* são os dados; a do **sistema** (pedida sempre) abre os dados. Esqueceu a da nuvem? *Esqueci a senha da nuvem* manda um link por e-mail. Esqueceu a do sistema? Use o código de recuperação.
- **Sair da nuvem:** *Ajustes > Usuário e senha > Sair da nuvem neste aparelho* tira os dados só daquele aparelho (útil em computador emprestado).
- **Apagar tudo** agora apaga da nuvem e de todos os aparelhos (o histórico do banco ainda guarda as últimas cópias).

## Casa, Fazenda e tipos de categoria

- Cada categoria tem um **tipo** (saída, entrada ou os dois). O formulário de lançamento só mostra as categorias do tipo escolhido. Dados de versões anteriores recebem o tipo automaticamente (pelo nome e pelo uso).
- As categorias dos grupos **Fazenda** e **Empresa** (`GRUPOS_SEPARADOS` em `src/lib/store.js`) ficam fora do *Resumo da casa* e ganham um quadro próprio no Início com vendas, despesas e lucro.

## Importar a planilha do Excel

*Ajustes > Backup, importar e exportar > Importar planilha do Excel*. Lê o `.xlsx` no modelo do `NOVO_CAIXA.xlsx` (uma aba por mês; caixa nas colunas A–J e um bloco por cartão), no próprio aparelho (`src/lib/ler-xlsx.js` + `DecompressionStream`). As colunas são achadas pelo título. Mostra uma prévia (mês/ano de cada aba, cadastros novos, avisos), pula o que já existe e pode ser desfeita. Regras em `src/lib/importar-planilha.js`.

## Temas de cores

*Ajustes > Aparência*: temas prontos (Verde Cofre, Azul Navy Contábil, Neutros com toque de cobre) ou 5 cores próprias (principal, gráficos, fundo, quadros, texto). `src/lib/temas.js` gera os tons da cor principal e os cinzas a partir dessas cores (OKLCH) e ajusta o que for preciso para manter contraste WCAG AA. As cores entram como variáveis CSS (`--color-brand-*`, `--color-stone-*`, `--color-fundo`, `--color-cartao`, `--color-texto`, `--color-destaque`).

## Proteções contra erro

- **Clique duplo** em Salvar não grava duas vezes (`semRepetir` em `lib/ui.js`).
- **Mais de uma aba/janela aberta** (ou o app instalado + o navegador): quem grava avisa as outras (`BroadcastChannel`), que recarregam os dados antes de continuar; nada se perde.
- **Backup editado ou danificado**: cada linha é conferida ao restaurar (`conferirTabelas` em `lib/api.js`); o que dá é corrigido, o resto fica de fora, e a pessoa é avisada antes de confirmar.
- **Nomes repetidos** em contas, cartões, categorias e pessoas são recusados (sem diferenciar maiúscula ou acento).
- **Aparelho sem espaço**: se não der para gravar, aparece um aviso pedindo backup.
- **Arquivos de fora**: PDF, CSV, Word, planilha com senha, .xls antigo, arquivo cortado ou vazio são recusados com uma mensagem que diz o que fazer.

## Backup

Os dados já ficam na nuvem, com histórico. O arquivo de backup é uma **cópia extra**, guardada onde você quiser.

- **Fazer backup:** *Ajustes > Backup e exportar > Backup, Excel ou PDF > Backup completo*. No celular, abre o *Compartilhar* (Drive, e-mail ou WhatsApp); no computador, baixa um arquivo `.json`.
- **Exportar:** na mesma janela dá para gerar uma **planilha do Excel (.xlsx)** (abas Resumo, Lançamentos, Cartões e Por categoria, com filtros e totais) ou um **relatório em PDF**, do mês aberto, do ano ou de tudo. Os dois arquivos são montados no próprio aparelho, sem internet e sem bibliotecas externas (`src/lib/exportar-*.js`, `zip.js`). Servem para consultar: só o `.json` restaura os dados.
- **Restaurar:** em *Ajustes > Restaurar um backup* ou, num aparelho novo, em *Já tenho um arquivo de backup* na primeira tela. A restauração tem *Desfazer*.
- O Início mostra um lembrete quando você ainda não fez backup ou quando o último tem mais de 30 dias.
- O arquivo de backup **não tem senha**: guarde-o num lugar só seu.

## Testes

```bash
npm test
```

Roda os testes das regras de negócio (em qual fatura cai cada compra, divisão de parcelas, datas e somas).

---

## Como o código está organizado

```
index.html                 página única (o JavaScript monta as telas)
public/                    ícones, manifest (instalar no celular) e sw.js (abrir sem internet)
src/
  main.js                  início: conta da nuvem, primeiro acesso ou tela de senha, bloqueio automático
  router.js                troca de tela pelo endereço (#inicio, #extrato…)
  style.css                Tailwind + componentes (botões, campos, cartões)
  lib/
    local-db.js            usuário, senha e tabelas cifradas; grava no aparelho e sincroniza com a nuvem
    nuvem.js               Supabase: login e leitura/gravação das caixas cifradas (fetch, sem bibliotecas)
    mesclar.js             junta mudanças feitas em dois aparelhos ao mesmo tempo
    cofre.js               criptografia (PBKDF2 + AES-GCM, Web Crypto)
    armazenamento.js       IndexedDB (cópia no aparelho, para abrir sem internet)
    consulta-local.js      consultas nos dados: from().select().eq().order()...
    api.js                 TODAS as leituras e gravações passam por aqui
    exemplo.js             contas iniciais e dados de exemplo (categorias e cartões só no exemplo)
    store.js               dados em memória (contas, cartões, categorias…)
    faturas.js             regra de fechamento/vencimento e parcelas
    calculos.js            somas (substituem os SUMIF da planilha)
    format.js              dinheiro e datas no padrão brasileiro
    ui.js                  ícones, avisos, janelas, máscara de valor
    preferencias.js        tema escuro e letras maiores
  components/              peças usadas em várias telas (layout, gráficos, backup…)
  pages/                   uma tela por arquivo (acesso, início, extrato, novo…)
tests/                     testes das regras (npm test)
supabase/schema.sql        tabela, regras de segurança e histórico do banco na nuvem
```

### Tabelas (cifradas juntas numa única caixa "dados" por usuário, na nuvem e no aparelho)

| Tabela | O que guarda | Na planilha |
|---|---|---|
| `lancamentos` | entradas e saídas do caixa, contas a pagar, pagamentos de fatura | colunas A:K |
| `compras_cartao` + `parcelas` | compras no crédito e cada parcela na fatura certa | colunas Q:AP |
| `contas` | Espécie, MMP, Nubank… com saldo inicial | bloco de saldos (M:N) |
| `categorias` | categorias, grupo e se aparecem no gráfico do Início | lista de categorias |
| `pessoas` | funcionários, prestadores, família | coluna PESSOA |

> As telas continuam usando as consultas de `consulta-local.js` (`from('lancamentos').select('*').eq(...)`) sobre os dados na memória. Só a camada que guarda (`local-db.js` + `nuvem.js`) mudou para levar tudo, cifrado, ao Supabase.

## Acessibilidade

- Todos os campos têm rótulo, dica e mensagem de erro lidas por leitores de tela.
- Dá para usar tudo pelo teclado. As janelas fecham com `Esc` e há o link "Pular para o conteúdo".
- Os botões têm pelo menos 44px de altura, bons para tocar no celular.
- O status nunca é indicado só pela cor: sempre vem com texto ("Pago", "Atrasado").
- Opções de **letras maiores** e **modo escuro** em Ajustes, e o sistema respeita a configuração de "reduzir movimento" do aparelho.
- O botão **?** explica cada tela, há uma apresentação no primeiro acesso e o botão **Desfazer** nas ações.
