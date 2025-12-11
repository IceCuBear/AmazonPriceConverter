// ==UserScript==
// @name         Amazon Price Converter
// @namespace    https://github.com/IceCuBear/AmazonPriceConverter
// @author       IceCuBear
// @license      GNU GPLv3
// @version      2025.12.11.6
// @description  Converts Amazon prices to your preferred currency. Auto-detects site currency; configurable target, toggle, and QoL UI.
// @downloadURL  https://raw.githubusercontent.com/IceCuBear/AmazonPriceConverter/refs/heads/main/AmazonPriceConverter.user.js
// @updateURL    https://raw.githubusercontent.com/IceCuBear/AmazonPriceConverter/refs/heads/main/AmazonPriceConverter.user.js
// @homepageURL  https://github.com/IceCuBear/AmazonPriceConverter
// @supportURL   https://github.com/IceCuBear/AmazonPriceConverter/issues
// @source       https://github.com/IceCuBear/AmazonPriceConverter
// @icon         https://www.amazon.de/favicon.ico
// @icon64       https://www.amazon.de/favicon.ico
// @run-at       document-idle
// @noframes
// @match        https://www.amazon.*/*
// @match        https://smile.amazon.*/*
// @match        https://m.amazon.*/*
// @match        https://www.amazon.co.uk/*
// @match        https://www.amazon.co.jp/*
// @match        https://www.amazon.com.au/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      open.er-api.com
// ==/UserScript==

