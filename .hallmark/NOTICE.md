# Hallmark Studio

Design instructions and the initial `client/tokens.css` and `client/base.css` scaffold come from [Nutlope/hallmark](https://github.com/Nutlope/hallmark), Hallmark 2.0.0, Studio theme, app scope. Hallmark is MIT-licensed; see the upstream [license](https://github.com/Nutlope/hallmark/blob/main/LICENSE).

The product is a calendar workbench, so Hallmark's app-screen rules apply. The theme contributes its paper palette, type, controls, and subtle crop marks. No marketing hero, stock imagery, fabricated event data, or decorative statistics are used.

Run the upstream skill's `scripts/sloplint.mjs client --scope app --genre editorial --url http://127.0.0.1:5173/` for rendered validation. Node, puppeteer-core, and Chrome/Chromium are required. The Hallmark skill itself is used from a temporary tooling directory rather than included in the application runtime.
