# 🚂 Guía de Deployment en Railway

## 📋 Configuración de Variables de Entorno

En Railway, configura las siguientes variables de entorno en tu proyecto:

### Variables Obligatorias:

```bash
# Base de datos (PostgreSQL - Railway lo provee automáticamente)
DATABASE_URL=postgresql://...  # Railway lo configura automáticamente

# Node
NODE_ENV=production
PORT=8080  # Railway usa este puerto por defecto

# JWT
JWT_SECRET=tu_secreto_jwt_muy_seguro_cambiar_en_produccion

# OpenAI (para el asistente)
OPENAI_API_KEY=sk-proj-...
OPENAI_ORGANIZATION=org-...

# URL base (importante para Railway)
BASE_URL=https://tu-app.up.railway.app
```

### Variables Opcionales:

```bash
# Gmail (DESHABILITADO por defecto en producción)
GMAIL_ENABLED=false  # Importante: dejar en false o no configurar

# Si decides habilitar Gmail en producción:
# GMAIL_ENABLED=true
# GMAIL_TOKEN_PATH=/etc/secrets/token.json
# O usar GMAIL_TOKEN_JSON con el contenido del token en base64
```

---

## 🚀 Pasos para Deploy

### 1. Crear proyecto en Railway

1. Ve a [Railway.app](https://railway.app)
2. Crea un nuevo proyecto
3. Conecta tu repositorio de GitHub
4. Railway detectará automáticamente que es una app Node.js

### 2. Agregar PostgreSQL

1. En tu proyecto de Railway, haz clic en "New"
2. Selecciona "Database" → "PostgreSQL"
3. Railway configurará automáticamente la variable `DATABASE_URL`

### 3. Configurar Variables de Entorno

En la pestaña "Variables" de tu servicio, agrega todas las variables listadas arriba.

**Importante:**
- `BASE_URL` debe ser la URL que Railway te asigne (ej: `https://whatsapp-baileys-project-production.up.railway.app`)
- `GMAIL_ENABLED=false` para evitar bloqueos en producción (Railway no soporta input interactivo)

### 4. Deploy Automático

Railway hará deploy automáticamente cuando hagas push a tu repositorio.

---

## ⚠️ Problemas Comunes y Soluciones

### Error 502 - Application failed to respond

**Causa:** El servidor se bloquea esperando input (como el código de Gmail).

**Solución:**
- Asegúrate de que `GMAIL_ENABLED=false` en las variables de entorno
- El código ya tiene protección para evitar este problema en producción

### WhatsApp no conecta

**Causa:** El QR solo se mostraba en consola.

**Solución (ya implementada):**
1. Inicia sesión como **gerente**
2. En el menú del chat (⋮), haz clic en "📱 Conexión WhatsApp"
3. Escanea el QR que aparece en la página web
4. La conexión se mantendrá en Railway

### Base de datos no se inicializa

**Causa:** Railway no encuentra la variable `DATABASE_URL`.

**Solución:**
- Verifica que agregaste PostgreSQL a tu proyecto
- La variable `DATABASE_URL` debe configurarse automáticamente
- Si usas variables individuales (`DB_HOST`, `DB_USER`, etc.), asegúrate de configurarlas

---

## 🔐 Seguridad en Producción

### Cambiar Secretos

Antes de ir a producción, cambia estos valores:

```bash
JWT_SECRET=genera_un_secreto_seguro_aleatorio_aqui
```

Puedes generar un secreto seguro con:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Acceso a Conexión WhatsApp

- **Solo gerentes** pueden acceder a `/whatsapp-connection`
- Verifica que tu usuario principal tenga el rol `gerente` en la base de datos
- Consulta: `SELECT * FROM usuarios WHERE tipo_usuario = 'gerente';`

---

## 📱 Conectar WhatsApp en Producción

### Primera vez:

1. Haz deploy en Railway
2. Inicia sesión como gerente
3. Ve al menú (⋮) → "📱 Conexión WhatsApp"
4. Escanea el QR con tu teléfono
5. La sesión quedará guardada en Railway

### Reconexión:

Si WhatsApp se desconecta:
1. Ve nuevamente a "📱 Conexión WhatsApp"
2. Espera el nuevo QR
3. Escanea nuevamente

**Nota:** Railway persistirá la carpeta `auth_info_baileys` entre deploys, por lo que no necesitarás reconectar cada vez.

---

## 🔍 Logs y Debugging

### Ver logs en Railway:

1. Ve a tu proyecto
2. Selecciona tu servicio
3. Haz clic en "Deployments"
4. Selecciona el deployment activo
5. Ve a "View Logs"

### Logs importantes:

```bash
# Servidor iniciado correctamente
Servidor escuchando en 8080

# WhatsApp conectado
Conectado a WhatsApp

# Gmail deshabilitado (correcto en producción)
[gmail] Deshabilitado vía configuración (GMAIL_ENABLED).
```

---

## 🛠️ Comandos Útiles

### Conectar a PostgreSQL desde Railway:

```bash
# Railway CLI
railway connect

# O usa la variable DATABASE_URL con psql
psql $DATABASE_URL
```

### Verificar usuarios gerentes:

```sql
SELECT id, username, tipo_usuario FROM usuarios WHERE tipo_usuario = 'gerente';
```

### Crear usuario gerente si no existe:

```sql
-- La contraseña es el hash de "admin123"
INSERT INTO usuarios (username, password, tipo_usuario)
VALUES ('gerente', '$2b$10$ejemplo_de_hash', 'gerente');
```

**Mejor:** Usa el script de inicialización que ya existe en el código (se ejecuta automáticamente).

---

## 📞 Soporte

Si tienes problemas:
1. Revisa los logs en Railway
2. Verifica que todas las variables de entorno estén configuradas
3. Asegúrate de que PostgreSQL esté conectado
4. Verifica que `GMAIL_ENABLED=false`

---

## ✅ Checklist de Deploy

- [ ] PostgreSQL agregado al proyecto
- [ ] Variables de entorno configuradas
- [ ] `BASE_URL` apunta a la URL de Railway
- [ ] `GMAIL_ENABLED=false`
- [ ] Deploy exitoso (sin errores 502)
- [ ] Puedes iniciar sesión como gerente
- [ ] Puedes acceder a "📱 Conexión WhatsApp"
- [ ] QR se muestra correctamente
- [ ] WhatsApp conectado exitosamente

---

## 🎉 ¡Listo!

Tu aplicación debería estar funcionando correctamente en Railway. Los gerentes pueden conectar WhatsApp desde la interfaz web sin necesidad de acceso a la consola del servidor.
