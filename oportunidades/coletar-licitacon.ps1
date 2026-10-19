<#
  Coleta os editais abertos do LicitaCon Cidadao (TCE-RS), pagina "Novas Licitacoes no RS",
  e envia a lista para o GitHub (oportunidades/licitacon-bruto.json).

  Roda neste PC porque o TCE-RS bloqueia acessos de fora do Brasil, como os servidores
  do GitHub. A rotina do GitHub le o arquivo enviado, filtra pelas palavras-chave de
  config.json e junta com o PNCP. Agendada por instalar-coleta-licitacon.ps1.

  Uso:  powershell -ExecutionPolicy Bypass -File coletar-licitacon.ps1 [-SemEnviar]
#>
param([switch]$SemEnviar)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Copia do repositorio so da coleta, separada da pasta de trabalho: o envio nunca leva
# junto alteracoes em andamento de quem esta editando o sistema
$pasta   = Join-Path $env:LOCALAPPDATA 'ColetaLicitaCon'
$repo    = Join-Path $pasta 'repo'
$origem  = 'https://github.com/Jonatha-Vanbro/Controle-de-Contratos-e-Licita-es-.git'
New-Item -ItemType Directory -Force $pasta | Out-Null
$arqLog  = Join-Path $pasta 'coleta.log'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Log($msg) {
    $linha = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
    Write-Host $linha
    Add-Content -Path $arqLog -Value $linha -Encoding UTF8
}

$BASE   = 'https://portal.tce.rs.gov.br/aplicprod/'
$PAGINA = $BASE + 'f?p=50500:3:::NO:::'

function Texto([string]$html) {
    $t = [regex]::Replace($html, '<[^>]+>', '')
    $t = [Net.WebUtility]::HtmlDecode($t)
    return ([regex]::Replace($t, '\s+', ' ')).Trim()
}

function MunicipioDoOrgao([string]$orgao) {
    # "PM DE PELOTAS" -> "Pelotas"; orgaos estaduais e autarquias ficam sem municipio
    $m = [regex]::Match($orgao, '^(?:PM|CM|PREFEITURA MUNICIPAL|C\S+MARA MUNICIPAL) DE (.+)$', 'IgnoreCase')
    if (-not $m.Success) { return '' }
    $nome = (Get-Culture).TextInfo.ToTitleCase($m.Groups[1].Value.ToLower())
    return [regex]::Replace($nome, '\s(De|Da|Do|Das|Dos|E)\s', { param($x) $x.Value.ToLower() })
}

function Valor([string]$s) {
    $n = 0.0
    $limpo = $s.Replace('.', '').Replace(',', '.')
    if ([double]::TryParse($limpo, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$n) -and $n -gt 0) { return $n }
    return $null
}

