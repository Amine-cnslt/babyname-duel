Find a baby name you both love - fair 1-10 scoring, tie-breakers, optional firebase sync.
##Dev
npm install
npm run dev

##Build 
npm run build

##Deploy (PythonAnwhere)
Upload the 'dist/' folder , set /assets static mapping, and use 'app.py' WSGI.

## Environment variables

The backend relies on a few environment variables. At minimum set:

```
DATABASE_URL=mysql+pymysql://user:pass@host:3306/db
ALLOWED_ORIGIN=https://your-frontend
```

Optional integrations:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-3.5-turbo
FIREBASE_PROJECT_ID=your-project-id

# Outbound email (password reset)
EMAIL_SENDER=no-reply@yourdomain.com
SENDGRID_API_KEY=SG.xxxxxx         # Preferred: SendGrid HTTP API

# Optional SMTP fallback (requires provider that allows SMTP from Railway)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-account@gmail.com
SMTP_PASSWORD=app-password
SMTP_USE_TLS=true
# Optional verbose SMTP logging
SMTP_DEBUG=false
# Use {token} placeholder or leave it off to append ?token=...
PASSWORD_RESET_URL_BASE=https://your-frontend/reset?token={token}

### Custom domain checklist

1. Point a `CNAME` for your domain (for example, `babynameshive.com`) to your Railway subdomain (`<service>.up.railway.app`).
2. Update `ALLOWED_ORIGIN` to include `https://your-domain.com` so CORS allows the SPA.
3. Set `PASSWORD_RESET_URL_BASE` to the same domain so password-reset links open on the branded site.
4. Redeploy the backend so the new environment variables take effect.
```
