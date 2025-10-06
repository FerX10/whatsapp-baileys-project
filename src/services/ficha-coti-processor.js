const {
  scrapNaturLeon,
  scrapNaturLeonPaquetesVuelo
} = require('../../scraper/naturleon-scraper');

const promoFinder = require('../../scraper/promo-finder');
const { ejecutarConReintento } = require('../database/db');

const {
  esHotelValido,
  correlacionarHotelesExactos,
  extraerPrecioNumerico,
  detectarTipoTarifa,
  validarConfiguracionPasajeros
} = promoFinder;

const NON_REFUNDABLE_GRACE_DAYS = 14;
const MAX_WINDOWS_PER_TASK = 3;
const DEFAULT_ORIGIN_BUS = 'Leon (Natursala Hidalgo)';
const DEFAULT_ORIGIN_FLIGHT = 'BJX - Leon';
const AIR_ONLY_DESTINATIONS = ['cancun', 'los cabos', 'cabo san lucas', 'mazatlan'];
const BUS_DEFAULT_DESTINATIONS = ['ixtapa', 'puerto vallarta', 'manzanillo'];

class FichaCotiProcessor {
  constructor(whatsappService, options = {}) {
    this.service = whatsappService;
    this.queue = [];
    this.processing = false;
    this.maxWindows = options.maxDateWindows || MAX_WINDOWS_PER_TASK;
    this.nonRefundableGraceDays = options.nonRefundableGraceDays || NON_REFUNDABLE_GRACE_DAYS;
  }

  enqueue(task) {
    if (!task || !task.phoneNumber) return;
    console.log(`\n🔍 [SCRAPER] Nueva tarea de scraping en cola para ${task.phoneNumber}`);
    console.log(`📋 Ficha ID: ${task.fichaId}`);
    console.log(`📦 Payload:`, JSON.stringify(task.payload, null, 2));
    this.queue.push(task);
    this._processNext();
  }

  async _processNext() {
    if (this.processing) {
      console.log('[SCRAPER] ⏸️ Ya hay un proceso de scraping en curso, esperando...');
      return;
    }
    const job = this.queue.shift();
    if (!job) return;

    console.log(`[SCRAPER] ▶️ Iniciando scraping para ${job.phoneNumber}...`);
    this.processing = true;
    try {
      await this._handleJob(job);
      console.log(`[SCRAPER] ✅ Scraping completado para ${job.phoneNumber}`);
    } catch (error) {
      console.error('[SCRAPER] ❌ Error en scraping:', error);
      await this._safeSend(job.phoneNumber, 'Lo siento, tuve un problema al generar la cotizacion. Aviso al equipo humano.');
    } finally {
      this.processing = false;
      if (this.queue.length) {
        console.log(`[SCRAPER] 📋 Quedan ${this.queue.length} tareas en cola`);
        setTimeout(() => this._processNext(), 200);
      }
    }
  }

