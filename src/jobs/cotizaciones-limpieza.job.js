// src/jobs/cotizaciones-limpieza.job.js
const cotizacionesService = require('../services/cotizaciones.service');

class CotizacionesLimpiezaJob {
  constructor() {
    this.interval = null;
  }

  /**
   * Iniciar el job (se ejecuta cada hora)
   */
  iniciar() {
    console.log('🧹 Iniciando job de limpieza de cotizaciones...');

    // Ejecutar inmediatamente
    this.ejecutar();

    // Ejecutar cada hora
    this.interval = setInterval(() => {
      this.ejecutar();
    }, 60 * 60 * 1000); // 1 hora

    console.log('✅ Job de limpieza de cotizaciones iniciado (cada 1 hora)');
  }

  /**
   * Ejecutar limpieza
   */
  async ejecutar() {
    try {
      const resultado = await cotizacionesService.limpiarExpiradas();

      if (resultado.eliminadas > 0) {
        console.log(`🗑️  [${new Date().toISOString()}] Cotizaciones expiradas eliminadas: ${resultado.eliminadas}`);
      }
    } catch (err) {
      console.error('❌ Error en job de limpieza de cotizaciones:', err);
    }
  }

  /**
   * Detener el job
   */
  detener() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('🛑 Job de limpieza de cotizaciones detenido');
    }
  }
}

module.exports = CotizacionesLimpiezaJob;
