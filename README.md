# Raillmy - Self-Hosted Deployment System

Railway/Render/Fly.io benzeri, kendi Linux sunucunuzda çalışan otomatik deploy sistemi.

## 🎯 Özellikler

- ✅ GitHub repo otomatik klonlama
- ✅ Frontend/Backend/Monorepo otomatik tespit
- ✅ Bağımlılık kurulumu (npm/pnpm/yarn otomatik algılama)
- ✅ Otomatik build süreçleri
- ✅ PM2 ile servis yönetimi
- ✅ Nginx otomatik yapılandırma ve routing
- ✅ Detaylı loglama ve hata yönetimi
- ✅ Shell injection koruması
- ✅ Environment variable desteği
- ✅ Monorepo desteği (apps/frontend, apps/backend)

## 📋 Gereksinimler

- **Node.js** >= 18.0.0
- **Git**
- **PM2** (global: `npm i -g pm2`)
- **Nginx**
- **sudo/root erişimi** (Nginx config için)

## 🚀 Kurulum

```bash
# Bağımlılıkları kur
npm install

# TypeScript derle
npm run build

# PM2'yi global kur (eğer yoksa)
npm i -g pm2
```

## 💻 Kullanım

### Temel Deploy

```bash
# Backend deploy
npm start deploy \
  --repo https://github.com/user/backend-api \
  --branch main \
  --type backend \
  --port 3000

# Frontend deploy (otomatik tespit)
npm start deploy \
  --repo https://github.com/user/frontend-app \
  --branch main

# Monorepo deploy
npm start deploy \
  --repo https://github.com/user/monorepo \
  --branch main \
  --type monorepo \
  --port 3000
```

### Environment Variables ile

```bash
npm start deploy \
  --repo https://github.com/user/api \
  --type backend \
  --port 3000 \
  --env "DATABASE_URL=postgres://...,API_KEY=secret123"
```

### Özel Proje Adı ve Base Path

```bash
npm start deploy \
  --repo https://github.com/user/api \
  --name my-api \
  --base-path /api \
  --port 3000
```

### Proje Yönetimi

```bash
# Tüm deploy edilmiş projeleri listele
raillmy list

# Belirli bir projenin durumunu kontrol et
raillmy status --name my-project

# Tüm PM2 process'lerini görüntüle
raillmy status

# Proje loglarını görüntüle
raillmy logs --name my-project --lines 200
raillmy logs --name my-project --type build
raillmy logs --name my-project --type runtime
raillmy logs --name my-project --type pm2

# Projeyi güncelle (repo pull + restart)
raillmy update --name my-project
raillmy update --name my-project --branch develop

# Projeyi kaldır
raillmy remove --name my-project
raillmy remove --name my-project --force  # Onay istemeden sil
```

## 📁 Proje Yapısı

```
raillmy/
 ├─ src/
 │   ├─ github/           # Repo klonlama
 │   │   └─ cloneRepo.ts
 │   ├─ analyzer/         # Proje tipi tespiti
 │   │   └─ detectProjectType.ts
 │   ├─ installer/        # Bağımlılık kurulumu
 │   │   └─ installDeps.ts
 │   ├─ builder/          # Build süreçleri
 │   │   └─ buildProject.ts
 │   ├─ runner/           # PM2 yönetimi
 │   │   └─ runWithPM2.ts
 │   ├─ nginx/            # Nginx config
 │   │   └─ generateConfig.ts
 │   ├─ logger/           # Loglama
 │   │   └─ logger.ts
 │   ├─ utils/            # Yardımcı fonksiyonlar
 │   │   ├─ security.ts
 │   │   └─ paths.ts
 │   ├─ types/            # TypeScript tipleri
 │   │   └─ index.ts
 │   └─ index.ts          # Ana orchestrator + CLI
 ├─ logs/                 # Log dosyaları
 ├─ package.json
 ├─ tsconfig.json
 └─ README.md
```

## 🔄 Deploy Süreci

1. **Repo Klonlama**: GitHub'dan repo klonlanır (`/var/apps/{project-name}/`)
2. **Proje Analizi**: package.json analiz edilir, tip tespit edilir
3. **Bağımlılık Kurulumu**: npm/pnpm/yarn ile bağımlılıklar kurulur
4. **Build**: Frontend/Backend build edilir
5. **PM2 Başlatma**: Backend/SSR servisleri PM2 ile başlatılır
6. **Nginx Config**: Otomatik Nginx config oluşturulur
7. **Nginx Reload**: Nginx yeniden yüklenir

## 🧠 Desteklenen Proje Tipleri

### Backend
- Express.js
- Fastify
- Koa
- NestJS
- Hapi
- Restify

### Frontend
- **Static**: React (Vite/CRA), Vue, Angular, Svelte
- **SSR**: Next.js, Nuxt, Remix

### Monorepo
- Turborepo
- Lerna
- Nx
- npm/yarn/pnpm workspaces

Yapı: `apps/frontend`, `apps/backend` veya `packages/*`

## 🔒 Güvenlik Özellikleri

- ✅ **URL Whitelist**: Sadece GitHub URL'lerine izin
- ✅ **Shell Injection Koruması**: Tüm input'lar sanitize edilir
- ✅ **Path Traversal Koruması**: Güvenli path işlemleri
- ✅ **Environment Variable Validation**: Key format kontrolü

## 📝 Loglama

Tüm işlemler loglanır:
- **Genel log**: `logs/general.log`
- **Proje logları**: `logs/{project-name}.log`
- **Build log**: `/var/apps/{project-name}/build.log`
- **Runtime log**: `/var/apps/{project-name}/runtime.log`

## 🐛 Hata Ayıklama

Hata durumunda:
1. Log dosyalarını kontrol edin
2. PM2 durumunu kontrol edin: `pm2 list`
3. Nginx config'i kontrol edin: `sudo nginx -t`
4. Build log'una bakın: `cat /var/apps/{project}/build.log`

## 🚧 Geliştirme Yol Haritası

- [x] Backend deploy
- [x] Frontend deploy (static + SSR)
- [x] Monorepo desteği
- [x] Proje listeleme (list)
- [x] Proje silme (remove)
- [x] Proje güncelleme (update)
- [x] Status komutu
- [x] Logs komutu
- [x] Metadata yönetimi
- [ ] GitHub webhook entegrasyonu
- [ ] Basit web dashboard
- [ ] Multi-server desteği
- [ ] Rollback mekanizması
- [ ] Health check endpoint'leri
- [ ] Otomatik backup

## 📝 Lisans

MIT

