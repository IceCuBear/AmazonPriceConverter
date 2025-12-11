# Amazon Euro Converter

A lightweight UserScript that automatically converts and displays Amazon prices in the desired currency next to the original Euro (EUR) prices. It is designed to provide "Revolut-ish" mid-market exchange rates rather than Amazon's often inflated currency conversion rates.

## 🚀 Features

*   **Real-time Exchange Rates:** Fetches current rates from `open.er-api.com`.
*   **Smart Caching:** Caches exchange rates locally for 12 hours to minimize API calls and speed up page loads.
*   **Native Integration:** The converted price is styled to look like part of the Amazon interface.
*   **Wide Support:** Works on:
    *   Product pages (Main price & secondary text prices)
    *   Search results lists
    *   Shopping Cart
    *   Delivery costs
*   **Supported Regions:** `amazon.de`, `amazon.es`, `amazon.fr`, `amazon.it`.

## 📦 Installation

You need a UserScript manager extension to run this script.

1.  **Install a UserScript Manager:**
    *   [Violentmonkey](https://violentmonkey.github.io/) (Recommended)
    *   [Tampermonkey](https://www.tampermonkey.net/)
    *   [Greasemonkey](https://www.greasespot.net/)

2.  **Install the Script:**
    *   Create a new script in your manager.
    *   Copy the content of `AmazonPriceConverter.user.js` from this repository.
    *   Paste it into the editor and save.

## ⚙️ How it Works

1.  The script activates on any supported Amazon domain.
2.  It checks if it has a cached exchange rate (less than 12 hours old).
3.  If not, it fetches the latest EUR to HUF rate from the API.
4.  It scans the page for price elements and injects the approximate HUF value next to them (e.g., `20,00 € (≈ 8 000 Ft)`).
5.  It uses a `MutationObserver` to handle dynamic content (like when you load more results or change product options).

## 📝 Configuration

The script works out of the box, but you can modify the constants at the top of the file if you want to adapt it for another currency:

```javascript
const CURRENCY_SOURCE = 'EUR';
const CURRENCY_TARGET = 'HUF'; // Change to 'USD', 'GBP', etc.
const SYMBOL_TARGET = ' Ft';
```

## ⚠️ Disclaimer

This is an unofficial script. Exchange rates are estimates based on mid-market data and may differ slightly from the final charge on your bank card.

## License

This project is open source. Feel free to modify and distribute.