  async _handleJob(job) {
    const { phoneNumber, fichaId, payload } = job;
    const parsed = this._parsePayload(payload);

    if (!parsed.destino) {
      await this._safeSend(phoneNumber, 'Necesito el destino para poder cotizar. Me lo confirmas, porfa?');
      return;
    }

    if (!parsed.dateWindows.length) {
      await this._safeSend(phoneNumber, 'No identifique fechas completas de salida y regreso. Me ayudas con las fechas exactas?');
      return;
    }

    let pasajerosConfig;
    try {
      pasajerosConfig = validarConfiguracionPasajeros({
        adultos: parsed.adultos,
        menores: {
          cantidad: parsed.menores.length,
          edades: parsed.menores
        }
      });
    } catch (error) {
      console.warn('FichaCotiProcessor passengers warning:', error.message);
      await this._safeSend(phoneNumber, 'Necesito validar cuantas personas viajan (adultos y menores con edades).');
      return;
    }

    const summary = this._buildSummaryMessage(parsed, fichaId);
    await this._safeSend(phoneNumber, summary);
    await sleep(350);

    for (let i = 0; i < parsed.dateWindows.length && i < this.maxWindows; i++) {
      const window = parsed.dateWindows[i];
      try {
        const tierResults = await this._executeSearch(parsed, window, pasajerosConfig);
        if (!tierResults || !tierResults.options.length) {
          await this._safeSend(phoneNumber, `Para ${formatDateRange(window.salida, window.regreso)} no encontre opciones disponibles. Intentamos con otras fechas?`);
          await sleep(300);
          continue;
        }

        const decorated = [];
        for (const opt of tierResults.options) {
          decorated.push(await this._enrichWithMedia(opt));
        }

        const messageChunks = await this._buildWindowMessages(parsed, window, {
          ...tierResults,
          options: decorated
        });

        for (const chunk of messageChunks) {
          await this._safeSend(phoneNumber, chunk);
          await sleep(450);
        }

        // Guardar cotización exitosa en BD (primera ventana de fechas exitosa)
        if (i === 0) {
          try {
            const cotizacionesService = require('./cotizaciones.service');
            await cotizacionesService.guardarCotizacion({
              numero_telefono: phoneNumber,
              tipo: 'PERSONALIZADA',
              datos_cotizacion: {
                destino: parsed.destino,
                check_in: window.salida,
                check_out: window.regreso,
                ocupacion: {
                  adultos: parsed.adultos.map((_, idx) => ({ nombre: `Adulto ${idx + 1}`, edad: 30 })),
                  menores: parsed.menores.map(edad => ({ nombre: `Menor`, edad }))
                },
                plan: parsed.plan,
                transporte: parsed.transporte,
                hotel_deseado: parsed.hotelDeseado,
                presupuesto_aprox_adulto: parsed.presupuesto,
                num_opciones: tierResults.options.length
              }
            });
            console.log(`✅ Cotización guardada exitosamente para ${phoneNumber}`);
          } catch (err) {
            console.error('Error guardando cotización:', err);
          }
        }

      } catch (error) {
        console.error('FichaCotiProcessor window error:', error);
        await this._safeSend(phoneNumber, `Tuvimos un problema al cotizar ${formatDateRange(window.salida, window.regreso)}. Estoy avisando al equipo.`);
        await sleep(300);
      }
    }
  }

  _parsePayload(payload = {}) {
    const safePayload = typeof payload === 'object' && payload !== null ? payload : {};

    const destino = pickString([
      safePayload.destino,
      safePayload.destinos,
      safePayload.location,
      safePayload.playa
    ]);

    const plan = normalizePlan(pickString([
      safePayload.plan,
      safePayload.plan_alimentacion,
      safePayload.plan_deseado
    ]));

    const transporte = normalizeTransport(pickString([
      safePayload.transporte,
      safePayload.transporte_preferido,
      safePayload.modo_transporte
    ]), destino);

    const traslados = pickString([
      safePayload.traslados,
      safePayload.traslado
    ]);

    const hotelDeseado = pickString([
      safePayload.hotel_deseado,
      safePayload.hotel,
      safePayload.hotel_preferido
    ]);

    const adultos = toPositiveInt(safePayload.adultos, 2);
    const menores = extractMenores(safePayload);

    const presupuestoAdulto = parseMoney(
      safePayload.presupuesto_aprox_adulto ||
      safePayload.presupuesto ||
      safePayload.budget_per_adult
    );

    const condicionesPromo = safePayload.condiciones_promo || {};
    const salidaCiudad = pickString([
      safePayload.salida,
      safePayload.city_salida,
      safePayload.ciudad_salida
    ]);

    const dateWindows = extractDateWindows(safePayload)
      .map(window => adjustWindowForTransport(window, transporte))
      .filter(Boolean);

    return {
      destino,
      plan,
      transporte,
      traslados,
      hotelDeseado,
      adultos,
      menores,
      presupuestoAdulto,
      condicionesPromo,
      salidaCiudad,
      dateWindows,
      raw: safePayload
    };
  }

