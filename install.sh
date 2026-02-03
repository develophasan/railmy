#!/bin/bash

# Raillmy Production Installation Script
# Bu script, Raillmy sistemini Linux sunucunuza kurar

set -e

echo "🚀 Raillmy Installation Script"
echo "=============================="
echo ""

# Renkler
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Hata fonksiyonu
error_exit() {
    echo -e "${RED}❌ Hata: $1${NC}" >&2
    exit 1
}

# Başarı mesajı
success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Uyarı mesajı
warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# OS tespiti
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VER=$VERSION_ID
    else
        error_exit "OS tespit edilemedi"
    fi
}

# Node.js kontrolü
check_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            success "Node.js $(node -v) kurulu"
            return 0
        else
            warning "Node.js versiyonu 18+ olmalı. Mevcut: $(node -v)"
            return 1
        fi
    else
        return 1
    fi
}

# Node.js kurulumu
install_nodejs() {
    echo "📦 Node.js kuruluyor..."
    detect_os
    
    case $OS in
        ubuntu|debian)
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        centos|rhel|fedora)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            sudo yum install -y nodejs
            ;;
        *)
            error_exit "Desteklenmeyen OS: $OS"
            ;;
    esac
    
    success "Node.js kuruldu: $(node -v)"
}

# Git kontrolü ve kurulumu
install_git() {
    if command -v git &> /dev/null; then
        success "Git kurulu: $(git --version)"
    else
        echo "📦 Git kuruluyor..."
        detect_os
        case $OS in
            ubuntu|debian)
                sudo apt-get update
                sudo apt-get install -y git
                ;;
            centos|rhel|fedora)
                sudo yum install -y git
                ;;
        esac
        success "Git kuruldu"
    fi
}

# PM2 kontrolü ve kurulumu
install_pm2() {
    if command -v pm2 &> /dev/null; then
        success "PM2 kurulu: $(pm2 -v)"
    else
        echo "📦 PM2 kuruluyor..."
        sudo npm install -g pm2
        success "PM2 kuruldu"
        
        # PM2 startup
        echo "⚙️  PM2 startup yapılandırılıyor..."
        sudo pm2 startup
        warning "PM2 startup komutunu çalıştırmanız gerekebilir"
    fi
}

# Nginx kontrolü ve kurulumu
install_nginx() {
    if command -v nginx &> /dev/null; then
        success "Nginx kurulu: $(nginx -v 2>&1)"
    else
        echo "📦 Nginx kuruluyor..."
        detect_os
        case $OS in
            ubuntu|debian)
                sudo apt-get update
                sudo apt-get install -y nginx
                ;;
            centos|rhel|fedora)
                sudo yum install -y nginx
                ;;
        esac
        
        sudo systemctl enable nginx
        sudo systemctl start nginx
        success "Nginx kuruldu ve başlatıldı"
    fi
}

# Dizin oluşturma
create_directories() {
    echo "📁 Dizinler oluşturuluyor..."
    
    # /var/apps
    if [ ! -d "/var/apps" ]; then
        sudo mkdir -p /var/apps
        sudo chown -R $USER:$USER /var/apps
        success "/var/apps dizini oluşturuldu"
    else
        success "/var/apps dizini mevcut"
    fi
    
    # Nginx conf.d
    if [ ! -d "/etc/nginx/conf.d" ]; then
        sudo mkdir -p /etc/nginx/conf.d
        success "/etc/nginx/conf.d dizini oluşturuldu"
    fi
}

# Ana kurulum
main() {
    echo "🔍 Sistem kontrol ediliyor..."
    echo ""
    
    # Node.js
    if ! check_nodejs; then
        install_nodejs
    fi
    
    # Git
    install_git
    
    # PM2
    install_pm2
    
    # Nginx
    install_nginx
    
    # Dizinler
    create_directories
    
    echo ""
    success "Kurulum tamamlandı!"
    echo ""
    echo "📝 Sonraki adımlar:"
    echo "1. Raillmy projesini klonlayın veya yükleyin"
    echo "2. npm install && npm run build"
    echo "3. İlk deploy'u test edin"
    echo ""
    echo "Örnek:"
    echo "  raillmy deploy --repo https://github.com/user/repo --type backend --port 3000"
}

# Script çalıştır
main

