// src/services/qr-handler.js
const qrcode = require('qrcode');  // Cambiado de qr-image a qrcode
const fs = require('fs').promises;
const path = require('path');

class QRHandler {
    constructor(io) {
        this.io = io;
        this.qrCode = null;
        this.currentQR = null;
    }

    async generateQR(qrText) {
        try {
            if (!qrText) return null;

            // Generar QR como data URL
            const qrImage = await qrcode.toDataURL(qrText);
            
            // Guardar estado
            this.currentQR = {
                image: qrImage,
                timestamp: Date.now(),
                expiresIn: 60000 // 1 minuto
            };

            // Emitir a través de Socket.IO
            this.io.emit('whatsappQR', {
                qr: qrImage,
                timestamp: Date.now()
            });

            return qrImage;
        } catch (error) {
            console.error('Error al generar QR:', error);
            throw error;
        }
    }

    getCurrentQR() {
        return this.currentQR?.image || null;
    }
}

module.exports = QRHandler;