  async _executeSearch(parsed, window, pasajerosConfig) {
    if (parsed.transporte === 'avion') {
      return this._runFlightSearch(parsed, window, pasajerosConfig);
    }
    return this._runBusSearch(parsed, window, pasajerosConfig);
  }

  async _runBusSearch(parsed, window, pasajerosConfig) {
    const baseOptions = {
      destino: parsed.destino,
      fechaInicio: toIsoDate(window.salida),
      fechaFin: toIsoDate(window.regreso),
      plan: planToNaturleon(parsed.plan),
      adultos: pasajerosConfig.adultos,
      ninos: 0,
      edadesMenores: [],
      habitaciones: 1,
      conTransporte: parsed.transporte === 'camion',
      origen: parsed.salidaCiudad || DEFAULT_ORIGIN_BUS,
      ajustarFechasTransporte: true,
      headless: true,
      guardarResultados: false,
      tomarCaptura: false,
      timeout: 60000
    };

    const adultRun = await scrapNaturLeon(baseOptions);
    if (!adultRun || !adultRun.exito) {
      throw new Error(adultRun?.error || 'Sin resultados en busqueda base');
    }

    const adultResults = (adultRun.resultados || []).filter(esHotelValido);

    let processed = [];
    const minorsCount = pasajerosConfig.menores.cantidad;
    if (minorsCount > 0) {
      await sleep(250);
      const withMinors = await scrapNaturLeon({
        ...baseOptions,
        ninos: minorsCount,
        edadesMenores: pasajerosConfig.menores.edades
      });

      if (withMinors && withMinors.exito) {
        const minorResults = (withMinors.resultados || []).filter(esHotelValido);
        processed = correlacionarHotelesExactos(adultResults, minorResults, pasajerosConfig) || [];
      }
    }

    if (!processed.length) {
      processed = adultResults.map(hotel => convertAdultOnlyHotel(hotel, pasajerosConfig));
    }

    return {
      options: processed,
      mode: 'camion'
    };
  }

  async _runFlightSearch(parsed, window, pasajerosConfig) {
    const minorsCount = pasajerosConfig.menores.cantidad;
    const response = await scrapNaturLeonPaquetesVuelo({
      destino: parsed.destino,
      origen: parsed.salidaCiudad || DEFAULT_ORIGIN_FLIGHT,
      fechaInicio: toIsoDate(window.salida),
      fechaFin: toIsoDate(window.regreso),
      plan: planToNaturleon(parsed.plan),
      adultos: pasajerosConfig.adultos,
      ninos: minorsCount,
      edadesMenores: pasajerosConfig.menores.edades,
      habitaciones: 1,
      headless: true,
      guardarResultados: false,
      tomarCaptura: false,
      timeout: 60000
    });

    if (!response || !response.exito) {
      throw new Error(response?.error || 'Sin resultados de paquetes con vuelo');
    }

    const processed = (response.resultados || [])
      .filter(esHotelValido)
      .map(hotel => enrichFlightHotel(hotel, pasajerosConfig));

    return {
      options: processed,
      mode: 'avion'
    };
  }

  _buildSummaryMessage(parsed, fichaId) {
    const lines = [];
    lines.push('📋 *Ficha de Cotización*');
    if (fichaId) lines.push(`_ID interno: #${fichaId}_`);
    lines.push('');
    lines.push(`📍 *Destino:* ${parsed.destino}`);
    lines.push(`🍽 *Plan:* ${formatPlanForDisplay(parsed.plan)}`);

    const personas = [`${parsed.adultos} adulto${parsed.adultos === 1 ? '' : 's'}`];
    if (parsed.menores.length) {
      const detalle = parsed.menores.map(edad => `${edad} años`).join(', ');
      personas.push(`${parsed.menores.length} menor${parsed.menores.length === 1 ? '' : 'es'} (${detalle})`);
    }
    lines.push(`👥 *Personas:* ${personas.join(' + ')}`);

    lines.push(`🚌 *Transporte:* ${parsed.transporte === 'avion' ? 'Vuelo ✈️' : 'Camión 🚌'}`);
    if (parsed.traslados) lines.push(`🚖 *Traslados:* ${capitalizeFirst(parsed.traslados)}`);
    if (parsed.hotelDeseado) lines.push(`🏨 *Hotel deseado:* ${parsed.hotelDeseado}`);
    if (parsed.presupuestoAdulto) lines.push(`💰 *Presupuesto/adulto:* ${formatCurrency(parsed.presupuestoAdulto)}`);

    if (parsed.dateWindows.length) {
      lines.push('');
      lines.push(`📅 *Fechas a cotizar* (máx ${this.maxWindows}):`);
      parsed.dateWindows.slice(0, this.maxWindows).forEach(win => {
        const label = formatDateRange(win.salida, win.regreso);
        if (win.adjustedNote) {
          lines.push(`• ${label}`);
          lines.push(`  ⚠️ _${win.adjustedNote}_`);
        } else {
          lines.push(`• ${label}`);
        }
      });
    }

    lines.push('');
    lines.push('_Buscando opciones disponibles..._');

    return lines.join('\n');
  }

