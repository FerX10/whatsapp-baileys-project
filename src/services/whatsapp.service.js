// src/services/whatsapp.service.js
// -------------------------------------------------------------
// Servicio de WhatsApp (Baileys)
// - Debounce 9s por número con cola de mensajes
// - Dedupe robusto para evitar duplicados recientes
// - Descarga de media a /uploads
// - Envío de respuestas ricas (PROMOS_JSON y FICHA-COTI)
// - Integrado con OpenAIHandler (firma por objeto)
// -------------------------------------------------------------

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const path = require('path');
const fs = require('fs').promises;
const qrcode = require('qrcode');
const FichaCotiProcessor = require('./ficha-coti-processor');

const {
  insertarMensajeEnDB,
  ejecutarConReintento,
  checkIfBlocked
} = require('../database/db');

class WhatsAppService {
  constructor(io, openAIHandler) {
    this.io = io;
    this.openAIHandler = openAIHandler;

    this.sock = null;
    this.ready = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    this.AUTH_FOLDER = process.env.AUTH_FOLDER || 'auth_info_baileys';
    this.logger = pino({ level: 'silent' });

    this.pendingTimers = {};         // timers por número
    this.messageQueue = new Map();   // { phone: { messages:[], lastMessageTime, processing, userName } }
    this.WAIT_TIME = 35000;          // 35 segundos (para agrupar mensajes del usuario)
    this.fichaCotiProcessor = new FichaCotiProcessor(this);

    // Guardar último QR generado
    this.lastQR = null;
    this.lastQRTimestamp = null;
  }

  isReady() {
    return this.ready;
  }

  getLastQR() {
    // Solo devolver QR si tiene menos de 90 segundos
    if (this.lastQR && this.lastQRTimestamp) {
      const age = Date.now() - this.lastQRTimestamp;
      if (age < 90000) {
        return { qr: this.lastQR, timestamp: this.lastQRTimestamp };
      }
    }
    return null;
  }

