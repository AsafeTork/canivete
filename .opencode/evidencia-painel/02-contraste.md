# Ficha de contraste — Painel (Ácido-Noir)

Método 1 — **medição em pixel** (`n_browser_contrast`, viewport inteiro da aba Visão,
2026-10-29 ~21:50): anel `#141414` (52 px) × miolo `#0b0b0b` (9 px), deltaE 0.0417,
1.07:1 = distância de superfície card/fundo (par estrutural, não-texto), e **os hex
reais do render batem com a SPEC** (`docs/DESIGN.md`).

Método 2 — WCAG 2.1 relative luminance calculado sobre os tokens da SPEC (o painel
usa exatamente estes hex — confirmado pixel acima):

| par | hex | contraste | uso no painel |
|---|---|---|---|
| luz / fundo | `#FAF9F5` / `#0B0B0B` | **18.68:1** (AAA) | títulos, números, resumos |
| neutro / fundo | `#9A9A95` / `#0B0B0B` | **6.96:1** (AA) | labels, eixo, meta |
| acento / fundo | `#C2FF3D` / `#0B0B0B` | **16.56:1** (AAA) | 1 alvo/aba: CTX%, foco, ponto elem |
| erro / fundo | `#FF6B5E` / `#0B0B0B` | **7.05:1** (AAA) | pills bug/erro, barra >90% |
| aviso / fundo | `#E7C266` / `#0B0B0B` | **11.53:1** (AAA) | pill ajuste, aviso de rede |
| ok / fundo | `#8FD4A8` / `#0B0B0B` | **9.60:1** (AAA) | anéis, dots, "on" |
| neutro / card | `#9A9A95` / `#141414` | 6.52:1 (AA) | labels dentro de card |
| card / fundo | `#141414` / `#0B0B0B` | 1.07:1 (n/a — superfície) | camadas por luminância |

Alvos de texto do painel todos ≥ 6.5:1. Mono (Geist) só em dado; acento 1×/aba
(visão: ponto elem · itens: replay · gráficos: latência · ferramentas: CTX%).
