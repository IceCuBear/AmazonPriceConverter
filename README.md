# Amazon Price Converter

Convert Amazon prices to your preferred currency, right on the page. The script auto‑detects the site’s base currency (EUR/GBP/USD/JPY/…) and shows an inline hint with your target currency next to each price, delivery fee, and cart total.

Current version: 2025.12.11.6

Repository: https://github.com/IceCuBear/AmazonPriceConverter

Issue tracker: https://github.com/IceCuBear/AmazonPriceConverter/issues

## Features

- Universal currencies
  - Auto‑detects the base currency from the Amazon domain (.de → EUR, .co.uk → GBP, .com → USD, .co.jp → JPY, …)
  - Lets you pick any target currency (e.g., HUF, EUR, USD, GBP, JPY, PLN, SEK, CZK, RON, TRY, AUD, CAD, CHF, NOK, DKK, MXN)
- Inline converted price hints like `(... ≈ 12 345 Ft)` added next to:
  - Product prices (including the main price block)
  - Search/listing results
  - Cart/subtotal and unit prices
  - Delivery price badges
- Smart formatting
  - Auto locale and suffix per target currency (e.g., HUF → `hu‑HU` + ` Ft`, JPY → `ja‑JP` + ` ¥`)
  - Optional “Advanced options” to override locale/suffix manually
  - Zero fraction digits for currencies without minor units (HUF, JPY, ISK)
- Smooth, compact UI
  - Small white cog in Amazon’s top bar opens a draggable settings panel
  - Click outside or press Esc to close
  - Enable/disable, choose target currency, refresh rates
- Efficient and respectful
  - 12‑hour per‑base‑currency caching of rates
  - Debounced DOM observer to avoid excessive work
  - Uses mid‑market rates from `open.er-api.com`

## 🖥Supported Amazon sites

The script matches broadly on Amazon domains and common variants:

- `https://www.amazon.*/*`
- `https://smile.amazon.*/*`
- `https://m.amazon.*/*`
- Explicit: `amazon.co.uk`, `amazon.co.jp`, `amazon.com.au`

If you find a domain that uses an unexpected base currency, please open an issue.

## Installation

You need a userscript manager extension:

- Violentmonkey (recommended): https://violentmonkey.github.io/
- Tampermonkey: https://www.tampermonkey.net/
- Greasemonkey: https://www.greasespot.net/

Then install the script:

1) One‑click (Raw URL)

- https://raw.githubusercontent.com/IceCuBear/AmazonPriceConverter/refs/heads/main/AmazonPriceConverter.user.js

2) Manual

- Create a new userscript and paste the contents of `AmazonPriceConverter.user.js`.

## Usage

1. Open any Amazon page. A small white cog appears in the header.
2. Click the cog to open the panel.
3. Pick your Target currency. The suggested locale and suffix update automatically.
4. Optionally enable “Advanced options” to override locale and suffix.
5. Click Save. Converted hints will appear next to prices.
6. Use “Refresh FX” to fetch fresh exchange rates immediately (otherwise cached for ~12h).

## Settings explained

- Enabled: Master on/off switch for rendering the converted price hints.
- Target currency: ISO 4217 code (HUF, EUR, USD, GBP, JPY, …).
- Advanced options: override auto formatting
  - Target locale: passed to `Intl.NumberFormat` (e.g., `hu-HU`, `en-GB`).
  - Suffix: text appended after the number (e.g., ` Ft`, ` €`).

By default, locale and suffix are selected automatically from a built‑in map per currency.

## Permissions

The userscript requests minimal permissions in its header:

- `@match` for Amazon domains listed above
- `@grant GM_xmlhttpRequest`, `@grant GM_setValue`, `@grant GM_getValue`
- `@connect open.er-api.com` to fetch exchange rates
- `@run-at document-idle`, `@noframes`

No tracking, analytics, or external resources beyond the public rates API are used.

## How it works (under the hood)

1. Detect base currency from the Amazon domain (e.g., `.de` → EUR).
2. Load your saved settings and build a locale‑aware number formatter.
3. Obtain the base→target exchange rate from `open.er-api.com` with a 12‑hour cache per base currency.
4. Scan price widgets, delivery badges, and cart totals, parse numeric values, and render inline hints.
5. Watch the page with a debounced `MutationObserver` to catch dynamic changes.
6. Provide a lightweight, draggable settings panel via the cog button.

## FAQ / Troubleshooting

- I don’t see the cog in the header
  - Wait a second for Amazon to load; the script inserts it once `#nav-tools` is present.
  - Some Amazon experiments/layouts may delay header creation; reloading the page usually helps.
- The numbers look odd for my currency
  - Try enabling Advanced options and set a custom locale (e.g., `de-DE` vs `fr-FR`).
- Rates look stale
  - Click “Refresh FX” in the panel to invalidate the cache and fetch new data.
- I want a new currency or domain supported
  - Open an issue with details and, if possible, example URLs.

## License

Licensed under the GNU GPLv3.  
Contributions and pull requests are welcome.
