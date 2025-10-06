// src/services/cotizaciones.service.js
const { ejecutarConReintento } = require('../database/db');

class CotizacionesService {
  /**
   * Guardar una cotización temporal (24 horas)
   */
  async guardarCotizacion(data) {
    const {
      contacto_id,
      numero_telefono,
      tipo, // 'PROMO' o 'PERSONALIZADA'
      promo_id = null,
      datos_cotizacion,
      imagen_url = null
    } = data;

    if (!numero_telefono || !tipo || !datos_cotizacion) {
      throw new Error('Faltan campos obligatorios: numero_telefono, tipo, datos_cotizacion');
    }

    const query = `
      INSERT INTO cotizaciones_temp
      (contacto_id, numero_telefono, tipo, promo_id, datos_cotizacion, imagen_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await ejecutarConReintento(query, [
      contacto_id || null,
      numero_telefono,
      tipo,
      promo_id,
      JSON.stringify(datos_cotizacion),
      imagen_url
    ]);

    return result.rows[0];
  }

  /**
   * Obtener cotizaciones de un contacto (solo no expiradas)
   */
  async getCotizacionesContacto(numero_telefono, limit = 10) {
    const query = `
      SELECT *
      FROM cotizaciones_temp
      WHERE numero_telefono = $1
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT $2
    `;

    const result = await ejecutarConReintento(query, [numero_telefono, limit]);

    return result.rows.map(row => ({
      ...row,
      datos_cotizacion: typeof row.datos_cotizacion === 'string'
        ? JSON.parse(row.datos_cotizacion)
        : row.datos_cotizacion
    }));
  }

  /**
   * Obtener una cotización por ID
   */
  async getCotizacion(id) {
    const query = `
      SELECT *
      FROM cotizaciones_temp
      WHERE id = $1
        AND expires_at > NOW()
    `;

    const result = await ejecutarConReintento(query, [id]);

    if (!result.rows.length) {
      throw new Error('Cotización no encontrada o expirada');
    }

    const row = result.rows[0];
    return {
      ...row,
      datos_cotizacion: typeof row.datos_cotizacion === 'string'
        ? JSON.parse(row.datos_cotizacion)
        : row.datos_cotizacion
    };
  }

  /**
   * Eliminar cotizaciones expiradas (llamado por job)
   */
  async limpiarExpiradas() {
    const query = `
      DELETE FROM cotizaciones_temp
      WHERE expires_at <= NOW()
      RETURNING id
    `;

    const result = await ejecutarConReintento(query);
    const eliminadas = result.rows.length;

    console.log(`🗑️  Cotizaciones eliminadas (expiradas): ${eliminadas}`);

    return { eliminadas };
  }

  /**
   * Eliminar todas las cotizaciones de un contacto
   */
  async eliminarCotizacionesContacto(numero_telefono) {
    const query = `
      DELETE FROM cotizaciones_temp
      WHERE numero_telefono = $1
      RETURNING id
    `;

    const result = await ejecutarConReintento(query, [numero_telefono]);
    return { eliminadas: result.rows.length };
  }

  /**
   * Obtener estadísticas de cotizaciones
   */
  async getEstadisticas() {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN tipo = 'PROMO' THEN 1 END) as promos,
        COUNT(CASE WHEN tipo = 'PERSONALIZADA' THEN 1 END) as personalizadas,
        COUNT(CASE WHEN expires_at <= NOW() THEN 1 END) as expiradas,
        COUNT(CASE WHEN expires_at > NOW() THEN 1 END) as activas
      FROM cotizaciones_temp
    `;

    const result = await ejecutarConReintento(query);
    return result.rows[0];
  }
}

module.exports = new CotizacionesService();
