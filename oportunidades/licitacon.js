/* Leitura dos editais abertos no LicitaCon Cidadão (TCE-RS), página "Novas Licitações no RS".
   https://portal.tce.rs.gov.br/aplicprod/f?p=50500:3

   O portal não tem API e não aceita chamadas de outros sites (CORS), por isso só a rotina
   diária (Node, GitHub Actions) consulta o LicitaCon. O relatório interativo do portal
   é pedido com todas as linhas de uma vez, já com os links públicos de cada edital. */
(function (raiz) {
  const BASE = 'https://portal.tce.rs.gov.br/aplicprod/';
  const PAGINA = BASE + 'f?p=50500:3:::NO:::';

  const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decodificar = s => String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ').trim();

  const tituloCaso = s => s.toLowerCase().replace(/(^|\s)(\S)/g, (m, e, l) => e + l.toUpperCase())
    .replace(/\s(De|Da|Do|Das|Dos|E)\s/g, m => m.toLowerCase());

  // "PM DE PELOTAS" -> "Pelotas"; órgãos estaduais e autarquias ficam sem município
  function municipioDoOrgao(orgao) {
    const m = /^(?:PM|CM|PREFEITURA MUNICIPAL|C[AÂ]MARA MUNICIPAL) DE (.+)$/i.exec(orgao);
    return m ? tituloCaso(m[1]) : '';
  }

  // "75.200,00" -> 75200
  function valor(s) {
    const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
    return isFinite(n) && n > 0 ? n : null;
  }

  /* Converte o HTML do relatório em registros no mesmo formato do motor (motor.js). */
  function lerRelatorio(html) {
    const itens = [];
    let grupo = { esfera: '', orgao: '' };
    for (const pedaco of html.split(/<tr[\s>]/).slice(1)) {
      if (pedaco.includes('a-IRR-header--group')) {
        const txt = decodificar(pedaco.slice(pedaco.indexOf('>') + 1));
        const m = /Esfera\s*:\s*(.*?),\s*[ÓO]rg[ãa]o\s*:\s*(.*?),\s*Central de Compras\s*:/i.exec(txt);
        if (m) grupo = { esfera: m[1].trim(), orgao: m[2].trim() };
        continue;
      }
      if (!pedaco.includes('headers="LINK')) continue;
      const celulas = [...pedaco.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]);
      if (celulas.length < 7) continue;
      const href = decodificar((/href="([^"]+)"/.exec(celulas[0]) || [])[1]);
      const idLic = (/P10_ID_LICITACAO,P10_PAG_RETORNO:(\d+)/.exec(href) || [])[1];
      if (!idLic) continue;
      const [modalidade, nr, ano, objeto, vlr, abertura] = celulas.slice(1, 7).map(decodificar);
      const d = /(\d{2})\/(\d{2})\/(\d{4})/.exec(abertura);
      itens.push({
        id: 'LICITACON-' + idLic,
        fonte: 'LicitaCon',
        orgao: grupo.orgao,
        municipio: municipioDoOrgao(grupo.orgao),
        uf: 'RS',
        titulo: `Nº ${nr}/${ano}`,
        numero: nr,
        objeto: objeto.length > 700 ? objeto.slice(0, 700) + '…' : objeto,
        modalidade,
        situacao: '',
        valor: valor(vlr),
        // O LicitaCon só informa a data: considera o edital aberto até o fim do dia
        encerramento: d ? `${d[3]}-${d[2]}-${d[1]}T23:59:00` : '',
        so_data: true,
        publicacao: '',
        plataforma: 'LicitaCon (TCE-RS)',
        ano,
        link: BASE + href,
        link_origem: '',
        palavras: [],
        no_objeto: false,
        excluida: false,
        excluida_por: null
      });
    }
    return itens;
  }

  /* Abre uma sessão no portal e pede o relatório completo. Só funciona no Node. */
  async function buscar() {
    const cookies = new Map();
    async function pedir(url, opcoes = {}) {
      const r = await fetch(url, {
        ...opcoes,
        headers: { ...(opcoes.headers || {}), Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
      });
      for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
        const [par] = c.split(';'); const i = par.indexOf('=');
        cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
      }
      if (!r.ok) throw new Error('LicitaCon respondeu HTTP ' + r.status);
      return r.text();
    }

    // A primeira visita só cria a sessão; o relatório vem na segunda
    let html = await pedir(PAGINA);
    if (!html.includes('ajaxIdentifier')) html = await pedir(PAGINA);
    const campo = id => {
      const tag = (new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html) || [''])[0];
      return (/value="([^"]*)"/.exec(tag) || [])[1] || '';
    };
    const instancia = campo('pInstance'), sal = campo('pSalt');
    const planilha = campo('R\\d+_worksheet_id'), relatorio = campo('R\\d+_report_id');
    const ajax = (/"ajaxIdentifier":"([^"]+)"/.exec(html) || [])[1];
    if (!instancia || !ajax || !planilha) throw new Error('Página do LicitaCon mudou: relatório não encontrado.');

    const corpo = new URLSearchParams({
      p_flow_id: '50500', p_flow_step_id: '3', p_instance: instancia, p_debug: '',
      p_request: 'PLUGIN=' + ajax,
      p_widget_name: 'worksheet', p_widget_mod: 'ACTION', p_widget_action: 'PAGE',
      p_widget_action_mod: 'pgR_min_row=1max_rows=10000rows_fetched=10000',
      p_widget_num_return: '10000',
      x01: planilha, x02: relatorio,
      p_json: JSON.stringify({ pageItems: null, salt: sal })
    });
    const tabela = await pedir(BASE + 'wwv_flow.ajax', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: corpo.toString()
    });
    const itens = lerRelatorio(tabela);
    if (!itens.length) throw new Error('LicitaCon não devolveu nenhum edital.');
    return itens;
  }

  const api = { buscar, lerRelatorio };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.LicitaCon = api;
})(typeof window !== 'undefined' ? window : globalThis);
