// ==UserScript==
// @name         Amazon Euro to HUF Converter (Revolut-ish rates)
// @namespace    https://violentmonkey.github.io/
// @version      1.0
// @description  Converts Amazon EUR prices to HUF.
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
                            resolve(400);
                        }
                    } catch (e) {
                        resolve(GM_getValue('exchangeRate', 400));
                    }
                }
            });
        });
    }

    // 2. FORMATTING
    function formatCurrency(value) {
        return new Intl.NumberFormat('hu-HU', {
            style: 'decimal',
            maximumFractionDigits: 0,
            minimumFractionDigits: 0
        }).format(value) + SYMBOL_TARGET;
    }

    // 3. VISUAL ELEMENT CREATION (The "Mimic" Logic)
    function createHufElement(euroValue, rate, contextElement) {
        const formatted = formatCurrency(euroValue * rate);
        const span = document.createElement('span');

        // Identify Context
        // "Main" prices are usually XL size on the product page.
        const isMainPagePrice = contextElement.classList.contains('a-size-xl') ||
                                (contextElement.getAttribute('data-a-size') === 'xl') ||
                                contextElement.closest('#corePriceDisplay_desktop_feature_div');

        // "Text" prices are unit prices like (10.00 / kg)
        const isTextPrice = contextElement.classList.contains('a-text-price');

        span.style.color = '#111';
        span.style.fontFamily = 'inherit';
        span.style.fontWeight = '400';
        span.style.whiteSpace = 'nowrap';
        if (isMainPagePrice && !isTextPrice) {
            // --- STYLE A: MAIN PRICE (Side by side) ---
            span.style.display = 'inline';
            span.style.fontSize = '20px';
            span.style.marginLeft = '8px';
            span.innerText = `(≈ ${formatted})`;
        } else {
            // --- STYLE B: LIST / INLINE / CART ---
            span.style.display = 'inline';


            if (contextElement.tagName === 'H2' || contextElement.closest('h2')) {
                span.style.fontSize = '0.75em';
            } else {
                span.style.fontSize = '0.9em';
            }

            // Spacing
            if (isTextPrice) {
                 span.style.marginLeft = '4px';
            } else {
                 span.style.marginLeft = '6px';
            }

            span.innerText = `(≈${formatted})`;
        }

        span.classList.add('huf-price-tag');
        return span;
    }

    // 4. PARSING LOGIC (Robust)
    function parseStringValue(str) {
        if (!str || !/[0-9]/.test(str)) return null;
        let clean = str.replace(/[^\d.,]/g, '');
        const lastDot = clean.lastIndexOf('.');
        const lastComma = clean.lastIndexOf(',');
        if (lastDot > -1 && lastComma > -1) {
            if (lastDot > lastComma) clean = clean.replace(/,/g, '');
            else clean = clean.replace(/\./g, '').replace(',', '.');
        } else if (lastComma > -1) {
            clean = clean.replace(',', '.');
        }
        const floatVal = parseFloat(clean);
        return isNaN(floatVal) ? null : floatVal;
    }

    function parsePriceFromComplexElement(element) {
        // Priority 1: Visuals
        const whole = element.querySelector('.a-price-whole');
        const fraction = element.querySelector('.a-price-fraction');
        if (whole && fraction) {
            const w = whole.textContent.trim().replace(/[.,]/g, '');
            const f = fraction.textContent.trim();
            return parseFloat(w + '.' + f);
        }
        // Priority 2: Hidden
        const offscreen = element.querySelector('.a-offscreen');
        if (offscreen && offscreen.textContent.trim().length > 0) {
            return parseStringValue(offscreen.textContent);
        }
        // Priority 3: Raw
        return parseStringValue(element.textContent);
    }

    // 5. MAIN LOOP
    async function runConversion() {
        const rate = await getExchangeRate();

        // 1. Standard Prices (.a-price)
        document.querySelectorAll('.a-price:not(.huf-processed)').forEach(container => {
            const euroValue = parsePriceFromComplexElement(container);
            if (euroValue !== null) {
                const hufEl = createHufElement(euroValue, rate, container);

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

        // 2. Delivery
        document.querySelectorAll('[data-csa-c-delivery-price]:not(.huf-processed)').forEach(block => {
            const deliveryPriceStr = block.getAttribute('data-csa-c-delivery-price');
            if (deliveryPriceStr && deliveryPriceStr.toUpperCase() !== 'FREE') {
                const euroValue = parseStringValue(deliveryPriceStr);
                if (euroValue !== null) {
                    const hufEl = createHufElement(euroValue, rate, block);
                    const textTarget = block.querySelector('.a-text-bold')?.parentNode || block;
                    textTarget.appendChild(hufEl);
                }
            }
            block.classList.add('huf-processed');
        });

        // 3. Cart / Sidebar
        const cartSelectors = ['.sc-price', '.ewc-subtotal-amount', '.ewc-unit-price'];
        document.querySelectorAll(cartSelectors.join(', ')).forEach(el => {
            if (el.classList.contains('huf-processed')) return;
            const targetTextEl = el.querySelector('h2') || el;
            const euroValue = parseStringValue(targetTextEl.textContent);
            if (euroValue !== null) {
                const hufEl = createHufElement(euroValue, rate, targetTextEl);
                targetTextEl.appendChild(hufEl);
                el.classList.add('huf-processed');
            }
        });
    }

    // 6. OBSERVER
    runConversion();
    const observer = new MutationObserver(() => {
        runConversion();
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();