  async _buildWindowMessages(parsed, window, tierResults) {
    const options = this._selectOptionsByBudget(tierResults.options, parsed.presupuestoAdulto, parsed.adultos);
    const allowNonRefundable = daysUntil(window.salida) <= this.nonRefundableGraceDays;
    const filtered = options.filter(opt => allowNonRefundable || opt.tipoTarifa !== 'NO REEMBOLSABLE');
    const finalOptions = filtered.length ? filtered : options;

    if (!finalOptions.length) {
      return [`Para ${formatDateRange(window.salida, window.regreso)} no encontre opciones disponibles en la plataforma.`];
    }

    const messages = [];

    // HEADER: Información de la fecha
    const headerLines = [];
    headerLines.push(`📅 *${formatDateRange(window.salida, window.regreso)}*`);
    if (window.adjustedNote) headerLines.push(`⚠️ _Ajuste: ${window.adjustedNote}_`);
    headerLines.push(`🚌 ${tierResults.mode === 'avion' ? 'Paquete con vuelo ✈️' : 'Transporte terrestre + hotel'}`);

    // NOTA sobre no reembolsables si aplica
    if (!allowNonRefundable && filtered.length < options.length) {
      const descartadas = options.length - filtered.length;
      headerLines.push(`ℹ️ _Se descartaron ${descartadas} opción(es) no reembolsable(s) (salida > 14 días)_`);
    } else if (allowNonRefundable && options.some(opt => opt.tipoTarifa === 'NO REEMBOLSABLE')) {
      headerLines.push(`⚠️ _Por cercanía de fecha (<14 días), algunas opciones son NO REEMBOLSABLES_`);
    }

    messages.push(headerLines.join('\n'));

    // OPCIONES: Cada hotel en mensaje separado
    finalOptions.forEach((opt, idx) => {
      messages.push(this._formatOption(opt, idx + 1, parsed, tierResults.mode));
    });

    return messages;
  }

  _formatOption(option, index, parsed, mode) {
    const lines = [];
    const hotelName = option.titulo || option.hotel || `Opcion ${index}`;

    // Emoji según posición
    const emoji = index === 1 ? '🎁' : index === 2 ? '💰' : '🌅';

    lines.push('');
    lines.push(`${emoji} *${hotelName}*`);

    // Incluye (plan + habitación)
    const incluye = buildIncludesLine(option, mode);
    if (incluye) lines.push(incluye);

    const priceAdult = option?.precios?.precioPorAdulto;
    const priceMinor = option?.precios?.precioPorMenorPromedio;
    const total = option?.precios?.precioConMenores ?? option?.precios?.precioSoloAdultos ?? extraerPrecioNumerico(option.precio);

    // PRECIOS
    if (priceAdult) lines.push(`👤 *Adulto:* ${formatCurrency(priceAdult)}`);
    if (parsed.menores.length && priceMinor) lines.push(`🧒 *Menor (prom.):* ${formatCurrency(priceMinor)}`);
    if (total) {
      lines.push(`👉 *Total:* ${formatCurrency(total)}`);
      lines.push(`💰 *Reserva con 30%:* ${formatCurrency(Math.round(total * 0.30))}`);
    }

    // TIPO DE TARIFA
    if (option.tipoTarifa === 'NO REEMBOLSABLE') {
      lines.push('⚠️ *No Reembolsable* (por cercanía de fecha)');
    } else if (option.tipoTarifa && option.tipoTarifa !== 'ESTANDAR') {
      lines.push(`ℹ️ Tarifa: ${option.tipoTarifa}`);
    }

    // LINKS DE VIDEO
    if (option.mediaLinks) {
      if (option.mediaLinks.tiktok_url) {
        lines.push(`🎬 TikTok: ${option.mediaLinks.tiktok_url}`);
      } else if (option.mediaLinks.external_video_url) {
        lines.push(`🎥 Video: ${option.mediaLinks.external_video_url}`);
      }
    }

    return lines.join('\n');
  }

