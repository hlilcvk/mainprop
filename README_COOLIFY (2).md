# PROPTREX Early Access — Coolify Deploy Rehberi

## Neler Değişti?

| Eski (Netlify)         | Yeni (Coolify/Docker)        |
|------------------------|------------------------------|
| Supabase REST API      | Doğrudan PostgreSQL (`pg`)   |
| Netlify Functions      | Express.js API sunucusu      |
| SendGrid API           | SMTP (Nodemailer)            |
| Statik hosting         | Express static serve         |

## Proje Yapısı

```
proptrex-early-access/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env.example
├── package.json
├── public/
│   ├── index.html          # Landing page
│   └── admin.html          # Admin analytics panel
└── src/
    ├── server.js           # Express ana sunucu
    ├── db.js               # PostgreSQL bağlantı pool
    ├── db-init.js          # Tablo oluşturma scripti
    ├── mail.js             # Nodemailer SMTP modülü
    ├── helpers.js           # sha256, rand6, isEmail, getClientIp
    └── routes/
        ├── track.js         # POST /api/track
        ├── request-code.js  # POST /api/request-code
        ├── verify-code.js   # POST /api/verify-code
        └── stats.js         # GET  /api/stats
```

## Coolify'da Deploy (Adım Adım)

### 1. PostgreSQL Servisi Oluşturun

Coolify panelinde:
1. **Resources → New Resource → Database → PostgreSQL**
2. PostgreSQL 16 seçin
3. Database adı: `proptrex`
4. Kullanıcı: `proptrex`
5. Şifre: güçlü bir şifre belirleyin
6. Deploy edin
7. **Internal URL** kısmındaki connection string'i kopyalayın

### 2. E-posta (SMTP) Kurulumu

**Seçenek A — Harici SMTP (önerilen, kolay):**
- Resend, Brevo (Sendinblue), Amazon SES, Gmail SMTP gibi servislerden SMTP bilgilerini alın
- Örnek Resend: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`

**Seçenek B — Coolify'da Docker Mailserver:**
1. **Resources → New Resource → Docker Compose**
2. `docker-mailserver` image'ini kullanın
3. Domain DNS ayarlarını yapın (MX, SPF, DKIM, DMARC)
4. SMTP bilgilerini environment'a girin

**Seçenek C — Test için Mailpit:**
1. Coolify'da yeni Docker servis olarak `axllent/mailpit` ekleyin
2. Port 8025'i açın (web UI)
3. SMTP: host=mailpit, port=1025, no auth

### 3. PROPTREX Uygulamasını Deploy Edin

1. **Resources → New Resource → Application**
2. **Git repo** veya **Docker Image** seçin
3. Build Pack: **Dockerfile**
4. Port: **3000**

### 4. Environment Variables

Coolify panelindeki **Environment Variables** bölümüne şunları ekleyin:

```env
# PostgreSQL (Coolify'ın internal URL'ini kullanın)
DATABASE_URL=postgresql://proptrex:SIFRE@coolify-postgres-xxxxx:5432/proptrex
DB_SSL=false

# SMTP
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxxx
MAIL_FROM=PROPTREX <noreply@proptrex.com>

# hCaptcha
HCAPTCHA_SECRET=0xXXXXXXXXXX

# OTP
OTP_SALT=buraya_64_karakter_rastgele_string

# Firebase Admin
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nXXX\n-----END PRIVATE KEY-----\n

# Admin
ADMIN_EMAILS=admin@proptrex.com

# App
PORT=3000
NODE_ENV=production
```

### 5. Domain Ayarları

Coolify'da uygulamanın **Domains** sekmesinden:
- `proptrex.com` veya `early.proptrex.com` ekleyin
- SSL otomatik yapılandırılır (Let's Encrypt)

### 6. Health Check

Coolify otomatik olarak `/health` endpoint'ini kullanacak (Dockerfile'daki HEALTHCHECK).

## API Endpoint'leri

| Eski Path (Netlify)                    | Yeni Path              |
|-----------------------------------------|------------------------|
| `/.netlify/functions/track`             | `/api/track`           |
| `/.netlify/functions/request-code`      | `/api/request-code`    |
| `/.netlify/functions/verify-code`       | `/api/verify-code`     |
| `/.netlify/functions/stats`             | `/api/stats`           |

> Not: Geriye uyumluluk için eski `/.netlify/functions/` path'leri de çalışır.

## Lokal Test

```bash
# .env dosyasını oluşturun
cp .env.example .env
# Değerleri düzenleyin

# Docker Compose ile çalıştırın
docker compose up -d

# Tarayıcıda açın
# App:     http://localhost:3000
# Mailpit: http://localhost:8025 (test mailleri burada görünür)
```

## Önemli Notlar

- **Veritabanı tabloları** ilk çalıştırmada otomatik oluşturulur (`db-init.js`)
- **Rate limiting** Express middleware ile yapılır (120 req/dk genel, OTP için IP başına 8/10dk)
- **Security headers** Express middleware'de tanımlı (X-Frame-Options, CSP, vs.)
- Container **non-root** kullanıcı ile çalışır
- Multi-stage build ile image boyutu minimize edilmiştir
