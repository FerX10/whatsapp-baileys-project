// migrate_roles.js - Script para migrar el sistema de roles
require('dotenv').config();
const { ejecutarConReintento } = require('./src/database/db');

async function migrate() {
  try {
    console.log('🔧 Iniciando migración del sistema de roles...\n');

    // 0. Crear columna usuario_sistema si no existe
    console.log('0️⃣ Creando columna usuario_sistema...');
    await ejecutarConReintento(
      `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS usuario_sistema BOOLEAN DEFAULT FALSE`
    );
    console.log('✅ Columna usuario_sistema creada\n');

    // 1. Marcar asistente_bot como usuario del sistema
    console.log('1️⃣ Marcando asistente_bot como usuario del sistema...');
    await ejecutarConReintento(
      `UPDATE usuarios SET usuario_sistema = TRUE WHERE nombre_usuario = 'asistente_bot'`
    );
    console.log('✅ asistente_bot marcado como usuario del sistema\n');

    // 2. Verificar usuarios actuales
    console.log('2️⃣ Verificando usuarios actuales:');
    const result = await ejecutarConReintento(
      `SELECT id, nombre_usuario, tipo_usuario, usuario_sistema, activo
       FROM usuarios
       ORDER BY id`
    );

    console.table(result.rows);

    console.log('\n📋 IMPORTANTE:');
    console.log('Para convertir tu usuario a gerente, ejecuta en la BD:');
    console.log("UPDATE usuarios SET tipo_usuario = 'gerente' WHERE nombre_usuario = 'TU_NOMBRE_USUARIO';");
    console.log('\n✅ Migración completada exitosamente!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error en la migración:', error);
    process.exit(1);
  }
}

migrate();
