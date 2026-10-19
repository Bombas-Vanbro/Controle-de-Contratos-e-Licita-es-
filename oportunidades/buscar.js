/* Rotina diária (GitHub Actions): busca as licitações abertas no PNCP e grava
   oportunidades/resultado.json, que a aba "Oportunidades" carrega ao abrir.
   Uso: node oportunidades/buscar.js */
const fs = require('fs');
const path = require('path');
const motor = require('./motor.js');

const pasta = __dirname;
const lerJson = (arq, padrao) => {
  try { return JSON.parse(fs.readFileSync(path.join(pasta, arq), 'utf8')); } catch { return padrao; }
};

(async () => {
  const config = lerJson('config.json', {});
  const historico = lerJson('historico.json', {});   // id -> data em que apareceu pela primeira vez
  const primeira = Object.keys(historico).length === 0;
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  const { itens, falhas } = await motor.buscar(config, {
    aoProgredir: (n, total, palavra) => console.log(`[${n}/${total}] ${palavra}`)
  });

  // Se todas as palavras falharam, mantém o resultado anterior em vez de gravar uma lista vazia
  if (falhas.length && falhas.length === (config.palavras_chave || []).length) {
    console.error('Nenhuma palavra-chave pôde ser consultada: ' + falhas.join(', '));
    process.exit(1);
  }

  for (const r of itens) {
    if (!historico[r.id]) historico[r.id] = hoje;
    r.visto_em = historico[r.id];
  }
  // Esquece editais vistos há mais de 180 dias
  const limite = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
  for (const id of Object.keys(historico)) if (historico[id] < limite) delete historico[id];

  // Uma linha por edital, em ordem fixa: as mudanças diárias ficam pequenas no Git
  itens.sort((a, b) => a.id.localeCompare(b.id));
  const meta = { gerado_em: new Date().toISOString(), palavras: config.palavras_chave, falhas, primeira };
  const linhas = itens.map(r => JSON.stringify(r));
  fs.writeFileSync(path.join(pasta, 'resultado.json'),
    `{"meta":${JSON.stringify(meta)},\n"itens":[\n${linhas.join(',\n')}\n]}\n`);
  const ids = Object.keys(historico).sort();
  fs.writeFileSync(path.join(pasta, 'historico.json'),
    '{\n' + ids.map(id => `${JSON.stringify(id)}:${JSON.stringify(historico[id])}`).join(',\n') + '\n}\n');

  const relevantes = itens.filter(r => r.no_objeto && !r.excluida).length;
  console.log(`${itens.length} editais abertos, ${relevantes} relevantes. Falhas: ${falhas.join(', ') || 'nenhuma'}`);
})().catch(e => { console.error(e); process.exit(1); });
