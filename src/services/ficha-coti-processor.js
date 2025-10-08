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

  async _executeSearch(parsed, window, pasajerosConfig, modeOverride = null) {
    const mode = modeOverride || parsed.transporte;
    const parsedWithMode = { ...parsed, transporte: mode };
    if (mode === 'avion') {
      return this._runFlightSearch(parsedWithMode, window, pasajerosConfig);
    }
    return this._runBusSearch(parsedWithMode, window, pasajerosConfig);
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
    if (fichaId) lines.push('_ID interno: #' + fichaId + '_');
    lines.push('');
    lines.push('📍 *Destino:* ' + (parsed.destino || 'por definir'));
    lines.push('🍽 *Plan:* ' + formatPlanForDisplay(parsed.plan));

    const adultosCount = Number(parsed.adultos) || 0;
    const personas = [adultosCount + ' adulto' + (adultosCount === 1 ? '' : 's')];
    if (parsed.menores.length) {
      const detalle = parsed.menores.map(edad => edad + ' años').join(', ');
      personas.push(parsed.menores.length + ' menor' + (parsed.menores.length === 1 ? '' : 'es') + ' (' + detalle + ')');
    }
    lines.push('👥 *Personas:* ' + personas.join(' + '));

    const transportes = Array.isArray(parsed.transportes) && parsed.transportes.length
      ? parsed.transportes
      : [parsed.transporte].filter(Boolean);
    const transporteCopy = transportes.length
      ? transportes.map(t => formatTransportLabel(t)).join(' + ')
      : 'por definir';
    lines.push('🧭 *Transporte:* ' + transporteCopy);

    if (parsed.traslados) lines.push('🚖 *Traslados:* ' + capitalizeFirst(parsed.traslados));
    if (parsed.hotelDeseado) lines.push('🏨 *Hotel deseado:* ' + parsed.hotelDeseado);
    if (parsed.presupuestoAdulto) lines.push('💰 *Presupuesto/adulto:* ' + formatCurrency(parsed.presupuestoAdulto));

    const windows = Array.isArray(parsed.dateWindows)
      ? parsed.dateWindows.slice(0, this.maxWindows)
      : [];

    if (windows.length) {
      lines.push('');
      lines.push('📅 *Fechas sugeridas* (hasta ' + this.maxWindows + '):');
      windows.forEach((win) => {
        lines.push('• ' + formatWindowLine(win));
        const note = formatAdjustmentNote(win.adjustedNote);
        if (note) lines.push('  ⚠️ ' + note);
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
      return [Para  no encontre opciones disponibles en la plataforma.];
    }

    const messages = [];

    const headerLines = [];
    headerLines.push(📅 **);
    if (window.adjustedNote) headerLines.push(⚠️ __);
    headerLines.push(🧭 );

    if (!allowNonRefundable && filtered.length < options.length) {
      const descartadas = options.length - filtered.length;
      headerLines.push(ℹ️ _Se descartaron  opción(es) no reembolsable(s) (salida > 14 días)_);
    } else if (allowNonRefundable && options.some(opt => opt.tipoTarifa === 'NO REEMBOLSABLE')) {
      headerLines.push(⚠️ _Por cercanía de fecha (<14 días), algunas opciones son NO REEMBOLSABLES_);
    }

    messages.push(headerLines.join('\n'));

    finalOptions.forEach((opt, idx) => {
      messages.push(this._formatOption(opt, idx + 1, parsed, tierResults.mode));
    });

    return messages;
  }

  _formatOption(option, index, parsed, mode) {
    const lines = [];
    const hotelName = option.titulo || option.hotel || Opcion ;

    const emoji = index === 1 ? '🎁' : index === 2 ? '💡' : '🌅';

    lines.push('');
    lines.push(${emoji} **);

    const incluye = buildIncludesLine(option, mode);
    if (incluye) lines.push(incluye);

    const priceAdult = option?.precios?.precioPorAdulto;
    const priceMinor = option?.precios?.precioPorMenorPromedio;
    const total = option?.precios?.precioConMenores ?? option?.precios?.precioSoloAdultos ?? extraerPrecioNumerico(option.precio);

    if (priceAdult) lines.push(👤 *Adulto:* );
    if (parsed.menores.length && priceMinor) lines.push(🧒 *Menor (prom.):* );
    if (total) {
      lines.push(💵 *Total:* );
      lines.push(💳 *Reserva con 30%:* );
    }

    if (option.tipoTarifa === 'NO REEMBOLSABLE') {
      lines.push('⚠️ *No Reembolsable* (por cercanía de fecha)');
    } else if (option.tipoTarifa && option.tipoTarifa !== 'ESTANDAR') {
      lines.push(ℹ️ Tarifa: );
    }

    if (option.mediaLinks) {
      if (option.mediaLinks.tiktok_url) {
        lines.push(🎬 TikTok: );
      } else if (option.mediaLinks.external_video_url) {
        lines.push(🎥 Video: );
      }
    }

    return lines.join('\n');
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


function ensureMidday(value) {
  if (!value) return null;
  const source = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (isNaN(source)) return null;
  source.setHours(12, 0, 0, 0);
  return source;
}

function createDateFromParts(year, monthIndex, day) {
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return null;
  const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
  return isNaN(date) ? null : date;
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

function formatTransportLabel(mode, includeIcon = true) {
  const normalized = mode === 'avion' ? 'avion' : 'camion';
  if (!includeIcon) return normalized === 'avion' ? 'Vuelo' : 'Camion';
  return normalized === 'avion' ? 'Vuelo ??' : 'Camion ??';
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
    : Math.max(diffInDays(window.salida, window.regreso), 0);
  const suffix = nights === 1 ? 'noche' : 'noches';
  return `${formatDayAbbrev(window.salida)} -> ${formatDayAbbrev(window.regreso)} (${nights} ${suffix})`;
}

function formatAdjustmentNote(note) {
  if (!note) return null;
  const normalized = note.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const clean = normalized.replace(/- patron valido para transporte/i, '').trim();
  const match = clean.match(/^([A-Za-z]+) a ([A-Za-z]+) \((\d+) noches?\)/i);
  if (match) {
    const start = capitalizeFirst(match[1].toLowerCase());
    const end = capitalizeFirst(match[2].toLowerCase());
    const nights = parseInt(match[3], 10);
    const suffix = nights === 1 ? 'noche' : 'noches';
    return `Ajustamos a ${start} -> ${end} (${nights} ${suffix})`;
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
    if (token.includes('avion') || token.includes('vuelo') || token.includes('aereo') || token.includes('aer�o')) {
      modes.add('avion');
    }
  });
  return Array.from(modes);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
