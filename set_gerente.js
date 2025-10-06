// set_gerente.js - Script para convertir un usuario a gerente
require('dotenv').config();
const { ejecutarConReintento } = require('./src/database/db');

async function setGerente() {
  try {
    const nombreUsuario = process.argv[2] || 'admin';

    console.log(`🔧 Convirtiendo '${nombreUsuario}' a gerente...\n`);

    const result = await ejecutarConReintento(
      `UPDATE usuarios
       SET tipo_usuario = 'gerente'
       WHERE nombre_usuario = $1
       RETURNING id, nombre_usuario, tipo_usuario`,
      [nombreUsuario]
    );

    if (result.rows.length === 0) {
      console.log(`❌ No se encontró el usuario '${nombreUsuario}'`);
      process.exit(1);
    }

    console.log('✅ Usuario actualizado exitosamente:');
    console.table(result.rows);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setGerente();
