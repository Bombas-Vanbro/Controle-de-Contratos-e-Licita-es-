<#
  Agenda no Windows a coleta do LicitaCon (coletar-licitacon.ps1): segunda a sexta,
  as 06:40 (antes da rotina das 7h no GitHub) e as 12:40. Se o PC estiver desligado
  no horario, a coleta roda assim que ele for ligado, e o envio ao GitHub ja dispara
  a atualizacao da aba Oportunidades.

  Instalar:  powershell -ExecutionPolicy Bypass -File instalar-coleta-licitacon.ps1
  Remover:   Unregister-ScheduledTask -TaskName 'Coleta LicitaCon' -Confirm:$false
  Registro:  %LOCALAPPDATA%\ColetaLicitaCon\coleta.log
#>
$script = Join-Path $PSScriptRoot 'coletar-licitacon.ps1'
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$dias = 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'
$gatilhos = @(
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At 6:40),
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $dias -At 12:40)
)
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RunOnlyIfNetworkAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'Coleta LicitaCon' -Action $acao -Trigger $gatilhos -Settings $config `
    -Description 'Coleta os editais abertos do LicitaCon (TCE-RS) e envia para a aba Oportunidades' -Force | Out-Null
Get-ScheduledTask -TaskName 'Coleta LicitaCon' | Get-ScheduledTaskInfo | Select-Object TaskName, NextRunTime
