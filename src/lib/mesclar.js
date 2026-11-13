// =====================================================================
// Junta as mudanças de dois aparelhos que gravaram ao mesmo tempo.
// Compara cada linha (pelo id) com a "base" (como estava antes de os dois mexerem):
//   - só um lado mudou a linha  -> fica a mudança desse lado
//   - os dois mudaram            -> fica a deste aparelho
//   - um lado excluiu e o outro não mexeu -> a linha é excluída
//   - um lado excluiu e o outro alterou   -> a linha alterada continua (nada some sem querer)
//   - linhas novas dos dois lados entram todas
// =====================================================================

/** Texto que representa a linha, sem depender da ordem dos campos */
function assinatura(linha) {
  if (linha === undefined) return undefined;
  return JSON.stringify(Object.keys(linha).sort().map((k) => [k, linha[k]]));
}

const porId = (lista = []) => new Map(lista.map((l) => [l.id, l]));

export function mesclarLista(base = [], daqui = [], deLa = []) {
  const b = porId(base), a = porId(daqui), r = porId(deLa);
  const ids = [...new Set([...deLa.map((l) => l.id), ...daqui.map((l) => l.id)])];
  const resultado = [];
  for (const id of ids) {
    const sb = assinatura(b.get(id)), sa = assinatura(a.get(id)), sr = assinatura(r.get(id));
    let fica;
    if (sa === sb) fica = r.get(id);        // aqui não mexeu: vale a nuvem (inclusive exclusão)
    else if (sr === sb) fica = a.get(id);   // lá não mexeu: vale daqui (inclusive exclusão)
    else fica = a.get(id) ?? r.get(id);     // os dois mexeram: daqui, a não ser que daqui tenha excluído
    if (fica) resultado.push(structuredClone(fica));
  }
  return resultado;
}

export function mesclarTabelas(base, daqui, deLa, tabelas) {
  return Object.fromEntries(tabelas.map((t) => [t, mesclarLista(base?.[t], daqui?.[t], deLa?.[t])]));
}
