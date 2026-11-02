$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$requiredFiles = @(
    'PROJECT.md',
    'AGENTS.md',
    'harness\STATE.md',
    'harness\issues\ISSUE_REGISTER.md',
    'harness\context\PROJECT_CONTEXT.md',
    'harness\context\SOURCE_OF_TRUTH.md',
    'harness\memory\DECISIONS.md',
    'harness\memory\FINDINGS.md',
    'harness\memory\HANDOFF.md',
    'harness\plans\CURRENT_ITERATION.md',
    'harness\plans\BACKLOG.md',
    'harness\loops\DEVELOPMENT.md',
    'harness\loops\VERIFICATION.md'
)

$errors = @()
foreach ($relativePath in $requiredFiles) {
    $absolutePath = Join-Path $projectRoot $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
        $errors += "Missing required file: $relativePath"
    }
}

$gitRoot = (& git -c "safe.directory=$projectRoot" -C $projectRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $gitRoot) {
    $errors += 'Project root is not a Git repository.'
} elseif ((Resolve-Path $gitRoot).Path -ne $projectRoot) {
    $errors += "Git root mismatch: $gitRoot"
}

if ($gitRoot) {
    $trackedSecrets = & git -c "safe.directory=$projectRoot" -C $projectRoot ls-files | Where-Object {
        $isEnvironmentFile = $_ -match '(^|/)\.env($|\.)'
        $isExampleTemplate = $_ -match '(^|/)\.env\.example$'
        $hasSecretLikeName = $_ -match '(^|/).*(secret|credential|api[_-]?key).*$'
        ($isEnvironmentFile -and -not $isExampleTemplate) -or $hasSecretLikeName
    }
    if ($trackedSecrets) {
        $errors += "Potential secret files are tracked: $($trackedSecrets -join ', ')"
    }

    # Implementation changes and progress records must move together. This does not
    # prove that prose is true, but prevents a code/database batch from passing the
    # governance check while leaving every current progress ledger untouched.
    $statusLines = @(& git -c "safe.directory=$projectRoot" -C $projectRoot status --porcelain=v1 --untracked-files=all)
    $changedPaths = @(
        foreach ($line in $statusLines) {
            if ($line.Length -lt 4) { continue }
            $path = $line.Substring(3).Trim('"').Replace('\', '/')
            if ($path -match ' -> ') {
                $path = ($path -split ' -> ')[-1]
            }
            $path
        }
    )

    $implementationChanged = @($changedPaths | Where-Object {
        $_ -eq 'projects/package.json' -or
        $_ -like 'projects/src/*' -or
        $_ -like 'projects/supabase/*' -or
        $_ -like 'projects/scripts/*' -or
        $_ -like 'projects/public/*'
    }).Count -gt 0

    if ($implementationChanged) {
        $requiredProgressLedgers = @(
            'harness/STATE.md',
            'harness/plans/CURRENT_ITERATION.md',
            'harness/issues/ISSUE_REGISTER.md',
            'harness/memory/HANDOFF.md'
        )
        $missingLedgerUpdates = @($requiredProgressLedgers | Where-Object { $_ -notin $changedPaths })
        if ($missingLedgerUpdates.Count -gt 0) {
            $errors += "Implementation changed without updating required progress ledgers: $($missingLedgerUpdates -join ', ')"
        }
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output 'Harness check passed.'
Write-Output "Project root: $projectRoot"
if ($gitRoot) {
    $status = & git -c "safe.directory=$projectRoot" -C $projectRoot status --short
    if ($status) {
        Write-Output 'Working tree changes:'
        $status
    } else {
        Write-Output 'Working tree is clean.'
    }
}
