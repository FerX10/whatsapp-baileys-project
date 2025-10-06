// src/jobs/recordatorios.job.js
const pagosService = require('../services/pagos.service');

class RecordatoriosJob {
  constructor(whatsappService) {
    this.whatsappService = whatsappService;
    this.intervals = [];
  }

  /**
   * Inicia todos los jobs programados
   */
  iniciar() {
    console.log('📅 Iniciando jobs de recordatorios...');

    // Job: Recordatorio -2 días (cada día a las 10:00 AM)
    this.scheduleDaily('10:00', () => this.recordatorioMenosDos());

    // Job: Recordatorio -1 día (cada día a las 16:00 PM)
    this.scheduleDaily('16:00', () => this.recordatorioMenosUno());

    // Job: Recordatorio día límite (cada día a las 09:00 AM)
    this.scheduleDaily('09:00', () => this.recordatorioDiaLimite());

    // Job: Marcar vencidas (cada día a las 00:05 AM)
    this.scheduleDaily('00:05', () => this.marcarCuotasVencidas());

    // Job: Recordatorio vencidas (cada día a las 18:00 PM)
    this.scheduleDaily('18:00', () => this.recordatorioVencidas());

    console.log('✅ Jobs de recordatorios iniciados');
  }

  /**
   * Detiene todos los jobs
   */
  detener() {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    console.log('🛑 Jobs de recordatorios detenidos');
  }

  /**
   * Programa una tarea diaria a una hora específica
   */
  scheduleDaily(time, task) {
    const [hour, minute] = time.split(':').map(Number);

    const runTask = () => {
      const now = new Date();
      if (now.getHours() === hour && now.getMinutes() === minute) {
        task();
      }
    };

    // Ejecutar cada minuto y verificar si es la hora
    const interval = setInterval(runTask, 60000);
    this.intervals.push(interval);

    console.log(`⏰ Job programado para las ${time}`);
  }

  /**
   * Recordatorio para cuotas que vencen en 2 días
   */
  async recordatorioMenosDos() {
    console.log('🔔 Ejecutando recordatorio -2 días...');

    try {
      const cuotas = await pagosService.getCuotasProximasVencer(2);

      for (const cuota of cuotas) {
        const mensaje = this.generarMensajeRecordatorio(cuota, 2);
        await this.enviarRecordatorio(cuota.cliente_telefono, mensaje);
      }

      console.log(`✅ Recordatorios -2 días enviados: ${cuotas.length}`);
    } catch (error) {
      console.error('❌ Error en recordatorio -2 días:', error);
    }
  }

  /**
   * Recordatorio para cuotas que vencen mañana
   */
  async recordatorioMenosUno() {
    console.log('🔔 Ejecutando recordatorio -1 día...');

    try {
      const cuotas = await pagosService.getCuotasProximasVencer(1);

      for (const cuota of cuotas) {
        const mensaje = this.generarMensajeRecordatorio(cuota, 1);
        await this.enviarRecordatorio(cuota.cliente_telefono, mensaje);
      }

      console.log(`✅ Recordatorios -1 día enviados: ${cuotas.length}`);
    } catch (error) {
      console.error('❌ Error en recordatorio -1 día:', error);
    }
  }

  /**
   * Recordatorio para cuotas que vencen HOY
   */
  async recordatorioDiaLimite() {
    console.log('🔔 Ejecutando recordatorio día límite...');

    try {
      const cuotas = await pagosService.getCuotasProximasVencer(0);

      for (const cuota of cuotas) {
        const mensaje = this.generarMensajeRecordatorio(cuota, 0);
        await this.enviarRecordatorio(cuota.cliente_telefono, mensaje);
      }

      console.log(`✅ Recordatorios día límite enviados: ${cuotas.length}`);
    } catch (error) {
      console.error('❌ Error en recordatorio día límite:', error);
    }
  }

  /**
   * Recordatorio para cuotas vencidas
   */
  async recordatorioVencidas() {
    console.log('🔔 Ejecutando recordatorio de vencidas...');

    try {
      const cuotas = await pagosService.getCuotasProximasVencer(-1); // Vencidas

      for (const cuota of cuotas) {
        const mensaje = this.generarMensajeVencida(cuota);
        await this.enviarRecordatorio(cuota.cliente_telefono, mensaje);
      }

      console.log(`✅ Recordatorios de vencidas enviados: ${cuotas.length}`);
    } catch (error) {
      console.error('❌ Error en recordatorio de vencidas:', error);
    }
  }

