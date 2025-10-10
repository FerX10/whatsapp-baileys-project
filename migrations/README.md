# 📁 Migraciones de Base de Datos

Esta carpeta contiene scripts SQL para migrar la base de datos PostgreSQL en Railway.

## 📄 Archivos

### `railway_deployment_fix.sql`

**Propósito:** Migración completa para corregir problemas de despliegue en Railway

**Qué hace:**
1. ✅ Renombra `fecha_creacion` → `created_at` en la tabla `notas_internas`
2. ✅ Crea columna `created_at` si no existe
3. ✅ Recrea tabla `whatsapp_sessions` con estructura optimizada para Railway
4. ✅ Crea índices para mejorar el rendimiento
5. ✅ Configura triggers para actualización automática de timestamps

**Cuándo usar:**
- Primera vez que despliegas en Railway
- Después de clonar el repositorio en un nuevo ambiente
- Si encuentras el error: `column "created_at" does not exist`
- Si WhatsApp se desconecta después de cada reinicio

**Cómo ejecutar:**

#### Opción 1: Desde Railway Dashboard
1. Ve a tu proyecto en Railway
2. Abre **PostgreSQL** → **Data** → **Query**
3. Copia y pega el contenido completo de `railway_deployment_fix.sql`
4. Haz clic en **Run**

#### Opción 2: Desde Railway CLI
```bash
railway login
railway link
railway run psql $DATABASE_URL -f migrations/railway_deployment_fix.sql
```

#### Opción 3: Desde tu máquina local (si tienes acceso a DATABASE_URL)
```bash
psql "$DATABASE_URL" -f migrations/railway_deployment_fix.sql
```

**Resultado esperado:**
```
✓ NOTAS_INTERNAS: Estructura verificada
✓ WHATSAPP_SESSIONS: Estructura verificada
✓ MIGRACIÓN COMPLETADA EXITOSAMENTE
```

---

### `fix_created_at.sql` (Deprecado)

**Propósito:** Solo corrige el problema de `created_at` en `notas_internas`

**Nota:** Este archivo está incluido en `railway_deployment_fix.sql`. Usa ese en su lugar.

---

## ⚠️ Advertencias

1. **Pérdida de sesión:** La primera vez que ejecutes `railway_deployment_fix.sql`, perderás la sesión actual de WhatsApp. Necesitarás escanear el QR nuevamente.

2. **Idempotencia:** Los scripts están diseñados para ser idempotentes (puedes ejecutarlos múltiples veces sin problemas).

3. **Backups:** Railway hace backups automáticos, pero siempre es buena práctica verificar antes de ejecutar migraciones en producción.

## 🔍 Verificar Migración

Después de ejecutar la migración, verifica que todo esté correcto:

```sql
-- Verificar estructura de notas_internas
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'notas_internas' AND column_name IN ('id', 'created_at', 'nota')
ORDER BY ordinal_position;

-- Verificar estructura de whatsapp_sessions
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'whatsapp_sessions'
ORDER BY ordinal_position;

-- Verificar índices
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'whatsapp_sessions';
```

**Salida esperada para `whatsapp_sessions`:**

| column_name          | data_type                   | is_nullable |
|---------------------|-----------------------------|-------------|
| id                  | integer                     | NO          |
| session_key         | character varying(100)      | NO          |
| session_value       | jsonb                       | NO          |
| activa              | boolean                     | YES         |
| fecha_creacion      | timestamp with time zone    | YES         |
| fecha_actualizacion | timestamp with time zone    | YES         |

## 🆘 Solución de Problemas

### Error: "relation does not exist"
**Causa:** La tabla no existe aún
**Solución:** Asegúrate de que `initDatabase()` se ejecutó primero. Revisa los logs de inicio de la app.

### Error: "syntax error at or near"
**Causa:** Hay un problema en el script SQL
**Solución:** Verifica que copiaste el script completo, sin cortar líneas.

### Error: "permission denied"
**Causa:** El usuario de base de datos no tiene permisos
**Solución:** En Railway esto no debería pasar. Verifica que estés conectado a la base de datos correcta.

## 📚 Más Información

Para una guía completa de despliegue, consulta: [`RAILWAY_DEPLOYMENT.md`](../RAILWAY_DEPLOYMENT.md)
