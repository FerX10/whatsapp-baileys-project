# 🚂 Guía de Despliegue en Railway

Esta guía explica cómo desplegar correctamente la aplicación en Railway y corregir los problemas de persistencia de sesión de WhatsApp.

## 📋 Problemas Resueltos

1. ✅ **Columna `created_at` faltante en `notas_internas`**
2. ✅ **Persistencia de sesión de WhatsApp** (antes se perdía en cada reinicio)

## 🔧 Pasos para Desplegar

### 1. Ejecutar Migración SQL en Railway

Primero, necesitas ejecutar el script SQL en tu base de datos de Railway:

1. Ve a tu proyecto en Railway
2. Abre la pestaña de **PostgreSQL**
3. Haz clic en **Data** → **Query**
4. Copia y pega el contenido del archivo [`migrations/railway_deployment_fix.sql`](migrations/railway_deployment_fix.sql)
5. Ejecuta el script

**Alternativa (usando CLI):**

```bash
# Instalar Railway CLI si no lo tienes
npm install -g @railway/cli

# Login
railway login

# Conectar a tu proyecto
railway link

# Ejecutar migración
railway run psql $DATABASE_URL -f migrations/railway_deployment_fix.sql
```

### 2. Verificar Variables de Entorno en Railway

Asegúrate de que tienes estas variables configuradas:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...  # Auto-generada por Railway
OPENAI_API_KEY=sk-...
JWT_SECRET=tu_secreto_jwt
PORT=3000  # Railway usa esto automáticamente
```

**Opcional:**
- `RAILWAY_ENVIRONMENT` - Railway la configura automáticamente

### 3. Desplegar el Código

```bash
# Hacer commit de los cambios
git add .
git commit -m "Fix Railway deployment: Use PostgreSQL for WhatsApp session persistence

- Add database auth state adapter
- Fix created_at column in notas_internas
- Support both local (files) and Railway (database) environments

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push a Railway
git push origin main
```

Railway detectará los cambios y redesplegará automáticamente.

### 4. Escanear QR de WhatsApp Nuevamente

Después del despliegue:

1. Ve a tu app: `https://tu-app.railway.app/login`
2. Login como gerente
3. Ve a **Conexión WhatsApp**
4. Escanea el código QR

**¡Importante!** Ahora la sesión se guardará en PostgreSQL y **persistirá entre reinicios**.

## 🔍 Verificar el Despliegue

### Verificar Logs

```bash
railway logs
```

Deberías ver:

```
🔵 Inicializando DatabaseAuthState para Railway...
🚂 Railway detectado - Usando PostgreSQL para sesión
✓ Guardado: creds
✅ Credenciales guardadas en BD
```

### Verificar Base de Datos

Ejecuta este query en Railway para verificar la migración:

```sql
-- Verificar tabla notas_internas
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'notas_internas' AND column_name = 'created_at';

-- Verificar tabla whatsapp_sessions
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'whatsapp_sessions'
ORDER BY ordinal_position;

-- Ver sesiones guardadas
SELECT session_key, activa, fecha_actualizacion
FROM whatsapp_sessions
WHERE activa = true;
```

## 🛠️ Solución de Problemas

### Problema: "Column created_at does not exist"

**Solución:**
1. Ejecuta el script SQL de migración (paso 1)
2. Redespliega la aplicación

### Problema: WhatsApp se desconecta después de reinicio

**Solución:**
1. Verifica que la migración SQL se ejecutó correctamente
2. Revisa los logs: debe decir "Railway detectado - Usando PostgreSQL"
3. Si dice "Entorno local", verifica que `NODE_ENV=production` esté configurado

### Problema: No puedo escanear el QR

**Solución:**
1. Ve a `/whatsapp-connection` en tu app
2. Si no aparece QR, usa el botón "Reset Session"
3. Espera 10 segundos y refresca la página

## 📊 Arquitectura

### Entorno Local (Desarrollo)
```
WhatsApp Session → Archivos (auth_info_baileys/)
├── creds.json
├── app-state-sync-key-*.json
└── ...
```

### Entorno Railway (Producción)
```
WhatsApp Session → PostgreSQL (whatsapp_sessions)
├── session_key: "creds"
├── session_key: "app-state-sync-key-AAAAAA"
├── session_key: "app-state-sync-key-AAAAAB"
└── ...
```

## ✅ Checklist de Despliegue

- [ ] Ejecutar script SQL de migración
- [ ] Verificar variables de entorno
- [ ] Push del código a Railway
- [ ] Esperar despliegue (2-3 minutos)
- [ ] Verificar logs (debe decir "Railway detectado")
- [ ] Escanear QR de WhatsApp
- [ ] Probar enviando un mensaje
- [ ] Verificar que la sesión persiste (reinicia el servicio y verifica que no pide QR)

## 🔗 Enlaces Útiles

- [Dashboard de Railway](https://railway.app/dashboard)
- [Documentación de Baileys](https://whiskeysockets.github.io/)
- [Documentación de PostgreSQL](https://www.postgresql.org/docs/)

## 💡 Notas Importantes

1. **Primera vez después de migración:** Deberás escanear el QR nuevamente
2. **Persistencia:** La sesión ahora se guarda en PostgreSQL y sobrevive a reinicios
3. **Local vs Railway:** El código detecta automáticamente el entorno y usa el método correcto
4. **Limpieza:** Usa el endpoint `/api/whatsapp/reset-session` si necesitas forzar un nuevo QR

---

**¿Problemas?** Revisa los logs con `railway logs` o contacta al equipo de desarrollo.
