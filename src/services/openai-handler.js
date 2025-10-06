// src/services/openai-handler.js
// -------------------------------------------------------------
// OpenAI Handler con:
// - Prompt de marca (Olas y Raíces)
// - Responses API v4 con conversations (store:true) + recovery 404
// - Historial desde DB para contexto conversacional
// - Manejo de <ctrl>{...}</ctrl> (intents, copies, tags, promo_filters)
// - Búsqueda de promos (mes flexible + fallback) y armado de PROMOS_JSON
// - Handoff a humano (assistant_status.active = false)
// - Inserciones a BD sólidas (sin columnas inexistentes, sin tipos ambiguos)
// -------------------------------------------------------------

const {
    ejecutarConReintento,
    getConversationId,
    upsertConversationId,
    getEtiquetasChat,
    toggleEtiqueta
} = require('../database/db');

const AGENCY_NAME = process.env.AGENCY_NAME || 'Olas y Raíces';
const BRAND_EMOJIS = '🌊🌿✨';
const SYSTEM_USER_ID = parseInt(process.env.ASSISTANT_USER_ID || '105', 10);
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

class OpenAIHandler {
    constructor(whatsappService) {
        this.whatsappService = whatsappService;
        this.client = global.__openaiClient || null;
    }

    // ========= PROMPT DE MARCA =========
    getSystemPrompt() {
        const AGENCY = 'Agencia de Viajes *Olas y Raíces*';
        const BRAND = '🌊🌿✨';
        const CIUDAD_BASE = 'León, Guanajuato (EuropPlaza, Blvrd Miguel Hidalgo #2027, Valle de León, 37140 León de los Aldama, Gto.)';
        const HORARIO_HUMANO = 'Lunes a Viernes de 11:00 a 18:00 (hora local)';
        const HANDOFF_TIEMPO = '10 a 20 min hábiles';
        const POLITICAS_PAGO = [
            'Anticipo mínimo: *30%*.',
            'Tabulador/fechas de pago tras anticipo.',
            'Si paga *en efectivo*: liquidar *15 días antes* de la salida.',
            'Meses sin intereses: *3 MSI* con *cualquier tarjeta de crédito* *excepto Amex*.'
        ];

        return (
            `Eres el asistente de *${AGENCY}* ${BRAND}. Escribe SIEMPRE en español, con tono cálido, cercano y profesional.

⚙️ FORMATO:
- Usa *itálicas* con un solo asterisco (ej: *todo incluido*). NO uses **dobles**.
- Usa emojis del mood mar y naturaleza GENEROSAMENTE en CADA mensaje: 🌊🏝️⛱️🐠🐬🌿🍃🌴✈️🧳✨🌅🌺💙🏖️🦜🥥🍹
- Respuestas cortas (1 a 3 líneas). SIEMPRE incluye mínimo 2-3 emojis relevantes.
- IMPORTANTE: Usa MUCHOS emojis para hacer las conversaciones más cálidas y visuales.

📍 CONTEXTO DE MARCA:
- Ciudad base/salida por defecto: *${CIUDAD_BASE}*.
- Horario de atención con asesor humano: *${HORARIO_HUMANO}*.
- Tiempo de respuesta cuando pida humano: *${HANDOFF_TIEMPO}*.
- Políticas de pago:
  • ${POLITICAS_PAGO.join('\n  • ')}

🚫 REGLAS:
- Nunca inventes precios, políticas ni fechas.
- Pide datos faltantes con amabilidad.
- Si el usuario ya lo dijo antes, no repitas la misma pregunta.

🧭 FLUJOS:
1) *Cotización* → reúne datos mínimos SIN inventar, pero HAZLO DE FORMA PROGRESIVA (uno o dos datos por mensaje):

   📋 Datos necesarios (pide SOLO lo que NO tengas ya):
   • *Destino/playa/ciudad* 🏝️
   • *Fechas* (o mes tentativo) 📅
   • *Adultos* y *menores* (con *edades*) 👨‍👩‍👧
   • *Plan*: *todo incluido*, *desayunos*, *solo hospedaje* 🍽️
   • *Transporte*: *camión*, *avión* o *por su cuenta* ✈️
   • *Ciudad de salida* (si aplica) — por defecto: *${CIUDAD_BASE}* 📍
   • *Hotel deseado* (si ya trae idea) 🏨
   • *Presupuesto aproximado por adulto* (si quiere compartir) 💰
   • *Condiciones de promo* (menores gratis, 2x1, desayuno a la llegada, entrega anticipada) 🎁

   ⚠️ NOTA IMPORTANTE: Si el transporte es *avión*, los traslados aeropuerto-hotel ya vienen incluidos automáticamente en la cotización. NO preguntes por traslados por separado.

   ⚠️ IMPORTANTE - CONVERSACIÓN GRADUAL:
   - NO pidas todos los datos de golpe
   - Pregunta 1 o máximo 2 cosas por mensaje
   - Espera respuesta antes de pedir el siguiente dato
   - Si el cliente ya mencionó algo, NO lo vuelvas a preguntar
   - Mantén un tono conversacional y natural con emojis 🌊✨

   Ejemplo de flujo correcto:
   ✅ "¿A dónde te gustaría viajar? 🏝️"
   [espera respuesta]
   ✅ "¡Perfecto! ¿Para qué fechas o mes tienes en mente? 📅"
   [espera respuesta]
   ✅ "¿Cuántos adultos y niños viajarían? 👨‍👩‍👧"

   ❌ NO hagas: "Dame destino, fechas, adultos, menores, plan, transporte..."

   ⚠️ GENERACIÓN DE FICHA-COTI (CRÍTICO):
   - Cuando tengas MÍNIMO: *destino* + *fechas/mes* + *personas (adultos/menores)*, DEBES generar la FICHA-COTI inmediatamente
   - NO esperes a tener todos los datos opcionales (plan, transporte, hotel, presupuesto)
   - Si faltan datos opcionales, usa valores por defecto o "por definir"
   - La FICHA-COTI dispara el scraping automático de opciones
   - Ejemplo: Si ya sabes "Mazatlán, del 13 al 16 oct, 2 adultos" → GENERA FICHA-COTI con esos datos
   - Si el usuario cambia fechas o datos después de una cotización previa, GENERA una NUEVA FICHA-COTI con los datos actualizados
   - NO digas solo "voy a revisar/buscar" sin generar la FICHA-COTI - siempre debes generarla
   - Si sugieres fechas alternativas ("¿qué tal del 13 al 17?"), GENERA la FICHA-COTI con esas fechas AUTOMÁTICAMENTE
   - NO esperes confirmación del usuario para generar la FICHA-COTI cuando sugieres fechas - genera MÚLTIPLES fichas si ofreces varias opciones

   🚨 OBLIGATORIO: El objeto FICHA-COTI en el array "copies" SIEMPRE debe incluir AMBOS campos:
      1. "text": mensaje amigable para WhatsApp
      2. "data": objeto JSON con la estructura completa (destino, fechas, adultos, menores, plan, transporte, salida, hotel_deseado, presupuesto_aprox_adulto, condiciones_promo)
      ❌ NUNCA omitas el campo "data" - es REQUERIDO para que funcione el scraper automático

   IMPORTANTE: NO pongas precios inventados. Si faltan, di "por definir".

2) *Promos* → si dice que vio una promo (estados WhatsApp, Facebook, o manda *foto* de promo) o pide “promociones”:
   • NO interrogues como cotización completa.
   • Saluda por su *nombre* y preséntate como *agencia* con estilo cálido.
   • Antes de listar promos, pregunta por *mes/fecha tentativo* y *playa/destino*.
   • Si no hay mes ni destino, comparte *hasta 3* opciones *más cercanas a hoy* y menciona que puedes afinar con mes/destino.
   • Pide *destino* o playa de interés, *mes* aproximado, si busca *todo incluido*, y *con/sin transporte*.
   • Devuelve filtros en el bloque técnico (*promo_filters*).

3) *Humano* → si pide hablar con una persona/asesor o te identifica como bot, devuelve intent "humano" en bloque técnico.

4) *Reservar* → cuando el cliente exprese intención de reservar ("quiero reservar", "apartar", "me decido", "voy con esta"):
   • Usa intent "reservar" en bloque técnico
   • Si NO especifica cuál promo/cotización, pregunta: "¿Cuál de las opciones que te compartí te gustaría reservar?"
   • Solicita los siguientes datos FALTANTES (si ya los tienes en conversación, NO los vuelvas a pedir):
     - *Nombres completos de TODOS los pasajeros* (adultos y menores)
     - *Edades de menores* (si aún no las tienes)
     - *Correo electrónico* (para enviar confirmación)
   • IMPORTANTE: Si en la conversación ya mencionaron nombres/edades/email, NO los vuelvas a pedir
   • Cuando tengas TODO completo, incluye en copies keyword "SOLICITUD-RESERVA" con:
     - promo_o_cotizacion: descripción de lo que quiere reservar
     - pasajeros: {adultos: [{nombre, edad}], menores: [{nombre, edad}]}
     - email: correo del cliente
   • Mensaje final: "✅ Perfecto, *[nombre]*, tu asesor procesará tu reserva y te enviará el plan de pagos en breve 📋💳"

🏷️ ETIQUETAS (embudo CRM):
- "Frio": saludo inicial, interés muy general sin datos.
- "SIC": cuando solicita info para cotizar o ya recabas datos.
- "MP": cuando le compartes *promociones* de la base.
- "MCP": cuando le compartes una *ficha de cotización personalizada*.
- "Seguimiento": tras enviar ficha o si quedaste en compartir algo luego.
- "Reservar": cuando expresa intención de reservar.
- "Cerrado": cuando da por cerrado o no seguirá.
Sugiere *solo* las etiquetas que apliquen en cada turno.

5) *Hotelpedia* → cuando pidan info de un hotel ("fotos del hotel X", "cómo es X", "tiene gym", etc.) o comparación ("X o Y"):
   • Si es 1 hotel: devuelve intent "hotel_info".
   • Si son 2 hoteles: devuelve intent "hotel_compare".
   • Identifica nombres de hoteles (exactos si puedes) y *secciones* que pidió: "habitaciones", "playa", "restaurantes", "albercas", "snacks", "gym", "spa" (usa estos nombres).
   • NO inventes datos; si algo falta, dilo.


🧾 FICHA DE COTIZACIÓN (sin precios inventados):
Cuando esté lista o semi-lista, incluye en *copies* un objeto con keyword "FICHA-COTI" y "text" listo para WhatsApp.
ESTRUCTURA RECOMENDADA:
- *📋 Ficha de Cotización* ${BRAND}
- Destino:
- Plan:
- Fechas (o mes):
- Personas (adultos / menores+edades):
- Transporte: (menciona solo el tipo: *camión* o *avión*. NO menciones traslados, ya están incluidos con avión)
- Preferencias / Hotel deseado:
- Nota de políticas/pagos (resumen breve):
- Próximo paso (agendar llamada de 15 min / confirmar datos):
No inventes números. Si faltan, di "por definir".

⚠️ IMPORTANTE SOBRE TRASLADOS:
- Si el transporte es *avión*, los traslados aeropuerto-hotel ya están incluidos automáticamente
- NO menciones "traslados" en la ficha cuando sea avión
- Ejemplo correcto: "Transporte: *avión* ✈️" (sin mencionar traslados)
- Ejemplo incorrecto: "Transporte y traslados: avión con traslados incluidos"

IMPORTANTE - TRANSPORTE POR DESTINO:
- *Cancún, Los Cabos, Mazatlán*: SOLO con avión (obligatorio)
- *Ixtapa, Puerto Vallarta, Manzanillo*: camión por defecto, pero puede ser avión si el cliente lo especifica
- Si el cliente NO especifica transporte y el destino permite camión, usa camión como default
- Si pide "con camión" o "con avión", respeta su elección

FECHAS VÁLIDAS PARA TRANSPORTE EN CAMIÓN:
- Solo acepta patrones: jueves→domingo, domingo→jueves, jueves→jueves, domingo→domingo
- Si el cliente da fechas inválidas para camión (ej: miércoles-sábado):
  * Sugiere la fecha válida más cercana
  * Explica el ajuste: "Para transporte terrestre ajustamos a jueves-domingo (patrón válido)"
  * Incluye la fecha original Y la ajustada en el payload

💰 CONSULTAS SOBRE RESERVAS Y PAGOS:
Si el cliente pregunta por:
- "mi reserva", "mis pagos", "cuánto debo", "saldo", "cuotas", "estado de mi reserva"
→ Usa keyword "CONSULTA-RESERVA" en copies para que el sistema busque sus reservas activas
→ Responde: "Déjame consultar tu información, un momento..."

Si el cliente menciona que hizo un pago o envía comprobante:
- "ya pagué", "hice el pago", "transferí", "deposité"
→ Si NO tiene imagen adjunta, pídele que envíe el comprobante
→ Si ya detectamos la imagen automáticamente, confirma: "✅ Recibimos tu comprobante, está en verificación"

✈️ Adjuntos y medios: puedes sugerir imágenes o PDFs cuando útil (la plataforma los enviará).

📦 BLOQUE TÉCNICO (siempre al final y NUNCA se lo muestres al usuario):
Delimita EXACTAMENTE así y con JSON válido:
<ctrl>{
  "intent": "cotizacion|promos|reservar|humano|chitchat",
  "fields_needed": ["destino","fechas","adultos","menores_edades","plan","transporte","presupuesto","salida","hotel_deseado"],
  "fields_collected": {
    "destino": null,
    "fechas": {"salida": null,"regreso": null,"mes": null},
    "adultos": null,
    "menores": [],
    "plan": null,
    "transporte": null,
    "presupuesto_aprox_adulto": null,
    "salida": "León, Guanajuato (EuropPlaza, Blvrd Miguel Hidalgo #2027, Valle de León, 37140 León de los Aldama, Gto.)",
    "hotel_deseado": null,
    "condiciones_promo": {"menores_gratis": false,"ninos_2x1": false,"desayuno_llegada": false,"entrega_anticipada": false}
  },
  "ready_for_copy": false,
  "copies": [
    {
      "keyword": "FICHA-COTI",
      "text": "texto amable para WhatsApp sin precios inventados",
      "data": {
        // ⚠️ CAMPO OBLIGATORIO: NUNCA omitas "data", contiene info estructurada para scraper
        "destino":"Puerto Vallarta",
        "fechas": [
          {"salida":"2025-10-16","regreso":"2025-10-19"},
          {"salida":"2025-10-30","regreso":"2025-11-02"},
          {"salida":"2025-11-13","regreso":"2025-11-16"}
        ],
        "adultos":2,
        "menores":[14,10,4],
        "plan":"todo incluido",
        "transporte":"camion",
        "salida":"León, Guanajuato (EuropPlaza, Blvrd Miguel Hidalgo #2027, Valle de León, 37140 León de los Aldama, Gto.)",
        "hotel_deseado":null,
        "presupuesto_aprox_adulto":null,
        "condiciones_promo":{"menores_gratis":false,"ninos_2x1":false,"desayuno_llegada":false,"entrega_anticipada":false}
      }
    },
    {
      "keyword": "SOLICITUD-RESERVA",
      "text": "✅ Perfecto, tu asesor procesará tu reserva y te enviará el plan de pagos en breve",
      "data": {
        "promo_o_cotizacion": "Promo Cancún 3 noches todo incluido",
        "pasajeros": {
          "adultos": [
            {"nombre": "Juan Pérez García", "edad": 35},
            {"nombre": "María López Ruiz", "edad": 32}
          ],
          "menores": [
            {"nombre": "Pedro Pérez López", "edad": 8},
            {"nombre": "Ana Pérez López", "edad": 5}
          ]
        },
        "email": "juan.perez@email.com",
        "cotizacion_id": null
      }
    }
  ],
"promo_filters": {
   "destino": null,
   "mes": null,                    // 'YYYY-MM' o nombre de mes
   "todo_incluido": null,          // true/false
   "con_transporte": null,         // true/false
   "fecha_salida_from": null,      // 'YYYY-MM-DD' opcional
   "fecha_salida_to": null         // 'YYYY-MM-DD' opcional
 },
 "suggested_tags": ["Frio","SIC","MP","MCP","Seguimiento","Reservar","Cerrado"],
 "hotel_query": {
    "names": ["Hotel X", "Hotel Y"],       // 1 o 2 nombres
    "sections": ["habitaciones","playa"]   // cero o más secciones pedidas
  }
  // "intent": "hotel_info" | "hotel_compare" (si aplica hoteles) | "reservar" (cuando quiere reservar) 

</ctrl>`

        );
    }

