# Controle de Contratos e Licitações

Ferramenta web para acompanhar contratos/ARPs com órgãos públicos (valores, faturamento, vigência) e buscar novas oportunidades de licitação. Substitui a planilha Excel "Controle de Contratos Ativos" (.xlsm).

- **Repositório:** https://github.com/Jonatha-Vanbro/Controle-de-Contratos-e-Licita-es-
- **Publicado em:** https://jonatha-vanbro.github.io/Controle-de-Contratos-e-Licita-es-/ (também no menu da Central Integrada)
- **Stack:** `index.html` estático (frontend) + Google Apps Script com Planilha Google como banco. Comunicação por **JSONP (GET)**, igual aos outros apps. `API_URL` no `index.html` aponta para a implantação `/exec`.
- O cabeçalho deste app é o **padrão** usado nas demais ferramentas.

## Backend (`apps-script/Code.gs`)
- Cópia versionada do script que fica na planilha. Ao alterar: colar na planilha e publicar **nova versão da implantação existente** (Gerenciar implantações → editar) para manter a mesma URL.
- Abas `Contratos` e `Historico`. `setup()` cria/atualiza cabeçalhos (seguro rodar de novo).
- Status de vigência: `<0` VENCIDO · `≤30` URGENTE: RENOVAR · `≤90` ATENÇÃO: VERIFICAR · senão OK - EM DIA.
- Situações: Ativo, Em Renovação, Encerrado, Suspenso, Aguardando Disputa, Perdemos a Disputa. Ao salvar como *Encerrado* ou *Perdemos a Disputa*, o registro vai para `Historico`.
- Colunas novas entram sempre **no final** (ex.: Plataforma, Propostas até) para não deslocar dados.

## Oportunidades (`oportunidades/`)
- `buscar.js` (Node 20) roda no GitHub Actions (`.github/workflows/oportunidades.yml`), seg–sex 07:00 de Brasília, e a cada push em config/motor. Grava `resultado.json` e `historico.json` (commit do bot); a aba *Oportunidades* do app lê `resultado.json`.
- `motor.js`: consulta ao PNCP + filtros. `saneamento.js`: portais Sanepar e Casan (Sanesul bloqueia robôs).
- `config.json`: palavras-chave, exclusões (`excluir_sempre`, `excluir_se_objeto_contem`) e proteções (`nunca_excluir_se_objeto_contem`).
- `coletar-licitacon.ps1`: roda **neste PC (Windows)** porque o TCE-RS bloqueia acessos de fora do Brasil; coleta o LicitaCon e envia `licitacon-bruto.json` ao GitHub usando um clone separado em `%LOCALAPPDATA%\ColetaLicitaCon`. Agendado por `instalar-coleta-licitacon.ps1`. Só um PC precisa ter esse agendamento.
- Antes de editar, `git pull`: o bot faz commits diários e pode haver conflito.
