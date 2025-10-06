const { createReadStream } = require('fs');
const path = require('path');
const { ejecutarConReintento } = require('../database/db');

class MediaHandler {
    constructor() {
        this.uploadDir = path.join(process.cwd(), 'uploads');
    }

    async handleMediaUpload(file, phoneNumber, caption = '') {
        try {
            // Guardar información del archivo en la base de datos
            const query = `
                INSERT INTO archivos_multimedia (
                    tipo_contenido,
                    nombre_archivo,
                    ruta_archivo,
                    tamano_archivo,
                    metadata
                ) VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;

            const metadata = {
                originalName: file.originalname,
                mimetype: file.mimetype,
                encoding: file.encoding,
                uploadDate: new Date()
            };

            const result = await ejecutarConReintento(query, [
                file.mimetype,
                file.filename,
                path.join(this.uploadDir, file.filename),
                file.size,
                metadata
            ]);

            return {
                success: true,
                fileData: result.rows[0],
                publicUrl: `/uploads/${file.filename}`
            };
        } catch (error) {
            console.error('Error en handleMediaUpload:', error);
            throw error;
        }
    }

    validateFile(file) {
        const maxSize = 50 * 1024 * 1024; // 50MB
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/gif',
            'video/mp4',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (file.size > maxSize) {
            throw new Error('El archivo excede el tamaño máximo permitido (50MB)');
        }

        if (!allowedTypes.includes(file.mimetype)) {
            throw new Error('Tipo de archivo no permitido');
        }

        return true;
    }

    async getMediaType(file) {
        const mimeType = file.mimetype;
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        return 'document';
    }

    async cleanupOldFiles(daysToKeep = 30) {
        try {
            const query = `
                SELECT ruta_archivo 
                FROM archivos_multimedia 
                WHERE fecha_subida < NOW() - INTERVAL '${daysToKeep} days';
            `;
            
            const result = await ejecutarConReintento(query);
            
            // Eliminar archivos físicos
            for (const row of result.rows) {
                try {
                    await fs.unlink(row.ruta_archivo);
                } catch (err) {
                    console.error('Error al eliminar archivo:', err);
                }
            }

            // Eliminar registros de la base de datos
            await ejecutarConReintento(`
                DELETE FROM archivos_multimedia 
                WHERE fecha_subida < NOW() - INTERVAL '${daysToKeep} days';
            `);

        } catch (error) {
            console.error('Error en cleanupOldFiles:', error);
        }
    }
}

module.exports = MediaHandler;