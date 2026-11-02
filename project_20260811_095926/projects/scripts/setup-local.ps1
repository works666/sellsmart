$ErrorActionPreference = 'Stop'

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  throw 'Supabase CLI was not found. Install it first with: scoop install supabase'
}

if (-not (Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
  Write-Host 'Created .env.local from .env.example.'
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
  Write-Host 'Docker was found. Starting the local Supabase stack...'
  supabase start
  supabase status
  Write-Host ''
  Write-Host 'Copy the API URL, anon key, and service_role key above into .env.local.'
} else {
  Write-Host 'Docker was not found. The hosted Supabase workflow will be used.'
  Write-Host ''
  Write-Host '1. Create a development project at https://supabase.com/dashboard'
  Write-Host '2. Run: supabase login'
  Write-Host '3. Run: supabase link --project-ref YOUR_PROJECT_REF'
  Write-Host '4. Run: supabase db push --include-seed'
  Write-Host '5. Copy the hosted project URL, anon key, and service_role key into .env.local'
}

Write-Host ''
Write-Host 'Then set AI_BASE_URL, AI_API_KEY, and AI_MODEL in .env.local.'
Write-Host 'Validate the configuration with: pnpm local:check'
