// resetDB.js
const { pool } = require('./src/database/db');

async function resetDatabase() {
  const client = await pool.connect();
  try {
    // Iniciar transacción para garantizar atomicidad
    await client.query('BEGIN');

    // Ejecutamos TRUNCATE en las tablas que deseamos limpiar (excluyendo usuarios)
    // Si existen relaciones entre tablas, usamos CASCADE para borrar también las dependencias.
    await client.query(`
      TRUNCATE TABLE 
        archivos_multimedia,
        chat_etiquetas,
        mensajes_programados,
        notas_internas,
        mensajes,
        assistant_status,
        chat_assignments,
        etiquetas,
        contactos,
        whatsapp_sessions
      CASCADE;
    `);

    // Confirmamos la transacción
    await client.query('COMMIT');
    console.log('La base de datos se ha reiniciado (los datos de las tablas se han borrado, excepto los usuarios).');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al reiniciar la base de datos:', error);
  } finally {
    client.release();
    process.exit();
  }
}

resetDatabase();
