# SPEC — sistema visual Canivete (Ácido-Noir)

Estilo nomeado: **Ácido-Noir** (vocab. beleza-universal §3). Coragem gasta em UM lugar
por tela: o acento ácido marca ação ou número, nunca decora. ABUSE monitorado:
acento em todo hover/label (guarda: acento restrito a 1 alvo por tela) ·
mono assinando metadata estética (guarda: mono SÓ em dado/seletor/caminho).

Referências: Vercel Geist (monocromia disciplinada, mono = dado) ·
Linear (escuro nativo, camadas por luminância, hairline > sombra) ·
vocabulário interno Ácido-Noir.

## Paleta (contraste medido vs fundo #0B0B0B / card #141414)

| token | hex | vs fundo | uso |
|---|---|---|---|
| fundo | `#0B0B0B` | — | canvas |
| card | `#141414` | — | superfície elevada |
| hairline | `#262626` | 1.30 | borda 1px (estrutural, nunca texto) |
| luz | `#FAF9F5` | 18.68 | texto primário |
| neutro | `#9A9A95` | 6.96 (card 6.52) | texto secundário |
| **acento-ácido** | `#C2FF3D` | 16.56 | 1 ação/número por tela · lâmina da logo |
| erro | `#FF6B5E` | 7.05 | semântica erro |
| aviso | `#E7C266` | 11.53 | semântica aviso |
| ok | `#8FD4A8` | 11.39 | semântica ok |

Texto sobre acento: `#0B0B0B` (16.56:1).

## Fontes (2 famílias, self-hosted latin subset)

- **Space Grotesk** (variável 300–700) — principal: display, títulos, corpo, botões.
- **Geist Mono** (variável 100–900) — dado exclusivo: seletor, caminho, id, timestamp, contador.
- Regular = peso **450**; ênfase 650; display 700 com tracking negativo (−0.02em a −0.054em).

## Escala tipográfica

| estilo | px/linha | peso | tracking |
|---|---|---|---|
| display | 28/32 | 700 | −0.84px |
| título | 20/26 | 650 | −0.3px |
| corpo | 15/22 | 450 | 0 |
| ui | 13/20 | 450 | 0 |
| micro | 11/16 | 450 | +0.2px (mono, dado) |

## Estrutura

- Espaçamento ∈ {4, 8, 16, 24, 32, 48}; nada fora da escala.
- Raio: UM token **6px**; pill (999px) só em dot/chip realmente pílula.
- Borda 1px hairline; **2px só em focus ring** (`outline: 2px solid #C2FF3D; outline-offset: 2px`).
- Sem sombra decorativa; profundidade = camada (card sobre fundo) + hairline.
- Motion: ≤300ms ease-out, interrompível; hover/focus/active/disabled desenhados.
- Estados: hover = card→`#1A1A1A` ou hairline→neutro; active = translateY(1px);
  disabled = neutro 50% opac, sem pointer.

## Momento-assinatura

A lâmina ácida: no logo é o gume; na UI é o 1 contorno/seleção/CTA por tela.

## Logo

`src/assets/logo-canivete.svg` — "C" de Canivete com lâmina aberta (acento).
Legível a 16px (fichas em `.opencode/evidencia-design/`).