  _selectOptionsByBudget(options, presupuestoAdulto, adultos) {
    if (!Array.isArray(options) || !options.length) return [];

    // Dedupe y ordenar por precio
    const unique = dedupeBy(options, opt => (opt.titulo || '') + '|' + (opt.habitacion || ''));
    const sorted = unique.sort((a, b) => {
      const aVal = a?.precios?.precioPorAdulto || divideSafe(extraerPrecioNumerico(a.precio), adultos);
      const bVal = b?.precios?.precioPorAdulto || divideSafe(extraerPrecioNumerico(b.precio), adultos);
      return aVal - bVal;
    });

    // SIN presupuesto: devolver las 3 más baratas
    if (!presupuestoAdulto || presupuestoAdulto <= 0) {
      return sorted.slice(0, 3);
    }

    // CON presupuesto: seleccionar 3 opciones distribuidas
    const cheaper = sorted.filter(opt => (opt?.precios?.precioPorAdulto || 0) < presupuestoAdulto);
    const equalOrClose = sorted
      .map(opt => ({ opt, diff: Math.abs((opt?.precios?.precioPorAdulto || 0) - presupuestoAdulto) }))
      .sort((a, b) => a.diff - b.diff)
      .map(item => item.opt);
    const higher = sorted.filter(opt => (opt?.precios?.precioPorAdulto || 0) > presupuestoAdulto);

    const picked = [];

    // 1. Opción cercana al presupuesto (prioritaria)
    if (equalOrClose.length) picked.push(equalOrClose[0]);

    // 2. Opción más barata (debajo del presupuesto)
    if (cheaper.length) {
      // Tomar la mejor opción barata (la más cara de las baratas)
      picked.push(cheaper[cheaper.length - 1]);
    } else if (sorted.length && !picked.includes(sorted[0])) {
      // Si no hay opciones baratas, tomar la más barata disponible
      picked.push(sorted[0]);
    }

    // 3. Opción superior (arriba del presupuesto)
    if (higher.length) {
      picked.push(higher[0]);
    } else if (sorted.length >= 2 && !picked.includes(sorted[sorted.length - 1])) {
      // Si no hay opciones caras, tomar la más cara disponible
      picked.push(sorted[sorted.length - 1]);
    }

    // Dedupear y limitar a 3
    const final = dedupeBy(picked.filter(Boolean), opt => (opt.titulo || '') + '|' + (opt.habitacion || ''));

    // Si tenemos menos de 3, completar con las siguientes mejores opciones
    if (final.length < 3 && sorted.length > final.length) {
      const existing = new Set(final.map(opt => (opt.titulo || '') + '|' + (opt.habitacion || '')));
      for (const opt of sorted) {
        const key = (opt.titulo || '') + '|' + (opt.habitacion || '');
        if (!existing.has(key)) {
          final.push(opt);
          existing.add(key);
          if (final.length >= 3) break;
        }
      }
    }

    return final.slice(0, 3);
  }

