/**
 * CONTROLE DE CONTRATOS E LICITAÇÕES — Backend (Google Apps Script)
 * ------------------------------------------------------------------
 * Banco de dados: esta Planilha Google (abas "Contratos" e "Historico").
 * Comunicação com o front-end via JSONP (GET), igual aos outros apps.
 *
 * Cópia versionada do Code.gs que fica na planilha (Extensões > Apps Script).
 * Ao alterar aqui, cole na planilha e publique uma NOVA VERSÃO da implantação
 * existente (Implantar > Gerenciar implantações > editar), para manter a mesma URL.
 *
 * COMO IMPLANTAR (do zero)
 * 1. Crie uma Planilha Google nova e abra Extensões > Apps Script.
 * 2. Cole este arquivo como Code.gs e salve.
 * 3. Execute a função setup() uma vez (cria as abas e importa o contrato
 *    de Mondaí que estava na planilha original).
 * 4. Implantar > Nova implantação > App da Web
 *    - Executar como: Eu
 *    - Quem pode acessar: Qualquer pessoa
 * 5. Copie a URL /exec e cole em API_URL no index.html.
 *
 * O que foi mantido da planilha original:
 * - Todas as colunas (Saldo, Dias p/ Vencer e Status Vigência são calculados).
 * - Regra de status: <0 VENCIDO | <=30 URGENTE: RENOVAR | <=90 ATENÇÃO: VERIFICAR | senão OK - EM DIA.
 * - Situações: Ativo, Em Renovação, Encerrado, Suspenso, Aguardando Disputa, Perdemos a Disputa.
 * - A macro "Mover para Histórico": ao salvar como Encerrado ou Perdemos a Disputa,
 *   o registro sai da aba Contratos e vai para a aba Historico.
 * - As abas por ano (2026…2030) viraram a coluna "Ano".
 *
 * Abas Itens e Fornecimentos: itens da ata de cada contrato e as quantidades
 * fornecidas; o script recusa fornecimento acima do saldo da ata. São criadas pelo
 * setup() (execute de novo depois de colar esta versão).
 *
 * Colunas da disputa (Plataforma e Propostas até) ficam no FINAL das abas, depois
 * das colunas originais, para não deslocar os dados já gravados. Em planilhas que já
 * existiam, execute setup() uma vez para criar os cabeçalhos novos (é seguro: não
 * apaga nem duplica dados).
 */

const ABA_CONTRATOS = 'Contratos';
const ABA_HISTORICO = 'Historico';

const COLUNAS_BASE = [
  'ID', 'Ano', 'Órgão / Cliente', 'Nº Licitação / Edital', 'Nº Contrato / ARP',
  'Pedidos Internos', 'Valor Total (R$)', 'Valor Faturado (R$)', 'Data Início',
  'Data Término', 'Situação', 'Link para Arquivos', 'Atualizado em'
];
const COLUNAS_DISPUTA = ['Plataforma', 'Propostas até'];
const COLUNAS = COLUNAS_BASE.concat(COLUNAS_DISPUTA);
const COLUNAS_HIST = COLUNAS_BASE.concat(['Encerrado em'], COLUNAS_DISPUTA);

const CHAVES_BASE = [
  'id', 'ano', 'orgao', 'edital', 'contrato', 'pedidos', 'valorTotal',
  'valorFaturado', 'dataInicio', 'dataTermino', 'situacao', 'link', 'atualizadoEm'
];
const CHAVES_DISPUTA = ['plataforma', 'propostasAte'];
const CHAVES = CHAVES_BASE.concat(CHAVES_DISPUTA);
const CHAVES_HIST = CHAVES_BASE.concat(['encerradoEm'], CHAVES_DISPUTA);
// Itens da ata de cada contrato e as quantidades já fornecidas de cada item.
// Um fornecimento com vários itens grava uma linha por item, todas com o mesmo ID.
const ABA_ITENS = 'Itens';
const COLUNAS_ITENS = ['ID', 'Contrato ID', 'Nº Item', 'Código Vanbro', 'Descrição', 'Unidade', 'Qtd. Ata', 'Atualizado em'];
const CHAVES_ITENS = ['id', 'contratoId', 'numero', 'codigo', 'descricao', 'unidade', 'quantidade', 'atualizadoEm'];
const ABA_FORNECIMENTOS = 'Fornecimentos';
const COLUNAS_FORN = ['ID Lançamento', 'Contrato ID', 'Item ID', 'Data', 'Pedido Interno', 'Quantidade', 'Observação', 'Registrado em'];
const CHAVES_FORN = ['id', 'contratoId', 'itemId', 'data', 'pedido', 'quantidade', 'obs', 'registradoEm'];

