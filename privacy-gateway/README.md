# Chutjul V2 privacy gateway

This service must run inside the trusted network. It sends complaint questions only to the configured local Ollama server, validates schema-constrained output, scans the result again, and returns an external-AI-safe minimum summary.

## Windows local run

Set the variables in PowerShell, using the exact model name from `ollama list`:

```powershell
$env:OLLAMA_MODEL='your-model-name'
$env:PRIVACY_GATEWAY_API_KEY='a-long-random-secret'
python .\privacy-gateway\server.py
```

Health check:

```powershell
curl.exe http://127.0.0.1:8765/health
```

Tests:

```powershell
python -m unittest discover -s privacy-gateway -p 'test_*.py'
```

Do not expose port 8765 directly to the public internet. Production requires an authenticated private HTTPS route from the site backend to this service.