  async _enrichWithMedia(option) {
    if (!option || option.mediaChecked) return option;
    const nombre = option.titulo || option.hotel;
    if (!nombre) {
      option.mediaChecked = true;
      return option;
    }

    try {
      let result = await ejecutarConReintento(
        'SELECT name, tiktok_url, external_video_url FROM hotels WHERE LOWER(name)=LOWER($1) LIMIT 1',
        [nombre]
      );

      if (!result.rows.length) {
        result = await ejecutarConReintento(
          'SELECT name, tiktok_url, external_video_url FROM hotels WHERE LOWER(name) LIKE LOWER($1) ORDER BY name LIMIT 1',
          [`%${nombre}%`]
        );
      }

      if (result.rows.length) {
        option.mediaLinks = {
          tiktok_url: result.rows[0].tiktok_url || null,
          external_video_url: result.rows[0].external_video_url || null
        };
      }
    } catch (error) {
      console.warn('FichaCotiProcessor media lookup error:', error.message);
    }

    option.mediaChecked = true;
    return option;
  }

  async _safeSend(phoneNumber, message) {
    if (!message) return;
    try {
      await this.service.sendMessage(phoneNumber, message);
    } catch (error) {
      console.error('Error enviando mensaje de ficha-coti:', error);
    }
  }
}

module.exports = FichaCotiProcessor;

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

function pickString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizePlan(plan) {
  if (!plan) return null;
  const token = normalizeToken(plan);
  if (token.includes('todo')) return 'todo incluido';
  if (token.includes('desayuno')) return 'desayunos';
  if (token.includes('solo')) return 'solo hospedaje';
  return plan;
}

function planToNaturleon(plan) {
  if (!plan) return 'todoincluido';
  const token = normalizeToken(plan);
  if (token.includes('todo')) return 'todoincluido';
  if (token.includes('desayuno')) return 'desayuno';
  if (token.includes('solo')) return 'soloalojamiento';
  return 'todoincluido';
}

function normalizeTransport(value, destino) {
  if (value) {
    const token = normalizeToken(value);
    if (token.includes('avion') || token.includes('vuelo') || token.includes('aereo')) {
      return 'avion';
    }
    if (token.includes('camion') || token.includes('bus') || token.includes('autobus')) {
      return 'camion';
    }
  }

  const destToken = normalizeToken(destino || '');
  if (AIR_ONLY_DESTINATIONS.some(d => destToken.includes(d))) return 'avion';
  if (BUS_DEFAULT_DESTINATIONS.some(d => destToken.includes(d))) return 'camion';
  return value ? normalizeToken(value) : 'camion';
}

function extractMenores(payload) {
  const menoresRaw = payload.menores || payload.menores_edades || payload.edades_menores || [];
  const menores = [];

  if (Array.isArray(menoresRaw)) {
    menoresRaw.forEach(item => {
      if (typeof item === 'number') menores.push(Math.round(item));
      else if (typeof item === 'string') {
        const parsed = toPositiveInt(item);
        if (parsed !== null) menores.push(parsed);
      } else if (item && typeof item === 'object') {
        const edad = toPositiveInt(item.edad || item.age);
        if (edad !== null) menores.push(edad);
      }
    });
  }

  const edadesAlt = payload.edades || payload.menores_edades_texto;
  if (typeof edadesAlt === 'string') {
    edadesAlt.split(/[,;\s]+/).forEach(token => {
      const edad = toPositiveInt(token);
      if (edad !== null) menores.push(edad);
    });
  }

  return menores;
}

