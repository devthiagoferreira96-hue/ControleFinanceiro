// Guarda dados no aparelho usando o IndexedDB do navegador (aguenta muito mais que o localStorage
// e continua lá depois de fechar o navegador). É a cópia local: deixa o sistema abrir e
// funcionar sem internet; a cópia principal fica na nuvem (veja local-db.js e nuvem.js).
// Nome próprio para não misturar com a versão antiga (só no aparelho) publicada no mesmo site.
const NOME = 'controle-financeiro-nuvem';
let conexao;

function abrir() {
  conexao ||= new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(NOME, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore('chaves');
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error);
  });
  return conexao;
}

async function transacao(modo, fn) {
  const db = await abrir();
  return new Promise((resolver, rejeitar) => {
    const tx = db.transaction('chaves', modo);
    const pedido = fn(tx.objectStore('chaves'));
    tx.oncomplete = () => resolver(pedido?.result);
    tx.onerror = () => rejeitar(tx.error);
  });
}

export const ler = (chave) => transacao('readonly', (s) => s.get(chave));
export const gravar = (chave, valor) => transacao('readwrite', (s) => s.put(valor, chave));
export const apagar = (chave) => transacao('readwrite', (s) => s.delete(chave));

/** Grava várias chaves de uma vez: ou grava todas, ou nenhuma (se o aparelho desligar no meio) */
export async function gravarJuntos(pares) {
  const db = await abrir();
  return new Promise((resolver, rejeitar) => {
    const tx = db.transaction('chaves', 'readwrite');
    const loja = tx.objectStore('chaves');
    for (const [chave, valor] of Object.entries(pares)) loja.put(valor, chave);
    tx.oncomplete = () => resolver();
    tx.onerror = () => rejeitar(tx.error);
    tx.onabort = () => rejeitar(tx.error);
  });
}
