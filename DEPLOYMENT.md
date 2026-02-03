# 🚀 Production Deployment Rehberi

Bu dokümantasyon, Raillmy deploy sistemini Linux sunucunuza kurmak için adım adım talimatlar içerir.

## 📋 Gereksinimler

### Sistem Gereksinimleri
- **OS**: Ubuntu 20.04+ / Debian 11+ / CentOS 8+ (veya benzer Linux dağıtımları)
- **Node.js**: >= 18.0.0
- **Git**: Kurulu olmalı
- **Nginx**: Kurulu ve çalışıyor olmalı
- **PM2**: Global olarak kurulu olmalı
- **Sudo/Root**: Nginx config için gerekli

### Disk Alanı
- Minimum: 5GB (projeler için ek alan gerekebilir)
- Önerilen: 20GB+

## 🔧 Kurulum Adımları

### 1. Sunucuya Bağlanın

```bash
ssh user@your-server-ip
```

### 2. Sistem Güncellemeleri

```bash
sudo apt update && sudo apt upgrade -y  # Ubuntu/Debian
# veya
sudo yum update -y  # CentOS/RHEL
```

### 3. Node.js Kurulumu

```bash
# Node.js 18+ kurulumu (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# veya nvm ile
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### 4. Git Kurulumu

```bash
sudo apt install git -y  # Ubuntu/Debian
# veya
sudo yum install git -y  # CentOS
```

### 5. PM2 Kurulumu

```bash
sudo npm install -g pm2
pm2 startup  # Sistem başlangıcında otomatik başlatma için
```

### 6. Nginx Kurulumu

```bash
sudo apt install nginx -y  # Ubuntu/Debian
# veya
sudo yum install nginx -y  # CentOS

sudo systemctl enable nginx
sudo systemctl start nginx
```

### 7. Raillmy Projesini Klonlayın

```bash
# Proje dizini oluştur
mkdir -p ~/raillmy
cd ~/raillmy

# Repo'yu klonla (veya dosyaları yükle)
git clone <your-repo-url> .
# veya
# scp ile dosyaları yükle
```

### 8. Bağımlılıkları Kurun

```bash
cd ~/raillmy
npm install
npm run build
```

### 9. Uygulama Dizinini Oluşturun

```bash
sudo mkdir -p /var/apps
sudo chown -R $USER:$USER /var/apps
```

### 10. Nginx Config Dizinini Hazırlayın

```bash
sudo mkdir -p /etc/nginx/conf.d
sudo chmod 755 /etc/nginx/conf.d
```

### 11. Global CLI Kurulumu (Opsiyonel)

```bash
# Global link oluştur
sudo npm link

# Artık her yerden kullanabilirsiniz:
raillmy deploy --repo https://github.com/user/repo --type backend --port 3000
```

## 🔐 Güvenlik Ayarları

### Firewall Yapılandırması

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable

# veya firewalld (CentOS)
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### Sudo Yetkileri

Nginx reload için sudo yetkisi gerekiyor. İki seçenek:

**Seçenek 1: Sudoers dosyasına ekle**
```bash
sudo visudo
# Şu satırı ekle:
your-user ALL=(ALL) NOPASSWD: /usr/sbin/nginx
```

**Seçenek 2: Nginx reload için script**
```bash
# /usr/local/bin/nginx-reload.sh oluştur
sudo tee /usr/local/bin/nginx-reload.sh << 'EOF'
#!/bin/bash
nginx -t && nginx -s reload
EOF

sudo chmod +x /usr/local/bin/nginx-reload.sh
sudo visudo
# Şu satırı ekle:
your-user ALL=(ALL) NOPASSWD: /usr/local/bin/nginx-reload.sh
```

## 🧪 İlk Deploy Testi

```bash
# Basit bir test deploy
raillmy deploy \
  --repo https://github.com/expressjs/express \
  --type backend \
  --port 3000 \
  --name test-app
```

## 📁 Dizin Yapısı

```
/var/apps/              # Deploy edilen projeler
  ├── project1/
  ├── project2/
  └── ...

/etc/nginx/conf.d/      # Nginx config dosyaları
  ├── project1.conf
  ├── project2.conf
  └── ...

~/raillmy/              # Raillmy sistemi
  ├── src/
  ├── dist/
  ├── logs/
  └── ...
```

## 🔄 Sistem Servisi Olarak Çalıştırma (Opsiyonel)

### Systemd Service Oluştur

```bash
sudo tee /etc/systemd/system/raillmy.service << 'EOF'
[Unit]
Description=Raillmy Deployment System
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/home/your-user/raillmy
ExecStart=/usr/bin/node /home/your-user/raillmy/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable raillmy
sudo systemctl start raillmy
```

## 🐛 Sorun Giderme

### PM2 Bulunamıyor
```bash
which pm2
# Eğer bulunamazsa:
sudo npm install -g pm2
```

### Nginx Reload Hatası
```bash
# Nginx syntax kontrolü
sudo nginx -t

# Manuel reload
sudo nginx -s reload
```

### Permission Denied
```bash
# /var/apps için yetki ver
sudo chown -R $USER:$USER /var/apps
sudo chmod -R 755 /var/apps
```

### Port Kullanımda
```bash
# Port kontrolü
sudo netstat -tulpn | grep :3000
# veya
sudo ss -tulpn | grep :3000
```

## 📊 Monitoring

### PM2 Monitoring
```bash
pm2 list
pm2 logs
pm2 monit
```

### Nginx Logs
```bash
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

## 🔄 Güncelleme

```bash
cd ~/raillmy
git pull
npm install
npm run build
```

## 📝 Notlar

- İlk deploy'dan önce tüm gereksinimlerin kurulu olduğundan emin olun
- Production'da HTTPS kullanmak için Let's Encrypt kurulumu yapın
- Düzenli backup alın (`/var/apps` dizini)
- Log dosyalarını düzenli olarak temizleyin

## 🆘 Destek

Sorun yaşarsanız:
1. Log dosyalarını kontrol edin: `~/raillmy/logs/`
2. PM2 durumunu kontrol edin: `pm2 list`
3. Nginx config'i kontrol edin: `sudo nginx -t`

