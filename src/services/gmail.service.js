const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

/**
 * Servicio para enviar emails usando Gmail API
 */
class GmailService {
  constructor() {
    this.SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
    this.TOKEN_PATH = path.join(process.cwd(), 'token.json');
    this.CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
    this.oauth2Client = null;
    this.gmail = null;
  }

  /**
   * Inicializar el servicio de Gmail
   */
  async initialize() {
    try {
      // Leer credenciales
      const credentials = await fs.readFile(this.CREDENTIALS_PATH);
      const { installed } = JSON.parse(credentials);

      // Crear cliente OAuth2
      const { client_id, client_secret, redirect_uris } = installed;
      this.oauth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      // Intentar cargar token guardado
      try {
        const token = await fs.readFile(this.TOKEN_PATH);
        this.oauth2Client.setCredentials(JSON.parse(token));
        console.log('✅ Gmail API autenticada con token guardado');
      } catch (err) {
        // Si no hay token, obtener uno nuevo
        await this.getNewToken();
      }

      // Crear cliente de Gmail
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

      return true;
    } catch (error) {
      console.error('❌ Error al inicializar Gmail API:', error.message);
      console.log('💡 Asegúrate de tener el archivo credentials.json en la raíz del proyecto');
      console.log('📖 Lee GMAIL_API_SETUP.md para más información');
      return false;
    }
  }

  /**
   * Obtener nuevo token de autenticación
   */
  async getNewToken() {
    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.SCOPES,
    });

    console.log('🔐 Autoriza esta app visitando esta URL:');
    console.log(authUrl);
    console.log('');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve, reject) => {
      rl.question('Ingresa el código de autorización: ', async (code) => {
        rl.close();
        try {
          const { tokens } = await this.oauth2Client.getToken(code);
          this.oauth2Client.setCredentials(tokens);

          // Guardar token para futuras ejecuciones
          await fs.writeFile(this.TOKEN_PATH, JSON.stringify(tokens));
          console.log('✅ Token guardado en', this.TOKEN_PATH);
          resolve();
        } catch (err) {
          console.error('❌ Error al obtener token:', err);
          reject(err);
        }
      });
    });
  }

  /**
   * Crear mensaje en formato MIME
   */
  createMimeMessage(to, subject, body, attachments = []) {
    const boundary = '____BOUNDARY____';

    let message = [
      'MIME-Version: 1.0',
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ];

    // Agregar adjuntos si los hay
    for (const attachment of attachments) {
      message.push(`--${boundary}`);
      message.push(`Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`);
      message.push('Content-Transfer-Encoding: base64');
      message.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      message.push('');
      message.push(attachment.data);
    }

    message.push(`--${boundary}--`);

    return message.join('\n');
  }

  /**
   * Enviar email
   */
  async sendEmail({ to, subject, body, attachments = [] }) {
    try {
      if (!this.gmail) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('No se pudo inicializar Gmail API');
        }
      }

      const mimeMessage = this.createMimeMessage(to, subject, body, attachments);
      const encodedMessage = Buffer.from(mimeMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const result = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      console.log('✉️ Email enviado exitosamente:', result.data.id);
      return { success: true, messageId: result.data.id };
    } catch (error) {
      console.error('❌ Error al enviar email:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Enviar notificación de pago a proveedor
   */
  async enviarNotificacionPagoProveedor({
    emailProveedor,
    nombreProveedor,
    folio,
    monto,
    metodoPago,
    fecha,
    concepto,
    evidenciaPath = null
  }) {
    const subject = `Notificación de Pago - Folio ${folio}`;

    const body = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
          .content { background: #f9fafb; padding: 20px; margin-top: 20px; }
          .detail { margin: 10px 0; }
          .label { font-weight: bold; color: #667eea; }
          .footer { margin-top: 20px; padding: 20px; text-align: center; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Olas y Raíces</h1>
            <p>Notificación de Pago</p>
          </div>
          <div class="content">
            <p>Estimado/a <strong>${nombreProveedor}</strong>,</p>
            <p>Le informamos que se ha registrado un pago a su favor con los siguientes detalles:</p>

            <div class="detail">
              <span class="label">Folio de Reserva:</span> ${folio}
            </div>
            <div class="detail">
              <span class="label">Monto Pagado:</span> $${Number(monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
            </div>
            <div class="detail">
              <span class="label">Método de Pago:</span> ${metodoPago}
            </div>
            <div class="detail">
              <span class="label">Fecha de Pago:</span> ${fecha}
            </div>
            <div class="detail">
              <span class="label">Concepto:</span> ${concepto || 'Pago de reserva'}
            </div>

            ${evidenciaPath ? '<p><strong>Nota:</strong> La evidencia de pago está adjunta a este correo.</p>' : ''}

            <p style="margin-top: 20px;">Si tiene alguna duda o discrepancia, por favor contáctenos a la brevedad.</p>
          </div>
          <div class="footer">
            <p>Este es un correo automático, por favor no responder.</p>
            <p>Olas y Raíces - Agencia de Viajes</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const attachments = [];

    // Agregar evidencia si existe
    if (evidenciaPath) {
      try {
        const fileBuffer = await fs.readFile(evidenciaPath);
        const base64Data = fileBuffer.toString('base64');
        const filename = path.basename(evidenciaPath);
        const mimeType = this.getMimeType(filename);

        attachments.push({
          filename,
          mimeType,
          data: base64Data
        });
      } catch (error) {
        console.error('⚠️ Error al adjuntar evidencia:', error.message);
      }
    }

    return await this.sendEmail({
      to: emailProveedor,
      subject,
      body,
      attachments
    });
  }

  /**
   * Enviar recordatorio de facturación
   */
  async enviarRecordatorioFacturacion({
    emailProveedor,
    nombreProveedor,
    items,
    montoTotal
  }) {
    const subject = `Recordatorio de Facturación - Olas y Raíces`;

    const itemsHtml = items.map(item => `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.folio}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.tipo}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">$${Number(item.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
      </tr>
    `).join('');

    const body = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
          .content { background: #f9fafb; padding: 20px; margin-top: 20px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #667eea; color: white; padding: 10px; text-align: left; }
          .total { background: #f3f4f6; font-weight: bold; }
          .footer { margin-top: 20px; padding: 20px; text-align: center; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Olas y Raíces</h1>
            <p>Recordatorio de Facturación</p>
          </div>
          <div class="content">
            <p>Estimado/a <strong>${nombreProveedor}</strong>,</p>
            <p>Le recordamos que tiene los siguientes pagos pendientes de facturar:</p>

            <table>
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Tipo</th>
                  <th style="text-align: right;">Monto</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
                <tr class="total">
                  <td colspan="2" style="padding: 10px; text-align: right;">TOTAL:</td>
                  <td style="padding: 10px; text-align: right;">$${Number(montoTotal).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</td>
                </tr>
              </tbody>
            </table>

            <p>Por favor, envíenos las facturas correspondientes a la brevedad posible.</p>
            <p>Si ya nos ha enviado las facturas, por favor ignore este mensaje.</p>
          </div>
          <div class="footer">
            <p>Este es un correo automático, por favor no responder.</p>
            <p>Olas y Raíces - Agencia de Viajes</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: emailProveedor,
      subject,
      body
    });
  }

  /**
   * Obtener tipo MIME según extensión
   */
  getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

// Singleton
const gmailService = new GmailService();
module.exports = gmailService;