    // ========= UTILIDADES =========
    parseControl(rawText) {
        if (!rawText) return { visible: '', control: null };

        // Intenta con etiquetas normales <ctrl>...</ctrl>
        const re = /<ctrl>\s*([\s\S]*?)\s*<\/ctrl>/i;
        const m = rawText.match(re);
        let control = null;
        let visible = rawText;

        if (m) {
            visible = rawText.replace(m[0], '').trim();
            try {
                control = JSON.parse(m[1]);
                console.log('[parseControl] ✅ Bloque <ctrl> encontrado con etiquetas');
            } catch (e) {
                console.log('[parseControl] ❌ Error parseando JSON dentro de <ctrl>:', e.message);
                control = null;
            }
        } else {
            // Si no hay etiquetas, buscar el patrón en texto plano: <ctrl>{ ... (hasta el final)
            const plainMatch = rawText.match(/\n<ctrl>\s*(\{[\s\S]*?)$/);
            if (plainMatch) {
                visible = rawText.substring(0, plainMatch.index).trim();
                try {
                    control = JSON.parse(plainMatch[1]);
                    console.log('[parseControl] ✅ Bloque <ctrl> encontrado sin cierre (texto plano)');
                } catch (e) {
                    console.log('[parseControl] ❌ Error parseando JSON en bloque plano:', e.message);
                    control = null;
                }
            } else {
                console.log('[parseControl] ⚠️ No se encontró bloque <ctrl>');
            }
        }

        return { visible, control };
    }

    async applySuggestedTags(phoneNumber, names = []) {
        if (!names || !names.length) return;

        const current = await getEtiquetasChat(phoneNumber);
        const activeMap = new Map(current.map(e => [String(e.nombre).toLowerCase(), !!e.activo]));

        let changed = false;
        for (const name of names) {
            const r = await ejecutarConReintento(
                `SELECT id FROM etiquetas WHERE LOWER(nombre)=LOWER($1) AND activo=TRUE LIMIT 1`,
                [name]
            );
            if (!r.rows.length) continue;

            const id = r.rows[0].id;
            const isActive = activeMap.get(String(name).toLowerCase()) === true;

            if (!isActive) {
                await toggleEtiqueta(phoneNumber, id, SYSTEM_USER_ID);
                changed = true;
            }
        }

        // Si hubo cambios, emitimos al frontend para refrescar en tiempo real
        if (changed && this.whatsappService?.io) {
            try {
                const assignedTags = await getEtiquetasChat(phoneNumber);
                this.whatsappService.io.emit('tagsUpdated', { phoneNumber, assignedTags });
            } catch (e) {
                console.error('emit tagsUpdated error:', e?.message || e);
            }
        }
    }


    // ========= MES FLEXIBLE =========
    normalizeMesInput(raw) {
        if (!raw) return null;
        const s = String(raw).trim().toLowerCase();

        const map = {
            'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
            'julio': 7, 'agosto': 8, 'septiembre': 9, 'setiembre': 9,
            'octubre': 10, 'noviembre': 11, 'diciembre': 12
        };

        if (map[s]) return { month: map[s], year: null };             // "agosto"
        if (/^\d{1,2}$/.test(s)) {                                    // "8" / "08"
            const m = parseInt(s, 10);
            if (m >= 1 && m <= 12) return { month: m, year: null };
        }
        const m1 = s.match(/^(\d{4})[\/\-](\d{1,2})$/);               // "2025-08" / "2025/8"
        if (m1) {
            const y = parseInt(m1[1], 10);
            const m = parseInt(m1[2], 10);
            if (m >= 1 && m <= 12) return { month: m, year: y };
        }
        const m2 = s.match(/^([a-záéíóúñ]+)\s+(\d{4})$/i);            // "agosto 2025"
        if (m2 && map[m2[1]]) {
            const y = parseInt(m2[2], 10);
            return { month: map[m2[1]], year: y };
        }
        return null;
    }

    // ========= PROMOS EN BD =========
    // Busca promos con filtros flexibles y ordena por cercanía a hoy.
    // filters soporta (todos opcionales):
    //  - destino: string (ej. "mazatlán")
    //  - fecha_salida_from: 'YYYY-MM-DD'
    //  - fecha_salida_to: 'YYYY-MM-DD'
    //  - todo_incluido: true/false
    //  - con_transporte: true/false
    //  - mes: 'YYYY-MM' (si viene de LLM)
    async findPromos(filters = {}) {
        const f = filters || {};
        const params = [];
        const where = [];

        // — Destino (ILike, coincidencia flexible)
        if (f.destino && typeof f.destino === 'string') {
            params.push(`%${f.destino.trim()}%`.toLowerCase());
            where.push(`LOWER(p.destino) ILIKE $${params.length}`);
        }

        // — Planes/flags
        if (typeof f.todo_incluido === 'boolean') {
            params.push(f.todo_incluido);
            where.push(`p.todo_incluido = $${params.length}`);
        }
        if (typeof f.con_transporte === 'boolean') {
            params.push(f.con_transporte);
            where.push(`p.con_transporte = $${params.length}`);
        }

        // — Fechas (prioridad: rango explícito → mes → nada)
        let haveDateFilter = false;

        // Rango explícito
        if (f.fecha_salida_from) {
            params.push(f.fecha_salida_from);
            where.push(`p.fecha_salida >= $${params.length}::date`);
            haveDateFilter = true;
        }
        if (f.fecha_salida_to) {
            params.push(f.fecha_salida_to);
            where.push(`p.fecha_salida <= $${params.length}::date`);
            haveDateFilter = true;
        }

        // Mes (YYYY-MM) → [primer día, último día del mes]
        if (!haveDateFilter && typeof f.mes === 'string' && /^\d{4}-\d{2}$/.test(f.mes)) {
            const [yy, mm] = f.mes.split('-').map(Number);
            const start = `${yy}-${String(mm).padStart(2, '0')}-01`;
            // último día mes: date_trunc + interval
            params.push(start);
            where.push(`p.fecha_salida >= $${params.length}::date`);
            params.push(start);
            where.push(`p.fecha_salida < ($${params.length}::date + INTERVAL '1 month')`);
            haveDateFilter = true;
        }

        // — Construye WHERE
        const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

        // — Orden por cercanía a HOY (preferir futuras, luego pasadas más cercanas) y precio si existe
        // Nota: usamos COALESCE para manejar nulos.
        const sql = `
    WITH base AS (
      SELECT
        p.*,
        CASE WHEN p.fecha_salida >= NOW()::date THEN 0 ELSE 1 END AS after_now,
        ABS(COALESCE(p.fecha_salida, NOW()::date) - NOW()::date) AS days_from_today
      FROM promos p
      ${whereSQL}
    )
    SELECT *
    FROM base
    ORDER BY
    after_now ASC,                 -- primero futuras (0), luego pasadas (1)
    days_from_today ASC,
    COALESCE(precio_adulto, 1e12) ASC

    LIMIT 3;
  `;

        try {
            const res = await ejecutarConReintento(sql, params);
            return res?.rows || [];
        } catch (e) {
            console.error('findPromos error:', e);
            return [];
        }
    }

    formatMXN(n) {
        if (n == null) return null;
        const v = Number(n);
        if (!Number.isFinite(v)) return null;
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);
    }