// Campos com data e hora (os demais campos de data guardam só o dia)
const CHAVES_DATA_HORA = ['atualizadoEm', 'encerradoEm', 'propostasAte', 'registradoEm'];

const SITUACOES = ['Ativo', 'Em Renovação', 'Encerrado', 'Suspenso', 'Aguardando Disputa', 'Perdemos a Disputa'];
// Situações que, ao salvar, movem o registro para a aba Historico
const SITUACOES_HISTORICO = ['Encerrado', 'Perdemos a Disputa'];

/* ================= SETUP (executar uma vez) ================= */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const c = prepararAba_(ss, ABA_CONTRATOS, COLUNAS);
  const h = prepararAba_(ss, ABA_HISTORICO, COLUNAS_HIST);

  // Importa o registro que existia na planilha original (aba 2026)
  if (c.getLastRow() < 2) {
    const agora = new Date();
    c.appendRow([
      novoId_(), 2026, 'Pref. Mun. de Mondaí - SC', '27/2026', '61/2026',
      '319796; 320796; 321064', 241600, 24000,
      new Date(2026, 5, 25), new Date(2027, 5, 25), 'Ativo',
      'S:\\Administrativo\\Vendas\\Licitacoes - Cias de Agua\\Prefeituras\\PM Mondaí - SC\\PE N° 27_2026\\ATA - Mondaí - SC_assinado.pdf',
      agora, '', ''
    ]);
  }
  formatarAba_(c, CHAVES);
  formatarAba_(h, CHAVES_HIST);

  const it = prepararAba_(ss, ABA_ITENS, COLUNAS_ITENS);
  const fo = prepararAba_(ss, ABA_FORNECIMENTOS, COLUNAS_FORN);
  const linhasIt = Math.max(it.getMaxRows() - 1, 1), linhasFo = Math.max(fo.getMaxRows() - 1, 1);
  it.getRange(2, CHAVES_ITENS.indexOf('atualizadoEm') + 1, linhasIt, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  fo.getRange(2, CHAVES_FORN.indexOf('data') + 1, linhasFo, 1).setNumberFormat('dd/MM/yyyy');
  fo.getRange(2, CHAVES_FORN.indexOf('registradoEm') + 1, linhasFo, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  // Nº do item, código e pedido como texto (preserva zeros à esquerda)
  it.getRange(2, CHAVES_ITENS.indexOf('numero') + 1, linhasIt, 2).setNumberFormat('@');
  fo.getRange(2, CHAVES_FORN.indexOf('pedido') + 1, linhasFo, 1).setNumberFormat('@');
}

function prepararAba_(ss, nome, colunas) {
  let sh = ss.getSheetByName(nome);
  if (!sh) sh = ss.insertSheet(nome);
  if (sh.getMaxColumns() < colunas.length) sh.insertColumnsAfter(sh.getMaxColumns(), colunas.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, colunas.length).setValues([colunas])
    .setFontWeight('bold').setBackground('#1e2a4a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

function formatarAba_(sh, chaves) {
  const linhas = Math.max(sh.getMaxRows() - 1, 1);
  const col = k => chaves.indexOf(k) + 1;
  sh.getRange(2, col('valorTotal'), linhas, 2).setNumberFormat('"R$" #,##0.00');
  sh.getRange(2, col('dataInicio'), linhas, 2).setNumberFormat('dd/MM/yyyy');
  CHAVES_DATA_HORA.forEach(function (k) {
    if (col(k) > 0) sh.getRange(2, col(k), linhas, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  });
  sh.getRange(2, col('situacao'), linhas, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SITUACOES, true).build()
  );
}

/* ================= ROTEADOR ================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  let resultado;
  try {
    switch (p.action) {
      case 'salvar':   resultado = salvar_(JSON.parse(p.payload || '{}')); break;
      case 'faturar':  resultado = faturar_(p.id, Number(p.valor)); break;
      case 'excluir':  resultado = excluir_(p.id, p.origem); break;
      case 'reativar': resultado = reativar_(p.id); break;
      case 'salvarItens':          resultado = salvarItens_(JSON.parse(p.payload || '{}')); break;
      case 'excluirItem':          resultado = excluirItem_(p.id); break;
      case 'salvarFornecimento':   resultado = salvarFornecimento_(JSON.parse(p.payload || '{}')); break;
      case 'excluirFornecimento':  resultado = excluirFornecimento_(p.id); break;
      case 'listar':
      default:         resultado = listar_();
    }
    resultado.ok = true;
  } catch (err) {
    resultado = { ok: false, erro: String(err.message || err) };
  }
  return responder_(resultado, p.callback);
}

function responder_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================= AÇÕES ================= */

function listar_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    contratos: lerAba_(ABA_CONTRATOS, CHAVES),
    historico: lerAba_(ABA_HISTORICO, CHAVES_HIST),
    // Abas criadas pelo setup(); antes disso a lista vem vazia em vez de dar erro
    itens: ss.getSheetByName(ABA_ITENS) ? lerAba_(ABA_ITENS, CHAVES_ITENS) : [],
    fornecimentos: ss.getSheetByName(ABA_FORNECIMENTOS) ? lerAba_(ABA_FORNECIMENTOS, CHAVES_FORN) : []
  };
}

/* ---------- Itens da ata ---------- */

// Cria ou atualiza itens de um contrato. d = { contratoId, itens: [{ id?, numero, codigo, descricao, unidade, quantidade }] }
function salvarItens_(d) {
  if (!d.contratoId) throw new Error('Contrato não informado.');
  const itens = Array.isArray(d.itens) ? d.itens : [];
  if (!itens.length) throw new Error('Nenhum item informado.');
  return comLock_(function () {
    if (acharLinha_(aba_(ABA_CONTRATOS), d.contratoId) < 0) throw new Error('Contrato não encontrado entre os ativos.');
    const sh = aba_(ABA_ITENS);
    const fornecido = fornecidoPorItem_();
    const ids = [];
    itens.forEach(function (it, i) {
      const quantidade = numero_(it.quantidade);
      const descricao = String(it.descricao || '').trim();
      const ref = 'Item ' + (it.numero || i + 1) + ': ';
      if (!descricao) throw new Error(ref + 'informe a descrição.');
      if (!(quantidade > 0)) throw new Error(ref + 'informe a quantidade da ata (maior que zero).');
      if (it.id && quantidade < (fornecido[it.id] || 0)) {
        throw new Error(ref + 'a quantidade da ata não pode ficar abaixo do que já foi fornecido (' + fornecido[it.id] + ').');
      }
      const registro = {
        id: it.id || novoIdCom_('IT'), contratoId: d.contratoId,
        numero: String(it.numero || '').trim(), codigo: String(it.codigo || '').trim(),
        descricao: descricao, unidade: String(it.unidade || '').trim().toUpperCase(),
        quantidade: quantidade, atualizadoEm: new Date()
      };
      const linha = paraLinha_(registro, CHAVES_ITENS);
      const idx = acharLinha_(sh, registro.id);
      if (idx > 0) sh.getRange(idx, 1, 1, linha.length).setValues([linha]);
      else sh.appendRow(linha);
      ids.push(registro.id);
    });
    return { ids: ids };
  });
}

function excluirItem_(id) {
  if (!id) throw new Error('Item não informado.');
  return comLock_(function () {
    if (fornecidoPorItem_()[id]) throw new Error('Este item já tem fornecimentos lançados. Exclua os lançamentos antes.');
    const sh = aba_(ABA_ITENS);
    const idx = acharLinha_(sh, id);
    if (idx < 0) throw new Error('Item não encontrado.');
    sh.deleteRow(idx);
    return { id: id };
  });
}

/* ---------- Fornecimentos (vendas por item) ---------- */

// d = { contratoId, data, pedido, obs, itens: [{ itemId, quantidade }] }
// Recusa quantidade acima do saldo da ata (Qtd. Ata − já fornecido) de cada item.
function salvarFornecimento_(d) {
  if (!d.contratoId) throw new Error('Contrato não informado.');
  const linhas = (Array.isArray(d.itens) ? d.itens : []).filter(function (x) { return numero_(x.quantidade) > 0; });
  if (!linhas.length) throw new Error('Informe a quantidade de pelo menos um item.');
  const data = paraData_(d.data);
  if (!data) throw new Error('Informe a data do fornecimento.');
  return comLock_(function () {
    const itens = {};
    lerAba_(ABA_ITENS, CHAVES_ITENS).forEach(function (it) { if (it.contratoId === d.contratoId) itens[it.id] = it; });
    const fornecido = fornecidoPorItem_();
    linhas.forEach(function (x) {
      const it = itens[x.itemId];
      if (!it) throw new Error('Item não pertence a este contrato.');
      const saldo = numero_(it.quantidade) - (fornecido[it.id] || 0);
      if (numero_(x.quantidade) > saldo + 1e-9) {
        throw new Error('Item ' + (it.numero || '') + ' (' + it.descricao + '): quantidade acima do saldo da ata. Saldo disponível: ' + saldo + ' ' + it.unidade + '.');
      }
    });
    const id = novoIdCom_('FN'), agora = new Date();
    const sh = aba_(ABA_FORNECIMENTOS);
    const novas = linhas.map(function (x) {
      return paraLinha_({
        id: id, contratoId: d.contratoId, itemId: x.itemId, data: data,
        pedido: String(d.pedido || '').trim(), quantidade: numero_(x.quantidade),
        obs: String(d.obs || '').trim(), registradoEm: agora
      }, CHAVES_FORN);
    });
    sh.getRange(sh.getLastRow() + 1, 1, novas.length, CHAVES_FORN.length).setValues(novas);
    return { id: id };
  });
}

function excluirFornecimento_(id) {
  if (!id) throw new Error('Lançamento não informado.');
  return comLock_(function () {
    const removidas = excluirLinhasOnde_(aba_(ABA_FORNECIMENTOS), 1, id);
    if (!removidas) throw new Error('Lançamento não encontrado.');
    return { id: id };
  });
}

// itemId -> quantidade total já fornecida
function fornecidoPorItem_() {
  const total = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(ABA_FORNECIMENTOS)) return total;
  lerAba_(ABA_FORNECIMENTOS, CHAVES_FORN).forEach(function (f) {
    total[f.itemId] = (total[f.itemId] || 0) + numero_(f.quantidade);
  });
  return total;
}

