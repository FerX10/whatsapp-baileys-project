// src/services/ocr-plan-pagos.service.js
// Servicio para extraer plan de pagos de imágenes usando OpenAI Vision API

const fs = require('fs');
const path = require('path');

class OCRPlanPagosService {
    constructor() {
        this.client = global.__openaiClient || null;
    }

    /**
     * Extrae el plan de pagos de una imagen usando OpenAI Vision API
     * @param {string} imagePath - Ruta absoluta de la imagen
     * @returns {Promise<Object>} - Plan de pagos extraído
     */
    async extraerPlanDePagos(imagePath) {
        if (!this.client) {
            throw new Error('OpenAI client no está inicializado');
        }

        try {
            // Leer la imagen y convertir a base64
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');
            const ext = path.extname(imagePath).toLowerCase();

            // Determinar el tipo MIME
            const mimeTypes = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp'
            };
            const mimeType = mimeTypes[ext] || 'image/jpeg';

            // Llamar a OpenAI Vision API
            const response = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `Analiza esta imagen de un plan de pagos y extrae la siguiente información en formato JSON:

{
  "total": número (monto total),
  "anticipo": número (anticipo o enganche),
  "anticipo_porcentaje": número (porcentaje del anticipo),
  "saldo": número (saldo restante),
  "numero_cuotas": número (cantidad de cuotas/pagos),
  "cuotas": [
    {
      "numero": número,
      "monto": número,
      "fecha_vencimiento": "YYYY-MM-DD" (si está disponible, sino null)
    }
  ],
  "metodo_pago": "EFECTIVO|TRANSFERENCIA|TARJETA|MIXTO" (si está especificado),
  "notas": "string con cualquier nota adicional relevante"
}

IMPORTANTE:
- Si no encuentras algún dato, usa null
- Las fechas deben estar en formato YYYY-MM-DD
- Los montos deben ser números sin símbolos de moneda
- Si hay MSI (Meses Sin Intereses), inclúyelo en las notas
- Si hay información de tarjeta específica (excepto Amex, 3 MSI, etc), inclúyela en notas

Responde ÚNICAMENTE con el JSON, sin texto adicional.`
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000,
                temperature: 0.1 // Baja temperatura para respuestas más consistentes
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No se recibió respuesta de OpenAI Vision');
            }

            // Extraer JSON de la respuesta (puede venir con markdown)
            let jsonText = content.trim();

            // Remover markdown code blocks si existen
            if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
            }

            // Parsear JSON
            const planPagos = JSON.parse(jsonText);

            // Validar estructura básica
            if (typeof planPagos !== 'object') {
                throw new Error('Respuesta no es un objeto JSON válido');
            }

            // Asegurar que cuotas sea un array
            if (!Array.isArray(planPagos.cuotas)) {
                planPagos.cuotas = [];
            }

            console.log('✅ Plan de pagos extraído:', planPagos);
            return planPagos;

        } catch (error) {
            console.error('Error extrayendo plan de pagos:', error);
            throw new Error(`Error en OCR: ${error.message}`);
        }
    }

    /**
     * Extrae plan de pagos de una imagen en base64
     * @param {string} base64Image - Imagen en base64
     * @param {string} mimeType - Tipo MIME de la imagen
     * @returns {Promise<Object>} - Plan de pagos extraído
     */
    async extraerPlanDePagosBase64(base64Image, mimeType = 'image/jpeg') {
        if (!this.client) {
            throw new Error('OpenAI client no está inicializado');
        }

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `Analiza esta imagen de un plan de pagos y extrae la siguiente información en formato JSON:

{
  "total": número (monto total),
  "anticipo": número (anticipo o enganche),
  "anticipo_porcentaje": número (porcentaje del anticipo),
  "saldo": número (saldo restante),
  "numero_cuotas": número (cantidad de cuotas/pagos),
  "cuotas": [
    {
      "numero": número,
      "monto": número,
      "fecha_vencimiento": "YYYY-MM-DD" (si está disponible, sino null)
    }
  ],
  "metodo_pago": "EFECTIVO|TRANSFERENCIA|TARJETA|MIXTO" (si está especificado),
  "notas": "string con cualquier nota adicional relevante"
}

IMPORTANTE:
- Si no encuentras algún dato, usa null
- Las fechas deben estar en formato YYYY-MM-DD
- Los montos deben ser números sin símbolos de moneda
- Si hay MSI (Meses Sin Intereses), inclúyelo en las notas

Responde ÚNICAMENTE con el JSON, sin texto adicional.`
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000,
                temperature: 0.1
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No se recibió respuesta de OpenAI Vision');
            }

            let jsonText = content.trim();
            if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
            }

            const planPagos = JSON.parse(jsonText);
            if (!Array.isArray(planPagos.cuotas)) {
                planPagos.cuotas = [];
            }

            return planPagos;

        } catch (error) {
            console.error('Error extrayendo plan de pagos base64:', error);
            throw new Error(`Error en OCR: ${error.message}`);
        }
    }
}

module.exports = new OCRPlanPagosService();