  /**
   * Marca cuotas vencidas automáticamente
   */
  async marcarCuotasVencidas() {
    console.log('🔄 Marcando cuotas vencidas...');

    try {
      const count = await pagosService.marcarCuotasVencidas();
      console.log(`✅ Cuotas marcadas como vencidas: ${count}`);
    } catch (error) {
      console.error('❌ Error al marcar cuotas vencidas:', error);
    }
  }

  /**
   * Genera mensaje de recordatorio
   */
  generarMensajeRecordatorio(cuota, diasRestantes) {
    const monto = Number(cuota.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    const fecha = new Date(cuota.fecha_limite).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });

    let mensaje = `🏖️ *Recordatorio de Pago - Izland Tours*\n\n`;
    mensaje += `Hola ${cuota.cliente_nombre || 'estimado cliente'},\n\n`;

    if (diasRestantes === 2) {
      mensaje += `Te recordamos que en *2 días* vence tu cuota #${cuota.numero}.\n\n`;
    } else if (diasRestantes === 1) {
      mensaje += `⚠️ Te recordamos que *mañana* vence tu cuota #${cuota.numero}.\n\n`;
    } else if (diasRestantes === 0) {
      mensaje += `🚨 *HOY* es el último día para pagar tu cuota #${cuota.numero}.\n\n`;
    }

    mensaje += `📋 *Detalles:*\n`;
    mensaje += `• Reserva: #${cuota.reserva_id} - ${cuota.destino}\n`;
    mensaje += `• Cuota: #${cuota.numero}\n`;
    mensaje += `• Monto: $${monto} MXN\n`;
    mensaje += `• Fecha límite: ${fecha}\n\n`;

    mensaje += `💰 *Métodos de pago disponibles:*\n`;
    mensaje += `• Transferencia bancaria\n`;
    mensaje += `• Depósito en efectivo\n`;
    mensaje += `• Tarjeta (con recargo)\n\n`;

    mensaje += `📸 Envíanos tu comprobante por este chat.\n\n`;
    mensaje += `¿Alguna duda? Estamos para ayudarte 😊`;

    return mensaje;
  }

  /**
   * Genera mensaje para cuotas vencidas
   */
  generarMensajeVencida(cuota) {
    const monto = Number(cuota.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 });
    const fecha = new Date(cuota.fecha_limite).toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long'
    });

    let mensaje = `⚠️ *Pago Vencido - Izland Tours*\n\n`;
    mensaje += `Hola ${cuota.cliente_nombre || 'estimado cliente'},\n\n`;
    mensaje += `Notamos que tu cuota #${cuota.numero} venció el ${fecha}.\n\n`;

    mensaje += `📋 *Detalles:*\n`;
    mensaje += `• Reserva: #${cuota.reserva_id} - ${cuota.destino}\n`;
    mensaje += `• Monto: $${monto} MXN\n\n`;

    mensaje += `Te pedimos que te pongas al corriente a la brevedad para mantener tu reserva activa.\n\n`;
    mensaje += `Contáctanos para confirmar tu pago o revisar opciones.\n\n`;
    mensaje += `Gracias por tu comprensión 🙏`;

    return mensaje;
  }

  /**
   * Envía recordatorio por WhatsApp
   */
  async enviarRecordatorio(telefono, mensaje) {
    if (!this.whatsappService || !telefono) {
      console.warn('⚠️ No se puede enviar recordatorio: servicio o teléfono faltante');
      return;
    }

    try {
      // Limpiar número de teléfono
      const phoneNumber = telefono.replace(/\D/g, '');

      await this.whatsappService.sendMessage(
        phoneNumber,
        mensaje,
        null, // sin media
        null, // sin tipo
        null, // sin filename
        { nombre_usuario: 'Sistema Recordatorios' }
      );

      console.log(`✅ Recordatorio enviado a ${phoneNumber}`);
    } catch (error) {
      console.error(`❌ Error al enviar recordatorio a ${telefono}:`, error.message);
    }
  }
}

module.exports = RecordatoriosJob;
