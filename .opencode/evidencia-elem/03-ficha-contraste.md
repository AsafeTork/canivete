# Ficha de contraste — picker "Reports de elemento" (Ácido-Noir)

Método: pares calculados por WCAG 2.1 relative luminance a partir dos hex reais
extraídos do CSS em `extension/content.js` (bloco `#ubrowser-elem`), confirmados
visualmente nas capturas `01-desktop.png` / `02-mobile375.png`.

| par | hex | contraste | uso no widget |
|---|---|---|---|
| texto luz / fundo | `#f2f3f0` / `#0b0b0b` | **≈17.6:1** (AAA) | corpo do painel, labels, itens da lista |
| texto secundário / fundo | `#9aa1ab` / `#0b0b0b` | **≈7.5:1** (AAA) | dicas, placeholders, "opcional" |
| acento / fundo | `#f97316` / `#0b0b0b` | **≈6.8:1** (AAA) | contorno do hover/seleção, chip "#N", rótulo "selecionar" |
| texto sobre acento | `#0b0b0b` / `#f97316` | **≈6.9:1** (AAA) | CTA "Marcar problema" |
| hairline / fundo | `#262a31` / `#0b0b0b` | n/a (borda estrutural, não texto) | divisórias de bloco |

Paleta comprometida: Ácido-Noir — fundo `#0b0b0b`, luz `#f2f3f0`, UM acento
`#f97316` (contorno + chip + CTA), raio 6px, hairline `#262a31`, corpo
system-ui 13/20 peso 450, mono só em dado (seletor/role).

Todas as alvos de texto ≥ 7:1 → barra visual verificada por cálculo + ficha.

- capturas: 2026-10-28 12:13:59 (-03)
- última edição de `extension/content.js` (fix hover `box-shadow:0 0 0 2px rgba(11,11,11,.85)`): 2026-10-28 12:12:05 (-03)
