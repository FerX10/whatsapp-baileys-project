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
const DAY_MS = 24 * 60 * 60 * 1000;
const BUS_PATTERNS = [
  { diff: 3, startDow: 4, endDow: 0, label: 'Jueves a Domingo (3 noches)' },
  { diff: 4, startDow: 0, endDow: 4, label: 'Domingo a Jueves (4 noches)' },
  { diff: 7, startDow: 4, endDow: 4, label: 'Jueves a Jueves (7 noches)' },
  { diff: 7, startDow: 0, endDow: 0, label: 'Domingo a Domingo (7 noches)' }
];
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];
const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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
    console.log(`\n[SCRAPER] Nueva tarea de scraping en cola para ${task.phoneNumber}`);
    console.log(`Ficha ID: ${task.fichaId}`);
    console.log(`[SCRAPER] Payload:`, JSON.stringify(task.payload, null, 2));
    this.queue.push(task);
    this._processNext();
  }

  async _processNext() {
    if (this.processing) {
      console.log('[SCRAPER] Ya hay un proceso de scraping en curso, esperando...');
      return;
    }
    const job = this.queue.shift();
    if (!job) return;

    console.log(`[SCRAPER] Iniciando scraping para ${job.phoneNumber}...`);
    this.processing = true;
    try {
      await this._handleJob(job);
      console.log(`[SCRAPER] Scraping completado para ${job.phoneNumber}`);
    } catch (error) {
      console.error('[SCRAPER] Error en scraping:', error);
      await this._safeSend(job.phoneNumber, 'Lo siento, tuve un problema al generar la cotizacion. Aviso al equipo humano.');
    } finally {
      this.processing = false;
      if (this.queue.length) {
        console.log(`[SCRAPER] Quedan ${this.queue.length} tareas en cola`);
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

    const transportModesInput = Array.isArray(parsed.transportes) && parsed.transportes.length
      ? parsed.transportes
      : [parsed.transporte].filter(Boolean);
    const uniqueModes = Array.from(new Set(transportModesInput.length ? transportModesInput : ['camion']));
    const rawWindows = Array.isArray(parsed.rawDateWindows) && parsed.rawDateWindows.length
      ? parsed.rawDateWindows
      : parsed.dateWindows;

    let cotizacionRegistrada = false;

    for (const mode of uniqueModes) {
      const windowsForMode = (rawWindows || [])
        .map(window => adjustWindowForTransport(window, mode))
        .filter(Boolean)
        .slice(0, this.maxWindows);

      if (!windowsForMode.length) continue;

      if (uniqueModes.length > 1) {
        await this._safeSend(phoneNumber, `${formatTransportLabel(mode)} · preparando opciones...`);
        await sleep(250);
      }

      for (const window of windowsForMode) {
        try {
          const tierResults = await this._executeSearch(parsed, window, pasajerosConfig, mode);
          if (!tierResults || !tierResults.options.length) {
            await this._safeSend(phoneNumber, `Para ${formatDateRange(window.salida, window.regreso)} (${formatTransportLabel(mode, false)}) no encontre opciones disponibles. Probamos con otra fecha?`);
            await sleep(300);
            continue;
          }

          const decorated = [];
          for (const opt of tierResults.options) {
            decorated.push(await this._enrichWithMedia(opt));
          }

          const parsedForMode = { ...parsed, transporte: mode };
          const messageChunks = await this._buildWindowMessages(parsedForMode, window, {
            ...tierResults,
            mode,
            options: decorated
          });

          for (const chunk of messageChunks) {
            await this._safeSend(phoneNumber, chunk);
            await sleep(450);
          }

          if (!cotizacionRegistrada) {
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
                    menores: parsed.menores.map(edad => ({ nombre: 'Menor', edad }))
                  },
                  plan: parsed.plan,
                  transporte: uniqueModes.join(' + '),
                  hotel_deseado: parsed.hotelDeseado,
                  presupuesto_aprox_adulto: parsed.presupuestoAdulto,
                  num_opciones: tierResults.options.length
                }
              });
              console.log(`Cotizacion guardada exitosamente para ${phoneNumber}`);
              cotizacionRegistrada = true;
            } catch (err) {
              console.error('Error guardando cotización:', err);
            }
          }
        } catch (error) {
          console.error('FichaCotiProcessor window error:', error);
          await this._safeSend(
            phoneNumber,
            `Tuvimos un detallito con la ventana *${formatDateRange(window.salida, window.regreso)}* (${formatTransportLabel(mode, false)}). Ya avise al equipo humano para ayudarte en cuanto tengan disponibilidad.`
          );
          await sleep(300);
        }
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

    const transporteRaw = pickString([
      safePayload.transporte,
      safePayload.transporte_preferido,
      safePayload.modo_transporte
    ]);
    const transportesSeleccionados = collectTransportModes(safePayload);
    const transporte = transportesSeleccionados.length
      ? transportesSeleccionados[0]
      : normalizeTransport(transporteRaw, destino);
    if (!transportesSeleccionados.length && transporte) {
      transportesSeleccionados.push(transporte);
    }

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

    const rawDateWindows = extractDateWindows(safePayload);
    const dateWindows = rawDateWindows
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
      transportes: Array.from(new Set(transportesSeleccionados)),
      rawDateWindows,
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
    lines.push('Ficha de Cotizacion');
    if (fichaId) lines.push(`ID interno: #${fichaId}`);

    if (parsed.destino) lines.push(`Destino: ${parsed.destino}`);
    if (parsed.plan) lines.push(`Plan: ${formatPlanForDisplay(parsed.plan)}`);

    const adultosCount = Number(parsed.adultos) || 0;
    const personas = [];
    if (adultosCount) personas.push(`${adultosCount} adulto${adultosCount === 1 ? '' : 's'}`);
    if (parsed.menores.length) {
      const detalle = parsed.menores.map(edad => `${edad} anios`).join(', ');
      personas.push(`${parsed.menores.length} menor${parsed.menores.length === 1 ? '' : 'es'} (${detalle})`);
    }
    if (personas.length) lines.push(`Personas: ${personas.join(' + ')}`);

    const transportes = Array.isArray(parsed.transportes) && parsed.transportes.length
      ? parsed.transportes
      : [parsed.transporte].filter(Boolean);
    const transporteCopy = transportes.length
      ? transportes.map(t => formatTransportLabel(t)).join(' + ')
      : 'por definir';
    lines.push(`Transporte: ${transporteCopy}`);

    if (parsed.hotelDeseado) lines.push(`Hotel deseado: ${parsed.hotelDeseado}`);
    if (parsed.traslados) lines.push(`Traslados: ${capitalizeFirst(parsed.traslados)}`);
    if (parsed.presupuestoAdulto) lines.push(`Presupuesto/adulto: ${formatCurrency(parsed.presupuestoAdulto)}`);

    const windows = Array.isArray(parsed.dateWindows)
      ? parsed.dateWindows.slice(0, this.maxWindows)
      : [];

    if (windows.length) {
      lines.push('');
      lines.push(`Fechas sugeridas (hasta ${this.maxWindows}):`);
      windows.forEach((win) => {
        lines.push(`- ${formatWindowLine(win)}`);
        const note = formatAdjustmentNote(win.adjustedNote);
        if (note) lines.push(`  Nota: ${note}`);
      });
    }

    lines.push('');
    lines.push('Buscando opciones disponibles...');

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

    const headerLines = [];
    headerLines.push(`Fecha: ${formatWindowLine(window)}`);
    headerLines.push(`Transporte: ${formatTransportLabel(tierResults.mode, false)}`);
    if (window.adjustedNote) {
      headerLines.push(`Nota: ${formatAdjustmentNote(window.adjustedNote)}`);
    }

    if (!allowNonRefundable && filtered.length < options.length) {
      const descartadas = options.length - filtered.length;
      headerLines.push(`Aviso: se descartaron ${descartadas} opciones no reembolsables (salida > 14 dias)`);
    } else if (allowNonRefundable && options.some(opt => opt.tipoTarifa === 'NO REEMBOLSABLE')) {
      headerLines.push('Aviso: por cercania de fecha (<14 dias) algunas opciones son no reembolsables');
    }

    messages.push(headerLines.join('\n'));

    finalOptions.forEach((opt, idx) => {
      messages.push(this._formatOption(opt, idx + 1, parsed, tierResults.mode));
    });

    return messages;
  }

  _formatOption(option, index, parsed, mode) {
    const lines = [];
    const title = option.titulo || option.hotel || `Opcion ${index}`;

    lines.push('');
    lines.push(`Opcion ${index}: ${title}`);

    const incluye = buildIncludesLine(option, mode);
    if (incluye) lines.push(incluye);

    const priceAdult = option?.precios?.precioPorAdulto;
    const priceMinor = option?.precios?.precioPorMenorPromedio;
    const total = option?.precios?.precioConMenores ?? option?.precios?.precioSoloAdultos ?? extraerPrecioNumerico(option.precio);

    if (priceAdult) lines.push(`Adulto: ${formatCurrency(priceAdult)}`);
    if (parsed.menores.length && priceMinor) lines.push(`Menor (promedio): ${formatCurrency(priceMinor)}`);
    if (total) {
      lines.push(`Total: ${formatCurrency(total)}`);
      lines.push(`Reserva con 30%: ${formatCurrency(Math.round(total * 0.30))}`);
    }

    if (option.tipoTarifa === 'NO REEMBOLSABLE') {
      lines.push('Tarifa: NO REEMBOLSABLE');
    } else if (option.tipoTarifa && option.tipoTarifa !== 'ESTANDAR') {
      lines.push(`Tarifa: ${option.tipoTarifa}`);
    }

    if (option.mediaLinks) {
      if (option.mediaLinks.tiktok_url) {
        lines.push(`TikTok: ${option.mediaLinks.tiktok_url}`);
      } else if (option.mediaLinks.external_video_url) {
        lines.push(`Video: ${option.mediaLinks.external_video_url}`);
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

    // SIN presupuesto: devolver las 3 mas baratas
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

    // 1. Opcion cercana al presupuesto (prioritaria)
    if (equalOrClose.length) picked.push(equalOrClose[0]);

    // 2. Opcion mas barata (debajo del presupuesto)
    if (cheaper.length) {
      // Tomar la mejor opcion barata (la mas cara de las baratas)
      picked.push(cheaper[cheaper.length - 1]);
    } else if (sorted.length && !picked.includes(sorted[0])) {
      // Si no hay opciones baratas, tomar la mas barata disponible
      picked.push(sorted[0]);
    }

    // 3. Opcion superior (arriba del presupuesto)
    if (higher.length) {
      picked.push(higher[0]);
    } else if (sorted.length >= 2 && !picked.includes(sorted[sorted.length - 1])) {
      // Si no hay opciones caras, tomar la mas cara disponible
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

  candidates.forEach((item) => {
    if (!item) return;
    const salida = ensureMidday(parseDateCandidate(item.salida || item.inicio || item.from || item.start || item.fechaInicio));
    const regreso = ensureMidday(parseDateCandidate(item.regreso || item.fin || item.to || item.end || item.fechaFin));
    if (salida && regreso && regreso > salida) {
      windows.push({
        salida,
        regreso,
        nights: Math.max(diffInDays(salida, regreso), 1)
      });
    }
  });

  return dedupeBy(windows, w => `${isoFromDate(w.salida)}|${isoFromDate(w.regreso)}`);
}


function adjustWindowForTransport(window, transporte) {
  if (!window) return null;
  const salida = ensureMidday(window.salida);
  const regreso = ensureMidday(window.regreso);
  if (!salida || !regreso || regreso <= salida) return null;

  const base = {
    salida,
    regreso,
    nights: Math.max(diffInDays(salida, regreso), 1)
  };

  if (transporte !== 'camion') {
    return base;
  }

  const snapped = snapToBusPattern(salida, regreso);
  if (!snapped) return base;

  const adjusted = {
    salida: snapped.salida,
    regreso: snapped.regreso,
    nights: snapped.nights
  };

  if (snapped.adjusted && snapped.patternLabel) {
    adjusted.adjustedNote = snapped.patternLabel;
  }

  return adjusted;
}


function snapToBusPattern(salida, regreso) {
  const candidates = [];
  const current = {
    salida,
    regreso,
    nights: Math.max(diffInDays(salida, regreso), 1),
    adjusted: false,
    patternLabel: describeBusPattern(salida, regreso),
    cost: 0
  };
  candidates.push(current);

  BUS_PATTERNS.forEach((pattern) => {
    const startCandidate = nearestDayMatch(salida, pattern.startDow);
    if (!startCandidate) return;
    const endCandidate = shiftDays(startCandidate, pattern.diff);
    if (!endCandidate || endCandidate <= startCandidate) return;

    const nights = Math.max(diffInDays(startCandidate, endCandidate), 1);
    const cost = Math.abs(diffInDays(salida, startCandidate)) + Math.abs(diffInDays(regreso, endCandidate));

    candidates.push({
      salida: startCandidate,
      regreso: endCandidate,
      nights,
      adjusted: startCandidate.getTime() !== salida.getTime() || endCandidate.getTime() !== regreso.getTime(),
      patternLabel: pattern.label,
      cost
    });
  });

  let best = null;
  for (const candidate of candidates) {
    if (!best || candidate.cost < best.cost) {
      best = candidate;
      continue;
    }
    if (candidate.cost === best.cost && !candidate.adjusted && best.adjusted) {
      best = candidate;
    }
  }

  return best;
}

function describeBusPattern(inicio, fin) {
  const startDow = inicio.getDay();
  const endDow = fin.getDay();
  const nights = Math.max(diffInDays(inicio, fin), 1);
  const pattern = BUS_PATTERNS.find(p => p.startDow === startDow && p.endDow === endDow && p.diff === nights);
  if (pattern) return pattern.label;
  const start = capitalizeFirst((DOW_SHORT[startDow] || "").toLowerCase());
  const end = capitalizeFirst((DOW_SHORT[endDow] || "").toLowerCase());
  const suffix = nights === 1 ? "1 noche" : `${nights} noches`;
  return `${start} a ${end} (${suffix})`;
}

function toIsoDate(value) {
  const date = ensureMidday(value);
  if (!date) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

﻿function formatPlanForDisplay(plan) {
  if (!plan) return 'por definir';
  const normalized = normalizeToken(plan);
  if (normalized.includes('todo')) return 'Todo Incluido';
  if (normalized.includes('desayuno')) return 'Desayunos';
  if (normalized.includes('solo')) return 'Solo hospedaje';
  return capitalizeFirst(plan);
}

function capitalizeFirst(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseDateCandidate(value) {
  if (!value) return null;
  if (value instanceof Date) return ensureMidday(value);
  if (typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date) ? null : ensureMidday(date);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const date = new Date(trimmed);
      return isNaN(date) ? null : ensureMidday(date);
    }
    if (/^\d{2}[\/.-]\d{2}[\/.-]\d{4}$/.test(trimmed)) {
      const [day, month, year] = trimmed.split(/[\/.-]/);
      const iso = `${year}-${month}-${day}`;
      const date = new Date(iso);
      return isNaN(date) ? null : ensureMidday(date);
    }
    const date = new Date(trimmed);
    return isNaN(date) ? null : ensureMidday(date);
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
  const target = ensureMidday(date);
  if (!target) return Number.MAX_SAFE_INTEGER;
  const today = ensureMidday(new Date());
  const diff = target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
  return Math.ceil(diff / DAY_MS);
}

function normalizeToken(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function ensureMidday(value) {
  if (!value) return null;
  const source = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(source)) return null;
  source.setHours(12, 0, 0, 0);
  return source;
}

function shiftDays(date, offset) {
  const base = ensureMidday(date);
  if (!base || !Number.isFinite(offset)) return null;
  const result = new Date(base.getTime());
  result.setDate(result.getDate() + offset);
  return ensureMidday(result);
}

function nearestDayMatch(date, targetDow) {
  const base = ensureMidday(date);
  if (!base) return null;
  let best = null;
  let bestScore = Infinity;
  for (let delta = -3; delta <= 7; delta += 1) {
    const candidate = shiftDays(base, delta);
    if (!candidate) continue;
    if (candidate.getDay() !== targetDow) continue;
    const score = Math.abs(delta) + (delta < 0 ? 0.25 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (!best) {
    const forward = (targetDow - base.getDay() + 7) % 7;
    best = shiftDays(base, forward);
  }
  return best;
}

function isoFromDate(value) {
  const date = ensureMidday(value);
  if (!date) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function diffInDays(start, end) {
  const a = ensureMidday(start);
  const b = ensureMidday(end);
  if (!a || !b) return 0;
  return Math.round((b - a) / DAY_MS);
}

function divideSafe(total, adultos) {
  if (!total || !adultos) return 0;
  return Math.round(total / adultos);
}

function formatDate(value) {
  const date = ensureMidday(value);
  if (!date) return 'fecha por definir';
  const day = String(date.getDate()).padStart(2, '0');
  const monthName = MONTH_NAMES[date.getMonth()] || '';
  const year = date.getFullYear();
  return `${day} de ${monthName} ${year}`;
}

function formatDateRange(start, end) {
  const startDate = ensureMidday(start);
  const endDate = ensureMidday(end);
  if (!startDate || !endDate) return 'fechas por definir';
  return `${formatDayAbbrev(startDate)} → ${formatDayAbbrev(endDate)}`;
}

function formatTransportLabel(mode, includeIcon = true) {
  const normalized = mode === 'avion' ? 'avion' : 'camion';
  if (!includeIcon) return normalized === 'avion' ? 'Vuelo' : 'Camion';
  return normalized === 'avion' ? 'Vuelo ✈️' : 'Camion 🚌';
}

function formatDayAbbrev(value) {
  const date = ensureMidday(value);
  if (!date) return 'fecha por definir';
  const dow = DOW_SHORT[date.getDay()] || '---';
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_SHORT[date.getMonth()] || '---';
  return `${dow} ${day} ${month}`;
}

function formatWindowLine(window) {
  if (!window) return 'fecha por definir';
  const nights = Number.isFinite(window.nights)
    ? window.nights
    : Math.max(diffInDays(window.salida, window.regreso), 1);
  const suffix = nights === 1 ? 'noche' : 'noches';
  return `${formatDayAbbrev(window.salida)} → ${formatDayAbbrev(window.regreso)} (${nights} ${suffix})`;
}

function formatAdjustmentNote(note) {
  if (!note) return null;
  const normalized = note.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const clean = normalized.replace(/- patron valido para transporte/i, '').trim();
  const match = clean.match(/^([A-Za-z]+) a ([A-Za-z]+) \((\d+) noches?\)$/i);
  if (match) {
    const start = capitalizeFirst(match[1].toLowerCase());
    const end = capitalizeFirst(match[2].toLowerCase());
    const nights = parseInt(match[3], 10);
    const suffix = nights === 1 ? '1 noche' : `${nights} noches`;
    return `Ajustamos a ${start} → ${end} (${suffix})`;
  }
  return `Ajuste aplicado: ${clean}`;
}

function collectTransportModes(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const modes = new Set();
  const consider = [];
  const pushValue = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(pushValue);
      return;
    }
    if (typeof value === 'string') {
      consider.push(value);
    }
  };
  pushValue(payload.transporte);
  pushValue(payload.transporte_preferido);
  pushValue(payload.modo_transporte);
  pushValue(payload.transporte_secundario);
  pushValue(payload.transporte_alternativo);
  pushValue(payload.transporte_extra);
  pushValue(payload.transportes);
  pushValue(payload.transportes_preferidos);
  pushValue(payload.transporte_opciones);
  pushValue(payload.transport_options);
  pushValue(payload.transport_modes);
  consider.forEach((value) => {
    const token = normalizeToken(value);
    if (!token) return;
    if (token.includes('ambos') || token.includes('ambas')) {
      modes.add('camion');
      modes.add('avion');
    }
    if (token.includes('camion') || token.includes('bus') || token.includes('autobus') || token.includes('terrestre')) {
      modes.add('camion');
    }
    if (token.includes('avion') || token.includes('vuelo') || token.includes('aereo')) {
      modes.add('avion');
    }
  });
  return Array.from(modes);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
