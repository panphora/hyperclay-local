# Debug Azure Trusted Signing
# Run this on Windows to diagnose signing issues

Write-Host "=== Azure Trusted Signing Debug ===" -ForegroundColor Cyan
Write-Host ""

# Check environment variables
Write-Host "1. Checking environment variables..." -ForegroundColor Yellow
$tenantId = $env:AZURE_TENANT_ID
$clientId = $env:AZURE_CLIENT_ID
$clientSecret = $env:AZURE_CLIENT_SECRET

if ($tenantId) { Write-Host "   ✓ AZURE_TENANT_ID: $($tenantId.Substring(0,8))..." -ForegroundColor Green }
else { Write-Host "   ✗ AZURE_TENANT_ID: Not set" -ForegroundColor Red }

if ($clientId) { Write-Host "   ✓ AZURE_CLIENT_ID: $($clientId.Substring(0,8))..." -ForegroundColor Green }
else { Write-Host "   ✗ AZURE_CLIENT_ID: Not set" -ForegroundColor Red }

if ($clientSecret) { Write-Host "   ✓ AZURE_CLIENT_SECRET: ***SET***" -ForegroundColor Green }
else { Write-Host "   ✗ AZURE_CLIENT_SECRET: Not set" -ForegroundColor Red }

Write-Host ""

# Check metadata.json
Write-Host "2. Checking metadata.json..." -ForegroundColor Yellow
$metadataPath = "$env:LOCALAPPDATA\TrustedSigning\Microsoft.Trusted.Signing.Client\Microsoft.Trusted.Signing.Client.1.0.53\bin\x64\metadata.json"

if (Test-Path $metadataPath) {
    Write-Host "   ✓ Found at: $metadataPath" -ForegroundColor Green
    $metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
    Write-Host "   Endpoint: $($metadata.Endpoint)" -ForegroundColor Cyan
    Write-Host "   Account: $($metadata.CodeSigningAccountName)" -ForegroundColor Cyan
    Write-Host "   Profile: $($metadata.CertificateProfileName)" -ForegroundColor Cyan
} else {
    Write-Host "   ✗ Not found at expected path" -ForegroundColor Red
}

Write-Host ""

# Check if TrustedSigning module is installed
Write-Host "3. Checking TrustedSigning module..." -ForegroundColor Yellow
$module = Get-Module -ListAvailable -Name TrustedSigning

if ($module) {
    Write-Host "   ✓ Version: $($module.Version)" -ForegroundColor Green
} else {
    Write-Host "   ✗ Not installed" -ForegroundColor Red
    Write-Host "   Install with: Install-Module -Name TrustedSigning -Force" -ForegroundColor Yellow
}

Write-Host ""

# Check for installer file
Write-Host "4. Checking for installer..." -ForegroundColor Yellow
$installerPath = "dist\HyperclayLocal-Setup-1.1.0.exe"

if (Test-Path $installerPath) {
    $fileInfo = Get-Item $installerPath
    Write-Host "   ✓ Found: $installerPath" -ForegroundColor Green
    Write-Host "   Size: $([math]::Round($fileInfo.Length / 1MB, 2)) MB" -ForegroundColor Cyan
} else {
    Write-Host "   ✗ Not found: $installerPath" -ForegroundColor Red
    Write-Host "   Build it first with: npm run build-windows" -ForegroundColor Yellow
}

Write-Host ""

# Test Azure connectivity
Write-Host "5. Testing Azure endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://eus.codesigning.azure.net" -Method Head -ErrorAction Stop
    Write-Host "   ✓ Endpoint reachable (Status: $($response.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Cannot reach endpoint: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Debug Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "If all checks pass, try signing manually:" -ForegroundColor Yellow
Write-Host "Invoke-TrustedSigning -Endpoint https://eus.codesigning.azure.net -CodeSigningAccountName Hyperclay -CertificateProfileName HyperclayLocalPublicCertProfile -Files ""$installerPath""" -ForegroundColor Cyan