    formatFecha(d) {
        if (!d) return null;
        const date = new Date(d);
        if (isNaN(date)) return null;
        return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }); // ej: "27 oct"
    }


    promoToCopy(p) {
        const titulo = (p.titulo || p.destino || 'Opción disponible').toString().trim();
        const destino = (p.destino || 'por definir').toString().trim();

        const extras = [];
        if (p.menores_gratis) extras.push('*Menores Gratis*');
        if (p.ninos_2x1) extras.push('*Niños 2x1*');
        if (p.incluye_desayuno_llegada) extras.push('*desayuno a la llegada*');
        if (p.entrega_anticipada) extras.push('*entrega anticipada*');
        if (p.traslados) extras.push('*traslados aeropuerto ↔ hotel*');
        const extrasLine = extras.length ? `\n➕ *Extras:* ${extras.join(' · ')}` : '';

        const fs = this.formatFecha(p.fecha_salida);
        const fr = this.formatFecha(p.fecha_llegada);
        const fechas = (fs || fr)
            ? `📅 *Fechas:* *${fs || 'por definir'}* → *${fr || 'por definir'}*`
            : `📅 *Fechas:* *por definir*`;

        const pa = this.formatMXN(p.precio_adulto);
        const pm = this.formatMXN(p.precio_menor);
        const pbm = this.formatMXN(p.precio_bus_menor);

        const preciosParts = [];
        if (pa) preciosParts.push(`Adulto desde *${pa}*`);

        if (p.menores_gratis === true) {
            preciosParts.push(`Menor *Gratis*`);
            if (pbm) preciosParts.push(`Menor (bus) *${pbm}*`);
        } else {
            if (pm) {
                preciosParts.push(`Menor *${pm}*`);
                if (pbm) preciosParts.push(`Menor (bus) *${pbm}*`);
            } else if (pbm) {
                preciosParts.push(`Menor (bus) *${pbm}*`);
            }
        }

        const precios = preciosParts.length
            ? `💵 *Precios:*\n• ${preciosParts.join('\n• ')}`
            : '💵 *Precios por definir* (según disponibilidad)';

        return (
            `🏖️ *${titulo}* 🌊🌿✨\n` +
            `📍 *Destino:* *${destino}*${extrasLine}\n` +
            `${fechas}\n` +
            `${precios}\n` +
            `ℹ️ *Precios y disponibilidad pueden cambiar*`
        ).trim();
    }

    formatFechaDMY(d) {
        if (!d) return null;
        const date = new Date(d);
        if (isNaN(date)) return null;
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = String(date.getFullYear());
        return `${dd}-${mm}-${yyyy}`;
    }

    diffNochesDias(salida, llegada) {
        const ds = salida ? new Date(salida) : null;
        const dr = llegada ? new Date(llegada) : null;
        if (!ds || !dr || isNaN(ds) || isNaN(dr)) return { noches: null, dias: null };
        ds.setHours(0, 0, 0, 0);
        dr.setHours(0, 0, 0, 0);
        const ms = dr.getTime() - ds.getTime();
        const noches = Math.max(Math.round(ms / (1000 * 60 * 60 * 24)), 0);
        const dias = noches + 1;
        return { noches, dias };
    }

    collectExtras(promos = []) {
        const arr = Array.isArray(promos) ? promos : [promos];
        const set = new Set();
        for (const p of arr) {
            if (!p) continue;
            if (p.menores_gratis) set.add('*Menores Gratis*');
            if (p.ninos_2x1) set.add('*Niños 2x1*');
            if (p.incluye_desayuno_llegada) set.add('*desayuno a la llegada*');
            if (p.entrega_anticipada) set.add('*entrega anticipada*');
            if (p.traslados) set.add('*traslados aeropuerto ↔ hotel*');
        }
        return set.size ? Array.from(set).join(' · ') : null;
    }


    // Unifica destinos para el encabezado (ej: "Ixtapa" o "Ixtapa · Mazatlán")
    destinosHeader(promos = []) {
        const destinos = Array.from(
            new Set((promos || []).map(p => (p?.destino || '').toString().trim()).filter(Boolean))
        );
        return destinos.length ? destinos.join(' · ') : 'Destino';
    }

    // MENSAJE ÚNICO de ofertas por hotel (con 30% por persona y extras por opción)
    buildOffersMessage(promos = []) {
        if (!Array.isArray(promos) || !promos.length) return null;

        const destinos = this.destinosHeader(promos);
        const header = `🏖️ ¡Ofertas increíbles en *${destinos}*! 🌴`;

        const emojiMap = ['🌊', '🌅', '🌞', '🌴', '✨'];
        const blocks = promos.map((p, idx) => {
            const e = emojiMap[idx % emojiMap.length];
            const hotel = (p?.titulo || p?.destino || `Opción ${idx + 1}`).toString().trim();
            const destino = (p?.destino || 'por definir').toString().trim();

            const fsDMY = this.formatFechaDMY ? this.formatFechaDMY(p?.fecha_salida) : null;
            const frDMY = this.formatFechaDMY ? this.formatFechaDMY(p?.fecha_llegada) : null;
            const fechasLine = `📅 *Fechas:* ${fsDMY || 'por definir'} al ${frDMY || 'por definir'}`;

            const paNum = Number(p?.precio_adulto);
            const pmNum = Number(p?.precio_menor);
            const pbmNum = Number(p?.precio_bus_menor);

            const pa = this.formatMXN(paNum);
            const pm = this.formatMXN(pmNum);
            const pbm = this.formatMXN(pbmNum);

            // Precios por persona
            const priceLines = [];
            priceLines.push(`💰 *Precio por adulto:* ${pa || 'por definir'}`);
            if (p?.menores_gratis) {
                priceLines.push('💰 *Precio por menor:* Gratis');
            } else if (pm) {
                priceLines.push(`💰 *Precio por menor:* ${pm}`);
            }
            if (pbm) priceLines.push(`💰 *Precio por menor (bus):* ${pbm}`);

            // Depósito 30% por persona
            const depParts = [];
            if (Number.isFinite(paNum)) depParts.push(`Adulto *${this.formatMXN(paNum * 0.30)}*`);
            if (p?.menores_gratis) {
                if (Number.isFinite(pbmNum)) depParts.push(`Menor (bus) *${this.formatMXN(pbmNum * 0.30)}*`);
            } else {
                if (Number.isFinite(pmNum)) depParts.push(`Menor *${this.formatMXN(pmNum * 0.30)}*`);
                if (Number.isFinite(pbmNum)) depParts.push(`Menor (bus) *${this.formatMXN(pbmNum * 0.30)}*`);
            }
            const depositoLine = depParts.length ? `💳 *Aparta con 30%:* ${depParts.join(' · ')}` : null;

            // Extras por hotel (solo promos, no TI/transporte)
            const extras = [];
            if (p?.menores_gratis) extras.push('*Menores Gratis*');
            if (p?.ninos_2x1) extras.push('*Niños 2x1*');
            if (p?.incluye_desayuno_llegada) extras.push('*desayuno a la llegada*');
            if (p?.entrega_anticipada) extras.push('*entrega anticipada*');
            if (p?.traslados) extras.push('*traslados aeropuerto ↔ hotel*');
            const extrasLine = extras.length ? `➕ *Extras:* ${extras.join(' · ')}` : null;

            return (
                `${idx + 1}. *${hotel}* ${e}
📍 *Destino:* *${destino}*
${fechasLine}
${priceLines.join('\n')}
${extrasLine ? extrasLine + '\n' : ''}${depositoLine ? depositoLine + '\n' : ''}`.trim()
            );
        });

        return `${header}\n\n${blocks.join('\n\n')}`.trim();
    }

    // Extras detallados por hotel (para el bloque "incluye")
    buildExtrasByHotel(promos = []) {
        if (!Array.isArray(promos) || !promos.length) return null;
        const lines = [];
        for (const p of promos) {
            const hotel = (p?.titulo || p?.destino || 'Hotel').toString().trim();
            if (p?.incluye_desayuno_llegada) lines.push(`• Desayuno a la llegada *Gratis* (*${hotel}*)`);
            if (p?.entrega_anticipada) lines.push(`• Entrega anticipada de la habitación (*${hotel}*)`);
            if (p?.menores_gratis) lines.push(`• Menores gratis (*${hotel}*)`);
            if (p?.ninos_2x1) lines.push(`• Niños 2x1 (*${hotel}*)`);
            if (p?.traslados) lines.push(`• Traslados aeropuerto ↔ hotel (*${hotel}*)`);
        }
        return lines.length ? lines.join('\n') : null;
    }

    // Bloque “¡Esto es lo que incluye!” tal cual tu formato + extras por hotel
    buildIncludesMessage(promos = [], context = {}) {
        if (!Array.isArray(promos) || !promos.length) return null;

        const destinos = this.destinosHeader(promos);
        const anyTI = promos.some(p => !!p?.todo_incluido);
        const anyTrans = promos.some(p => !!p?.con_transporte);

        const lines = [
            '✨ ¡Esto es lo que incluye! ✨',
            '',
            anyTI ? '✅ *Todo incluido*' : '✅ *Plan según opción*',
            anyTrans ? '🚌 *Transporte redondo (camión)*' : '🚌 *Transporte* según opción'
        ];

        if (anyTI) {
            lines.push(
                '⭐ *Plan Todo Incluido* para disfrutar sin límites:',
                '🍽 Desayunos, comidas y cenas *buffet*',
                '🍔 *Snacks* ilimitados',
                '🍺 Bebidas *alcohólicas* ilimitadas',
                '🍹 Bebidas *no alcohólicas* ilimitadas',
                '🏖️ *Actividades en el hotel* para relajarte o divertirte'
            );
        }

        const extrasByHotel = this.buildExtrasByHotel(promos);
        if (extrasByHotel) {
            lines.push('', 'Extras:', extrasByHotel);
        }

        lines.push(
            '',
            `🎉 ¡Elige tu favorito y vive unas vacaciones inolvidables en *${destinos}*! 🎉`,
            '👉 ¿Necesitas *más información* o *reservar*? ¡Contáctanos!',
            '',
            'Precios sujetos a *disponibilidad* y cambio de tarifa *sin previo aviso*.'
        );

        return lines.join('\n').trim();
    }



    // “Datos generales” al estilo ejemplo (con noches, incluye y extras)
    makeOfferOverviewMessage(promos = [], context = {}) {
        try {
            const arr = Array.isArray(promos) ? promos : [promos];

            const destinos = Array.from(new Set(arr.map(p => (p?.destino || '').trim()).filter(Boolean)));
            const destino = (context.destino?.trim()) || (destinos.length === 1 ? destinos[0] : (destinos[0] || 'Ixtapa'));

            let fs = null, fr = null;
            for (const p of arr) {
                if (p?.fecha_salida || p?.fecha_llegada) {
                    fs = fs || p.fecha_salida || null;
                    fr = fr || p.fecha_llegada || null;
                    if (fs && fr) break;
                }
            }
            const fsDMY = this.formatFechaDMY(fs);
            const frDMY = this.formatFechaDMY(fr);
            const { noches, dias } = this.diffNochesDias(fs, fr);

            const habLine = context.habitaciones_text ? `🏨 *Habitaciones:* ${context.habitaciones_text}` : null;

            let ocupacionLine = null;
            const ad = Number.isFinite(context.adultos) ? context.adultos : null;
            const menores = Array.isArray(context.menores) ? context.menores : [];
            if (ad || menores.length) {
                const parts = [];
                if (ad) parts.push(`${ad} ${ad === 1 ? 'adulto' : 'adultos'}`);
                for (const m of menores) {
                    const edad = Number(m);
                    parts.push(`1 menor (*${Number.isFinite(edad) ? `${edad} ${edad === 1 ? 'año' : 'años'}` : 'edad por definir'}*)`);
                }
                ocupacionLine = `👨‍👩‍👧‍👦 ${parts.join(', ')}`;
            }

            const anyTI = arr.some(p => !!p?.todo_incluido);
            const anyTrans = arr.some(p => !!p?.con_transporte);

            const header = `🏖️ ¡Ofertas increíbles en *${destino}*! 🌴`;
            const lineaDuracion = (Number.isFinite(dias) && Number.isFinite(noches))
                ? `🌟 *${dias} DÍAS - ${noches} NOCHES*`
                : '🌟 *Duración por definir*';
            const lineaFechas = (fsDMY || frDMY)
                ? `📅 *Fechas:* ${fsDMY || 'por definir'} al ${frDMY || 'por definir'}`
                : '📅 *Fechas:* por definir';

            const piezas = [
                header, '',
                lineaDuracion,
                lineaFechas,
                ...(habLine ? [habLine] : []),
                ...(ocupacionLine ? [ocupacionLine] : []),
                '',
                '✨ ¡Esto es lo que incluye! ✨',
                anyTI ? '✅ *Todo incluido*' : '✅ *Plan según opción*',
                anyTrans ? '🚌 *Transporte redondo (camión)*' : '🚌 *Transporte* según opción',
                anyTI ? '⭐ *Plan Todo Incluido* para disfrutar sin límites:' : null,
                ...(anyTI ? [
                    '🍽 Desayunos, comidas y cenas *buffet*',
                    '🍔 *Snacks* ilimitados',
                    '🍺 Bebidas *alcohólicas* ilimitadas',
                    '🍹 Bebidas *no alcohólicas* ilimitadas',
                    '🏖️ *Actividades en el hotel* para relajarte o divertirte'
                ] : []),
                ''
            ].filter(Boolean);

            const extrasAgg = this.collectExtras(arr);
            if (extrasAgg) piezas.push(`➕ *Extras destacados:* ${extrasAgg}`, '');

            piezas.push(
                '🎉 ¡Elige tu favorito y vive unas vacaciones inolvidables! 🎉',
                '👉 ¿Necesitas *más información* o *reservar*? ¡Contáctanos!',
                '',
                'Precios sujetos a *disponibilidad* y cambio de tarifa *sin previo aviso*.'
            );

            return piezas.join('\n').trim();
        } catch {
            return (
                'ℹ️ *Detalles generales*\n' +
                '🍽️ *Plan de alimentos según opción* (podemos ajustar a *todo incluido*).\n' +
                '🚌 *Transporte* según opción (podemos cotizarlo).\n' +
                '📆 *Fechas* sujetas a disponibilidad.\n' +
                '💳 *Tarifas por persona*, pueden variar.'
            ).trim();
        }
    }

    // Lista numerada 1., 2., 3. con precios por hotel
    buildPriceBreakdownList(promos = [], context = {}) {
        if (!Array.isArray(promos) || promos.length === 0) return null;
        const emojiMap = ['🌊', '🌅', '🌞', '🌴', '✨'];
        const lines = [];

        promos.forEach((p, idx) => {
            const i = idx + 1;
            const e = emojiMap[idx % emojiMap.length];
            const hotel = (p?.titulo || p?.destino || `Opción ${i}`).toString().trim();

            const pa = this.formatMXN(p?.precio_adulto);
            const pm = this.formatMXN(p?.precio_menor);
            const pbm = this.formatMXN(p?.precio_bus_menor);
            const total = this.formatMXN(p?.importe_total);
            const deposito = (p?.importe_total != null) ? this.formatMXN(Number(p.importe_total) * 0.30) : null;

            const priceLines = [];
            if (pa) priceLines.push(`💰 *Precio por adulto:* ${pa}`);

            if (p?.menores_gratis) {
                priceLines.push('💰 *Precio por menor:* Gratis');
                if (pbm) priceLines.push(`💰 *Precio por menor (bus):* ${pbm}`);
            } else {
                if (pm) priceLines.push(`💰 *Precio por menor:* ${pm}`);
                if (pbm) priceLines.push(`💰 *Precio por menor (bus):* ${pbm}`);
            }

            if (total) {
                priceLines.push(`💵 *Importe total:* ${total}`);
                if (deposito) priceLines.push(`💳 *Importe para reservar (30%):* ${deposito}`);
            }

            const block = `${i}. *${hotel}* ${e}\n${priceLines.join('\n')}`;
            lines.push(block);
        });

        return lines.join('\n\n').trim();
    }


    ensurePersonalizedGreeting(text, userName) {
        try {
            if (!text) return text;
            const name = (this.getFirstName ? this.getFirstName(userName) : (userName || 'Cliente')).toString().trim();
            // Si comienza con "Hola" y no trae el nombre en negritas, lo insertamos
            if (/^¡?hola[!¡]?\b/i.test(text) && !text.includes(`*${name}*`)) {
                return text.replace(/^¡?hola[!¡]?/i, `¡Hola, *${name}*!`);
            }
            return text;
        } catch {
            return text;
        }
    }


    // ——— Helper: primer nombre limpio
    getFirstName(n) {
        try {
            if (!n) return 'viajer@';
            const clean = String(n).replace(/[^\p{L}\p{N}\s\.'-]/gu, '').trim();
            return clean.split(/\s+/)[0] || 'viajer@';
        } catch { return 'viajer@'; }
    }

    // Extrae un mes en español del texto y devuelve 'YYYY-MM'.
    // Si el mes ya pasó este año, asume el próximo año.
    extractMonthFromText(txt = '') {
        const m = (txt || '').toLowerCase();
        const map = {
            'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4, 'mayo': 5, 'junio': 6,
            'julio': 7, 'agosto': 8, 'septiembre': 9, 'setiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
        };
        const found = Object.keys(map).find(k => m.includes(k));
        if (!found) return null;

        const month = map[found];
        const now = new Date();
        let year = now.getFullYear();

        // si ya pasó, usar el próximo año
        const currentMonth = now.getMonth() + 1;
        if (month < currentMonth) year += 1;

        return `${year}-${String(month).padStart(2, '0')}`;
    }


    // ——— Helper: saludo + pedir filtros mínimos (mes + playa/destino)
    makePromoGreetingAndAsk(userName) {
        const nombre = this.getFirstName(userName);
        return (
            `¡Hola, *${nombre}*! Somos *${AGENCY_NAME}* ${BRAND_EMOJIS}.\n` +
            `¿Tienes alguna *fecha/mes tentativo* y alguna *playa/destino* en especial? ` +
            `Así busco *3 promos ideales* para ti 🏝️✨`
        );
    }

    // ——— Helper: armar paquete agrupado para PROMOS_GROUP
    buildGroupedPromoPayload(promos = [], context = {}) {
        // 3 imágenes (primera de cada promo)
        const images = (promos || [])
            .map(p => (Array.isArray(p?.imagenes) ? p.imagenes[0] : null))
            .filter(Boolean)
            .slice(0, 3);

        // NUEVO: un solo mensaje con ofertas por hotel (encabezado con destinos)
        const offers_message = this.buildOffersMessage(promos);

        // NUEVO: bloque “¡Esto es lo que incluye!” exacto + extras por hotel
        const includes_message = this.buildIncludesMessage(promos, context);

        // Seguimiento/CTA (lo manda el service al final)
        const followup = '¿Quieres *más info*, *reservar* o *ajustar fechas/destino*? También te ayudo con *dudas* o *pagos*.';

        // Compatibilidad con flujos anteriores (no se usan si ya hay offers/includes)
        const top3 = (promos || []).slice(0, 3).map(p => this.promoToCopy(p)).join('\n\n');
        const group_copy = `🏖️ *Ofertas seleccionadas* 🌊🌿\n\n${top3}`;
        const common_details = this.makeCommonDetailsMessage
            ? this.makeCommonDetailsMessage(promos)
            : 'ℹ️ Detalles generales disponibles.';
        const price_list = this.buildPriceBreakdownList
            ? this.buildPriceBreakdownList(promos, context)
            : null;

        return { images, offers_message, includes_message, followup, group_copy, common_details, price_list };
    }


    // ————————————————————————————————————————————————
    // Mensaje de *Detalles generales* (para enviarlo después del copy de 3 opciones)
    // PÉGALO DEBAJO de promoToCopy(p)
    makeCommonDetailsMessage(promos = []) {
        try {
            const arr = Array.isArray(promos) ? promos : [promos];

            // Señales para ajustar el wording
            const anyTI = arr.some(p => !!p?.todo_incluido);
            const anyTrans = arr.some(p => !!p?.con_transporte);

            // Líneas dinámicas (con emojis + negritas)
            const tiLine = anyTI
                ? '🍽️ *Todo incluido*: desayuno, comida y cena tipo *buffet*; 🍹 *bebidas alcohólicas y no alcohólicas ilimitadas*; 🎯 *actividades dentro del hotel*.'
                : '🍽️ *Plan de alimentos según opción*. Si lo prefieres, podemos ajustar a *todo incluido*.';

            const trLine = anyTrans
                ? '🚌 *Transporte redondo* incluido en las opciones indicadas (consulta disponibilidad).'
                : '🚌 *Transporte* no incluido (podemos cotizarlo en *camión o avión*).';

            // Mensaje final (orden y estilo que verán tus clientes)
            const msg =
                'ℹ️ *Detalles generales*\n' +
                `${tiLine}\n` +
                `${trLine}\n` +
                '📆 *Fechas y disponibilidad* sujetas a cambios sin previo aviso.\n' +
                '💳 *Tarifas por persona*, pueden variar según fecha, ocupación y disponibilidad.\n' +
                '🧾 Impuestos y cargos aplican según la opción elegida.\n' +
                '✅ Podemos *ajustar habitación, noches y ocupación* a tu preferencia.';

            return msg.trim();
        } catch {
            // Fallback seguro
            return (
                'ℹ️ *Detalles generales*\n' +
                '🍽️ *Plan de alimentos según opción* (podemos ajustar a *todo incluido*).\n' +
                '🚌 *Transporte* según opción (podemos cotizarlo).\n' +
                '📆 *Fechas* sujetas a disponibilidad.\n' +
                '💳 *Tarifas por persona*, pueden variar.'
            ).trim();
        }
    }

    // ————————————————————————————————————————————————
    // Mensaje de *Políticas de pago* (para incentivar compra)
    makePaymentPoliciesMessage() {
        return (
            '💳 *Políticas de pago*\n' +
            '• *Formas de pago*: transferencia, tarjeta de crédito/débito.\n' +
            '• *Apartado con anticipo* y liquidación previa a la salida (según opción y disponibilidad).\n' +
            '• *Meses sin intereses* sujetos a promociones del banco/proveedor.\n' +
            '• Tarifas y condiciones pueden variar por *fecha, ocupación y proveedor*.'
        ).trim();
    }

    // ====== Hotelpedia helpers ======
    async getHotelByNameFlexible(name) {
        try {
            if (!name || !name.trim()) return null;
            const n = name.trim();

            // 1) match exacto (case-insensitive)
            let r = await ejecutarConReintento(
                `SELECT * FROM hotels WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                [n]
            );
            if (r.rows.length) return r.rows[0];

            // 2) match flexible
            r = await ejecutarConReintento(
                `SELECT * FROM hotels WHERE LOWER(name) ILIKE LOWER($1) ORDER BY name LIMIT 1`,
                [`%${n}%`]
            );
            if (r.rows.length) return r.rows[0];

            return null;
        } catch (e) {
            console.error('getHotelByNameFlexible error:', e.message);
            return null;
        }
    }

    async getHotelLinks(hotelId) {
        try {
            const r = await ejecutarConReintento(
                `SELECT id, section, title, url, sort_order
       FROM hotel_links
       WHERE hotel_id=$1
       ORDER BY section, sort_order, id`,
                [hotelId]
            );
            return r.rows;
        } catch (e) {
            console.error('getHotelLinks error:', e.message);
            return [];
        }
    }

    // Mensaje de 1 hotel (ficha corta + tip + links por secciones)
    buildHotelInfoMessage(h, links = [], reqSections = []) {
        const stars = h?.stars ? `${h.stars}★` : 'Sin categoría';
        const pools = Number.isFinite(h?.pools) ? `${h.pools}` : 'n/d';
        const rests = Number.isFinite(h?.restaurants) ? `${h.restaurants}` : 'n/d';
        const specs = (h?.specialties || '').trim();
        const dest = (h?.destination || 'por definir').trim();
        const zone = (h?.zone || '').trim();

        const feats = [];
        feats.push(`🏨 *${h.name}* (${stars})`);
        feats.push(`📍 ${dest}${zone ? ` • ${zone}` : ''}`);
        feats.push(`🏊 Albercas: ${pools}  •  🍽 Restaurantes: ${rests}`);
        if (specs) feats.push(`🍴 Especialidades: ${specs}`);
        if (h.has_gym) feats.push('💪 *Gimnasio*');
        if (h.has_spa) feats.push('💆 *Spa*');
        if (h.has_kids_club) feats.push('🧒 *Kids Club*');
        if (h.adults_only) feats.push('🔞 *Solo adultos*');

        if (h.personal_tip) {
            feats.push('');
            feats.push(`📝 *Mi recomendación:* ${h.personal_tip}`);
        }

        // TikTok / video externo
        const extraLinks = [];
        if (h.tiktok_url) extraLinks.push(`🎬 TikTok: ${h.tiktok_url}`);
        if (h.external_video_url) extraLinks.push(`🎥 Video: ${h.external_video_url}`);

        // Links por secciones
        const wanted = Array.isArray(reqSections) && reqSections.length
            ? new Set(reqSections.map(s => s.toLowerCase()))
            : null;

        const bySection = new Map();
        for (const L of links) {
            const sec = (L.section || '').toLowerCase();
            if (wanted && !wanted.has(sec)) continue; // si pidieron secciones, filtra
            if (!bySection.has(sec)) bySection.set(sec, []);
            bySection.get(sec).push(L);
        }

        const secLines = [];
        for (const [sec, arr] of bySection.entries()) {
            if (!sec) continue;
            const top = arr.slice(0, 3).map(x => `• ${(x.title || x.url)} → ${x.url}`);
            if (top.length) {
                const label = sec.charAt(0).toUpperCase() + sec.slice(1);
                secLines.push(`🔗 *${label}:*\n${top.join('\n')}`);
            }
        }

        const parts = [feats.join('\n')];
        if (secLines.length) parts.push('', secLines.join('\n\n'));
        if (extraLinks.length) parts.push('', extraLinks.join('\n'));

        parts.push('', '¿Quieres más detalles o fechas? Te ayudo con gusto 🌊🌿✨');
        return parts.join('\n').trim();
    }

    // Comparativo 2 hoteles + recomendación simple por estrellas/amenidades
    buildHotelCompareMessage(h1, h2) {
        const fmt = (h) => ({
            n: h?.name || 'Hotel',
            s: h?.stars ? `${h.stars}★` : 'n/d',
            gym: h?.has_gym ? 'Sí' : 'No',
            spa: h?.has_spa ? 'Sí' : 'No',
            kids: h?.has_kids_club ? 'Sí' : 'No',
            adu: h?.adults_only ? 'Sí' : 'No',
            pools: Number.isFinite(h?.pools) ? h.pools : 'n/d',
            r: Number.isFinite(h?.restaurants) ? h.restaurants : 'n/d'
        });
        const a = fmt(h1), b = fmt(h2);

        const lines = [
            `⚖️ *Comparativo rápido*`,
            `1) *${a.n}* (${a.s})`,
            `   Albercas: ${a.pools} • Restaurantes: ${a.r} • Gym: ${a.gym} • Spa: ${a.spa} • Kids: ${a.kids} • Solo adultos: ${a.adu}`,
            `2) *${b.n}* (${b.s})`,
            `   Albercas: ${b.pools} • Restaurantes: ${b.r} • Gym: ${b.gym} • Spa: ${b.spa} • Kids: ${b.kids} • Solo adultos: ${b.adu}`
        ];

        // Recomendación muy sencilla: más estrellas y/o más amenidades
        const score = (h) => {
            let sc = 0;
            sc += Number(h?.stars || 0);
            if (h?.has_spa) sc += 0.5;
            if (h?.has_gym) sc += 0.3;
            if (h?.has_kids_club) sc += 0.2;
            return sc;
        };
        const rec = score(h1) >= score(h2) ? h1 : h2;
        lines.push('', `✅ *Recomendación:* *${rec?.name || 'Cualquiera'}* por relación calidad/amenidades.`);

        lines.push('', 'Si me dices fechas y plan (TI / con transporte), afinamos opciones y precios.');
        return lines.join('\n').trim();
    }


    // ========= HISTORIAL =========
    async buildHistoryItems(phoneNumber, latestUserText) {
        const q = `
      SELECT tipo_remitente, mensaje, COALESCE(nombre_usuario,'') AS nombre_usuario
      FROM mensajes
      WHERE numero_telefono=$1
      ORDER BY fecha_hora DESC
      LIMIT 15
    `;
        const { rows } = await ejecutarConReintento(q, [phoneNumber]);
        const reversed = rows.reverse();

        const items = [];
        items.push({ role: 'user', content: [{ type: 'input_text', text: this.getSystemPrompt() }] });

        for (const row of reversed) {
            if (!row.mensaje) continue;
            let role = 'user';
            if (row.tipo_remitente === 'received') role = 'user';
            else if (row.tipo_remitente === 'sent' && row.nombre_usuario === 'Asistente') role = 'assistant';
            else role = 'user';

            items.push({
                role,
                content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: row.mensaje }]
            });
        }

        items.push({ role: 'user', content: [{ type: 'input_text', text: (latestUserText || '').trim() }] });
        return items;
    }

    // ========= CONVERSATIONS =========
    async ensureConversation(phoneNumber) {
        const existing = await getConversationId(phoneNumber);
        return existing || null;
    }

    async responsesCreateWithRetries({ model, input, conversation, store, max_output_tokens }) {
        const client = this.client;
        const attempts = 3;
        const baseDelay = 400; // ms

        const safePreview = (obj) => {
            try { return JSON.stringify(obj).slice(0, 300); } catch { return '[unserializable]'; }
        };

        for (let i = 1; i <= attempts; i++) {
            const started = Date.now();
            try {
                console.log(`[OpenAI] intento ${i}/${attempts} | conv=${conversation || '(new)'} | items=${Array.isArray(input) ? input.length : 'n/a'}`);
                const resp = await client.responses.create({
                    model,
                    input,
                    ...(conversation ? { conversation } : {}),
                    ...(store ? { store } : {}),
                    max_output_tokens
                });
                const took = Date.now() - started;

                // Logs sanos del payload
                const outText = resp?.output_text || resp?.output?.[0]?.content?.[0]?.text || '';
                console.log(`[OpenAI] intento ${i} OK (${took}ms) | output_text.len=${String(outText).length}`);

                // A veces el SDK regresa sin texto (vacío). Reintentamos si i < attempts.
                if (!outText && i < attempts) {
                    console.warn(`[OpenAI] respuesta vacía; reintento #${i + 1}`);
                    await new Promise(r => setTimeout(r, baseDelay * i));
                    continue;
                }

                return resp;

            } catch (err) {
                const took = Date.now() - started;
                const code = err?.status || err?.code || err?.name || 'unknown';
                const msg = err?.message || safePreview(err?.error) || 'error';
                console.error(`[OpenAI] intento ${i} FALLÓ (${took}ms) | code=${code} | ${msg}`);

                // Errores transitorios: 408/429/5xx o network → reintentar
                const retriable =
                    code === 408 ||
                    code === 429 ||
                    (typeof code === 'number' && code >= 500) ||
                    /ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN/i.test(String(code)) ||
                    /timeout/i.test(msg);

                if (retriable && i < attempts) {
                    await new Promise(r => setTimeout(r, baseDelay * i));
                    continue;
                }

                // Si no es transitorio o ya se agotaron intentos, relanza
                throw err;
            }
        }
        // No debería llegar aquí
        return null;
    }


    async _respondWithRecovery({ phoneNumber, conversationId, items }) {
        if (!this.client || !this.client.responses?.create) {
            throw new Error('OpenAI v4 no inicializado (responses.create no disponible)');
        }

        const call = async (opts) => this.responsesCreateWithRetries({
            model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
            input: items,
            conversation: opts.conversation,
            store: opts.store,
            max_output_tokens: 900
        });

        // 1) Si hay conversación previa, intenta continuarla
        if (conversationId) {
            try {
                const resp = await call({ conversation: conversationId, store: false });
                return { resp, recovered: false, newConversationId: null };
            } catch (err) {
                const is404Conv =
                    err?.status === 404 &&
                    typeof err?.error?.message === 'string' &&
                    err.error.message.includes('Conversation with id');

                if (!is404Conv) throw err;

                // 404 → limpia conv y crea nueva
                try { await upsertConversationId(phoneNumber, null); } catch { }
                const retry = await call({ conversation: null, store: true });
                const newId = retry?.conversation?.id || null;
                if (newId) {
                    try { await upsertConversationId(phoneNumber, newId); } catch { }
                }
                return { resp: retry, recovered: true, newConversationId: newId };
            }
        }

        // 2) Sin conversación previa → crea y guarda
        const created = await call({ conversation: null, store: true });
        const newId = created?.conversation?.id || null;
        if (newId) {
            try { await upsertConversationId(phoneNumber, newId); } catch { }
        }
        return { resp: created, recovered: false, newConversationId: newId };
    }





    // Busca promos por *mención* en texto libre (hotel, destino, o descripción).
    // Extrae palabras útiles (≥3 chars) y hace match flexible en titulo/destino/descripcion.
    // Ordena por cercanía a hoy y precio. Máx 3 resultados.
    async findPromosByMention(text = '', extraFilters = {}) {
        const raw = (text || '').toLowerCase();
        const tokens = Array.from(
            new Set((raw.match(/[a-záéíóúñü0-9]{3,}/gi) || []).map(t => t.toLowerCase()))
        );

        // Si no hay tokens útiles, cae al flex normal
        if (!tokens.length) {
            return [];
        }

        const params = [];
        const wheres = [];

        // OR por cada token en (titulo|destino|descripcion)
        const orGroups = tokens.map(tok => {
            params.push(`%${tok}%`);
            const idx = params.length;
            return `(LOWER(p.titulo) ILIKE $${idx} OR LOWER(p.destino) ILIKE $${idx} OR LOWER(COALESCE(p.descripcion,'')) ILIKE $${idx})`;
        });
        if (orGroups.length) {
            wheres.push(`(${orGroups.join(' OR ')})`);
        }

        // Filtros extra opcionales (alineados con findPromos)
        if (extraFilters && typeof extraFilters === 'object') {
            if (extraFilters.destino) {
                params.push(`%${String(extraFilters.destino).trim().toLowerCase()}%`);
                wheres.push(`LOWER(p.destino) ILIKE $${params.length}`);
            }
            if (typeof extraFilters.todo_incluido === 'boolean') {
                params.push(extraFilters.todo_incluido);
                wheres.push(`p.todo_incluido = $${params.length}`);
            }
            if (typeof extraFilters.con_transporte === 'boolean') {
                params.push(extraFilters.con_transporte);
                wheres.push(`p.con_transporte = $${params.length}`);
            }
            if (extraFilters.fecha_salida_from) {
                params.push(extraFilters.fecha_salida_from);
                wheres.push(`p.fecha_salida >= $${params.length}::date`);
            }
            if (extraFilters.fecha_salida_to) {
                params.push(extraFilters.fecha_salida_to);
                wheres.push(`p.fecha_salida <= $${params.length}::date`);
            }
            if (extraFilters.mes && /^\d{4}-\d{2}$/.test(extraFilters.mes)) {
                const start = `${extraFilters.mes}-01`;
                params.push(start);
                wheres.push(`p.fecha_salida >= $${params.length}::date`);
                params.push(start);
                wheres.push(`p.fecha_salida < ($${params.length}::date + INTERVAL '1 month')`);
            }
        }

        const whereSQL = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
        const sql = `
                WITH base AS (
                SELECT
                    p.*,
                    CASE WHEN p.fecha_salida >= NOW()::date THEN 0 ELSE 1 END AS after_now,
                    ABS(COALESCE(p.fecha_salida, NOW()::date) - NOW()::date) AS days_from_today
                FROM promos p
                ${whereSQL}
                )
                SELECT *
                FROM base
                ORDER BY
                after_now ASC,
                days_from_today ASC,
                COALESCE(precio_adulto, 1e12) ASC
                LIMIT 3;
            `;

        try {
            const res = await ejecutarConReintento(sql, params);
            return res?.rows || [];
        } catch (e) {
            console.error('findPromosByMention error:', e);
            return [];
        }
    }



    // ========= CORE =========
    async procesarMensajeConOpenAI(a, b, c) {
        let phoneNumber, userText, userName;
        if (typeof a === 'object') {
            phoneNumber = a.phoneNumber;
            userText = a.userText;
            userName = a.userName || 'Cliente';
        } else {
            phoneNumber = a;
            userText = b;
            userName = c || 'Cliente';
        }

        if (!this.client) {
            throw new Error('OpenAI v4 no inicializado (cliente ausente)');
        }

        // Helpers locales
        const firstName = (() => {
            try {
                const clean = String(userName || 'Cliente').replace(/[^\p{L}\p{N}\s\.'-]/gu, '').trim();
                return clean.split(/\s+/)[0] || 'Cliente';
            } catch { return 'Cliente'; }
        })();

        const buildGroupFromPromos = (promos = []) => {
            // Usa helper global si ya lo pegaste; si no, arma aquí
            if (typeof this.buildGroupedPromoPayload === 'function') {
                return this.buildGroupedPromoPayload(promos);
            }
            // 3 imágenes (1 por promo)
            const images = promos
                .map(p => (Array.isArray(p.imagenes) ? p.imagenes[0] : null))
                .filter(Boolean)
                .slice(0, 3)
                .map(u => this.whatsappService?.toAbsoluteUrl(u) ?? u);

            // Copy consolidado con tu promoToCopy(p)
            const top3 = promos.slice(0, 3).map(p => this.promoToCopy(p)).join('\n\n');
            const group_copy = `🏝️ *Top 3 opciones* ${BRAND_EMOJIS}\n${top3}`;

            // Detalles generales
            const common_details = typeof this.makeCommonDetailsMessage === 'function'
                ? this.makeCommonDetailsMessage(promos)
                : 'ℹ️ *Detalles generales disponibles* (plan de alimentos y transporte según opción).';

            // Seguimiento
            const followup = '¿Qué te parecieron? 🤔 ¿Buscas otra *fecha* o *destino*? Si gustas, armamos una *cotización personalizada* en 2 min 🙌';

            return { images, group_copy, common_details, followup };
        };

        const tryFindPromosFlex = async (filtersInput) => {
            let hadError = false;
            let promos = [];

            const safeFind = async (f) => {
                try {
                    return await this.findPromos(f || {});
                } catch (e) {
                    hadError = true;
                    console.error('findPromos error in flex:', e?.message || e);
                    return null;
                }
            };

            const base = (filtersInput && typeof filtersInput === 'object') ? { ...filtersInput } : null;

            // 1) Tal cual filtros
            promos = await safeFind(base);
            if (Array.isArray(promos) && promos.length) return { promos, hadError };

            // 2) Relajar destino
            if (base && base.destino) {
                const relaxed = { ...base };
                delete relaxed.destino;
                promos = await safeFind(relaxed);
                if (Array.isArray(promos) && promos.length) return { promos, hadError };
            }

            // 3) Top activas por fecha (cercanas a hoy)
            promos = await safeFind({});
            return { promos: Array.isArray(promos) ? promos : [], hadError };
        };





        ///////////////////////////////////////////////////////////////////////////////////////

        let conversationId = await this.ensureConversation(phoneNumber);
        const items = await this.buildHistoryItems(phoneNumber, userText);

        let { resp, recovered, newConversationId } = await this._respondWithRecovery({
            phoneNumber,
            conversationId,
            items
        });

        if (recovered && newConversationId) {
            conversationId = newConversationId;
        } else if (!conversationId && resp?.conversation?.id) {
            conversationId = resp.conversation.id;
            try { await upsertConversationId(phoneNumber, conversationId); } catch { }
        }

        const raw =
            resp?.output_text ||
            (resp?.output?.[0]?.content?.[0]?.text ?? 'Disculpa, hubo un detalle técnico.');

        console.log('\n=== RESPUESTA OPENAI (raw) ===');
        console.log('Longitud:', raw?.length);
        console.log('Primeros 500 chars:', raw?.substring(0, 500));
        console.log('Últimos 500 chars:', raw?.substring(raw.length - 500));
        console.log('================================\n');

        const { visible, control } = this.parseControl(raw);
        console.log('CTRL parseado:', control ? 'SI' : 'NO');
        if (control) console.log('CTRL intent:', control.intent, 'filters:', control.promo_filters);

        // Etiquetas sugeridas por LLM
        if (control?.suggested_tags?.length) {
            try { await this.applySuggestedTags(phoneNumber, control.suggested_tags); } catch { }
        }

        // Handoff a humano
        if (control?.intent === 'humano') {
            try {
                await ejecutarConReintento(
                    `INSERT INTO assistant_status (numero_telefono, active)
         VALUES ($1, FALSE)
         ON CONFLICT (numero_telefono)
         DO UPDATE SET active = FALSE`,
                    [phoneNumber]
                );
            } catch { }
            return `Te conecto con una persona de *${AGENCY_NAME}* ${BRAND_EMOJIS}. En breve te atiende un asesor.`;
        }
        
        
        
        // ===== LÓGICA HOTELPEDIA (info y comparación) =====
        try {
            const txt = String(userText || '');
            const intentHotel = control?.intent === 'hotel_info' || control?.intent === 'hotel_compare';
            const hq = control?.hotel_query || null;

            if (intentHotel && hq && Array.isArray(hq.names) && hq.names.length) {
                // 1) Resolver hoteles
                const names = hq.names.slice(0, 2);
                const sections = Array.isArray(hq.sections) ? hq.sections.map(s => String(s).toLowerCase()) : [];

                const found = [];
                for (const n of names) {
                    const h = await this.getHotelByNameFlexible(n);
                    if (h) found.push(h);
                }

                if (!found.length) {
                    // No hay hoteles en DB: pedir que lo agreguen/precisen
                    try { await this.applySuggestedTags(phoneNumber, ['SIC']); } catch { }
                    return `Puedo compartirte detalles, pero no encuentro *${names.join(' / ')}* en nuestra base. ¿Confirmas el nombre y destino? Si no está, lo agrego en un momento.`;
                }

                // 2) Links + media
                const withLinks = [];
                for (const h of found) {
                    const links = await this.getHotelLinks(h.id);
                    withLinks.push({ h, links });
                }

                // 3) Armar payload para envío (reutilizamos PROMOS_GROUP)
                const group = {};
                const images = [];
                for (const { h } of withLinks) {
                    let media = [];
                    try {
                        media = Array.isArray(h.media) ? h.media : (h.media ? JSON.parse(h.media) : []);
                    } catch { media = []; }
                    (media || []).slice(0, 2).forEach(u => images.push(u));
                }
                group.images = images.slice(0, 3);

                if (found.length === 1) {
                    const { h, links } = withLinks[0];
                    const info = this.buildHotelInfoMessage(h, links, sections);
                    group.offers_message = info;

                    // Si el usuario pidió secciones específicas y no hubo links de esas secciones → handoff
                    if (sections.length) {
                        const hay = links.some(L => sections.includes(String(L.section || '').toLowerCase()));
                        if (!hay) {
                            try {
                                await ejecutarConReintento(
                                    `INSERT INTO assistant_status (numero_telefono, active)
               VALUES ($1, FALSE)
               ON CONFLICT (numero_telefono)
               DO UPDATE SET active = FALSE`,
                                    [phoneNumber]
                                );
                                try { await this.applySuggestedTags(phoneNumber, ['Seguimiento']); } catch { }
                            } catch { }
                            const visibleMsg = `Te consigo *enseguida* fotos/links de ${sections.join(', ')} de *${h.name}*. Un asesor te las envía en breve.`;
                            return `${visibleMsg}\n\nPROMOS_GROUP:${JSON.stringify(group)}`;
                        }
                    }

                    // Enviar
                    return `Te paso detalles del hotel 👇\n\nPROMOS_GROUP:${JSON.stringify(group)}`;
                }

                if (found.length === 2) {
                    const cmp = this.buildHotelCompareMessage(found[0], found[1]);
                    group.offers_message = cmp;

                    // Si pidieron secciones, agrega un "includes_message" con links por sección, si hay
                    const secWanted = new Set(sections);
                    const secLines = [];
                    for (const { h, links } of withLinks) {
                        const pick = links.filter(L => !sections.length || secWanted.has(String(L.section || '').toLowerCase()))
                            .slice(0, 3)
                            .map(x => `• ${(x.title || x.url)} → ${x.url}`);
                        if (pick.length) {
                            secLines.push(`🔗 *${h.name}:*\n${pick.join('\n')}`);
                        }
                    }
                    if (secLines.length) group.includes_message = secLines.join('\n\n');

                    return `Listo, aquí va el comparativo 👇\n\nPROMOS_GROUP:${JSON.stringify(group)}`;
                }
            }
        } catch (e) {
            console.error('HOTELPEDIA flow error:', e.message);
        }




        // ===== LÓGICA DE PROMOS (flexible) =====
        let finalText = visible;
        const wantsPromos = control?.intent === 'promos';

        // Normaliza filtros y añade 'mes' si lo detectamos en el texto
        let pf = (control && control.promo_filters) ? { ...control.promo_filters } : {};
        const monthFromText = this.extractMonthFromText ? this.extractMonthFromText(userText) : null;
        if (!pf.mes && monthFromText) {
            pf.mes = monthFromText;
        }

        // hasFilters = “tiene llaves” ({} es truthy, pero no tiene llaves)
        const hasFilters = pf && Object.keys(pf).length > 0;
        const askedPromos = /promoc(i|í|io|ión|iones)|promos?/i.test(userText || '');
        console.log('[PROMOS] askedPromos=', askedPromos, '| wantsPromos=', wantsPromos, '| pf=', pf);

        // Caso A: el usuario menciona "promos" pero el intent no vino como 'promos'
        if (askedPromos && !(control && control.intent === 'promos')) {
            const hasBasic =
                !!(pf?.destino || pf?.mes || pf?.fecha_salida_from || pf?.fecha_salida_to);

            const mentionsSpecific =
                /\b(vi|ví)\b.*\bpromo|\bpromo(s)?\b.*\b(whats|whatsapp|estado|facebook|face|historia|stories|publicaci[oó]n)\b/i
                    .test(userText || '');

            // 1) Si parece que vio una promo en redes/estados → buscar por *mención* primero
            if (mentionsSpecific) {
                try {
                    let promos = await this.findPromosByMention(userText, pf);

                    if (!promos || !promos.length) {
                        const flex = await tryFindPromosFlex(pf);
                        promos = flex.promos;
                    }

                    if (promos && promos.length) {
                        try { await this.applySuggestedTags(phoneNumber, ['MP']); } catch { }

                        if (!finalText || !finalText.trim()) {
                            finalText = `¡Hola, *${firstName}*! Somos *${AGENCY_NAME}* ${BRAND_EMOJIS}.`;
                        }
                        finalText += `\n\nListo, te comparto *3 opciones* 👇 ${BRAND_EMOJIS}`;

                        const group = buildGroupFromPromos(promos);
                        if (typeof this.makePaymentPoliciesMessage === 'function') {
                            group.payments = this.makePaymentPoliciesMessage();
                        }
                        finalText += `\n\nPROMOS_GROUP:${JSON.stringify(group)}`;
                    } else {
                        finalText = this.makePromoGreetingAndAsk(userName);
                        try { await this.applySuggestedTags(phoneNumber, ['SIC']); } catch { }
                    }
                } catch (e) {
                    console.warn('Promos mention warn:', e.message);
                    finalText = this.makePromoGreetingAndAsk(userName);
                }
                console.log('[RETURN] Caso A (mentionsSpecific) → len=', (finalText || '').length);
                return (finalText || '').trim();
            }

            // 2) Si NO hay mes ni destino → solo saludo y preguntas
            if (!hasBasic) {
                finalText = this.makePromoGreetingAndAsk(userName);
                try { await this.applySuggestedTags(phoneNumber, ['SIC']); } catch { }
                console.log('[RETURN] Caso A (sin filtros) → len=', (finalText || '').length);
                return (finalText || '').trim();
            }

            // 3) Si hay *mes* (aunque sin destino), manda directo opciones de ese mes (flex)
            try {
                const { promos, hadError } = await tryFindPromosFlex(pf);

                if (promos && promos.length) {
                    try { await this.applySuggestedTags(phoneNumber, ['MP']); } catch { }

                    if (!finalText || !finalText.trim()) {
                        finalText = `¡Hola, *${firstName}*! Somos *${AGENCY_NAME}* ${BRAND_EMOJIS}.`;
                    }
                    finalText += `\n\nListo, te comparto *3 opciones* 👇 ${BRAND_EMOJIS}`;

                    const group = buildGroupFromPromos(promos);
                    finalText += `\n\nPROMOS_GROUP:${JSON.stringify(group)}`;
                } else if (!hadError) {
                    finalText += `\n\nNo encontré promos activas que coincidan justo ahora. ¿Te comparto *otras* similares por fecha o destino, o armamos una *cotización personalizada*? ${BRAND_EMOJIS}`;
                }
            } catch (e) {
                console.warn('Promos flexible warn:', e.message);
            }
            // Si cae aquí, no retornaste antes → devuelve lo construido
            console.log('[RETURN] Caso A (con filtros/mes) → len=', (finalText || '').length);
            return (finalText || '').trim();
        }


        // Caso B: intent=promos o cotización con filtros → buscar y responder
        const hasBasicForSearch =
            !!(pf?.destino || pf?.mes || pf?.fecha_salida_from || pf?.fecha_salida_to);

        if ((hasBasicForSearch && (wantsPromos || control?.intent === 'cotizacion')) || wantsPromos || (pf?.mes && !pf?.destino)) {
            try {
                // 1) Intentar con los filtros tal cual (usa pf SIEMPRE)
                let promos = [];
                if (hasFilters) {
                    promos = await this.findPromos(pf);
                }

                // 2) Fallback flexible:
                //    - antes era solo si wantsPromos; ahora también si trajo “mes” (pf.mes)
                let hadErrorFlex = false;
                if (!promos || !promos.length) {
                    if (wantsPromos || pf?.mes) {
                        const flex = await tryFindPromosFlex(pf);
                        promos = flex.promos;
                        hadErrorFlex = flex.hadError;
                    }
                }

                // 3) Si hay promos, arma el paquete PROMOS_GROUP
                if (promos && promos.length) {
                    try { await this.applySuggestedTags(phoneNumber, ['MP']); } catch { }

                    // Si el visible original trae preguntas y ya tenemos "mes", da intro directa
                    if (pf?.mes && (!finalText || /¿|buscas|prefieres|transporte|hospedaje/i.test(finalText))) {
                        finalText = `¡Perfecto, *${firstName}*! Te comparto *3 opciones* para ese mes 👇 ${BRAND_EMOJIS}`;
                    } else if (!finalText || !finalText.trim()) {
                        finalText = `¡Hola, *${firstName}*! Somos *${AGENCY_NAME}* ${BRAND_EMOJIS}.\n\nTe comparto *3 opciones* 👇 ${BRAND_EMOJIS}`;
                    } else {
                        finalText += `\n\nListo, te comparto *3 opciones* 👇 ${BRAND_EMOJIS}`;
                    }

                    const group = buildGroupFromPromos(promos);
                    finalText += `\n\nPROMOS_GROUP:${JSON.stringify(group)}`;

                    // NO guardamos aquí - se guardará cuando el scraper envíe los resultados exitosamente

                } else if ((wantsPromos || pf?.mes) && !hadErrorFlex) {
                    // Solo pregunta si NO tiene suficiente info para cotización
                    // Si ya tiene destino + fechas + personas, NO preguntar, dejar que genere FICHA-COTI
                    const tieneDatosCoti = pf?.destino && (pf?.mes || pf?.fecha_salida_from) &&
                                          (control?.fields_collected?.adultos || control?.fields_collected?.menores?.length);

                    if (!tieneDatosCoti && control?.intent !== 'cotizacion') {
                        finalText += `\n\nNo encontré promos activas que coincidan justo ahora. ¿Te comparto *otras* similares por fecha o destino, o armamos una *cotización personalizada*? ${BRAND_EMOJIS}`;
                    }
                }


            } catch (e) {
                console.log('promos find warn:', e.message);
            }
        }

        // Adjuntar copys (FICHA-COTI) + sugerir 2 promos afines cuando la intención sea cotización
        if (control?.copies?.length) {
            console.log('[COPIES] Procesando copies:', JSON.stringify(control.copies, null, 2));

            // 1) Armar el bloque interno de cotización (no se envía al cliente; WhatsApp lo detecta y dispara tu scraping)
            let cotiBlock = '';
            for (const c of control.copies) {
                if (c?.keyword === 'FICHA-COTI' && c?.text) {
                    console.log('[FICHA-COTI] Data recibida:', JSON.stringify(c.data, null, 2));

                    const short = Math.floor(Date.now() / 1000);
                    const ficha =
                        `⛭ (Uso interno ${AGENCY_NAME}) — FICHA-COTI#${short}
${c.text}

Datos (no enviar al cliente):
${JSON.stringify(c.data || {}, null, 2)}`;
                    cotiBlock += `\n\n${ficha}`;

                    // NO guardamos aquí - se guardará cuando el scraper envíe los resultados exitosamente
                }

                // SOLICITUD-RESERVA: Cliente quiere reservar
                if (c?.keyword === 'SOLICITUD-RESERVA' && c?.data) {
                    console.log(`📝 SOLICITUD DE RESERVA recibida de ${phoneNumber}:`, JSON.stringify(c.data, null, 2));

                    // Marcar etiqueta "Reservar"
                    try { await this.applySuggestedTags(phoneNumber, ['Reservar']); } catch { }

                    // Notificar al sistema (guardar en BD para que vendedor lo vea)
                    try {
                        await ejecutarConReintento(
                            `INSERT INTO mensajes (
                                numero_telefono, mensaje, tipo_remitente, fecha_hora,
                                usuario_id, nombre_usuario, tipo_contenido, estado
                            ) VALUES ($1, $2, 'received', CURRENT_TIMESTAMP, $3::INTEGER, $4::TEXT, 'SOLICITUD_RESERVA', 'sent')`,
                            [
                                phoneNumber,
                                `📝 SOLICITUD DE RESERVA\n\n${JSON.stringify(c.data, null, 2)}`,
                                SYSTEM_USER_ID,
                                'Sistema'
                            ]
                        );
                        console.log(`✅ Solicitud de reserva guardada en BD para ${phoneNumber}`);
                    } catch (err) {
                        console.error('Error guardando solicitud de reserva:', err);
                    }
                }
            }

            if (cotiBlock) {
                // Etiqueta sugerida: cotización personalizada
                try { await this.applySuggestedTags(phoneNumber, ['COTIZACION_PERSONALIZADA']); } catch { }

                // Si ya armamos un PROMOS_GROUP antes, solo anexamos la ficha interna y salimos
                const alreadyHasGroup = typeof finalText === 'string' && finalText.includes('PROMOS_GROUP:');
                if (alreadyHasGroup) {
                    finalText += cotiBlock;
                } else {
                    // 2) Mientras se prepara la cotización personalizada, sugerimos 2 promos afines
                    let promosSugeridas = [];
                    try {
                        // Usa los filtros actuales (pf) de la conversación; si no hay, flex cercano a hoy
                        const flex = await tryFindPromosFlex(pf || {});
                        promosSugeridas = Array.isArray(flex?.promos) ? flex.promos.slice(0, 2) : [];
                    } catch (e) {
                        console.warn('Promos sugeridas (cotización) warn:', e?.message || e);
                        promosSugeridas = [];
                    }

                    if (promosSugeridas.length) {
                        // Mensaje visible breve antes de las promos
                        const nombre = this.getFirstName ? this.getFirstName(userName) : (userName || 'Cliente');
                        const aviso = `Perfecto, *${nombre}* 😊. Mientras preparo tu *cotización personalizada*, te dejo *2 promos afines* para que compares 👇`;

                        // Construir PROMOS_GROUP con solo 2 opciones
                        const group = this.buildGroupedPromoPayload
                            ? this.buildGroupedPromoPayload(promosSugeridas)
                            : (() => {
                                const images = promosSugeridas
                                    .map(p => (Array.isArray(p.imagenes) ? p.imagenes[0] : null))
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map(u => this.whatsappService?.toAbsoluteUrl(u) ?? u);

                                const group_copy = `🏝️ *Opciones afines* ${BRAND_EMOJIS}\n` +
                                    promosSugeridas.slice(0, 2).map(p => this.promoToCopy(p)).join('\n\n');

                                const common_details = typeof this.makeCommonDetailsMessage === 'function'
                                    ? this.makeCommonDetailsMessage(promosSugeridas)
                                    : 'ℹ️ *Detalles generales disponibles* (plan de alimentos y transporte según opción).';

                                const followup = '¿Te gustaría que tome alguna de estas como base o prefieres que afine la *cotización* con otras fechas/destino?';

                                return { images, group_copy, common_details, followup };
                            })();

                        // Nota: WhatsAppService, cuando detecta PROMOS_GROUP, ahora envía primero este "visible"
                        finalText = `${(finalText || '').trim()}\n\n${aviso}\n\nPROMOS_GROUP:${JSON.stringify(group)}${cotiBlock}`;
                    } else {
                        // Sin promos sugeridas → solo anexa la ficha interna (igual dispara tu scraping)
                        finalText = `${(finalText || '').trim()}${cotiBlock}`;
                    }
                }
            }
        }


        finalText = this.ensurePersonalizedGreeting(finalText, userName);
        return (finalText || '').trim();
    }

    // ========= ENVÍO AUX =========
    async guardarYEnviarRespuesta(phoneNumber, text) {
        const message = (text || '').toString();

        // Enviar por WhatsApp
        await this.whatsappService.sendMessage(phoneNumber, message);

        // Guardar en BD (evita tipos ambiguos con casts)
        const insertSql = `
      INSERT INTO mensajes (
        numero_telefono, mensaje, tipo_remitente, fecha_hora,
        usuario_id, nombre_usuario, tipo_contenido, url_archivo, nombre_archivo, estado
      ) VALUES ($1, $2, 'sent', CURRENT_TIMESTAMP, $3::INTEGER, $4::TEXT, $5::TEXT, $6::TEXT, $7::TEXT, 'sent')
    `;
        const valores = [
            phoneNumber,
            message,
            SYSTEM_USER_ID,
            'Asistente',
            null,
            null,
            null
        ];
        try { await ejecutarConReintento(insertSql, valores); } catch { }
        return true;
    }
}

module.exports = OpenAIHandler;
