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
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USERNAME=apikey
SMTP_PASSWORD=SG.xxxxxx
SMTP_USE_TLS=true
# Use {token} placeholder or leave it off to append ?token=...
PASSWORD_RESET_URL_BASE=https://your-frontend/reset?token={token}
```