function salvar_(d) {
  if (!d.orgao) throw new Error('Informe o Órgão / Cliente.');
  if (d.situacao && SITUACOES.indexOf(d.situacao) < 0) throw new Error('Situação inválida.');

  return comLock_(function () {
    const sh = aba_(ABA_CONTRATOS);
    const registro = {
      id: d.id || novoId_(),
      ano: Number(d.ano) || (d.dataInicio ? Number(String(d.dataInicio).slice(0, 4)) : new Date().getFullYear()),
      orgao: String(d.orgao).trim(),
      edital: d.edital || '',
      contrato: d.contrato || '',
      pedidos: d.pedidos || '',
      valorTotal: Number(d.valorTotal) || 0,
      valorFaturado: Number(d.valorFaturado) || 0,
      dataInicio: paraData_(d.dataInicio),
      dataTermino: paraData_(d.dataTermino),
      situacao: d.situacao || 'Ativo',
      link: d.link || '',
      atualizadoEm: new Date(),
      plataforma: d.plataforma || '',
      propostasAte: paraDataHora_(d.propostasAte)
    };
    const idx = acharLinha_(sh, registro.id);

    // Regra da macro original: Encerrado (e Perdemos a Disputa) vai para o Histórico
    if (SITUACOES_HISTORICO.indexOf(registro.situacao) >= 0) {
      if (idx > 0) sh.deleteRow(idx);
      registro.encerradoEm = new Date();
      aba_(ABA_HISTORICO).appendRow(paraLinha_(registro, CHAVES_HIST));
      return { id: registro.id, movidoParaHistorico: true };
    }

    const linhaNova = paraLinha_(registro, CHAVES);
    if (idx > 0) sh.getRange(idx, 1, 1, linhaNova.length).setValues([linhaNova]);
    else sh.appendRow(linhaNova);
    return { id: registro.id };
  });
}