(function () {
    'use strict';

    ////////////////////////////////////////////////////////////////////////////
    // 1. Config & Constants
    // Core currency settings and external API configuration.
    ////////////////////////////////////////////////////////////////////////////

    /** Settings keys for GM storage. */
    const KV = {
        enabled: 'apc_enabled',
        targetCurrency: 'apc_target_currency',
        targetLocale: 'apc_target_locale',
        targetSuffix: 'apc_target_suffix',
        overrideFormatting: 'apc_override_formatting',
        lastRates: 'apc_rates_', // prefix + base
        lastUpdate: 'apc_rates_ts_', // prefix + base
    };

    /** Default settings. */
    const DEFAULTS = {
        enabled: true,
        targetCurrency: 'HUF',
        targetLocale: 'hu-HU',
        targetSuffix: ' Ft',
        overrideFormatting: false,
    };

    /** Exchange-rate endpoint and cache lifetime. */
    const FX_BASE_URL = `https://open.er-api.com/v6/latest/`;
    const FX_CACHE_MS = 12 /* h */ * 60 * 60 * 1000;

    ////////////////////////////////////////////////////////////////////////////
    // 2. Utilities
    // Precompiled regex and number formatter. Avoids allocations in loops.
    ////////////////////////////////////////////////////////////////////////////

    // Quick check: skip text without any digits.
    const NUMBER_TEST_REGEX = /[0-9]/;
    // Clean everything except digits and punctuation commonly used by prices.
    const CLEAN_REGEX = /[^\d.,]/g;
    const COMMA_GLOBAL_REGEX = /,/g;
    const DOT_GLOBAL_REGEX = /\./g;

    // Global state: resolved settings and helpers built at runtime.
    let SETTINGS = null; // populated in init
    let FORMATTER = null; // Intl.NumberFormat built from SETTINGS
    let CURRENT_BASE = null; // detected base ISO
    let CURRENT_RATE = 0; // base -> target

    /**
     * Simple debounce helper to coalesce rapid DOM changes.
     * @param {Function} fn - Function to execute.
     * @param {number} waitMs - Debounce interval in milliseconds.
     * @returns {Function}
     */
    function debounce(fn, waitMs) {
        let t = null;
        return function debounced(...args) {
            if (t) clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), waitMs);
        };
    }

    ////////////////////////////////////////////////////////////////////////////
    // 3. Settings, Base Detection & Exchange Rate
    // Pulls latest FX and caches it for a fixed duration to minimize requests.
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Load settings from storage with defaults.
     */
    function loadSettings() {
        return {
            enabled: GM_getValue(KV.enabled, DEFAULTS.enabled),
            targetCurrency: GM_getValue(KV.targetCurrency, DEFAULTS.targetCurrency),
            targetLocale: GM_getValue(KV.targetLocale, DEFAULTS.targetLocale),
            targetSuffix: GM_getValue(KV.targetSuffix, DEFAULTS.targetSuffix),
            overrideFormatting: GM_getValue(KV.overrideFormatting, DEFAULTS.overrideFormatting),
        };
    }

    /** Persist provided settings fields. */
    function saveSettings(partial) {
        if (partial.hasOwnProperty('enabled')) GM_setValue(KV.enabled, !!partial.enabled);
        if (partial.hasOwnProperty('targetCurrency')) GM_setValue(KV.targetCurrency, String(partial.targetCurrency || '').toUpperCase());
        if (partial.hasOwnProperty('targetLocale')) GM_setValue(KV.targetLocale, String(partial.targetLocale || ''));
        if (partial.hasOwnProperty('targetSuffix')) GM_setValue(KV.targetSuffix, String(partial.targetSuffix || ''));
        if (partial.hasOwnProperty('overrideFormatting')) GM_setValue(KV.overrideFormatting, !!partial.overrideFormatting);
        SETTINGS = loadSettings();
        FORMATTER = buildFormatter(SETTINGS);
    }

    /** Build Intl formatter based on settings. */
    function buildFormatter(s) {
        // Prefer currency-specific auto locale unless user overrides.
        const auto = getAutoFormattingFor(s.targetCurrency);
        const locale = s.overrideFormatting ? (s.targetLocale || undefined) : (auto.locale || navigator.language || undefined);
        // Zero fraction for currencies typically without minor units.
        const zeroFrac = /^(HUF|JPY|ISK)$/.test(s.targetCurrency);
        return new Intl.NumberFormat(locale, {
            style: 'decimal',
            maximumFractionDigits: zeroFrac ? 0 : 2,
            minimumFractionDigits: zeroFrac ? 0 : 0,
        });
    }

    /** Currency metadata used for automatic suffix/locale suggestions. */
    const CURRENCY_META = {
        HUF: { suffix: ' Ft', locale: 'hu-HU', zero: true },
        EUR: { suffix: ' €', locale: 'de-DE', zero: false },
        USD: { suffix: ' $', locale: 'en-US', zero: false },
        GBP: { suffix: ' £', locale: 'en-GB', zero: false },
        PLN: { suffix: ' zł', locale: 'pl-PL', zero: false },
        SEK: { suffix: ' kr', locale: 'sv-SE', zero: false },
        CZK: { suffix: ' Kč', locale: 'cs-CZ', zero: false },
        RON: { suffix: ' lei', locale: 'ro-RO', zero: false },
        JPY: { suffix: ' ¥', locale: 'ja-JP', zero: true },
        TRY: { suffix: ' ₺', locale: 'tr-TR', zero: false },
        AUD: { suffix: ' A$', locale: 'en-AU', zero: false },
        CAD: { suffix: ' C$', locale: 'en-CA', zero: false },
        CHF: { suffix: ' CHF', locale: 'de-CH', zero: false },
        NOK: { suffix: ' kr', locale: 'nb-NO', zero: false },
        DKK: { suffix: ' kr', locale: 'da-DK', zero: false },
        MXN: { suffix: ' MX$', locale: 'es-MX', zero: false },
    };

    /** Compute automatic suffix and locale for a currency. */
    function getAutoFormattingFor(code) {
        const iso = String(code || '').toUpperCase();
        const meta = CURRENCY_META[iso];
        const locale = (meta && meta.locale) || (navigator.language || 'en-US');
        const suffix = (meta && meta.suffix) || (' ' + iso);
        return { locale, suffix };
    }

    /** Map hostname/TLD to base currency; fallback to DOM detection later. */
    function detectBaseCurrencyFromHost(host) {
        host = host || location.hostname;
        // Common Amazon locales
        const map = [
            [/amazon\.(de|fr|it|es|nl|com\.be|com\.tr|ae|sa)/, 'EUR'],
            [/amazon\.se/, 'SEK'],
            [/amazon\.pl/, 'PLN'],
            [/amazon\.co\.uk/, 'GBP'],
            [/amazon\.com\.au/, 'AUD'],
            [/amazon\.ca/, 'CAD'],
            [/amazon\.co\.jp/, 'JPY'],
            [/amazon\.com\.mx/, 'MXN'],
            [/amazon\.com/, 'USD'],
        ];
        for (const [re, iso] of map) {
            if (re.test(host)) return iso;
        }
        return 'USD'; // safe default
    }

    /**
     * Fetch BASE→TARGET exchange rate with per-base caching to minimize requests.
     * Uses open.er-api.com and stores the full rates table keyed by base ISO.
     * @param {string} baseIso ISO 4217 base currency (e.g., EUR)
     * @param {string} targetIso ISO 4217 target currency (e.g., HUF)
     * @returns {Promise<number>} Resolved to a positive rate or 0 on failure.
     */
    async function getExchangeRate(baseIso, targetIso) {
        baseIso = String(baseIso || '').toUpperCase();
        targetIso = String(targetIso || '').toUpperCase();
        if (baseIso === targetIso) return 1;

        const now = Date.now();
        const tsKey = KV.lastUpdate + baseIso;
        const ratesKey = KV.lastRates + baseIso;
        const lastUpdate = GM_getValue(tsKey, 0);
        const cachedRates = GM_getValue(ratesKey, null);
        if (cachedRates && (now - lastUpdate) < FX_CACHE_MS) {
            const rate = cachedRates[targetIso];
            return rate && isFinite(rate) && rate > 0 ? rate : 0;
        }

        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: FX_BASE_URL + baseIso,
                onload: function (response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const rates = data && data.rates ? data.rates : null;
                        if (rates && rates[targetIso] && isFinite(rates[targetIso])) {
                            GM_setValue(ratesKey, rates);
                            GM_setValue(tsKey, now);
                            resolve(rates[targetIso]);
                        } else {
                            resolve(0);
                        }
                    } catch (_e) {
                        resolve(0);
                    }
                },
                onerror: () => resolve(0),
            });
        });
    }

    ////////////////////////////////////////////////////////////////////////////
    // 4. Formatting
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Formats a numeric value into the currently selected target-currency string.
     * Uses Intl.NumberFormat with auto/override locale and appends a suffix.
     * @param {number} value
     * @returns {string}
     */
    function formatCurrency(value) {
        const auto = getAutoFormattingFor(SETTINGS?.targetCurrency);
        const suffix = SETTINGS?.overrideFormatting ? (SETTINGS?.targetSuffix || auto.suffix) : auto.suffix;
        return FORMATTER.format(value) + suffix;
    }

    ////////////////////////////////////////////////////////////////////////////
    // 5. Visual Element Creation
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Creates a small inline tag like "(≈ 12 345 Ft)" next to an Amazon price.
     * Attempts to match nearby font sizes for a cohesive look.
     *
     * @param {number} baseValue
     * @param {number} rate
     * @param {HTMLElement} contextElement
     * @returns {HTMLSpanElement}
     */
    function createHintElement(baseValue, rate, contextElement) {
        const formatted = formatCurrency(baseValue * rate);
        const span = document.createElement('span');

        const sizeMap = {
            'xl': '21px',
            'l': '17px',
            'm': '15px',
            's': '13px',
            'mini': '11px'
        };

        let sizeKey = contextElement.getAttribute('data-a-size');

        if (!sizeKey) {
            if (contextElement.classList.contains('a-size-xl')) sizeKey = 'xl';
            else if (contextElement.classList.contains('a-size-large')) sizeKey = 'l';
            else if (contextElement.classList.contains('a-size-medium')) sizeKey = 'm';
            else if (contextElement.classList.contains('a-size-small')) sizeKey = 's';
            else if (contextElement.classList.contains('a-size-mini')) sizeKey = 'mini';
        }

        if (contextElement.closest('#corePriceDisplay_desktop_feature_div')) sizeKey = 'xl';

        let fontSize = sizeMap[sizeKey] || '0.9em';

        if (contextElement.classList.contains('a-text-price')) {
            fontSize = '12px';
        }

        span.style.color = '#111';
        span.style.fontFamily = 'inherit';
        span.style.fontWeight = '400';
        span.style.whiteSpace = 'nowrap';
        span.style.display = 'inline';
        span.style.fontSize = fontSize;

        span.style.marginLeft = (sizeKey === 'xl' || sizeKey === 'l') ? '8px' : '5px';

        span.innerText = `(≈ ${formatted})`;
        span.classList.add('apc-tag');

        return span;
    }

    ////////////////////////////////////////////////////////////////////////////
    // 6. Parsing Logic
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Parses a price-like string and returns a floating value.
     * Handles common punctuation variants (e.g., "1.234,56" vs "1,234.56").
     * @param {string} str
     * @returns {number|null}
     */
    function parseStringValue(str) {
        if (!str || !NUMBER_TEST_REGEX.test(str)) return null;

        let clean = str.replace(CLEAN_REGEX, '');
        const lastDot = clean.lastIndexOf('.');
        const lastComma = clean.lastIndexOf(',');

        if (lastDot > -1 && lastComma > -1) {
            if (lastDot > lastComma) clean = clean.replace(COMMA_GLOBAL_REGEX, '');
            else clean = clean.replace(DOT_GLOBAL_REGEX, '').replace(',', '.');
        } else if (lastComma > -1) {
            clean = clean.replace(',', '.');
        }

        const floatVal = parseFloat(clean);
        return isNaN(floatVal) ? null : floatVal;
    }

    /**
     * Extracts a price value from Amazon's structured price blocks.
     * Supports standard price layout and accessibility offscreen node.
     * @param {HTMLElement} element
     * @returns {number|null}
     */
    function parsePriceFromComplexElement(element) {
        const whole = element.querySelector('.a-price-whole');
        const fraction = element.querySelector('.a-price-fraction');
        if (whole && fraction) {
            const w = whole.textContent.trim().replace(/[.,]/g, '');
            const f = fraction.textContent.trim();
            return parseFloat(w + '.' + f);
        }
        const offscreen = element.querySelector('.a-offscreen');
        if (offscreen && offscreen.textContent.length > 0) {
            return parseStringValue(offscreen.textContent);
        }
        return parseStringValue(element.textContent);
    }

    ////////////////////////////////////////////////////////////////////////////
    // 7. Main Conversion Pass & Observer
    ////////////////////////////////////////////////////////////////////////////

    /** Adds a marker class to avoid double-processing. */
    function markProcessed(el) { el.classList.add('apc-processed'); }
    /** Quick processed check. */
    function isProcessed(el) { return el.classList.contains('apc-processed'); }

    /**
     * Executes a single pass that discovers price-like elements and augments
     * them with a local-currency hint.
     * @param {number} rate BASE→TARGET rate
     */
    function runConversionPass(rate) {
        if (!SETTINGS?.enabled) return;
        // 1) Standard price widgets
        document.querySelectorAll('.a-price:not(.apc-processed)').forEach(container => {
            const baseValue = parsePriceFromComplexElement(container);
            if (baseValue !== null) {
                const hintEl = createHintElement(baseValue, rate, container);

                if (container.classList.contains('a-text-price')) {
                    container.appendChild(hintEl);
                } else {
                    if (container.parentNode) {
                        container.parentNode.insertBefore(hintEl, container.nextSibling);
                    } else {
                        container.appendChild(hintEl);
                    }
                }
                markProcessed(container);
            }
        });

        // 2) Delivery price badges
        document.querySelectorAll('[data-csa-c-delivery-price]:not(.apc-processed)')
            .forEach(block => {
                const deliveryPriceStr = block.getAttribute('data-csa-c-delivery-price');
                if (deliveryPriceStr && deliveryPriceStr.toUpperCase() !== 'FREE') {
                    const baseValue = parseStringValue(deliveryPriceStr);
                    if (baseValue !== null) {
                        const hintEl = createHintElement(baseValue, rate, block);
                        const textTarget = block.querySelector('.a-text-bold')?.parentNode || block;
                        textTarget.appendChild(hintEl);
                    }
                }
                markProcessed(block);
            });

        // 3) Cart / sidebar totals and unit prices
        const cartSelectors = ['.sc-price', '.ewc-subtotal-amount', '.ewc-unit-price'];
        document.querySelectorAll(cartSelectors.join(', ')).forEach(el => {
            if (isProcessed(el)) return;
            const targetTextEl = el.querySelector('h2') || el;
            const baseValue = parseStringValue(targetTextEl.textContent);
            if (baseValue !== null) {
                const hintEl = createHintElement(baseValue, rate, targetTextEl);
                targetTextEl.appendChild(hintEl);
                markProcessed(el);
            }
        });
    }

    /** Remove all rendered hints and processed markers (old and new). */
    function clearRenderedHints() {
        document.querySelectorAll('.apc-tag, .huf-price-tag').forEach(n => n.remove());
        document.querySelectorAll('.apc-processed, .huf-processed').forEach(n => n.classList.remove('apc-processed', 'huf-processed'));
    }

    /**
     * Try to inject a small settings cog (icon-only) into the Amazon top nav.
     * Idempotent; safe to call repeatedly (no duplicates).
     */
    function ensureSettingsCog() {
        if (document.getElementById('apc-cog')) return;
        const navTools = document.querySelector('#nav-tools');
        if (!navTools) return; // retry later via observer

        const wrap = document.createElement('div');
        wrap.className = 'nav-div';
        const btn = document.createElement('a');
        btn.id = 'apc-cog';
        btn.href = 'javascript:void(0)';
        btn.className = 'nav-a nav-a-2';
        btn.setAttribute('aria-label', 'Amazon Price Converter settings');
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.padding = '2px 6px';
        btn.style.borderRadius = '16px';
        btn.style.userSelect = 'none';
        btn.style.textDecoration = 'none';
        // Make the cog a bit larger and more white for visibility
        btn.innerHTML = '<span style="font-size:22px; line-height:1; color:#fff; text-shadow: 0 0 2px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.5)">⚙</span>';
        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(255,255,255,0.08)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '';
        });
        btn.addEventListener('click', toggleSettingsPanel);
        wrap.appendChild(btn);
        // Place it as the leftmost tool item
        navTools.insertBefore(wrap, navTools.firstChild);
    }

    /**
     * Create or remove the floating settings panel. Includes:
     * - Outside click + Esc to close
     * - Draggable header with smooth, low‑jank movement (rAF + transform)
     */
    function toggleSettingsPanel() {
        const existing = document.getElementById('apc-panel');
        if (existing) { existing.remove(); return; }
        const panel = document.createElement('div');
        panel.id = 'apc-panel';
        panel.style.position = 'fixed';
        panel.style.top = '64px';
        panel.style.right = '16px';
        panel.style.zIndex = '99999';
        panel.style.background = '#fff';
        panel.style.border = '1px solid #ddd';
        panel.style.boxShadow = '0 2px 12px rgba(0,0,0,0.15)';
        panel.style.padding = '0 12px 10px';
        panel.style.borderRadius = '6px';
        panel.style.minWidth = '280px';
        panel.style.fontSize = '13px';

        const autoFmt = getAutoFormattingFor(SETTINGS.targetCurrency);
        const html = `
            <div id="apc-header" style="
                font-weight:600; margin:0 -12px 8px -12px; padding:10px 12px; cursor:move;
                background:#f6f7f8; border-bottom:1px solid #e6e6e6; border-radius:6px 6px 0 0;
                display:flex; align-items:center; justify-content:space-between;">
                <span>Amazon Price Converter</span>
                <button id="apc-x" title="Close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#555">×</button>
            </div>
            <label style="display:flex;align-items:center;gap:8px;margin:6px 0">
                <input type="checkbox" id="apc-enabled" ${SETTINGS.enabled ? 'checked' : ''}>
                <span>Enabled</span>
            </label>
            <label style="display:block;margin:6px 0">
                <div style="margin-bottom:4px">Target currency (ISO):</div>
                <select id="apc-target" style="width:100%"></select>
                <div id="apc-auto-hint" style="font-size:12px;color:#666;margin-top:4px">
                    Auto: locale <b>${autoFmt.locale}</b>, suffix <b>${autoFmt.suffix.replace(/</g,'&lt;')}</b>
                </div>
            </label>
            <div id="apc-adv-wrap" style="margin-top:8px;border-top:1px solid #eee;padding-top:8px">
                <label style="display:flex;align-items:center;gap:8px;margin:6px 0">
                    <input type="checkbox" id="apc-override" ${SETTINGS.overrideFormatting ? 'checked' : ''}>
                    <span>Advanced options: override auto formatting</span>
                </label>
                <div id="apc-adv-fields" style="display:${SETTINGS.overrideFormatting ? 'block' : 'none'}">
                    <label style="display:block;margin:6px 0">
                        <div style="margin-bottom:4px">Target locale (for number formatting):</div>
                        <input id="apc-locale" type="text" placeholder="e.g. hu-HU" style="width:100%" value="${SETTINGS.targetLocale}">
                    </label>
                    <label style="display:block;margin:6px 0">
                        <div style="margin-bottom:4px">Suffix (after number):</div>
                        <input id="apc-suffix" type="text" style="width:100%" value="${SETTINGS.targetSuffix}">
                    </label>
                </div>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
                <button id="apc-refresh" class="a-button a-button-base" style="padding:4px 10px">Refresh FX</button>
                <button id="apc-save" class="a-button a-button-primary" style="padding:4px 10px">Save</button>
                <button id="apc-close" class="a-button a-button-base" style="padding:4px 10px">Close</button>
            </div>
        `;
        panel.innerHTML = html;
        document.body.appendChild(panel);

        // Convert initial right-aligned position to left for dragging convenience
        try {
            const rect = panel.getBoundingClientRect();
            const left = Math.max(8, window.innerWidth - rect.width - 16);
            panel.style.left = left + 'px';
            panel.style.right = '';
        } catch(_) {}

        // Populate currency select
        const list = ['HUF','EUR','USD','GBP','PLN','SEK','CZK','RON','JPY','TRY','AUD','CAD','CHF','NOK','DKK','MXN'];
        const sel = panel.querySelector('#apc-target');
        list.forEach(code => {
            const opt = document.createElement('option');
            opt.value = code; opt.textContent = code; if (code === SETTINGS.targetCurrency) opt.selected = true; sel.appendChild(opt);
        });

        // Update auto hint when currency changes (before save)
        sel.addEventListener('change', () => {
            const v = sel.value;
            const a = getAutoFormattingFor(v);
            const hint = panel.querySelector('#apc-auto-hint');
            if (hint) hint.innerHTML = `Auto: locale <b>${a.locale}</b>, suffix <b>${a.suffix.replace(/</g,'&lt;')}</b>`;
            // If override is on, do not auto-change inputs. If override is off, just update hint.
        });

        const closePanel = () => panel.remove();
        panel.querySelector('#apc-x')?.addEventListener('click', closePanel);
        panel.querySelector('#apc-close')?.addEventListener('click', closePanel);
        const advFields = panel.querySelector('#apc-adv-fields');
        const overrideChk = panel.querySelector('#apc-override');
        if (overrideChk) {
            overrideChk.addEventListener('change', (e) => {
                if (advFields) advFields.style.display = e.target.checked ? 'block' : 'none';
            });
        }
        panel.querySelector('#apc-refresh')?.addEventListener('click', async () => {
            // bust cache for current base
            const base = CURRENT_BASE || detectBaseCurrencyFromHost();
            GM_setValue(KV.lastUpdate + base, 0);
            GM_setValue(KV.lastRates + base, null);
            CURRENT_RATE = await getExchangeRate(base, SETTINGS.targetCurrency);
            clearRenderedHints();
            runConversionPass(CURRENT_RATE);
        });
        panel.querySelector('#apc-save')?.addEventListener('click', async () => {
            const enabled = panel.querySelector('#apc-enabled').checked;
            const targetCurrency = panel.querySelector('#apc-target').value;
            const overrideFormatting = !!panel.querySelector('#apc-override')?.checked;
            let targetLocale = SETTINGS.targetLocale;
            let targetSuffix = SETTINGS.targetSuffix;
            if (overrideFormatting) {
                targetLocale = panel.querySelector('#apc-locale')?.value || '';
                targetSuffix = panel.querySelector('#apc-suffix')?.value || '';
            } else {
                // compute and persist autos for convenience
                const auto = getAutoFormattingFor(targetCurrency);
                targetLocale = auto.locale;
                targetSuffix = auto.suffix;
            }
            saveSettings({ enabled, targetCurrency, targetLocale, targetSuffix, overrideFormatting });
            // When settings change, refresh rate and rerender
            const base = CURRENT_BASE || detectBaseCurrencyFromHost();
            CURRENT_RATE = await getExchangeRate(base, SETTINGS.targetCurrency);
            clearRenderedHints();
            if (SETTINGS.enabled) runConversionPass(CURRENT_RATE);
        });

        // Stop propagation so outside-click closer doesn't immediately close
        panel.addEventListener('click', (e) => e.stopPropagation());

        // Draggable behavior via header
        const header = panel.querySelector('#apc-header');
        if (header) {
            // Prevent page scroll during drag (touch/pen)
            header.style.touchAction = 'none';
            // Use Pointer Events + requestAnimationFrame and CSS transform for smoothness.
            // We compute deltas relative to the panel's current left/top and then commit
            // the final position on pointerup to avoid layout thrash during the drag.

            let dragging = false;
            let startX = 0, startY = 0;     // pointer start
            let baseLeft = 0, baseTop = 0;  // left/top at drag start
            let dx = 0, dy = 0;             // live deltas
            let rafId = 0;

            const onPointerMove = (e) => {
                // Coalesce rapid events via rAF
                dx = e.clientX - startX;
                dy = e.clientY - startY;
                if (!rafId) {
                    rafId = requestAnimationFrame(() => {
                        rafId = 0;
                        // Keep within viewport with margins, applied to visual position
                        const margin = 4;
                        const w = panel.offsetWidth;
                        const h = panel.offsetHeight;
                        let nx = baseLeft + dx;
                        let ny = baseTop + dy;
                        nx = Math.min(window.innerWidth - w - margin, Math.max(margin, nx));
                        ny = Math.min(window.innerHeight - h - margin, Math.max(margin, ny));
                        // Apply visual movement via transform relative to base position
                        const tx = nx - baseLeft;
                        const ty = ny - baseTop;
                        panel.style.transform = `translate(${tx}px, ${ty}px)`;
                    });
                }
                e.preventDefault();
            };

            const endDrag = () => {
                if (!dragging) return;
                dragging = false;
                header.releasePointerCapture?.(lastPointerId);
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', endDrag);
                window.removeEventListener('pointercancel', endDrag);
                document.body.style.userSelect = '';
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                // Commit final position: compute visual offsets from transform and add to base
                const tr = panel.style.transform;
                let tx = 0, ty = 0;
                if (tr && tr.startsWith('translate(')) {
                    const m = tr.match(/translate\(([-\d.]+)px,\s*([\-\d.]+)px\)/);
                    if (m) { tx = parseFloat(m[1]) || 0; ty = parseFloat(m[2]) || 0; }
                }
                const finalLeft = baseLeft + tx;
                const finalTop = baseTop + ty;
                panel.style.transform = 'none';
                panel.style.left = Math.round(finalLeft) + 'px';
                panel.style.top = Math.round(finalTop) + 'px';
                panel.style.willChange = '';
            };

            let lastPointerId = 0;
            header.addEventListener('pointerdown', (e) => {
                // Only start drag on primary button/touch/pen
                if (e.button !== undefined && e.button !== 0) return;
                dragging = true;
                lastPointerId = e.pointerId || 0;
                const rect = panel.getBoundingClientRect();
                // Ensure left/top are numeric anchors to compute deltas from
                const curLeft = parseFloat(panel.style.left || rect.left);
                const curTop = parseFloat(panel.style.top || rect.top);
                baseLeft = isFinite(curLeft) ? curLeft : rect.left;
                baseTop = isFinite(curTop) ? curTop : rect.top;
                startX = e.clientX; startY = e.clientY; dx = 0; dy = 0;
                panel.style.willChange = 'transform';
                document.body.style.userSelect = 'none';
                header.setPointerCapture?.(lastPointerId);
                window.addEventListener('pointermove', onPointerMove, { passive: false });
                window.addEventListener('pointerup', endDrag);
                window.addEventListener('pointercancel', endDrag);
                e.preventDefault();
            });
        }
    }

    // Close the settings panel when clicking outside of it (and not on the cog)
    let outsideCloseAttached = false;
    /**
     * One-time global listeners to close the panel on outside click or Esc.
     * Safe to call multiple times; attaches only once per page.
     */
    function attachOutsideClose() {
        if (outsideCloseAttached) return;
        outsideCloseAttached = true;
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('apc-panel');
            const cog = document.getElementById('apc-cog');
            if (!panel) return;
            const target = e.target;
            const insidePanel = target && (target.closest ? target.closest('#apc-panel') : null);
            const onCog = target && (target.closest ? target.closest('#apc-cog') : null);
            if (!insidePanel && !onCog) {
                panel.remove();
            }
        }, true);
        // Optional: close with Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById('apc-panel');
                if (panel) panel.remove();
            }
        });
    }

    async function init() {
        SETTINGS = loadSettings();
        FORMATTER = buildFormatter(SETTINGS);
        CURRENT_BASE = detectBaseCurrencyFromHost();
        ensureSettingsCog();

        CURRENT_RATE = await getExchangeRate(CURRENT_BASE, SETTINGS.targetCurrency);
        if (!CURRENT_RATE && SETTINGS.enabled) {
            // Allow still running with last cached if any, else skip.
        }

        if (SETTINGS.enabled) runConversionPass(CURRENT_RATE || 0);

        // Observe dynamic content; Amazon frequently updates portions of the DOM.
        const debouncedRun = debounce(() => {
            ensureSettingsCog();
            attachOutsideClose();
            if (SETTINGS.enabled) runConversionPass(CURRENT_RATE || 0);
        }, 200);
        const observer = new MutationObserver(debouncedRun);
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
        // Also attach once at init
        attachOutsideClose();
    }

    init();

})();
