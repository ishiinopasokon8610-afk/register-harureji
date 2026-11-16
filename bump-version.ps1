$utf8 = New-Object System.Text.UTF8Encoding($false)

function Bump($file, $pattern) {
    $path = Join-Path $PSScriptRoot $file
    if (-not (Test-Path $path)) { Write-Host "NOT FOUND: $file"; return }
    $text = [IO.File]::ReadAllText($path, $utf8)
    $re = New-Object System.Text.RegularExpressions.Regex($pattern)
    $m = $re.Match($text)
    if (-not $m.Success) { Write-Host "PATTERN NOT FOUND: $file"; return }
    $old = [int]$m.Groups[2].Value
    $new = $old + 1
    $ev = [System.Text.RegularExpressions.MatchEvaluator]{
        param($x)
        $x.Groups[1].Value + ([int]$x.Groups[2].Value + 1) + $x.Groups[3].Value
    }
    $result = $re.Replace($text, $ev, 1)
    [IO.File]::WriteAllText($path, $result, $utf8)
    Write-Host ("OK: {0}  {1} -> {2}" -f $file, $m.Value, $re.Match($result).Value)
}

Bump 'sw.js' "(const CACHE_VERSION = 'v)(\d+)(')"
Bump 'update-notification-system.js' "(const APP_VERSION = 'v\d+\.\d+\.)(\d+)(')"