function faturar_(id, valor) {
  if (!id) throw new Error('ID não informado.');
  if (!(valor > 0)) throw new Error('Informe um valor de faturamento maior que zero.');
  return comLock_(function () {
    const sh = aba_(ABA_CONTRATOS);
    const idx = acharLinha_(sh, id);
    if (idx < 0) throw new Error('Contrato não encontrado.');
    const col = CHAVES.indexOf('valorFaturado') + 1;
    const atual = Number(sh.getRange(idx, col).getValue()) || 0;
    sh.getRange(idx, col).setValue(atual + valor);
    sh.getRange(idx, CHAVES.indexOf('atualizadoEm') + 1).setValue(new Date());
    return { id: id, valorFaturado: atual + valor };
  });
}

function excluir_(id, origem) {
  return comLock_(function () {
    const sh = aba_(origem === 'historico' ? ABA_HISTORICO : ABA_CONTRATOS);
    const idx = acharLinha_(sh, id);
    if (idx < 0) throw new Error('Registro não encontrado.');
    sh.deleteRow(idx);
    // Itens da ata e fornecimentos do contrato saem junto
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    [ABA_FORNECIMENTOS, ABA_ITENS].forEach(function (nome) {
      const aba = ss.getSheetByName(nome);
      if (aba) excluirLinhasOnde_(aba, 2, id);
    });
    return { id: id };
  });
}

