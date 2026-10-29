# 从仓库根目录的 .env 读取连接设定；私人入口不会显示在终端。
$ErrorActionPreference = 'Stop'
$taskPython = Get-Command python -ErrorAction Stop
& $taskPython.Source (Join-Path $PSScriptRoot 'open_dsh.py') @args
exit $LASTEXITCODE
