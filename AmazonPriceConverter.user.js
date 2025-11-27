// ==UserScript==
// @name         Amazon Euro Converter
// @namespace    https://violentmonkey.github.io/
// @version      1.1
// @description  Converts Amazon EUR prices to HUF (or whatever needed).
// @downloadURL  https://raw.githubusercontent.com/IceCuBear/AmazonPriceConverter/refs/heads/main/AmazonPriceConverter.user.js
// @updateURL    https://raw.githubusercontent.com/IceCuBear/AmazonPriceConverter/refs/heads/main/AmazonPriceConverter.user.js
// @match        https://www.amazon.de/*
// @match        https://www.amazon.es/*
// @match        https://www.amazon.fr/*
// @match        https://www.amazon.it/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION ---
    const CURRENCY_SOURCE = 'EUR';
    const CURRENCY_TARGET = 'HUF';
    const SYMBOL_TARGET = ' Ft';

    // --- OPTIMIZATION: PRE-COMPILE REGEX & FORMATTER ---
    const NUMBER_TEST_REGEX = /[0-9]/;
    const CLEAN_REGEX = /[^\d.,]/g;
    const COMMA_GLOBAL_REGEX = /,/g;
    const DOT_GLOBAL_REGEX = /\./g;

    const HUF_FORMATTER = new Intl.NumberFormat('hu-HU', {
        style: 'decimal',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0
    });

    // 1. CACHING LOGIC
    async function getExchangeRate() {
        const now = Date.now();
        const cachedRate = GM_getValue('exchangeRate', 0);
        const lastUpdate = GM_getValue('lastUpdate', 0);

        if (cachedRate && (now - lastUpdate) < 1000 * 60 * 60 * 12) {
            return cachedRate;
        }

        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `https://open.er-api.com/v6/latest/${CURRENCY_SOURCE}`,
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const rate = data.rates[CURRENCY_TARGET];
                        if (rate) {
                            GM_setValue('exchangeRate', rate);
                            GM_setValue('lastUpdate', now);
                            resolve(rate);
                        } else {
                            resolve(GM_getValue('exchangeRate', 0));
                        }
                    } catch (e) {
                        resolve(GM_getValue('exchangeRate', 0));
                    }
                },
                onerror: () => resolve(GM_getValue('exchangeRate', 0))
            });
        });
    }

    // 2. FORMATTING
    function formatCurrency(value) {
        return HUF_FORMATTER.format(value) + SYMBOL_TARGET;
    }

    // 3. VISUAL ELEMENT CREATION
    function createHufElement(euroValue, rate, contextElement) {
        const formatted = formatCurrency(euroValue * rate);
        const span = document.createElement('span');

        const sizeMap = {
            'xl': '21px',
            'l':  '17px',
            'm':  '15px',
            's':  '13px',
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

    // 4. PARSING LOGIC
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

    // 5. MAIN LOOP & OBSERVER
    async function init() {
        let currentRate = await getExchangeRate();
        if (!currentRate) return;

        const runConversion = () => {
            // 1. Standard Prices
            document.querySelectorAll('.a-price:not(.huf-processed)').forEach(container => {
                const euroValue = parsePriceFromComplexElement(container);
                if (euroValue !== null) {
                    const hufEl = createHufElement(euroValue, currentRate, container);

                    if (container.classList.contains('a-text-price')) {
                        container.appendChild(hufEl);
                    } else {
                        if(container.parentNode) {
                            container.parentNode.insertBefore(hufEl, container.nextSibling);
                        } else {
                            container.appendChild(hufEl);
                        }
                    }
                    container.classList.add('huf-processed');
                }
            });

            // 2. Delivery Prices
            document.querySelectorAll('[data-csa-c-delivery-price]:not(.huf-processed)').forEach(block => {
                const deliveryPriceStr = block.getAttribute('data-csa-c-delivery-price');
                if (deliveryPriceStr && deliveryPriceStr.toUpperCase() !== 'FREE') {
                    const euroValue = parseStringValue(deliveryPriceStr);
                    if (euroValue !== null) {
                        const hufEl = createHufElement(euroValue, currentRate, block);
                        const textTarget = block.querySelector('.a-text-bold')?.parentNode || block;
                        textTarget.appendChild(hufEl);
                    }
                }
                block.classList.add('huf-processed');
            });

            // 3. Cart / Sidebar Totals
            const cartSelectors = ['.sc-price', '.ewc-subtotal-amount', '.ewc-unit-price'];
            document.querySelectorAll(cartSelectors.join(', ')).forEach(el => {
                if (el.classList.contains('huf-processed')) return;
                const targetTextEl = el.querySelector('h2') || el;
                const euroValue = parseStringValue(targetTextEl.textContent);
                if (euroValue !== null) {
                    const hufEl = createHufElement(euroValue, currentRate, targetTextEl);
                    targetTextEl.appendChild(hufEl);
                    el.classList.add('huf-processed');
                }
            });
        };

        runConversion();

        let debounceTimer;
        const observer = new MutationObserver(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                runConversion();
            }, 200);
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    init();

})();
