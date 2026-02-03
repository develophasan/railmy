# ⚡ Hızlı Başlangıç

Sunucunuza hızlıca kurulum için:

## 🚀 Tek Komutla Kurulum

```bash
# Sunucunuza bağlanın
ssh user@your-server

# Kurulum scriptini indirin ve çalıştırın
curl -fsSL https://raw.githubusercontent.com/your-repo/raillmy/main/install.sh | bash
```

## 📦 Manuel Kurulum

### 1. Dosyaları Sunucuya Yükleyin

```bash
# Lokal makinenizden
scp -r . user@your-server:~/raillmy
```

### 2. Sunucuda Kurulum

```bash
ssh user@your-server
cd ~/raillmy

# Gereksinimleri kur (install.sh çalıştır)
bash install.sh

# Bağımlılıkları kur
npm install
npm run build
```

### 3. İlk Deploy

```bash
# Test deploy
node dist/index.js deploy \
  --repo https://github.com/expressjs/express \
  --type backend \
  --port 3000 \
  --name test-app
```

## ✅ Kontrol Listesi

- [ ] Node.js >= 18 kurulu
- [ ] Git kurulu
- [ ] PM2 global kurulu
- [ ] Nginx kurulu ve çalışıyor
- [ ] /var/apps dizini oluşturuldu
- [ ] Raillmy build edildi
- [ ] İlk deploy test edildi

## 🎯 Kullanım

```bash
# Backend deploy
raillmy deploy --repo https://github.com/user/api --type backend --port 3000

# Frontend deploy
raillmy deploy --repo https://github.com/user/app --type frontend

# Monorepo deploy
raillmy deploy --repo https://github.com/user/monorepo --type monorepo --port 3000

# Environment variables ile
raillmy deploy \
  --repo https://github.com/user/api \
  --type backend \
  --port 3000 \
  --env "DATABASE_URL=postgres://...,API_KEY=secret"
```

## 📚 Detaylı Dokümantasyon

Tam kurulum rehberi için `DEPLOYMENT.md` dosyasına bakın.

