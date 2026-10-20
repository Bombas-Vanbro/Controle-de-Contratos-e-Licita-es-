/* Licitações abertas nos portais próprios das companhias de saneamento.
   Parte delas não vai para o PNCP (estatais da Lei 13.303), por isso a rotina diária
   lê os portais direto. Os editais que também estão no PNCP são unificados pelo
   CNPJ + número (motor.mesclar).

   - Sanepar (PR): página "Próximas Aberturas" de Bens e Serviços
   - Casan (SC):   consulta de licitações em andamento
   A Sanesul (MS) fica de fora: o site bloqueia acessos automáticos (Cloudflare). */
(function (raiz) {
  const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const texto = s => String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/[​﻿]/g, '')
    .replace(/\s+/g, ' ').trim();

  // "21/10/2026 às 09:00" ou "02/10/2026 09:30:00" -> "2026-10-21T09:00"
  function dataHora(s) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})(?:\D+(\d{2}):(\d{2}))?/.exec(s || '');
    if (!m) return '';
    return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '23'}:${m[5] || '59'}`;
  }

  function base(fonte, id, campos) {
    return {
      id: `${fonte.toUpperCase()}-${id}`, fonte, municipio: '', situacao: '', valor: null,
      publicacao: '', link_origem: '', palavras: [], no_objeto: false, excluida: false, excluida_por: null,
      ...campos
    };
  }

  /* ---------- Sanepar ---------- */
  const SANEPAR = 'https://licitacoes.sanepar.com.br/';
  function lerSanepar(html) {
    const itens = [];
    const re = /<a href="(SLI11100\.aspx\?numpro=(\d+)[^"]*)">([^<]+)<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
    for (const m of html.matchAll(re)) {
      const [, href, numpro, processo, objeto, publicacao, abertura] = m;
      const p = /^(\D*)-?(\d+)\/(\d{2})$/.exec(texto(processo).replace(/\s/g, ''));
      const pub = dataHora(texto(publicacao));
      itens.push(base('Sanepar', numpro, {
        orgao: 'SANEPAR - Companhia de Saneamento do Paraná',
        cnpj: '76484013000145',
        uf: 'PR',
        titulo: texto(processo),
        numero: numpro,
        ano: p ? '20' + p[3] : '',
        objeto: texto(objeto),
        modalidade: /^PE/i.test(processo) ? 'Pregão Eletrônico' : texto(processo).split('-')[0],
        encerramento: dataHora(texto(abertura)),
        publicacao: pub ? pub.replace('T23:59', 'T00:00') : '',
        plataforma: 'Portal Sanepar',
        link: SANEPAR + texto(href)
      }));
    }
    return itens;
  }

  /* ---------- Casan ---------- */
  const CASAN = 'https://www.casan.com.br/';
  function lerCasan(html) {
    const itens = [];
    for (const bloco of html.split(/<table class="table table-bordered table-condensed">/).slice(1)) {
      const campos = {};
      for (const tr of bloco.split(/<tr[\s>]/).slice(1)) {
        const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => texto(c[1]));
        if (tds.length >= 2 && /:$/.test(tds[0])) campos[tds[0].slice(0, -1)] = tds[1];
      }
      const id = (/editais-arquivos\/licitacao_id\/(\d+)/.exec(bloco) || [])[1];
      if (!id || !campos.Edital) continue;
      const edital = campos.Edital;
      const ano = (/(\d{4})\s*$/.exec(edital) || [])[1] || '';
      const quando = campos['Abertura das propostas'] || campos['Disputa de preços'] || campos['Entrega dos Envelopes'] || '';
      itens.push(base('Casan', id, {
        orgao: 'CASAN - Companhia Catarinense de Águas e Saneamento',
        cnpj: '82508433000117',
        uf: 'SC',
        titulo: edital,
        numero: edital,
        ano,
        objeto: (campos.Objeto || '').slice(0, 700),
        modalidade: campos.Modalidade || '',
        situacao: campos.Status && campos.Status !== 'Publicado' ? campos.Status : '',
        encerramento: dataHora(quando),
        plataforma: 'Portal Casan',
        link: `${CASAN}licitacoes/editais-arquivos/licitacao_id/${id}`
      }));
    }
    return itens;
  }

  /* Lê as duas fontes. Devolve { itens, falhas, erros }; uma fonte que falha não derruba a outra. */
  async function buscar() {
    const fontes = [
      ['Sanepar', SANEPAR + 'SLI11000.aspx', lerSanepar],
      ['Casan', CASAN + 'licitacoes/editais-visualiza?licitacao_modalidade_id=&licitacao_ano=&numero_edital=&licitacao_objeto=', lerCasan]
    ];
    const itens = [], falhas = [], erros = {};
    for (const [nome, url, ler] of fontes) {
      try {
        let html;
        for (let t = 1; ; t++) {
          try {
            const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            html = await r.text();
            break;
          } catch (e) { if (t >= 3) throw e; await new Promise(ok => setTimeout(ok, 5000 * t)); }
        }
        const lidos = ler(html);
        if (!lidos.length) throw new Error('nenhuma licitação encontrada na página (o site mudou?)');
        itens.push(...lidos);
      } catch (e) {
        falhas.push(nome);
        erros[nome] = e.message + (e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : '');
      }
    }
    return { itens, falhas, erros };
  }

  const api = { buscar, lerSanepar, lerCasan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Saneamento = api;
})(typeof window !== 'undefined' ? window : globalThis);
