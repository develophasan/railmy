#!/bin/bash

# Raillmy Kullanım Örnekleri

# 1. Basit Backend Deploy
echo "=== Backend Deploy Örneği ==="
npm start deploy \
  --repo https://github.com/user/express-api \
  --branch main \
  --type backend \
  --port 3000

# 2. Frontend Deploy (Otomatik Tespit)
echo "=== Frontend Deploy Örneği ==="
npm start deploy \
  --repo https://github.com/user/react-app \
  --branch main

# 3. Environment Variables ile
echo "=== Env Vars ile Deploy ==="
npm start deploy \
  --repo https://github.com/user/api \
  --type backend \
  --port 3000 \
  --env "DATABASE_URL=postgres://localhost:5432/mydb,API_KEY=secret123,JWT_SECRET=mysecret"

# 4. Monorepo Deploy
echo "=== Monorepo Deploy Örneği ==="
npm start deploy \
  --repo https://github.com/user/monorepo \
  --branch main \
  --type monorepo \
  --port 3000

# 5. Özel Proje Adı ve Base Path
echo "=== Özel Config ile Deploy ==="
npm start deploy \
  --repo https://github.com/user/api \
  --name my-custom-api \
  --base-path /api/v1 \
  --port 3000 \
  --env "NODE_ENV=production"

# 6. Log Görüntüleme
echo "=== Log Görüntüleme ==="
npm start logs --name my-project --lines 100

# 7. PM2 Status
echo "=== PM2 Status ==="
npm start status