function reativar_(id) {
  return comLock_(function () {
    const hist = aba_(ABA_HISTORICO);
    const idx = acharLinha_(hist, id);
    if (idx < 0) throw new Error('Registro não encontrado no histórico.');
    // As abas têm colunas em ordens diferentes: converte por nome do campo
    const valores = hist.getRange(idx, 1, 1, CHAVES_HIST.length).getValues()[0];
    const registro = {};
    CHAVES_HIST.forEach(function (k, i) { registro[k] = valores[i]; });
    registro.situacao = 'Ativo';
    registro.atualizadoEm = new Date();
    aba_(ABA_CONTRATOS).appendRow(paraLinha_(registro, CHAVES));
    hist.deleteRow(idx);
    return { id: id };
  });
}

/* ================= UTILITÁRIOS ================= */

function aba_(nome) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  if (!sh) throw new Error('Aba "' + nome + '" não encontrada. Execute setup().');
  return sh;
}

function paraLinha_(registro, chaves) {
  return chaves.map(function (k) { return registro[k] === undefined || registro[k] === null ? '' : registro[k]; });
}

function lerAba_(nome, chaves) {
  const sh = aba_(nome);
  if (sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, sh.getLastRow() - 1, chaves.length).getValues()
    .filter(function (l) { return l[0] !== '' && l[0] !== null; })
    .map(function (l) {
      const o = {};
      chaves.forEach(function (k, i) {
        let v = l[i];
        if (v instanceof Date) {
          v = Utilities.formatDate(v, tz, CHAVES_DATA_HORA.indexOf(k) >= 0 ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd');
        }
        o[k] = v;
      });
      return o;
    });
}

function acharLinha_(sh, id) {
  if (!id || sh.getLastRow() < 2) return -1;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function paraData_(s) {
  if (!s) return '';
  const p = String(s).slice(0, 10).split('-');
  return p.length === 3 ? new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) : '';
}

// "2026-10-27T09:00" -> data e hora no fuso do script; sem hora, vale o fim do dia
function paraDataHora_(s) {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s));
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    m[4] ? Number(m[4]) : 23, m[5] ? Number(m[5]) : 59);
}

function novoId_() {
  return novoIdCom_('CT');
}

function novoIdCom_(prefixo) {
  return prefixo + '-' + Utilities.getUuid().slice(0, 8).toUpperCase();
}

// Aceita 12, "12", "12,5" e "1.250,5"
function numero_(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').trim();
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s) || 0;
}

// Apaga, de baixo para cima, as linhas cuja coluna `coluna` (1 = A) vale `valor`. Devolve quantas apagou.
function excluirLinhasOnde_(sh, coluna, valor) {
  if (sh.getLastRow() < 2) return 0;
  const vals = sh.getRange(2, coluna, sh.getLastRow() - 1, 1).getValues();
  let n = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(valor)) { sh.deleteRow(i + 2); n++; }
  }
  return n;
}

function comLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