function Coletar {
    $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $html = ''
    # A primeira visita so cria a sessao; o relatorio vem na segunda
    for ($t = 1; $t -le 3 -and $html -notmatch 'ajaxIdentifier'; $t++) {
        $p = Invoke-WebRequest -UseBasicParsing -WebSession $s -TimeoutSec 60 $PAGINA
        $html = [Text.Encoding]::UTF8.GetString($p.RawContentStream.ToArray())
    }
    function Campo($id) {
        $tag = [regex]::Match($html, "<input[^>]*id=""$id""[^>]*>").Value
        return [regex]::Match($tag, 'value="([^"]*)"').Groups[1].Value
    }
    $instancia = Campo 'pInstance'; $sal = Campo 'pSalt'
    $planilha = Campo 'R\d+_worksheet_id'; $relatorio = Campo 'R\d+_report_id'
    $ajax = [regex]::Match($html, '"ajaxIdentifier":"([^"]+)"').Groups[1].Value
    if (-not $instancia -or -not $ajax -or -not $planilha) { throw 'Pagina do LicitaCon mudou: relatorio nao encontrado.' }

    $corpo = 'p_flow_id=50500&p_flow_step_id=3&p_instance=' + $instancia + '&p_debug=' +
             '&p_request=' + [uri]::EscapeDataString("PLUGIN=$ajax") +
             '&p_widget_name=worksheet&p_widget_mod=ACTION&p_widget_action=PAGE' +
             '&p_widget_action_mod=' + [uri]::EscapeDataString('pgR_min_row=1max_rows=10000rows_fetched=10000') +
             '&p_widget_num_return=10000&x01=' + $planilha + '&x02=' + $relatorio +
             '&p_json=' + [uri]::EscapeDataString('{"pageItems":null,"salt":"' + $sal + '"}')
    $r = Invoke-WebRequest -UseBasicParsing -WebSession $s -Method Post -TimeoutSec 120 `
         -ContentType 'application/x-www-form-urlencoded; charset=UTF-8' -Body $corpo ($BASE + 'wwv_flow.ajax')
    return [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
}

function LerRelatorio([string]$tabela) {
    $itens = New-Object System.Collections.ArrayList
    $orgao = ''
    foreach ($pedaco in ([regex]::Split($tabela, '<tr[\s>]') | Select-Object -Skip 1)) {
        if ($pedaco.Contains('a-IRR-header--group')) {
            $txt = Texto $pedaco
            $m = [regex]::Match($txt, 'Esfera\s*:\s*(.*?),\s*\S+rg\S+o\s*:\s*(.*?),\s*Central de Compras\s*:')
            if ($m.Success) { $orgao = $m.Groups[2].Value.Trim() }
            continue
        }
        if (-not $pedaco.Contains('headers="LINK')) { continue }
        $celulas = @([regex]::Matches($pedaco, '<td[^>]*>([\s\S]*?)</td>') | ForEach-Object { $_.Groups[1].Value })
        if ($celulas.Count -lt 7) { continue }
        $href = [Net.WebUtility]::HtmlDecode([regex]::Match($celulas[0], 'href="([^"]+)"').Groups[1].Value)
        $idLic = [regex]::Match($href, 'P10_ID_LICITACAO,P10_PAG_RETORNO:(\d+)').Groups[1].Value
        if (-not $idLic) { continue }
        $modalidade = Texto $celulas[1]; $nr = Texto $celulas[2]; $ano = Texto $celulas[3]
        $objeto = Texto $celulas[4]; $vlr = Texto $celulas[5]; $abertura = Texto $celulas[6]
        if ($objeto.Length -gt 700) { $objeto = $objeto.Substring(0, 700) + [char]0x2026 }
        $d = [regex]::Match($abertura, '(\d{2})/(\d{2})/(\d{4})')
        [void]$itens.Add([ordered]@{
            id           = "LICITACON-$idLic"
            fonte        = 'LicitaCon'
            orgao        = $orgao
            municipio    = MunicipioDoOrgao $orgao
            uf           = 'RS'
            titulo       = "N" + [char]0xBA + " $nr/$ano"
            numero       = $nr
            objeto       = $objeto
            modalidade   = $modalidade
            situacao     = ''
            valor        = Valor $vlr
            # O LicitaCon so informa a data: considera o edital aberto ate o fim do dia
            encerramento = $(if ($d.Success) { '{0}-{1}-{2}T23:59:00' -f $d.Groups[3].Value, $d.Groups[2].Value, $d.Groups[1].Value } else { '' })
            so_data      = $true
            publicacao   = ''
            plataforma   = 'LicitaCon (TCE-RS)'
            ano          = $ano
            link         = $BASE + $href
            link_origem  = ''
        })
    }
    return $itens
}

try {
    Log 'Coletando editais abertos do LicitaCon...'
    $itens = $null
    for ($t = 1; $t -le 3; $t++) {
        try { $itens = LerRelatorio (Coletar); if ($itens.Count) { break } }
        catch { if ($t -eq 3) { throw }; Log "  tentativa $t falhou: $($_.Exception.Message)"; Start-Sleep -Seconds (20 * $t) }
    }
    if (-not $itens -or -not $itens.Count) { throw 'O LicitaCon nao devolveu nenhum edital.' }

    # Uma linha por edital, em ordem fixa: as mudancas diarias ficam pequenas no Git
    $linhas = $itens | Sort-Object { $_.id } | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress }
    $coletado = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $json = "{""coletado_em"":""$coletado"",""total"":$($itens.Count),`n""itens"":[`n" + ($linhas -join ",`n") + "`n]}`n"
    Log "  $($itens.Count) editais abertos no RS"

    if ($SemEnviar) {
        [IO.File]::WriteAllText((Join-Path $pasta 'licitacon-bruto.json'), $json, $utf8)
        Log "  salvo em $pasta (sem enviar)"
    } else {
        $ErrorActionPreference = 'Continue'   # o git escreve avisos no stderr
        if (-not (Test-Path (Join-Path $repo '.git'))) { git clone -q $origem $repo 2>&1 | Out-Null }
        Push-Location $repo
        try {
            for ($t = 1; $t -le 3; $t++) {
                git fetch -q origin 2>&1 | Out-Null
                git reset -q --hard origin/main 2>&1 | Out-Null
                [IO.File]::WriteAllText((Join-Path $repo 'oportunidades\licitacon-bruto.json'), $json, $utf8)
                git add -- oportunidades/licitacon-bruto.json 2>&1 | Out-Null
                git commit -q -m 'Coleta do LicitaCon (TCE-RS)' 2>&1 | Out-Null
                git push -q origin HEAD:main 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) { break }
                if ($t -eq 3) { throw 'git push falhou' }
                Start-Sleep -Seconds 15   # alguem enviou antes: refaz sobre a versao nova
            }
            Log '  enviado ao GitHub'
        } finally { Pop-Location }
    }
} catch {
    Log "ERRO: $($_.Exception.Message)"
    exit 1
}