  // -----------------------------------------------------------
  // Inicialización
  // -----------------------------------------------------------
  async initialize() {
    try {
      console.log('Iniciando servicio de WhatsApp...');

      // En producción, limpiar sesión corrupta automáticamente
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd) {
        const fs = require('fs');
        const path = require('path');
        const authPath = path.join(process.cwd(), this.AUTH_FOLDER);

        // Solo limpiar si existe y tiene credenciales corruptas
        if (fs.existsSync(authPath)) {
          try {
            const credsFile = path.join(authPath, 'creds.json');
            if (fs.existsSync(credsFile)) {
              const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
              // Si hay credenciales pero está deslogueado, limpiar
              if (creds && !creds.me) {
                console.log('⚠️ Limpiando sesión corrupta...');
                fs.rmSync(authPath, { recursive: true, force: true });
              }
            }
          } catch (e) {
            console.log('⚠️ Error verificando credenciales, limpiando sesión...');
            fs.rmSync(authPath, { recursive: true, force: true });
          }
        }
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.AUTH_FOLDER);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: this.logger,
        browser: ['Chrome (Linux)', '', ''],
        version,
        connectTimeoutMs: 60000,
        qrTimeout: 90000, // 90 segundos para el QR
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 5000
      });

      // Estados de conexión
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const qrDataURL = await qrcode.toDataURL(qr);
          const timestamp = Date.now();

          // Guardar último QR
          this.lastQR = qrDataURL;
          this.lastQRTimestamp = timestamp;

          console.log('📱 Nuevo QR generado');
          console.log('📡 Emitiendo evento whatsappQR via Socket.IO...');

          // Emitir a todos los clientes conectados
          this.io.emit('whatsappQR', { qr: qrDataURL, timestamp });

          console.log('✅ Evento whatsappQR emitido correctamente');
          console.log(`👥 Clientes conectados: ${this.io.engine.clientsCount}`);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (statusCode === DisconnectReason.loggedOut) {
            console.log('⚠️ Sesión cerrada (logged out). Limpiando credenciales...');
            this.ready = false;
            // Limpiar credenciales corruptas
            const fs = require('fs');
            const path = require('path');
            const authPath = path.join(process.cwd(), this.AUTH_FOLDER);
            if (fs.existsSync(authPath)) {
              try {
                fs.rmSync(authPath, { recursive: true, force: true });
                console.log('✅ Credenciales eliminadas. Reiniciando para generar nuevo QR...');
              } catch (e) {
                console.error('Error eliminando credenciales:', e);
              }
            }
            // Reintentar una vez con sesión limpia
            if (this.reconnectAttempts === 0) {
              this.reconnectAttempts++;
              await new Promise((res) => setTimeout(res, 2000));
              await this.initialize();
            }
            return;
          }
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Intento de reconexión ${this.reconnectAttempts}...`);
            await new Promise((res) => setTimeout(res, Math.min(5000 * this.reconnectAttempts, 30000)));
            await this.initialize();
          } else {
            console.log('Máximo de intentos alcanzado. Reinicio manual requerido.');
          }
        }

        if (connection === 'open') {
          console.log('Conectado a WhatsApp');
          this.ready = true;
          this.reconnectAttempts = 0;
        }
      });

      // Mensajes entrantes
      this.sock.ev.on('messages.upsert', async (baileysData) => {
        try {
          console.log('Mensaje entrante (crudo) recibido:', baileysData);
          if (!['notify', 'append'].includes(baileysData.type)) return;

          for (const msgObj of baileysData.messages) {
            try {
              if (!msgObj.message) continue;

              // Ignorar mensajes enviados por nosotros
              if (msgObj.key.fromMe) {
                console.log('Mensaje omitido (enviado por el bot):', msgObj.key.id);
                continue;
              }

              const remoteJid = msgObj.key.remoteJid || '';

              // Ignorar grupos / broadcast
              if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) {
                console.log('Se ignora mensaje de grupo/difusión:', remoteJid);
                continue;
              }

              const phoneNumber = remoteJid.replace('@s.whatsapp.net', '');

              // Bloqueados
              const isBlocked = await checkIfBlocked(phoneNumber);
              if (isBlocked) {
                console.log(`El número ${phoneNumber} está bloqueado. Se ignora.`);
                continue;
              }

              // Parsear contenido
              let text = '';
              let fileUrl = null;
              let fileName = null;
              let fileType = null;

              if (msgObj.message.conversation) {
                text = msgObj.message.conversation;
              } else if (msgObj.message.extendedTextMessage?.text) {
                text = msgObj.message.extendedTextMessage.text;
              } else if (msgObj.message.imageMessage) {
                text = msgObj.message.imageMessage.caption || '[Imagen sin caption]';
                fileUrl = await this.downloadMedia(msgObj.message.imageMessage, 'image');
                fileType = 'image';
              } else if (msgObj.message.videoMessage) {
                text = msgObj.message.videoMessage.caption || '[Video sin caption]';
                fileUrl = await this.downloadMedia(msgObj.message.videoMessage, 'video');
                fileType = 'video';
              } else if (msgObj.message.documentMessage) {
                text = msgObj.message.documentMessage.caption || '[Documento]';
                fileName = msgObj.message.documentMessage.fileName || 'archivo';
                fileUrl = await this.downloadMedia(msgObj.message.documentMessage, 'document');
                fileType = 'document';
              } else if (msgObj.message.audioMessage) {
                text = '[Audio sin texto]';
                fileUrl = await this.downloadMedia(msgObj.message.audioMessage, 'audio');
                fileType = 'audio';
              } else {
                text = '[Mensaje sin texto o no soportado]';
              }

              const timestamp = Number(msgObj.messageTimestamp || 0) * 1000;

              // Detectar evidencia de pago automáticamente
              if (fileType === 'image' && fileUrl) {
                try {
                  const evidenciasDetector = require('./evidencias-detector.service');
                  const evidencia = await evidenciasDetector.detectarEvidenciaPago(phoneNumber, fileUrl, text);

                  if (evidencia && evidencia.confianza !== 'BAJA') {
                    console.log(`📸 Evidencia de pago detectada para ${phoneNumber}:`, evidencia);
                    await evidenciasDetector.procesarEvidenciaAutomatica(phoneNumber, evidencia, this);
                  }
                } catch (errEvidencia) {
                  console.error('Error al detectar evidencia de pago:', errEvidencia);
                }
              }

              // Guardar entrante
              const parsedMsg = {
                phoneNumber,
                message: text,
                timestamp,
                sender_type: 'received',
                pushName: msgObj.pushName || '',
                broadcast: !!msgObj.broadcast,
                url_archivo: fileUrl || null,
                nombre_archivo: fileName || null,
                tipo_contenido: fileType || null
              };
              await insertarMensajeEnDB(parsedMsg);

              // Emitir a frontend
              this.io.emit('newMessage', parsedMsg);
              this.io.emit('chatListUpdated', { success: true, phoneNumber });

              // Upsert assistant_status activo por defecto
              const upsertQuery = `
                INSERT INTO assistant_status (numero_telefono, active)
                VALUES ($1, TRUE)
                ON CONFLICT (numero_telefono) DO NOTHING;
              `;
              await ejecutarConReintento(upsertQuery, [phoneNumber]);

              // Guardar/actualizar nombre del contacto
              const userNameFromWhatsApp = msgObj.pushName || '';
              if (userNameFromWhatsApp) {
                const updateNameQuery = `
                  INSERT INTO contactos (numero_telefono, nombre)
                  VALUES ($1, $2)
                  ON CONFLICT (numero_telefono)
                  DO UPDATE SET nombre = EXCLUDED.nombre
                  WHERE contactos.nombre IS NULL OR contactos.nombre = '';
                `;
                try {
                  await ejecutarConReintento(updateNameQuery, [phoneNumber, userNameFromWhatsApp]);
                  console.log(`Nombre actualizado para ${phoneNumber}: ${userNameFromWhatsApp}`);
                } catch (error) {
                  console.error('Error actualizando nombre del contacto:', error);
                }
              }

              // ¿Asistente activo?
              const checkQuery = `SELECT active FROM assistant_status WHERE numero_telefono = $1;`;
              const result = await ejecutarConReintento(checkQuery, [phoneNumber]);

              if (result.rows.length === 0 || result.rows[0].active) {
                this.scheduleAssistantResponse(phoneNumber, userNameFromWhatsApp);
              } else {
                console.log('Asistente inactivo. No se procesó IA.');
              }
            } catch (errMsg) {
              console.error('Error procesando mensaje individual:', errMsg);
            }
          }
        } catch (error) {
          console.error('Error global en messages.upsert:', error);
        }
      });

      this.sock.ev.on('creds.update', saveCreds);
      console.log('Servicio de WhatsApp inicializado correctamente');
      return true;

    } catch (error) {
      console.error('Error al inicializar WhatsApp:', error);
      return false;
    }
  }

  // -----------------------------------------------------------
  // Envío de mensajes
  // -----------------------------------------------------------
  /**
   * Envía un mensaje (texto o media) y lo guarda en DB.
   * Para evitar duplicados, se hace un DEDUPE corto por contenido/url.
   *
   * options:
   *  - nombre_usuario: 'Asistente' (default) o el agente (envíos desde UI)
   *  - dedupeWindowSec: ventana en segundos (default 5s)
   */
  async sendMessage(
    phoneNumber,
    text,
    mediaUrl = null,
    mediaType = null,
    fileName = null,
    options = {}
  ) {
    if (!this.sock || !this.ready) throw new Error('Servicio de WhatsApp no está listo');

    const nombreUsuario = options.nombre_usuario || 'Asistente';
    const dedupeWindowSec = Number.isFinite(options.dedupeWindowSec) ? options.dedupeWindowSec : 5;

    // DEDUPE (solamente comprobación; no interrumpe si falla)
    try {
      const dedupeSql = `
        SELECT id
        FROM mensajes
        WHERE numero_telefono = $1
          AND tipo_remitente = 'sent'
          AND (
               ( ($2)::text IS NOT NULL AND mensaje = ($2)::text )
            OR ( ($3)::text IS NOT NULL AND url_archivo = ($3)::text )
          )
          AND fecha_hora >= NOW() - INTERVAL '${dedupeWindowSec} seconds'
        ORDER BY fecha_hora DESC
        LIMIT 1
      `;
      const dRes = await ejecutarConReintento(dedupeSql, [
        phoneNumber,
        text || null,
        mediaUrl || null
      ]);
      if (dRes.rows.length > 0) {
        console.log('Dedupe: mensaje idéntico reciente, se omite reenvío.');
        return;
      }
    } catch (e) {
      console.warn('Aviso dedupe (no crítico):', e.message);
    }

    const jid = `${phoneNumber}@s.whatsapp.net`;
    const safeText = this.sanitizeCtrl(text || '');
console.log(`Enviando mensaje a ${jid}: "${safeText}"`);

    let message;
if (mediaUrl && mediaType) {
  if (mediaType === 'image') {
    message = { image: { url: mediaUrl }, caption: safeText };
  } else if (mediaType === 'video') {
    message = { video: { url: mediaUrl }, caption: safeText };
  } else if (mediaType === 'audio') {
    message = { audio: { url: mediaUrl }, mimetype: 'audio/ogg' };
  } else if (mediaType === 'document') {
    message = {
      document: { url: mediaUrl, fileName: fileName || 'archivo.pdf', mimetype: 'application/pdf' },
      caption: safeText
    };
  } else {
    message = { text: safeText };
  }
} else {
  message = { text: safeText };
}

    await this.sock.sendMessage(jid, message);

    // Guardar saliente (DB)
    const parsedMsg = {
      phoneNumber,
      message: text || '',
      timestamp: Date.now(),
      sender_type: 'sent',
      nombre_usuario: nombreUsuario,
      url_archivo: mediaUrl || null,
      nombre_archivo: fileName || null,
      tipo_contenido: mediaType || (mediaUrl ? 'document' : null)
    };

    try {
      await insertarMensajeEnDB(parsedMsg);
    } catch (e) {
      console.error('Error guardando mensaje saliente en DB:', e);
    }

    // Emitir a frontend
    this.io.emit('newMessage', parsedMsg);
    this.io.emit('chatListUpdated', { success: true, phoneNumber });
  }

  /**
   * Envío desde UI (unifica el punto de guardado/emisión)
   */
  async sendUserMessageFromUI(phoneNumber, text, userName, mediaUrl = null, mediaType = null, fileName = null) {
    return this.sendMessage(phoneNumber, text, mediaUrl, mediaType, fileName, {
      nombre_usuario: userName || 'Usuario'
    });
  }

  // -----------------------------------------------------------
  // Descarga de media
  // -----------------------------------------------------------
  async downloadMedia(mediaMessage, type) {
    try {
      const stream = await downloadContentFromMessage(mediaMessage, type);
      let buffer = Buffer.from([]);

      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }

      if (!buffer || !buffer.length) return null;

      const extension = type === 'image' ? 'jpg'
        : type === 'video' ? 'mp4'
          : type === 'audio' ? 'ogg'
            : 'pdf';

      const uniqueName = `${Date.now()}-${Math.floor(Math.random() * 1000)}.${extension}`;
      const filePath = path.join(process.cwd(), 'uploads', uniqueName);
      await fs.writeFile(filePath, buffer);

      return `${process.env.BASE_URL || 'http://localhost:3000'}/uploads/${uniqueName}`;
    } catch (error) {
      console.error('Error descargando el medio:', error);
      return null;
    }
  }

  // -----------------------------------------------------------
  // Envío “rico”: PROMOS_JSON + FICHA-COTI
  // -----------------------------------------------------------
  sanitizeCtrl(text) {
    if (typeof text !== 'string') return '';

    let out = String(text);

    // 1) Remueve el bloque de control interno (con o sin etiquetas)
    out = out.replace(/<ctrl>[\s\S]*?<\/ctrl>/gi, '');

    // 2) Si OpenAI devolvió el bloque como texto plano (sin etiquetas)
    //    Buscar patrón: <ctrl>{ o solo el JSON visible
    //    Filtrar desde donde empieza el objeto JSON de control hasta el final
    const ctrlPlainMatch = out.match(/\n<ctrl>\s*\{[\s\S]*$/);
    if (ctrlPlainMatch) {
      out = out.substring(0, ctrlPlainMatch.index).trim();
    }

    // 3) Remueve etiquetas sueltas que el LLM pudiera escupir
    //    (evita que el cliente vea "<suggested_tags>Frio</suggested_tags>", etc.)
    out = out.replace(/<suggested_tags>[\s\S]*?<\/suggested_tags>/gi, '');
    out = out.replace(/<(?:meta|tag|tags?|data|debug)\b[^>]*>[\s\S]*?<\/(?:meta|tag|tags?|data|debug)>/gi, '');
    out = out.replace(/<\/?(?:meta|tag|tags?|data|debug)\b[^>]*>/gi, '');

    // 4) Limpieza visual
    out = out.replace(/\n{3,}/g, '\n\n').trim();

    return out;
  }


  extractFicha(texto) {
    if (typeof texto !== 'string') {
      return { limpio: texto, tieneFicha: false, fichaId: null, payload: null };
    }
    const KEY = 'FICHA-COTI#';
    const idx = texto.indexOf(KEY);
    if (idx === -1) {
      return { limpio: texto, tieneFicha: false, fichaId: null, payload: null };
    }

    const idMatch = texto.slice(idx).match(/^FICHA-COTI#(\d+)/);
    const fichaId = idMatch ? idMatch[1] : null;

    let payload = null;
    const datosIdx = texto.search(/Datos\s*\(no enviar al cliente\)\s*:/i);
    if (datosIdx !== -1) {
      const tail = texto.slice(datosIdx);
      const start = tail.indexOf('{');
      const end = tail.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try { payload = JSON.parse(tail.slice(start, end + 1)); } catch { payload = null; }
      }
    }

    let limpio = texto.replace(/⛭[^\n]*FICHA-COTI#[^\n]*\n?/g, '');
    limpio = limpio.replace(/Datos\s*\(no enviar al cliente\)\s*:[\s\S]*$/i, '').trim();

    return { limpio, tieneFicha: true, fichaId, payload };
  }

  extractConsultaReserva(texto) {
    if (typeof texto !== 'string') {
      return { limpio: texto, tieneConsulta: false };
    }

    const KEY = 'CONSULTA-RESERVA';
    const idx = texto.indexOf(KEY);

    if (idx === -1) {
      return { limpio: texto, tieneConsulta: false };
    }

    // Remover el marcador del texto visible
    const limpio = texto.replace(/CONSULTA-RESERVA/g, '').trim();

    return { limpio, tieneConsulta: true };
  }

  async procesarConsultaReserva(phoneNumber) {
    try {
      const { ejecutarConReintento } = require('../database/db');

      // Buscar reservas activas del cliente
      const qReservas = `
        SELECT r.id, r.estado, r.destino, r.check_in, r.check_out,
               (SELECT COALESCE(SUM(ri.precio_cliente),0) FROM reservas_items ri WHERE ri.reserva_id = r.id) AS total_cliente,
               (SELECT COALESCE(SUM(pc.monto),0) FROM pagos_clientes pc WHERE pc.reserva_id = r.id AND pc.estado='CONFIRMADO') AS cobrado
        FROM reservas r
        JOIN contactos c ON c.id = r.contacto_id
        WHERE c.numero_telefono = $1
          AND r.estado IN ('COTIZADA', 'APARTADA', 'CONFIRMADA', 'LIQUIDADA')
        ORDER BY r.created_at DESC
        LIMIT 3
      `;

      const resReservas = await ejecutarConReintento(qReservas, [phoneNumber]);

      if (!resReservas.rows.length) {
        await this.sendMessage(
          phoneNumber,
          'No encontré reservas activas a tu nombre. ¿Necesitas hacer una nueva cotización? 😊'
        );
        return;
      }

      // Construir respuesta con información de reservas
      let mensaje = '📋 *Tus Reservas Activas:*\n\n';

      for (const reserva of resReservas.rows) {
        const total = Number(reserva.total_cliente);
        const cobrado = Number(reserva.cobrado);
        const saldo = total - cobrado;

        mensaje += `🏖️ *Reserva #${reserva.id}*\n`;
        mensaje += `• Destino: ${reserva.destino}\n`;
        mensaje += `• Estado: ${reserva.estado}\n`;

        if (reserva.check_in) {
          mensaje += `• Check-in: ${new Date(reserva.check_in).toLocaleDateString('es-MX')}\n`;
        }

        mensaje += `• Total: $${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN\n`;
        mensaje += `• Pagado: $${cobrado.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN\n`;
        mensaje += `• Saldo: $${saldo.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN\n`;

        // Obtener próxima cuota
        if (saldo > 0) {
          const qCuota = `
            SELECT cc.numero, cc.fecha_limite, cc.monto
            FROM planes_pago_cliente p
            JOIN cuotas_cliente cc ON cc.plan_id = p.id
            WHERE p.reserva_id = $1 AND cc.estado='PENDIENTE'
            ORDER BY cc.numero ASC
            LIMIT 1
          `;

          const resCuota = await ejecutarConReintento(qCuota, [reserva.id]);

          if (resCuota.rows.length) {
            const cuota = resCuota.rows[0];
            const fecha = new Date(cuota.fecha_limite).toLocaleDateString('es-MX', {
              day: '2-digit',
              month: 'long'
            });

            mensaje += `\n💰 *Próxima cuota:*\n`;
            mensaje += `• Número: ${cuota.numero}\n`;
            mensaje += `• Monto: $${Number(cuota.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN\n`;
            mensaje += `• Fecha límite: ${fecha}\n`;
          }
        } else {
          mensaje += `\n✅ *Reserva LIQUIDADA*\n`;
        }

        mensaje += `\n`;
      }

      mensaje += `\n¿Necesitas más información? Estoy para ayudarte 😊`;

      await this.sendMessage(phoneNumber, mensaje);
    } catch (error) {
      console.error('Error al procesar consulta de reserva:', error);
      await this.sendMessage(
        phoneNumber,
        'Tuve un problema al consultar tus reservas. Por favor, contacta con un asesor.'
      );
    }
  }

  async sendRichAIResponse(phoneNumber, aiPayload) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const processOne = async (text) => {
      if (typeof text !== 'string') return;

      let visible = this.sanitizeCtrl(text);

      // —— PROMOS_GROUP (nuevo: imágenes → copy consolidado → detalles → seguimiento)
      const groupMarker = 'PROMOS_GROUP:';
      let group = null;
      {
        const gidx = visible.indexOf(groupMarker);
        if (gidx !== -1) {
          const gStr = visible.slice(gidx + groupMarker.length).trim();
          visible = visible.slice(0, gidx).trim();
          try { group = JSON.parse(gStr); } catch { group = null; }
        }
      }

      // PROMOS_JSON (legacy)
      const marker = 'PROMOS_JSON:';
      let promos = [];
      const idx = visible.indexOf(marker);
      if (idx !== -1) {
        const jsonStr = visible.slice(idx + marker.length).trim();
        visible = visible.slice(0, idx).trim();
        try { promos = JSON.parse(jsonStr); } catch { promos = []; }
      }

      // FICHA-COTI
      const fichaInfo = this.extractFicha(visible);
      visible = fichaInfo.limpio;

      if (fichaInfo.tieneFicha) {
        console.log('FICHA-COTI detectada', { phoneNumber, fichaId: fichaInfo.fichaId });
        this.fichaCotiProcessor.enqueue({
          phoneNumber,
          fichaId: fichaInfo.fichaId,
          payload: fichaInfo.payload
        });
      }

      // CONSULTA-RESERVA
      const consultaReservaInfo = this.extractConsultaReserva(visible);
      visible = consultaReservaInfo.limpio;

      if (consultaReservaInfo.tieneConsulta) {
        console.log('CONSULTA-RESERVA detectada', { phoneNumber });
        await this.procesarConsultaReserva(phoneNumber);
      }

      const hasPromos = Array.isArray(promos) && promos.length > 0;
      const hasGroup = !!group;

      // Si hay PROMOS_GROUP, mandamos ese flujo (imágenes → copy → detalles → seguimiento) y salimos
      // Si hay PROMOS_GROUP, mandamos (saludo visible si existe) → intro → imágenes → copy → detalles → seguimiento
      if (hasGroup) {
  // 0) Si el LLM dejó texto visible (saludo/preguntas), envíalo ANTES del intro
  if (visible) {
    await this.sendMessage(phoneNumber, visible);
    await sleep(300);
  }

  const intro = 'Te comparto opciones con imágenes y detalles 👇';
  await this.sendMessage(phoneNumber, intro);
  await sleep(300);

  // 1) IMÁGENES (hasta 3)
  try {
    const imgs = Array.isArray(group.images) ? group.images.slice(0, 3) : [];
    for (const rawUrl of imgs) {
      try {
        const url = this.toAbsoluteUrl(rawUrl);
        if (!url) continue;
        await this.sendMessage(phoneNumber, '', url, 'image');
        await sleep(450);
      } catch (e) {
        console.error('Error enviando imagen de PROMOS_GROUP:', e);
      }
    }
  } catch (e) {
    console.error('Error preparando imágenes PROMOS_GROUP:', e);
  }

  // 2) MENSAJE DE OFERTAS POR HOTEL (un solo mensaje, con: destino, hotel, fechas, precios, extras, 30% por persona)
  if (group.offers_message) {
    await this.sendMessage(phoneNumber, group.offers_message);
    await sleep(550);
  } else if (group.group_copy) {
    // Fallback: copy consolidado + lista de precios si viene
    await this.sendMessage(phoneNumber, group.group_copy);
    await sleep(550);
    if (group.price_list) {
      await this.sendMessage(phoneNumber, group.price_list);
      await sleep(550);
    }
  }

  // 3) DETALLES GENERALES / INCLUYE (bloque exacto + extras por hotel)
  if (group.includes_message) {
    await this.sendMessage(phoneNumber, group.includes_message);
    await sleep(550);
  } else if (group.common_details) {
    await this.sendMessage(phoneNumber, group.common_details);
    await sleep(550);
  }

  // 4) SEGUIMIENTO / CTA (AL FINAL)
  if (group.followup) {
    await this.sendMessage(phoneNumber, group.followup);
    await sleep(550);
  }

  return; // ← flujo atendido
}



      // Si hay promos (legacy), no reenvíes el listado largo del visible.
      // Manda un intro cortito y luego imágenes+copy bonito por cada promo.
      if (hasPromos) {
        const intro = 'Te comparto opciones con imágenes y detalles 👇';
        await this.sendMessage(phoneNumber, intro);
        await sleep(300);
      } else if (visible) {
        await this.sendMessage(phoneNumber, visible);
        await sleep(300);
      }

      // Enviar promos (imágenes + copy) — LEGACY PROMOS_JSON
      if (Array.isArray(promos) && promos.length) {
        for (const p of promos) {
          // Acepta array o string JSON por robustez
          let images = [];
          try {
            const raw = typeof p.imagenes === 'string' ? JSON.parse(p.imagenes) : p.imagenes;
            images = Array.isArray(raw) ? raw.slice(0, 3) : [];
          } catch {
            images = [];
          }

          for (const rawUrl of images) {
            try {
              const url = this.toAbsoluteUrl(rawUrl);
              if (!url) continue;
              await this.sendMessage(phoneNumber, '', url, 'image');
              await sleep(450);
            } catch (e) {
              console.error('Error enviando imagen de promo:', e);
            }
          }

          if (p.copy) {
            await this.sendMessage(phoneNumber, p.copy);
            await sleep(550);
          }
        }
      }

    };

    if (Array.isArray(aiPayload)) {
      for (let i = 0; i < aiPayload.length; i++) {
        await processOne(aiPayload[i]);
        if (i < aiPayload.length - 1) await sleep(1100);
      }
    } else {
      await processOne(aiPayload);
    }

    this.io.emit('chatListUpdated', { success: true, phoneNumber });
  }


  // 🔧 Extrae y parsea PROMOS_JSON:[ ... ] del mensaje del asistente
  extractPromosJson(texto) {
    if (typeof texto !== 'string') return null;
    const m = texto.match(/PROMOS_JSON:\s*(\[[\s\S]*\])\s*$/i);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  }

  // 👉 Nuevo helper para construir URL absoluta
  toAbsoluteUrl(u) {
    if (!u) return null;
    const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    // Si ya es absoluta, la regresamos tal cual
    if (/^https?:\/\//i.test(u)) return u;

    // Si viene "uploads/xxx" o "/uploads/xxx", normalizamos con base
    const rel = u.startsWith('/') ? u : `/${u}`;
    return new URL(rel, base).toString();
  }


  // -----------------------------------------------------------
  // Planificador (debounce 9s)
  // -----------------------------------------------------------
  async scheduleAssistantResponse(phoneNumber, userName = '') {
    // Cancelar timer previo
    if (this.pendingTimers[phoneNumber]) {
      clearTimeout(this.pendingTimers[phoneNumber]);
      console.log(`Timer anterior cancelado para ${phoneNumber}`);
    }

    // Inicializar/actualizar cola
    if (!this.messageQueue.has(phoneNumber)) {
      this.messageQueue.set(phoneNumber, {
        messages: [],
        lastMessageTime: Date.now(),
        processing: false,
        userName: userName || ''
      });
    } else {
      const q = this.messageQueue.get(phoneNumber);
      q.lastMessageTime = Date.now();
      if (userName) q.userName = userName;
    }

    // Traer el último mensaje de DB y agregar a cola (sin duplicar)
    const recentQuery = `
      SELECT mensaje
      FROM mensajes
      WHERE numero_telefono = $1
      ORDER BY fecha_hora DESC
      LIMIT 1
    `;
    try {
      const result = await ejecutarConReintento(recentQuery, [phoneNumber]);
      if (result.rows.length > 0) {
        const queueInfo = this.messageQueue.get(phoneNumber);
        const lastMessage = result.rows[0].mensaje;
        if (!queueInfo.messages.includes(lastMessage)) {
          queueInfo.messages.push(lastMessage);
          console.log(`Mensaje agregado a la cola para ${phoneNumber}: "${lastMessage}"`);
        }
      }
    } catch (error) {
      console.error('Error obteniendo mensaje reciente:', error);
    }

    console.log(`Programando procesamiento en ${this.WAIT_TIME / 1000} segundos para ${phoneNumber}`);

    this.pendingTimers[phoneNumber] = setTimeout(async () => {
      try {
        const queueInfo = this.messageQueue.get(phoneNumber);
        if (!queueInfo || queueInfo.processing) {
          console.log(`Procesamiento en curso o sin info para ${phoneNumber}`);
          return;
        }

        queueInfo.processing = true;

        const mensajeCombinado = queueInfo.messages.join(' ').trim();
        if (!mensajeCombinado) {
          console.log(`Sin mensajes para procesar de ${phoneNumber}`);
          return;
        }

        // Obtener nombre si no vino en pushName
        let nombreUsuario = queueInfo.userName;
        if (!nombreUsuario) {
          try {
            const nombreQuery = `SELECT nombre FROM contactos WHERE numero_telefono = $1`;
            const nombreResult = await ejecutarConReintento(nombreQuery, [phoneNumber]);
            if (nombreResult.rows.length > 0 && nombreResult.rows[0].nombre) {
              nombreUsuario = nombreResult.rows[0].nombre;
            }
          } catch (error) {
            console.error('Error obteniendo nombre de la BD:', error);
          }
        }

        console.log(`\n=== PROCESANDO MENSAJES ===`);
        console.log(`Número: ${phoneNumber}`);
        console.log(`Cliente: ${nombreUsuario || 'Sin nombre'}`);
        console.log(`Mensajes acumulados: ${queueInfo.messages.length}`);
        console.log(`Mensaje combinado: "${mensajeCombinado}"`);
        console.log(`========================\n`);

        if (!this.openAIHandler) {
          console.error('OpenAI Handler no está disponible');
          return;
        }

        // Llamamos al handler con la firma por objeto
        const aiResponse = await this.openAIHandler.procesarMensajeConOpenAI({
          phoneNumber,
          userText: mensajeCombinado,
          userName: nombreUsuario || 'Cliente'
        });

        if (aiResponse && String(aiResponse).trim()) {
          console.log('[IA] Respuesta OK | len=', String(aiResponse).length);
          await this.sendRichAIResponse(phoneNumber, aiResponse);
          this.io.emit('chatListUpdated', { success: true, phoneNumber });
        } else {
          console.log('[IA] No se recibió respuesta de OpenAI (fallback local)');
          const nombre = nombreUsuario || 'Cliente';
          const fallback = `¡Hola, *${nombre}*! Somos *Olas y Raíces* 🌊🌿✨. ¿Te ayudo con *promos*, *fechas* o *destino*?`;
          await this.sendMessage(phoneNumber, fallback);
          this.io.emit('chatListUpdated', { success: true, phoneNumber });
        }


      } catch (error) {
        console.error(`Error procesando respuesta para ${phoneNumber}:`, error);

        try {
          const errorMsg = 'Disculpa, hubo un problema técnico. ¿Podrías repetir tu mensaje?';
          await this.sendMessage(phoneNumber, errorMsg);
        } catch (sendError) {
          console.error('Error enviando mensaje de error:', sendError);
        }
      } finally {
        // Limpiar timer y cola
        if (this.pendingTimers[phoneNumber]) delete this.pendingTimers[phoneNumber];
        if (this.messageQueue.has(phoneNumber)) this.messageQueue.delete(phoneNumber);
        console.log(`Limpieza completada para ${phoneNumber}`);
      }
    }, this.WAIT_TIME);
  }
}

module.exports = WhatsAppService;
