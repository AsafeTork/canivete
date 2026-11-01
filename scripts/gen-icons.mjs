// Gera os ícones PNG da extensão (16/32/48/128) do logo SVG via Chrome headless --screenshot.
// Tile full-bleed #0B0B0B + logo com 12% de padding; C em luz (#faf9f5), lâmina no acento ácido.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const svg = readFileSync(new URL("../src/assets/logo-canivete.svg", import.meta.url), "utf8");
mkdirSync("/tmp/opencode/icon", { recursive: true });
mkdirSync(new URL("../extension/icons", import.meta.url), { recursive: true });

for (const s of [16, 32, 48, 128]) {
  const pad = Math.round(s * 0.12);
  const html = `<!DOCTYPE html><html><head><style>
html,body{margin:0;width:100%;height:100%;background:#0b0b0b;overflow:hidden}
body{display:flex;align-items:center;justify-content:center}
svg{width:calc(100% - ${pad}px);height:calc(100% - ${pad}px);color:#faf9f5}
</style></head><body>${svg}</body></html>`;
  writeFileSync(`/tmp/opencode/icon/i${s}.html`, html);
  execFileSync("google-chrome", ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    `--screenshot=/tmp/opencode/icon/icon${s}.png`, `--window-size=${s},${s}`, `file:///tmp/opencode/icon/i${s}.html`],
    { stdio: "ignore" });
  writeFileSync(new URL(`../extension/icons/icon${s}.png`, import.meta.url), readFileSync(`/tmp/opencode/icon/icon${s}.png`));
  console.log(`icon${s}.png ok`);
}
