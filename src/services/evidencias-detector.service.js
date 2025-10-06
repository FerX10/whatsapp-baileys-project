// src/services/evidencias-detector.service.js
const pagosService = require('./pagos.service');
const { ejecutarConReintento } = require('../database/db');

class EvidenciasDetectorService {
  /**
   * Detecta si un mensaje con imagen podría ser una evidencia de pago
   */
  async detectarEvidenciaPago(phoneNumber, mediaUrl, mensaje = '') {
    try {
      // 1. Buscar reservas activas del cliente
      const qReservas = `
        SELECT r.id, r.estado, r.destino,
               (SELECT COALESCE(SUM(ri.precio_cliente),0) FROM reservas_items ri WHERE ri.reserva_id = r.id) AS total_cliente,
               (SELECT COALESCE(SUM(pc.monto),0) FROM pagos_clientes pc WHERE pc.reserva_id = r.id AND pc.estado='CONFIRMADO') AS cobrado
        FROM reservas r
        JOIN contactos c ON c.id = r.contacto_id
        WHERE c.numero_telefono = $1
          AND r.estado IN ('COTIZADA', 'APARTADA', 'CONFIRMADA')
        ORDER BY r.created_at DESC
        LIMIT 3
      `;

      const resReservas = await ejecutarConReintento(qReservas, [phoneNumber]);

      if (!resReservas.rows.length) {
        return null; // No hay reservas activas
      }

      // 2. Palabras clave que sugieren un pago
      const palabrasClave = [
        'pago', 'deposito', 'transferencia', 'comprobante',
        'ficha', 'recibo', 'anticipo', 'abono', 'ticket',
        'pague', 'pagué', 'deposité', 'transferí'
      ];

      const mensajeNormalizado = mensaje.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const esPosibleEvidencia = palabrasClave.some(palabra => mensajeNormalizado.includes(palabra));

      if (!esPosibleEvidencia && !mediaUrl) {
        return null; // No parece ser evidencia
      }

      // 3. Obtener la reserva con saldo pendiente
      const reserva = resReservas.rows.find(r => {
        const saldo = Number(r.total_cliente) - Number(r.cobrado);
        return saldo > 0;
      }) || resReservas.rows[0];

      // 4. Extraer monto del mensaje (si menciona cantidad)
      const monto = this.extraerMonto(mensaje);

      return {
        reserva_id: reserva.id,
        monto: monto || null,
        evidencia_url: mediaUrl,
        mensaje_original: mensaje,
        confianza: esPosibleEvidencia && mediaUrl ? 'ALTA' : mediaUrl ? 'MEDIA' : 'BAJA'
      };
    } catch (error) {
      console.error('Error al detectar evidencia de pago:', error);
      return null;
    }
  }

  /**
   * Extrae monto de un mensaje de texto
   */
  extraerMonto(mensaje) {
    if (!mensaje) return null;

    // Patrones para detectar montos
    const patrones = [
      /(?:por|de|son|total|monto)?\s*\$?\s*([\d,]+\.?\d*)/i, // $1,234.56 o 1234
      /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:pesos|mxn|mx)?/i // 1,234.56 pesos
    ];

    for (const patron of patrones) {
      const match = mensaje.match(patron);
      if (match && match[1]) {
        const montoStr = match[1].replace(/,/g, '');
        const monto = parseFloat(montoStr);

        if (!isNaN(monto) && monto > 0 && monto < 1000000) { // Validar rango razonable
          return monto;
        }
      }
    }

    return null;
  }

  /**
   * Procesa una evidencia detectada automáticamente
   */
  async procesarEvidenciaAutomatica(phoneNumber, evidencia, whatsappService) {
    try {
      // Crear pago pendiente
      const resultado = await pagosService.crearPagoCliente({
        reserva_id: evidencia.reserva_id,
        monto: evidencia.monto || 0, // Si no se detectó monto, poner 0 para que lo revisen
        evidencia_url: evidencia.evidencia_url,
        metodo_reportado: this.detectarMetodoPago(evidencia.mensaje_original)
      });

      // Notificar al cliente
      let respuesta = `✅ Recibimos tu comprobante de pago.\n\n`;

      if (evidencia.monto) {
        respuesta += `💰 Monto detectado: $${evidencia.monto.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN\n`;
      } else {
        respuesta += `⚠️ No pudimos detectar el monto automáticamente.\n`;
      }

      respuesta += `\nTu pago está siendo verificado por nuestro equipo.\n`;
      respuesta += `Te notificaremos cuando sea confirmado.\n\n`;
      respuesta += `📋 Reserva: #${evidencia.reserva_id}\n`;
      respuesta += `🔖 ID de pago: #${resultado.pago_id}`;

      if (whatsappService) {
        await whatsappService.sendMessage(
          phoneNumber,
          respuesta,
          null,
          null,
          null,
          { nombre_usuario: 'Sistema de Pagos' }
        );
      }

      // Notificar a CAJA/ADMIN por Socket.IO (opcional)
      // io.emit('nuevo-pago-pendiente', { pago_id: resultado.pago_id, reserva_id: evidencia.reserva_id });

      return resultado;
    } catch (error) {
      console.error('Error al procesar evidencia automática:', error);

      if (whatsappService) {
        await whatsappService.sendMessage(
          phoneNumber,
          '❌ Hubo un error al procesar tu comprobante. Por favor, contacta con un asesor.',
          null,
          null,
          null,
          { nombre_usuario: 'Sistema' }
        );
      }

      return null;
    }
  }

  /**
   * Detecta método de pago del mensaje
   */
  detectarMetodoPago(mensaje) {
    const mensajeNorm = mensaje.toLowerCase();

    if (mensajeNorm.includes('transferencia') || mensajeNorm.includes('transferi')) {
      return 'TRANSFERENCIA';
    }
    if (mensajeNorm.includes('deposito') || mensajeNorm.includes('efectivo')) {
      return 'EFECTIVO';
    }
    if (mensajeNorm.includes('tarjeta') || mensajeNorm.includes('card')) {
      return 'TARJETA';
    }

    return null;
  }
}

module.exports = new EvidenciasDetectorService();
