# ED CAESAR — Silver Jewelry Store

Node.js + Express e-commerce starter for ED CAESAR.

## Run locally

```bash
npm install
ADMIN_KEY="your-long-secret" npm start
```

Windows PowerShell:

```powershell
$env:ADMIN_KEY="your-long-secret"; npm start
```

Open `http://localhost:3000` for the store and `http://localhost:3000/admin` for the admin panel.

## Admin

Set `ADMIN_KEY` as an environment variable. The key is never stored in frontend code. The admin session is an HttpOnly cookie and expires after 8 hours. Sessions are in memory, so production should use a persistent session store/database.

## Production notes

- Replace JSON persistence with PostgreSQL before real sales scale.
- Add PayTR hash/signature verification to `/api/paytr/callback` before enabling live payments.
- Keep all PayTR credentials as hosting-provider secrets/environment variables.
- Use HTTPS and a strong unique `ADMIN_KEY`.
