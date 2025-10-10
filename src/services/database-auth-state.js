// database-auth-state.js
// Adaptador personalizado para usar PostgreSQL como almacenamiento de sesión de Baileys
// Compatible con Railway (sin depender del filesystem efímero)

const { ejecutarConReintento } = require('../database/db');
const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

/**
 * Crea un state manager que persiste en PostgreSQL
 * Compatible con la interfaz de useMultiFileAuthState de Baileys
 *
 * Esta implementación usa la nueva estructura de tabla:
 * - session_key: identificador único (ej: "creds", "app-state-sync-key-AAAAAA")
 * - session_value: datos JSONB serializados con BufferJSON
 */
async function useDatabaseAuthState() {
  console.log('🔵 Inicializando DatabaseAuthState para Railway...');

  const writeData = async (key, data) => {
    try {
      // Serializar datos usando BufferJSON para manejar Buffers correctamente
      const serializedData = JSON.stringify(data, BufferJSON.replacer);

      const query = `
        INSERT INTO whatsapp_sessions (session_key, session_value, activa)
        VALUES ($1, $2::jsonb, true)
        ON CONFLICT (session_key)
        DO UPDATE SET
          session_value = EXCLUDED.session_value,
          fecha_actualizacion = CURRENT_TIMESTAMP,
          activa = true;
      `;

      await ejecutarConReintento(query, [key, serializedData]);
      console.log(`✓ Guardado: ${key}`);
    } catch (error) {
      console.error(`❌ Error guardando ${key} en BD:`, error.message);
      throw error;
    }
  };

  const readData = async (key) => {
    try {
      const query = `
        SELECT session_value
        FROM whatsapp_sessions
        WHERE session_key = $1 AND activa = true
        LIMIT 1;
      `;

      const result = await ejecutarConReintento(query, [key]);

      if (result.rows.length > 0) {
        // Deserializar usando BufferJSON para restaurar Buffers
        const data = JSON.parse(JSON.stringify(result.rows[0].session_value), BufferJSON.reviver);
        console.log(`✓ Leído: ${key}`);
        return data;
      }

      console.log(`⚠️  No encontrado: ${key}`);
      return null;
    } catch (error) {
      console.error(`❌ Error leyendo ${key} de BD:`, error.message);
      return null;
    }
  };

  const removeData = async (key) => {
    try {
      const query = `
        DELETE FROM whatsapp_sessions
        WHERE session_key = $1;
      `;

      await ejecutarConReintento(query, [key]);
      console.log(`✓ Eliminado: ${key}`);
    } catch (error) {
      console.error(`❌ Error eliminando ${key} de BD:`, error.message);
    }
  };

  // Cargar credenciales existentes o crear nuevas
  let creds = await readData('creds');
  if (!creds) {
    console.log('🆕 No hay credenciales existentes, creando nuevas...');
    creds = initAuthCreds();
    await writeData('creds', creds);
  } else {
    console.log('✅ Credenciales cargadas desde BD');
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                // Asegurar que los buffers se deserializan correctamente
                value = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(writeData(key, value));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData('creds', creds);
      console.log('✅ Credenciales guardadas en BD');
    }
  };
}

/**
 * Limpia todas las sesiones de la base de datos
 * Útil para forzar un nuevo escaneo de QR
 */
async function clearDatabaseAuthState() {
  try {
    const query = 'DELETE FROM whatsapp_sessions;';
    await ejecutarConReintento(query);
    console.log('✅ Todas las sesiones eliminadas de BD');
    return true;
  } catch (error) {
    console.error('❌ Error limpiando sesiones:', error.message);
    return false;
  }
}

module.exports = { useDatabaseAuthState, clearDatabaseAuthState };