function parseMoney(value) {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = value.replace(/[^0-9.,]/g, '');
    if (!match) return null;
    const normalized = match.replace(/,/g, '');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function toPositiveInt(value, fallback = null) {
  const num = typeof value === 'number' ? value : Number(String(value || '').trim());
  if (Number.isFinite(num) && num > 0) return Math.round(num);
  return fallback;
}

function extractDateWindows(payload) {
  const windows = [];
  const candidates = [];

  if (Array.isArray(payload.fechas)) candidates.push(...payload.fechas);
  else if (payload.fechas && typeof payload.fechas === 'object') candidates.push(payload.fechas);
  if (Array.isArray(payload.fechas_opciones)) candidates.push(...payload.fechas_opciones);
  if (Array.isArray(payload.ventanas)) candidates.push(...payload.ventanas);

  const single = {
    salida: payload?.fechas?.salida || payload.fecha_salida || payload.salida,
    regreso: payload?.fechas?.regreso || payload.fecha_regreso || payload.regreso
  };
  if (single.salida && single.regreso) candidates.push(single);

  candidates.forEach(item => {
    if (!item) return;
    const salida = parseDateCandidate(item.salida || item.inicio || item.from || item.start || item.fechaInicio);
    const regreso = parseDateCandidate(item.regreso || item.fin || item.to || item.end || item.fechaFin);
    if (salida && regreso && salida < regreso) windows.push({ salida, regreso });
  });

  return dedupeBy(windows, w => `${toIsoDate(w.salida)}|${toIsoDate(w.regreso)}`);
}

function adjustWindowForTransport(window, transporte) {
  if (!window) return null;
  if (transporte !== 'camion') return window;

  const adjusted = ajustarFechasParaTransporte(window.salida, window.regreso);
  if (adjusted && adjusted.ajustado) {
    return {
      salida: adjusted.fechaInicio,
      regreso: adjusted.fechaFin,
      adjustedNote: adjusted.motivo || 'patron jueves-domingo'
    };
  }

  return { salida: window.salida, regreso: window.regreso };
}

function ajustarFechasParaTransporte(fechaInicio, fechaFin) {
  const start = new Date(fechaInicio);
  const end = new Date(fechaFin);
  if (isNaN(start) || isNaN(end)) {
    return { fechaInicio, fechaFin, ajustado: false };
  }

  const clone = (date) => new Date(date.getTime());
  let inicio = clone(start);
  let fin = clone(end);
  let ajustado = false;
  let motivo = '';

  const esValido = (dia) => dia === 0 || dia === 4;
  const patronesValidos = (inicioDia, finDia) => (
    (inicioDia === 4 && finDia === 0) ||
    (inicioDia === 0 && finDia === 4) ||
    (inicioDia === 0 && finDia === 0) ||
    (inicioDia === 4 && finDia === 4)
  );

  const moverHasta = (fecha, diaObjetivo) => {
    const resultado = clone(fecha);
    while (resultado.getDay() !== diaObjetivo) {
      resultado.setDate(resultado.getDate() + 1);
    }
    return resultado;
  };

  if (!esValido(inicio.getDay())) {
    inicio = moverHasta(inicio, inicio.getDay() < 4 ? 4 : 0);
    ajustado = true;
  }

  if (!esValido(fin.getDay())) {
    fin = moverHasta(fin, fin.getDay() < 4 ? 4 : 0);
    ajustado = true;
  }

  if (!patronesValidos(inicio.getDay(), fin.getDay())) {
    const opciones = [0, 4];
    let mejorInicio = inicio;
    let mejorFin = fin;
    let mejorDiff = Infinity;

    opciones.forEach(diaInicio => {
      const posibleInicio = moverHasta(start, diaInicio);
      opciones.forEach(diaFin => {
        const posibleFin = moverHasta(posibleInicio, diaFin === diaInicio ? diaFin : (diaFin === 0 ? 0 : 4));
        const diff = Math.abs(posibleInicio - inicio) + Math.abs(posibleFin - fin);
        if (diff < mejorDiff) {
          mejorDiff = diff;
          mejorInicio = posibleInicio;
          mejorFin = posibleFin;
        }
      });
    });

    inicio = mejorInicio;
    fin = mejorFin;
    ajustado = true;
  }

  if (ajustado) motivo = describePattern(inicio, fin);

  return {
    fechaInicio: inicio,
    fechaFin: fin,
    ajustado,
    motivo
  };
}

function describePattern(inicio, fin) {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const diaInicio = inicio.getDay();
  const diaFin = fin.getDay();

  const nombreInicio = capitalizeFirst(dias[diaInicio]);
  const nombreFin = capitalizeFirst(dias[diaFin]);

  // Calcular número de noches
  const diffMs = fin - inicio;
  const noches = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return `${nombreInicio} a ${nombreFin} (${noches} noches) - patrón válido para transporte`;
}

function toIsoDate(value) {
  const date = new Date(value);
  if (isNaN(date)) return null;
  return date.toISOString().slice(0, 10);
}

function divideSafe(total, adultos) {
  if (!total || !Number.isFinite(total)) return Number.MAX_SAFE_INTEGER;
  const count = Math.max(adultos || 1, 1);
  return Math.round(total / count);
}

function formatDateRange(start, end) {
  const startStr = formatDate(start);
  const endStr = formatDate(end);
  return `${startStr} - ${endStr}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (isNaN(date)) return 'fecha por definir';
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'long' });
}

function formatPlanForDisplay(plan) {
  if (!plan) return 'por definir';
  return capitalizeFirst(plan);
}

function capitalizeFirst(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseDateCandidate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date) ? null : date;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const date = new Date(trimmed);
      return isNaN(date) ? null : date;
    }
    if (/^\d{2}[\/.-]\d{2}[\/.-]\d{4}$/.test(trimmed)) {
      const [day, month, year] = trimmed.split(/[\/.-]/);
      const iso = `${year}-${month}-${day}`;
      const date = new Date(iso);
      return isNaN(date) ? null : date;
    }
    const date = new Date(trimmed);
    return isNaN(date) ? null : date;
  }
  return null;
}

function dedupeBy(list, selector) {
  const seen = new Set();
  const result = [];
  list.forEach(item => {
    const key = selector(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  });
  return result;
}

function convertAdultOnlyHotel(hotel, pasajerosConfig) {
  const total = extraerPrecioNumerico(hotel.precio) || 0;
  const adultos = Math.max(pasajerosConfig.adultos || 1, 1);
  const perAdult = total ? Math.round(total / adultos) : null;
  return {
    ...hotel,
    precios: {
      precioSoloAdultos: total,
      precioConMenores: total,
      precioPorAdulto: perAdult,
      precioPorMenorPromedio: 0,
      diferenciaTotal: 0,
      cantidadMenores: 0,
      edadesMenores: []
    },
    tipoTarifa: detectarTipoTarifa(hotel),
    correlacionExacta: true,
    confianzaCorrelacion: 100
  };
}

function enrichFlightHotel(hotel, pasajerosConfig) {
  const total = extraerPrecioNumerico(hotel.precio) || 0;
  const adultos = Math.max(pasajerosConfig.adultos || 1, 1);
  const menores = Math.max(pasajerosConfig.menores.cantidad || 0, 0);
  const perAdult = total ? Math.round(total / adultos) : null;
  const perMinor = menores > 0 && total ? Math.round((total - (perAdult * adultos)) / menores) : null;
  return {
    ...hotel,
    precios: {
      precioSoloAdultos: total,
      precioConMenores: total,
      precioPorAdulto: perAdult,
      precioPorMenorPromedio: perMinor,
      diferenciaTotal: 0,
      cantidadMenores: menores,
      edadesMenores: pasajerosConfig.menores.edades
    },
    tipoTarifa: detectarTipoTarifa(hotel),
    correlacionExacta: true,
    confianzaCorrelacion: 100
  };
}

function buildIncludesLine(option, mode) {
  const partes = [];
  if (mode === 'avion') partes.push('Incluye: Vuelo + Hotel');
  else partes.push('Incluye: Transporte + Hotel');
  if (option.plan) partes.push(capitalizeFirst(option.plan));
  if (option.habitacion) partes.push(option.habitacion);
  return partes.filter(Boolean).join(' | ');
}

function cleanText(text, maxLength = 200) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return 'por definir';
  return `$${value.toLocaleString('es-MX')}`;
}

function daysUntil(date) {
  const target = new Date(date);
  if (isNaN(target)) return Number.MAX_SAFE_INTEGER;
  const today = new Date();
  const diff = target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function normalizeToken(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
