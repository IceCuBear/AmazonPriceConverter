// ==UserScript==
// @name         Amazon Price Converter
// @namespace    https://github.com/IceCuBear/AmazonPriceConverter
// @author       IceCuBear
// @license      GNU GPLv3
// @version      2025.12.11.2
// @description  Converts Amazon prices (EUR) to HUF and displays a local-currency hint next to prices, delivery fees, and totals.
// @downloadURL  https://raw.githubusercontent.com/IceCuBear/AmazonPriceConverter/refs/heads/main/AmazonPriceConverter.user.js
// @updateURL    https://raw.githubusercontent.com/IceCuBear/AmazonPriceConverter/refs/heads/main/AmazonPriceConverter.user.js
// @homepageURL  https://github.com/IceCuBear/AmazonPriceConverter
// @supportURL   https://github.com/IceCuBear/AmazonPriceConverter/issues
// @source       https://github.com/IceCuBear/AmazonPriceConverter
// @icon         https://www.amazon.de/favicon.ico
// @icon64       https://www.amazon.de/favicon.ico
// @run-at       document-idle
// @noframes
// @match        https://www.amazon.de/*
// @match        https://www.amazon.es/*
// @match        https://www.amazon.fr/*
// @match        https://www.amazon.it/*
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

    /** ISO code of source currency used on the matched Amazon sites. */
    const CURRENCY_SOURCE = 'EUR';
    /** ISO code of the target/local currency for display. */
    const CURRENCY_TARGET = 'HUF';
    /** Trailing symbol/label to append after a formatted value. */
    const SYMBOL_TARGET = ' Ft';

    /** Exchange-rate endpoint and cache lifetime. */
    const FX_ENDPOINT = `https://open.er-api.com/v6/latest/${CURRENCY_SOURCE}`;
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

    // Hungarian locale decimal formatting without fractional digits.
    const HUF_FORMATTER = new Intl.NumberFormat('hu-HU', {
        style: 'decimal',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    });

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
    // 3. Exchange Rate: Cache & Fetch
    // Pulls latest FX and caches it for a fixed duration to minimize requests.
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Returns the EUR→HUF exchange rate, using a cached value when fresh.
     * @returns {Promise<number>} Resolved to a positive rate or 0 on failure.
     */
    async function getExchangeRate() {
        const now = Date.now();
        const cachedRate = GM_getValue('exchangeRate', 0);
        const lastUpdate = GM_getValue('lastUpdate', 0);

        if (cachedRate && (now - lastUpdate) < FX_CACHE_MS) {
            return cachedRate;
        }

        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: FX_ENDPOINT,
                onload: function (response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const rate = data && data.rates ? data.rates[CURRENCY_TARGET] : 0;
                        if (rate && isFinite(rate) && rate > 0) {
                            GM_setValue('exchangeRate', rate);
                            GM_setValue('lastUpdate', now);
                            resolve(rate);
                        } else {
                            resolve(GM_getValue('exchangeRate', 0));
                        }
                    } catch (_e) {
                        resolve(GM_getValue('exchangeRate', 0));
                    }
                },
                onerror: () => resolve(GM_getValue('exchangeRate', 0)),
            });
        });
    }

    ////////////////////////////////////////////////////////////////////////////
    // 4. Formatting
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Formats a numeric value into a HUF display string.
     * @param {number} value
     * @returns {string}
     */
    function formatCurrency(value) {
        return HUF_FORMATTER.format(value) + SYMBOL_TARGET;
    }

    ////////////////////////////////////////////////////////////////////////////
    // 5. Visual Element Creation
    ////////////////////////////////////////////////////////////////////////////

    /**
     * Creates a small inline tag like "(≈ 12 345 Ft)" next to an Amazon price.
     * Attempts to match nearby font sizes for a cohesive look.
     *
     * @param {number} euroValue
     * @param {number} rate
     * @param {HTMLElement} contextElement
     * @returns {HTMLSpanElement}
     */
    function createHufElement(euroValue, rate, contextElement) {
        const formatted = formatCurrency(euroValue * rate);
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
        span.classList.add('huf-price-tag');

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
    function markProcessed(el) { el.classList.add('huf-processed'); }
    /** Quick processed check. */
    function isProcessed(el) { return el.classList.contains('huf-processed'); }

    /**
     * Executes a single pass that discovers price-like elements and augments
     * them with a local-currency hint.
     * @param {number} rate EUR→HUF rate
     */
    function runConversionPass(rate) {
        // 1) Standard price widgets
        document.querySelectorAll('.a-price:not(.huf-processed)').forEach(container => {
            const euroValue = parsePriceFromComplexElement(container);
            if (euroValue !== null) {
                const hufEl = createHufElement(euroValue, rate, container);

                if (container.classList.contains('a-text-price')) {
                    container.appendChild(hufEl);
                } else {
                    if (container.parentNode) {
                        container.parentNode.insertBefore(hufEl, container.nextSibling);
                    } else {
                        container.appendChild(hufEl);
                    }
                }
                markProcessed(container);
            }
        });

        // 2) Delivery price badges
        document.querySelectorAll('[data-csa-c-delivery-price]:not(.huf-processed)')
            .forEach(block => {
                const deliveryPriceStr = block.getAttribute('data-csa-c-delivery-price');
                if (deliveryPriceStr && deliveryPriceStr.toUpperCase() !== 'FREE') {
                    const euroValue = parseStringValue(deliveryPriceStr);
                    if (euroValue !== null) {
                        const hufEl = createHufElement(euroValue, rate, block);
                        const textTarget = block.querySelector('.a-text-bold')?.parentNode || block;
                        textTarget.appendChild(hufEl);
                    }
                }
                markProcessed(block);
            });

        // 3) Cart / sidebar totals and unit prices
        const cartSelectors = ['.sc-price', '.ewc-subtotal-amount', '.ewc-unit-price'];
        document.querySelectorAll(cartSelectors.join(', ')).forEach(el => {
            if (isProcessed(el)) return;
            const targetTextEl = el.querySelector('h2') || el;
            const euroValue = parseStringValue(targetTextEl.textContent);
            if (euroValue !== null) {
                const hufEl = createHufElement(euroValue, rate, targetTextEl);
                targetTextEl.appendChild(hufEl);
                markProcessed(el);
            }
        });
    }

    async function init() {
        let currentRate = await getExchangeRate();
        if (!currentRate) return;

        // Initial pass
        runConversionPass(currentRate);

        // Observe dynamic content; Amazon frequently updates portions of the DOM.
        const debouncedRun = debounce(() => runConversionPass(currentRate), 200);
        const observer = new MutationObserver(debouncedRun);
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    init();

})();
