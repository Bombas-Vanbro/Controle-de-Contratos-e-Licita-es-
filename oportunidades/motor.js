/* Motor de busca de licitações abertas no PNCP (Portal Nacional de Contratações Públicas).
   Usado pela aba "Oportunidades" (navegador) e pela rotina diária do GitHub Actions (Node).

   Pela Lei 14.133/2021 todo edital é publicado no PNCP, inclusive os do Compras.gov.br e
   das plataformas privadas (BLL, Licitações-e, BNC, BBMNET, Licitanet, Portal de Compras
   Públicas...), por isso uma única consulta cobre todas essas fontes. */
(function (raiz) {
  const API = 'https://pncp.gov.br/api/search/';
  const POR_PAGINA = 500;

  const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Casa a palavra inteira, aceitando plural simples (bomba/bombas, motor/motores)
  function padrao(palavra) {
    const p = normalizar(palavra).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp('\\b' + p + '(s|es)?\\b');
  }

  const esperar = ms => new Promise(r => setTimeout(r, ms));

  async function consultar(url) {
    // O PNCP derruba conexões com alguma frequência: tenta de novo com espera crescente
    for (let t = 1; ; t++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) {
        if (t >= 6) throw e;
        await esperar(4000 * t);
      }
    }
  }

  function registro(it) {
    const objeto = [it.description, it.informacao_complementar].filter(Boolean).join(' | ');
    return {
      id: it.numero_controle_pncp,
      fonte: 'PNCP',
      orgao: it.orgao_nome,
      municipio: it.municipio_nome,
      uf: it.uf,
      titulo: it.title,
      objeto: objeto.length > 700 ? objeto.slice(0, 700) + '…' : objeto,
      modalidade: it.modalidade_licitacao_nome,
      situacao: it.situacao_nome,
      valor: it.valor_total_estimado,
      encerramento: it.data_fim_vigencia,
      publicacao: (it.data_publicacao_pncp || '').slice(0, 19),
      plataforma: it.usuario_nome,
      ano: it.ano,
      link: 'https://pncp.gov.br/app/editais' + String(it.item_url || '').replace(/^\/compras/, ''),
      link_origem: it.link_sistema_origem || '',
      palavras: [],
      no_objeto: false,
      excluida: false,
      excluida_por: null
    };
  }

  /* Busca todas as palavras-chave e devolve { itens, falhas }.
     opcoes.aoProgredir(feitas, total, palavra) é chamado a cada palavra concluída. */
  async function buscar(config, opcoes = {}) {
    const palavras = (config.palavras_chave || []).map(p => String(p).trim()).filter(Boolean);
    const ufs = (config.ufs || []).map(u => String(u).toUpperCase().trim()).filter(Boolean);
    const maxRes = Number(config.max_resultados_por_palavra) || 3000;
    const achados = new Map();
    const falhas = [];
    const erros = {};          // palavra -> última mensagem de erro
    const proxima = {};        // palavra -> página em que parou (a repetição continua dali)
    let feitas = 0;

    async function buscarPalavra(palavra) {
      const termo = /\s/.test(palavra) ? `"${palavra}"` : palavra;
      const re = padrao(palavra);
      try {
        for (let pag = proxima[palavra] || 1; pag <= Math.ceil(maxRes / POR_PAGINA); pag++) {
          proxima[palavra] = pag;
          const url = `${API}?q=${encodeURIComponent(termo)}&tipos_documento=edital&ordenacao=-data` +
                      `&pagina=${pag}&tam_pagina=${POR_PAGINA}&status=recebendo_proposta`;
          const itens = (await consultar(url)).items || [];
          for (const it of itens) {
            if (it.cancelado || !it.numero_controle_pncp) continue;
            if (ufs.length && !ufs.includes(it.uf)) continue;
            let r = achados.get(it.numero_controle_pncp);
            if (!r) { r = registro(it); achados.set(r.id, r); }
            if (!r.palavras.includes(palavra)) r.palavras.push(palavra);
            if (re.test(normalizar(r.objeto))) r.no_objeto = true;
          }
          if (itens.length < POR_PAGINA) break;
        }
      } catch (e) {
        falhas.push(palavra);
        erros[palavra] = `página ${proxima[palavra]}: ${e.message}${e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''}`;
      }
      feitas++;
      if (opcoes.aoProgredir) opcoes.aoProgredir(feitas, palavras.length, palavra);
    }

    // Três palavras por vez para não sobrecarregar o PNCP
    const fila = [...palavras];
    await Promise.all([1, 2, 3].map(async () => { while (fila.length) await buscarPalavra(fila.shift()); }));

    // Segunda chance, uma palavra por vez, para as que falharam
    const repetir = falhas.splice(0);
    for (const palavra of repetir) {
      await esperar(10000);
      feitas--;
      await buscarPalavra(palavra);
    }

    const itens = [...achados.values()];
    aplicarExclusoes(itens, config);
    for (const p of Object.keys(erros)) if (!falhas.includes(p)) delete erros[p];
    return { itens, falhas, erros };
  }

  /* Se o objeto cita uma palavra protegida (ex.: bomba), o edital nunca é excluído.
     Se a palavra protegida aparece só nos itens, o edital vai para "citadas só nos itens"
     em vez de sumir; nos demais casos ele fica oculto (visível com "Mostrar excluídas"). */
  function aplicarExclusoes(itens, config) {
    const protegidas = (config.nunca_excluir_se_objeto_contem || []).filter(Boolean);
    const reProt = protegidas.map(padrao);
    const protNorm = protegidas.map(normalizar);
    const excluir = (config.excluir_se_objeto_contem || []).filter(Boolean).map(t => ({ termo: t, re: padrao(t) }));
    for (const r of itens) {
      const norm = normalizar(r.objeto);
      if (reProt.some(re => re.test(norm))) continue;
      const ex = excluir.find(x => x.re.test(norm));
      if (!ex) continue;
      r.excluida_por = ex.termo;
      if (r.palavras.some(p => protNorm.includes(normalizar(p)))) r.no_objeto = false;
      else r.excluida = true;
    }
  }

  /* Marca as palavras-chave citadas no objeto de editais vindos de outras fontes
     (ex.: LicitaCon) e descarta os que não citam nenhuma. */
  function filtrarPorPalavras(itens, config) {
    const palavras = (config.palavras_chave || []).map(p => String(p).trim()).filter(Boolean);
    const ufs = (config.ufs || []).map(u => String(u).toUpperCase().trim()).filter(Boolean);
    const res = palavras.map(p => ({ p, re: padrao(p) }));
    const saida = [];
    for (const r of itens) {
      if (ufs.length && !ufs.includes(r.uf)) continue;
      const norm = normalizar(r.objeto);
      r.palavras = res.filter(x => x.re.test(norm)).map(x => x.p);
      if (!r.palavras.length) continue;
      r.no_objeto = true;
      saida.push(r);
    }
    aplicarExclusoes(saida, config);
    return saida;
  }

  /* Junta editais do PNCP com os de outra fonte. Um edital que já está no PNCP
     (mesmo município, número e ano) não se repete: o PNCP ganha o link da outra fonte. */
  function mesclar(pncp, outros) {
    const numAno = r => {
      const m = /(\d+)\s*\/\s*(\d{4})/.exec(r.numero ? `${r.numero}/${r.ano}` : r.titulo || '');
      return m ? `${Number(m[1])}/${m[2]}` : '';
    };
    const chave = r => r.municipio && numAno(r) ? `${r.uf}|${normalizar(r.municipio)}|${numAno(r)}` : '';
    const porChave = new Map();
    for (const r of pncp) { const k = chave(r); if (k) porChave.set(k, r); }
    const extras = [];
    for (const r of outros) {
      const igual = porChave.get(chave(r));
      if (igual) igual.link_licitacon = r.link;
      else extras.push(r);
    }
    return [...pncp, ...extras];
  }

  const api = { buscar, aplicarExclusoes, filtrarPorPalavras, mesclar, normalizar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MotorPNCP = api;
})(typeof window !== 'undefined' ? window : globalThis);
