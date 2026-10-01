# Echoes of Mind — U3: Direção de Arte e Identidade Visual

> **Unidade:** U3 — Direção de Arte e Identidade Visual
> **Rubric alvo:** R6 (identidade visual diegética consistente e implementável)
> **Público:** artistas 2D/3D, tech artists, UI engineers, sound designers
> **Engines de referência:** Unity (HDRP / URP) e Godot 4 (Forward+)
> **Idioma:** português-BR. Unidades: valores de produção, não adjetivos vagos.

---

## Índice

1. [Princípios de direção de arte](#1-princípios-de-direção-de-arte)
2. [PARTE A — UI/UX Diegética: tela de diagnóstico da IA](#2-parte-a--uiux-diegética-tela-de-diagnóstico-da-ia)
   - 2.1 [Paleta exata + regras de uso](#21-paleta-exata--regras-de-uso)
   - 2.2 [Tipografia](#22-tipografia)
   - 2.3 [Efeitos CRT: scanlines, flicker, vignette](#23-efeitos-crt-scanlines-flicker-vignette)
   - 2.4 [Estática intermitente por estresse](#24-estática-intermitente-trigger-por-estresse)
   - 2.5 [Feeds de câmera baixa-resolução (found footage)](#25-feeds-de-câmera-baixa-resolução-found-footage)
   - 2.6 [Wireframe textual (ASCII) da HUD](#26-wireframe-textual-ascii-da-hud)
   - 2.7 [Tabela de estados UI por estresse](#27-tabela-de-estados-ui-por-estresse)
3. [PARTE B — Cenários da estação](#3-parte-b--cenários-da-estação)
   - 3.1 [Ponte (Bridge)](#31-ponte-bridge)
   - 3.2 [Medbay (Enfermaria)](#32-medbay-enfermaria)
   - 3.3 [Reator (Reactor)](#33-reator-reactor)
   - 3.4 [Hidroponia (Hydroponics)](#34-hidroponia-hydroponics)
   - 3.5 [Eclusa (Airlock)](#35-eclusa-airlock)
   - 3.6 [Matriz comparativa dos 5 ambientes](#36-matriz-comparativa-dos-5-ambientes)
4. [Referências de implementação Unity vs Godot](#4-referências-de-implementação-unity-vs-godot)
5. [Proveniência e referências](#5-proveniência-e-referências)
6. [Checklist de aceitação R6](#6-checklist-de-aceitação-r6)

---

## 1. Princípios de direção de arte

1. **Tudo é diegético primeiro.** A interface é um objeto dentro do mundo:
   telas de diagnóstico da IA da estação, monitores CRT embutidos nas paredes,
   tablets do traje do astronauta. Nada de HUD flutuante "de jogo" sem âncora física.
2. **Lo-fi crível, hi-fi seletivo.** Bases em 320×240 / 10 fps / ruído para
   câmeras de segurança (estética found footage), com picos hi-fi apenas no
   feed principal da IA (1080p simulado com pós-processamento CRT).
3. **Estresse vaza pela imagem.** O estado psicológico do astronauta e o nível
   de corrupção da IA alteram glitch, saturação, jitter e estática. A UI é um
   medidor narrativo, não decoração.
4. **Valores antes de adjetivos.** Nenhuma instrução do tipo "metal bem gasto".
   Sempre: `roughness 0.7`, `metallic 0.85`, `poeira 150 partículas/m³`,
   `luz emergência #FF2222 ciclo 2 s`. Se não dá para colocar no editor, não entra no doc.
5. **Paleta contida, sinalização escassa.** Verde-fósforo = sistema nominal.
   Âmbar = atenção / degradação. Vermelho = emergência. Todo o resto é cinza.

---

## 2. PARTE A — UI/UX Diegética: tela de diagnóstico da IA

### Conceito

A "tela de diagnóstico da IA" é o hub visual do jogo: um terminal CRT curvo
embutido no peito do traje + painéis espelhados nas paredes da estação.
O jogador lê vitais do astronauta, conversa com a IA (terminal), monitora
energia e revê feeds de câmera. A IA corrompida injeta glitch nesse mesmo
canal — o horror acontece *dentro* da ferramenta de ajuda.

---

### 2.1 Paleta exata + regras de uso

| Token | Hex | RGB | Função narrativa | % de tela alvo | Quando usar |
|---|---|---|---|---|---|
| `phos-green` (verde-fósforo) | `#33FF66` | 51, 255, 102 | Sistema nominal, texto terminal, vetores do minimapa | 8–12 % | Texto principal, bordas ativas, cursor, barras OK |
| `amber-warn` (âmbar) | `#FFB000` | 255, 176, 0 | Degradação, aviso, energia < 40 % | 3–5 % | Alertas, valores em queda, destaques de log |
| `hull-dark` (cinza escuro) | `#1A1D21` | 26, 29, 33 | Fundo base, chassi dos painéis | 60–70 % | Background de todos os painéis, letterbox |
| `bone-grey` (cinza apoio 1) | `#8A9199` | 138, 145, 153 | Texto secundário, linhas inativas | 10–15 % | Labels, timestamps, divisórias, grid do minimapa |
| `blood-red` (vermelho apoio 2) | `#FF2222` | 255, 34, 34 | Emergência, falha crítica | 0–2 % (pico 8 % em pânico) | Luz pulsante 1.2 Hz, bordas de dano, `CRITICAL` |

**Regras de uso (contrato artista ↔ dev):**

- **R1 — Fundo sempre `hull-dark`.** Nunca preto puro (`#000000` estoura o bloom
  do CRT; nunca branco. O "preto CRT" é `#1A1D21` + vignette do shader.
- **R2 — Verde-fósforo `#33FF66` é o único verde permitido em UI.** Verdes de
  cenário (hidroponia) usam `#2E7D4F` dessaturado para não confundir com UI nominal.
- **R3 — Âmbar `#FFB000` = limiar, nunca decoração.** Só aparece quando uma métrica
  cruza threshold (energia, O₂, integridade, sanidade/estresse). Se tudo está OK,
  a tela tem 0 px de âmbar.
- **R4 — Vermelho `#FF2222` tem orçamento.** Fora de emergência: 0 %. Em emergência:
  teto de 8 % da tela (bordas + 1 linha de alerta). Piscar a `1.2 Hz` (ciclo ~0.83 s;
  em alguns rigs arredondar para ciclo de 2 s com duty 50 % — ver §3).
- **R5 — Cinza `bone-grey #8A9199` para tudo que é "morto".** Texto lido, câmera
  offline, seção colapsada. Contraste mínimo 4.5:1 contra `#1A1D21` (testar em CRT).
- **R6 — Texto nunca 100 % opaco branco.** Texto "branco" do terminal é
  `#33FF66` a 90 % + bloom 0.35. Texto secundário é `#8A9199` a 75 %.
- **R7 — Regra dos 70/15/10/5.** Em qualquer frame de UI: ~70 % `hull-dark`,
  ~15 % `bone-grey` (linhas/texto morto), ~10 % `phos-green`, ~5 % `amber-warn`
  + `blood-red` somados. Auditar com histograma em QA.

**Swatches para o editor (copiar/colar):**

```text
phos-green  #33FF66   // verde-fósforo — nominal
amber-warn  #FFB000   // âmbar — degradação
hull-dark   #1A1D21   // cinza escuro — fundo
bone-grey   #8A9199   // cinza apoio — texto morto
blood-red   #FF2222   // vermelho apoio — emergência
```

---

### 2.2 Tipografia

Duas famílias apenas. Terceira fonte = bug de direção de arte.

#### F1 — Terminal: mono condensada

- **Função:** todo texto digitado/lido no terminal da IA, logs, telemetria.
- **Escolhas aprovadas (nesta ordem):** `IBM Plex Mono Condensed` →
  `JetBrains Mono` (fallback com `font-stretch: condensed 75 %`) →
  `Noto Sans Mono Condensed`.
- **Tamanhos (escala em px a 1080p, escalar linearmente):**
  - Corpo terminal: **15 px**, `line-height 1.45` (21.75 px).
  - Cabeçalho de painel: **13 px**, `ALL CAPS`, `letter-spacing +0.18 em`.
  - Micro-label (timestamp, unidade): **11 px**, `letter-spacing +0.12 em`.
  - Linha de comando ativa: **17 px** (único tamanho maior — hierarquia de foco).
- **Tracking:** corpo `0`; cabeçalhos `+0.18 em`; micro `+0.12 em`.
- **Peso:** Regular 400 corpo; Medium 500 apenas no prompt (`>` / `█`).
- **Exemplo (render alvo):**

```text
> SYS.DIAG --canal 03 :: IA NÚCLEO [██████░░░░] 62%
  14:02:11  O2 94% · PWR 61% · HULL 88% ............ NOMINAL
  14:02:13  ⚠ DERIVA TÉRMICA SETOR C — contenção em 02:41 [âmbar #FFB000]
  14:02:14  > você ainda confia em mim? █
```

#### F2 — Alerta: grotesca geométrica

- **Função:** APENAS alertas, títulos de emergência, contadores grandes.
- **Escolhas aprovadas:** `Archivo Expanded / Black` → `Inter Tight Bold`
  (com `letter-spacing -0.02 em`) → fallback sistema `Arial Narrow Bold`.
- **Tamanhos:**
  - Banner emergência: **42 px**, `weight 800`, `ALL CAPS`.
  - Contador regressivo: **64 px**, `weight 800`, tabular-nums.
  - Sub-alerta: **20 px**, `weight 700`.
- **Tracking:** títulos `-0.02 em` (compacto, urgente); contador `0`.
- **Cor:** sempre `#FFB000` (aviso) ou `#FF2222` (crítico) sobre `#1A1D21`.
  Nunca verde-fósforo — grotesca verde quebra o código de leitura.
- **Exemplo (render alvo):**

```text
┌─────────────────────────────────────────────┐
│  ⚠ CONTENÇÃO FALHOU — SETOR C      [42px]   │
│  EVACUAR EM  01:37                 [64px]   │
│  rota: ECLUSA LESTE · traje selado [20px]   │
└─────────────────────────────────────────────┘
```

**Regras de composição:**

- T1. Mono condensada ocupa ≥ 85 % dos glifos em tela. Grotesca ≤ 15 %.
- T2. Nunca misturar as duas na mesma linha (exceção: timestamp mono 11 px +
  palavra de alerta grotesca 20 px no banner — separadas por linha).
- T3. Cursor bloco `█` pisca a **1.8 Hz** (período 0.55 s, duty 50 %).
  Em pânico, o cursor trava aceso (sem blink = "ela está olhando").
- T4. Texto do terminal tem **jitter horizontal ±0.5 px** nominal,
  **±3 px** em pânico (ver tabela §2.7).

---

### 2.3 Efeitos CRT: scanlines, flicker, vignette

Implementação como pós-processamento fullscreen (último passo do pipeline)
ou material de tela diegética (painel 3D). Parâmetros canônicos — usar os
mesmos números em Unity e Godot para paridade visual.

| Parâmetro | Valor nominal | Faixa pânico | Notas |
|---|---|---|---|
| `scanline frequency` | **480 linhas** (1 por 2.25 px a 1080p) | 480 (fixo) | Frequência fixa; o que muda é o contraste |
| `scanline contrast` | **0.18** (0 = off, 1 = preto total) | 0.18 → 0.42 | Subir com estresse |
| `scanline thickness` | **0.55** (fração do período) | fixo | |
| `flicker Hz` | **59.94 Hz sutil, amplitude 0.03** | amplitude → 0.12 + roll 0.5 Hz | Nunca flicker > 3 Hz em área > 25 % da tela (fotossensibilidade) |
| `vignette intensity` | **0.45** | 0.45 → 0.75 | Cantos comem o feed em pânico |
| `vignette smoothness` | **0.35** | fixo | |
| `aperture grille` (RGB vertical) | **0.06** | 0.06 → 0.12 | Máscara RGB sutil, período 3 px |
| `curvature` (barrel) | **0.08** | 0.08 → 0.14 | Telas de parede 0.08; traje 0.14 (mais curvo) |
| `bloom threshold` | **0.72** | 0.72 → 0.55 | Verde-fósforo floresce primeiro |
| `bloom intensity` | **0.35** | 0.35 → 0.80 | |
| `chromatic aberration` | **0.6 px** bordas | → 2.5 px | Só bordas (máscara radial) |

#### Implementação Unity (URP — Renderer Feature / fullscreen pass)

```hlsl
// EchoesCRT.hlsl — passe fullscreen URP (fragmento, HLSL)
// _MainTex: frame; _Time.y: tempo; _Stress: 0..1 (global)
float scanline(float2 uv) {
    float freq = 480.0;                       // line frequency
    float thick = 0.55;
    float s = sin(uv.y * freq * 6.28318);
    float contrast = lerp(0.18, 0.42, _Stress);
    return 1.0 - contrast * smoothstep(1.0 - thick, 1.0, s);
}
float flicker() {
    float amp = lerp(0.03, 0.12, _Stress);
    return 1.0 + amp * sin(_Time.y * 59.94 * 6.28318)
               + 0.04 * _Stress * sin(_Time.y * 0.5 * 6.28318); // roll
}
float2 barrel(float2 uv, float k) {
    float2 cc = uv - 0.5;
    return uv + cc * dot(cc, cc) * k;          // k = lerp(0.08,0.14,_Stress)
}
```

- Via: `ScriptableRendererFeature` + `RenderPassEvent.AfterRenderingPostProcessing`.
  Expor `_Stress` como `Global Float` (0 calmo → 1 pânico) dirigido pelo
  `StressDirector` (mesma variável que pilota áudio e glitch — fonte única).
- Alternativa HDRP: `Custom Post Process` (`CustomPostProcessVolumeComponent`)
  com os mesmos uniforms; aproveitar `Bloom` nativo (threshold 0.72).

#### Implementação Godot 4 (Forward+ — `canvas_item` / fullscreen `ColorRect`)

```glsl
// echoes_crt.gdshader — shader_type canvas_item;
shader_type canvas_item;
uniform float stress : hint_range(0.0, 1.0) = 0.0;
uniform float line_freq = 480.0;
uniform float flicker_hz = 59.94;
void fragment() {
    vec2 uv = UV;
    vec2 cc = uv - 0.5;
    float k = mix(0.08, 0.14, stress);        // curvature barrel
    uv = uv + cc * dot(cc, cc) * k;
    vec4 c = texture(TEXTURE, uv);
    float s = sin(uv.y * line_freq * 6.28318);
    float contrast = mix(0.18, 0.42, stress);
    c.rgb *= 1.0 - contrast * smoothstep(0.45, 1.0, s);   // scanlines CRT
    float amp = mix(0.03, 0.12, stress);
    c.rgb *= 1.0 + amp * sin(TIME * flicker_hz * 6.28318);// flicker
    float d = length(cc) * 1.4142;                        // vignette
    c.rgb *= 1.0 - mix(0.45, 0.75, stress) * smoothstep(0.65, 1.0, d);
    COLOR = c;
}
```

- Aplicar num `ColorRect` fullscreen com esse `ShaderMaterial`, camada `CanvasLayer 10`.
- Paridade: mesmos números (480 linhas, 59.94 Hz, vignette 0.45→0.75).

---

### 2.4 Estática intermitente (trigger por estresse)

A estática é o "respirar" da IA corrompida: rajadas de ruído branco + tearing
que interrompem o feed. Nunca aleatória pura — sempre dirigida por estresse.

| Parâmetro | Calmo (`stress < 0.35`) | Tenso (`0.35–0.7`) | Pânico (`> 0.7`) |
|---|---|---|---|
| Probabilidade de rajada / 10 s | 0 % | 25 % | 70 % |
| Duração da rajada | — | 0.15–0.4 s | 0.4–1.2 s |
| Cobertura do frame (ruído) | — | 10–30 % em blocos | 40–90 % fullscreen |
| Tearing horizontal (linhas deslocadas) | 0 | 2–4 linhas, offset ≤ 40 px | 6–14 linhas, offset ≤ 160 px |
| Corte de áudio junto | — | duck −6 dB 0.2 s | mute 0.3 s + burst |

**Trigger (especificação para dev):**

```text
se stress cruzar 0.35 ↑  → agenda 1 rajada em 1–3 s
se stress cruzar 0.70 ↑  → rajada imediata + agenda rajadas a cada 4–8 s
se evento "IA mente revelada" → rajada longa 1.2 s (roteirizada, ignora RNG)
seed RNG por frame: hash(frame_id) — determinístico p/ replay/QA
```

- Implementação: sprite de ruído (tile 256×256, 8 frames) em `Additive`,
  opacidade = cobertura; tearing = deslocar fatias UV por linha com offset do hash.
- Acessibilidade: rajadas nunca excedem 1.2 s; frequência máxima 1 rajada / 3 s;
  opção "reduzir estática" trava cobertura em ≤ 30 % e desliga tearing.

---

### 2.5 Feeds de câmera baixa-resolução (found footage)

As câmeras de segurança da estação são o vocabulário found footage do jogo:
imagem pobre, lenta, ruidosa — o jogador assiste ao próprio passado e vê
coisas que não lembra de ter feito.

**Especificação canônica do feed de segurança:**

```text
resolução:     320×240 (upscale nearest-neighbor p/ painel, sem filtro)
framerate:     10 fps (amostrar e segurar — sem interpolação)
profundidade:  6-bit por canal + dithering ordenado 4×4 (banding visível)
ruído:         gaussiano σ=0.08 + dropouts verticais aleatórios (1–3 linhas/frame)
timestamp:     mono 11 px #8A9199, canto inferior, formato DD:HH:MM:SS:FF
overlay:       "CAM 04 — REATOR [REC ●]" mono 13 px #33FF66 (● pisca 1 Hz)
compressão:    blocos 16×16 com posterização (simular MJPEG barato)
áudio:         nenhum (câmeras são mudas — silêncio + hum 50 Hz no monitor)
```

**Pipeline (Unity e Godot, mesma receita):**

1. Renderizar câmera secundária num `RenderTarget 320×240` a 10 Hz
   (acumular tempo; só re-renderizar quando `t += 0.1 s`).
2. Pós: posterizar (`floor(c*63)/63`), somar ruído, 5 % de chance de dropout.
3. Upscale `Point / Nearest` para o painel 3D (preserva pixel duro).
4. Sobrepor scanlines CRT (§2.3) com `contrast 0.25` fixo + timestamp.

**Regras narrativas:**

- F1. Feed principal da IA = limpo (1080p + CRT leve). Câmeras = sujas.
  O contraste vende a ideia de "duas IAs" (a que fala × a que vigia).
- F2. Em pânico, 1–2 câmeras "morrem" (tela `#1A1D21` + `SEM SINAL` âmbar
  20 px grotesca) — nunca todas; o jogador precisa continuar vendo.
- F3. Pelo menos 1 susto por ato acontece SÓ no feed baixa-resolução
  (found footage puro: o monstro passa ao fundo a 10 fps).

---

### 2.6 Wireframe textual (ASCII) da HUD

Layout 16:9 de referência, 80 colunas. Painéis nomeados para o backlog
(`HUD-FEED`, `HUD-TERM`, `HUD-VIT`, `HUD-MAP`, `HUD-LOG`).

```text
+==============================================================================+
| ECHOES.OS v2.7 // DIAGNÓSTICO IA        O2 94%  PWR 61%  [NOMINAL #33FF66] 14:02|
+================================+=============================================+
|                                |  > SYS.DIAG --canal 03                     |
|   HUD-FEED (principal)         |  IA NÚCLEO [██████░░░░] 62%               |
|   feed IA 960×540 + CRT        |                                             |
|                                |  14:02:11 O2 94% · PWR 61% .... NOMINAL   |
|   +------------------------+   |  14:02:13 DERIVA TÉRMICA SETOR C [âmbar]  |
|   | CAM 04 320×240 10fps   |   |                                             |
|   | [ substantivo visual:  |   |  HUD-TERM (terminal)                      |
|   |  ruído + timestamp ]   |   |  > você ainda confia em mim? █            |
|   +------------------------+   |                                             |
+================================+=============================================+
| HUD-VIT          | HUD-MAP                 | HUD-LOG                          |
| FC 112 bpm [âmb] |  minimapa energia       | 14:01:58 porta C-7 aberta        |
| O2 94%  [grn]    |  ·····[##····] 61%      | 14:02:01 pico rad. 0.4 mSv       |
| ESTRESSE ▓▓▓░░   |  Ponte ●── Medbay ○     | 14:02:13 deriva térmica [âmbar]  |
| TRAJE 88% [grn]  |  Reator ▲ HIDRO ○       | 14:02:14 ??? sinal desconhecido  |
+------------------+-------------------------+------------------------------- ...--+
| [TAB] câmeras · [Q] log · [E] interagir · [F] lanterna        ... STRESS 0.42 |
+==============================================================================+
```

**Especificação por painel:**

| ID | Nome | Tamanho (% tela) | Conteúdo | Fonte |
|---|---|---|---|---|
| `HUD-FEED` | Feed principal | 42 % (esq-sup) | Câmera IA + PiP CAM 04 320×240 | mono 11 px overlay |
| `HUD-TERM` | Terminal | 42 % (dir-sup) | Scroll 8 linhas + input | mono 15/17 px |
| `HUD-VIT` | Vitais astronauta | 15 % (esq-inf) | FC, O₂, estresse, traje | mono 13 px + barras |
| `HUD-MAP` | Minimapa energia | 25 % (cen-inf) | Grafo setores + % energia | mono 11 px |
| `HUD-LOG` | Log eventos | 18 % (dir-inf) | Últimos 4 eventos | mono 11 px `#8A9199` |

- Z-order: banner de emergência (`F2` grotesca) cobre tudo (modal).
- Safe-area: 3 % de margem interna em todos os painéis (CRT curvature come borda).
- Modo traje (capacete): mesmo layout a 85 % de escala + reflexo visor
  (`roughness 0.15`, overlay gradiente 10 %).

---

### 2.7 Tabela de estados UI por estresse

`stress` 0.0 (calmo) → 1.0 (pânico). Variável única `StressDirector.stress`
pilota UI + áudio + luz. Interpolação linear salvo nota.

| Canal | Calmo (0.0–0.35) | Tenso (0.35–0.7) | Pânico (0.7–1.0) |
|---|---|---|---|
| `glitch %` (pixels deslocados) | 0 % | 0.5–2 % em rajadas | 3–8 % contínuo + rajadas 15 % |
| `saturação` (multiplicador) | 1.00 | 0.92 | 0.75 (drena cor, sobra fósforo) |
| `jitter` texto (px) | ±0.5 | ±1.5 | ±3.0 + 1 linha tremida/2 s |
| `scanline contrast` | 0.18 | 0.28 | 0.42 |
| `flicker amplitude` | 0.03 | 0.07 | 0.12 |
| `vignette` | 0.45 | 0.60 | 0.75 |
| `chromatic aberration` | 0.6 px | 1.2 px | 2.5 px |
| `cursor blink` | 1.8 Hz | 0.9 Hz (lento = errado) | travado aceso |
| `estática` | nunca | rajada 0.15–0.4 s / 10 s | rajada 0.4–1.2 s / 4–8 s |
| `timestamp CAM` | `#8A9199` estável | +1 frame drop/5 s | congela 0.5 s + salta |
| `cor dominante` | `#33FF66` | `#33FF66` + `#FFB000` 5 % | `#FFB000` + `#FF2222` até 8 % |
| `áudio UI` (bips) | seno 880 Hz −18 dB | +eco 120 ms | bitcrush 8-bit + dropouts |

**Curvas (para dev):** `glitch = smoothstep(0.35, 1.0, stress) × 8 %`;
`saturação = 1 − 0.25 × smoothstep(0.3, 1.0, stress)`;
`jitter = 0.5 + 2.5 × stress²` px. Clampar tudo; expor para debug (`ui.stress 0.8`).

---

## 3. PARTE B — Cenários da estação

### Convenções de leitura (valem para os 5 ambientes)

- `roughness / metallic`: PBR 0–1, medidos no material base (antes de sujeira/decal).
- `lux`: iluminância aproximada no plano de jogo (1.6 m do piso).
- Emergência: vermelho `#FF2222`, pulsante **1.2 Hz** (período 0.83 s, duty 50 %,
  onda quadrada suavizada 0.1 s) — ou ciclo de **2 s** onde indicado (variante lenta).
- `poeira`: partículas em suspensão em gravidade-zero, densidade em **partículas/m³**,
  tamanho 0.5–3 mm, `additive` 5–12 % opacidade.
- Lanterna: `spot 3200 K, 600 lm, ângulo 35°, falloff 2` — a poeira dentro do cone
  ganha +3× brilho (forward scattering simulado via shader ou `volumetric fog`).
- Sujeira: `decals` (óleo, ferrugem, sangue seco) + `roughness +0.15` localizada.

---

### 3.1 Ponte (Bridge)

**Fantasia:** o cérebro morto da estação — consoles apagados, uma cadeira virada,
a Terra visível e indiferente pela vigia. Silêncio quebrado só pelo hum.

```text
materiais:
  piso ............ metal escovado desgastado, roughness 0.7, metallic 0.6
                    + trilhos de cadeira (decal desgaste, roughness local 0.9)
  consoles ........ carcaça polímero fosco #23262B, roughness 0.85, metallic 0.0
                    + telas CRT curvas (shader §2.3, 60 % apagadas)
  vigia ........... vidro triplo, roughness 0.05, trinca radial decal (1 de 3 vidros)
  teto ............ painéis acústicos, roughness 0.95, 30 % painéis faltando (vãos c/ fios)
iluminação:
  geral ........... 80 lux, fria #BFD4E6 (terra refletida), direcional pela vigia
  consoles ........ 40 lux local, verde-fósforo #33FF66 residual (telas ligadas)
  emergência ...... #FF2222, 1.2 Hz, 2 projetores × 15 lux (só em alerta)
detalhes:
  fios expostos ... 12 feixes no teto (vão central), balanço senoidal 0.3 Hz ±5 cm
  poeira .......... 80 partículas/m³, deriva lenta 0.05 m/s (ar parado)
  papel/flutuantes  6 pranchetas + 20 folhas soltas, gravidade-zero, rotação 2°/s
  cadeira ......... 1 virada (marco visual), roughness assento 0.9 (tecido gasto)
áudio visual:
  poeira na lanterna: cone 35° revela +3× brilho, cintilação 2 Hz (partículas cruzando)
  telas apagadas refletem a lanterna (specular streak, roughness 0.2 no vidro CRT)
```

**Notas de implementação:** vigia = `emissive` Terra (textura 1K) + `bloom 0.5`;
consoles apagados = `emissive 0` + decal poeira (`roughness +0.2`).

---

### 3.2 Medbay (Enfermaria)

**Fantasia:** branco que falhou — azulejo manchado, incubadora vazia aberta,
luz cirúrgica que ainda funciona bem demais para o que ilumina.

```text
materiais:
  paredes ........ azulejo cerâmico 15×15 cm, roughness 0.35, metallic 0.0
                   + manchas (decal sangue seco #5A1515, roughness 0.9, 8 manchas)
  piso ............ vinil antiderrapante cinza #6E747B, roughness 0.8
  macas ........... aço inox escovado, roughness 0.4, metallic 0.9
                    + lençol (tecido, roughness 1.0, 1 mancha grande)
  incubadora ...... vidro roughness 0.1 + aro metal roughness 0.5, TAMPA ABERTA 70°
iluminação:
  geral ........... 220 lux, neutra #E8ECF0 (luz cirúrgica fria — mais claro da estação)
  cirúrgica ....... 800 lux cone sobre maca central, #FFFFFF 5600 K, flicker 0.5 % 50 Hz
  emergência ...... #FF2222, 1.2 Hz, faixa LED perímetro, 25 lux
detalhes:
  fios expostos ... 4 cabos de monitor caídos da parede (loop no chão, sway 0.2 Hz)
  vazamento ....... soro fisiológico pingando: 1 gota / 2 s, poça decal (roughness 0.05)
  poeira .......... 60 partículas/m³ (ambiente filtrado — MENOR densidade, ar "limpo")
  papéis .......... prontuários flutuando (3 pranchetas), 1 com carimbo [âmbar #FFB000]
áudio visual:
  lanterna no azulejo: hotspot duro (specular, roughness 0.35) — contrasta c/ sangue fosco
  gota caindo cruza o cone: flash +1 frame (vender com som + decal ripple na poça)
```

**Notas de implementação:** luz cirúrgica = 1 `spot` sombras ON + volumetrics;
sangue seco sempre `roughness ≥ 0.85` (sangue fresco seria 0.15 — não usar aqui).

---

### 3.3 Reator (Reactor)

**Fantasia:** o coração quente — Cherenkov azul contido por vidro grosso,
calor que distorce o ar, o único lugar onde a estação parece viva.

```text
materiais:
  núcleo .......... vidro contenção roughness 0.08 + emissive Cherenkov #2A7FFF 3.0
  tubulação ....... metal escovado desgastado, roughness 0.7, metallic 0.85
                    + manchas térmicas (gradiente azul→palha, decal, 6 trechos)
  piso grade ...... grating metálico, roughness 0.6, metallic 0.7 (ver através 40 %)
  paredes ......... concreto blindado, roughness 0.9, sinalização âmbar #FFB000 faixas
iluminação:
  geral ........... 120 lux, mista: Cherenkov #2A7FFF (núcleo) + sódio #FFB000 corredores
  núcleo .......... emissive pulsante lento 0.4 Hz ±10 % (respiração — NÃO é emergência)
  emergência ...... #FF2222, ciclo 2 s (variante lenta: 1 s ON / 1 s OFF), 40 lux
detalhes:
  fios expostos ... 20 eletrocalhas abertas, cabos grossos (Ø 3–5 cm), sem balanço (rígidos)
  vazamento ....... refrigerante: vapor branco em 2 juntas (partículas 30/s, sobe 0.3 m/s)
  poeira .......... 150 partículas/m³ (MAIOR densidade — fuligem + íons), carga estática
  calor ........... heat-haze acima do núcleo (distortion shader, amplitude 2 px, 3 Hz)
áudio visual:
  poeira ionizada desvia da lanterna (repelida 5 cm do eixo do cone — "vento" do núcleo)
  Cherenkov tinge a poeira de azul (tint #2A7FFF 20 % nas partículas próximas ao vidro)
```

**Notas de implementação:** núcleo = `emissive` + `point light` azul (sem sombra,
barato) + `volumetric fog` denso local; heat-haze = fullscreen distortion mask.

---

### 3.4 Hidroponia (Hydroponics)

**Fantasia:** o único verde vivo — estufas úmidas, lâmpadas de cultivo rosa,
água parada com algo flutuando que não deveria estar lá.

```text
materiais:
  bancadas ........ alumínio anodizado, roughness 0.5, metallic 0.8
  bandejas ........ plástico cultivo #2E3B2F, roughness 0.9 (musgo/álcool nas bordas)
  plantas ......... folhagem verde dessaturado #2E7D4F (PROIBIDO #33FF66 aqui — ver R2)
                    + 30 % folhas necrosadas #6B5B2E, translucency 0.4
  piso ............ grade + lodo (decal verde-escuro, roughness 1.0, escorregadio visual)
  vidro estufa .... roughness 0.15 + condensação (droplets decal, 200 gotas/m²)
iluminação:
  geral ........... 150 lux, cultivo magenta #FF4FD8 + #7A28FF 50/50 (grow-lights)
  ciclo ........... grow-lights em ciclo 12 s (amanhecer artificial — 2 s fade)
  emergência ...... #FF2222, 1.2 Hz, 1 projetor × 20 lux (sangra rosa→vermelho)
detalhes:
  fios expostos ... 8 cabos de irrigação + gotejadores pingando (2 gotas/s, 3 pontos)
  vazamento ....... água nutriente: poça 1.5 m² (roughness 0.05, reflexo grow-light)
  poeira .......... 200 partículas/m³ (MAIOR — pólen + esporos, flutuam 0.02 m/s)
                    + 2 nuvens densas (500/m³ local, Ø 1 m, deriva senoidal)
  umidade ......... névoa baixa 0.3 m (fog local, densidade 0.06, rosa pálido)
áudio visual:
  lanterna corta a névoa (cone visível — god-rays baratos via fog volumétrico)
  pólen no cone: +3× brilho + drift lateral (corrente do ventilador, 0.1 m/s, 0.5 Hz)
```

**Notas de implementação:** grow-lights = 2 `spots` coloridos cruzados (sombras OFF,
perf) + `fog` rosa; condensação = `roughness map` manchado no vidro.

---

### 3.5 Eclusa (Airlock)

**Fantasia:** a porta entre dentro e fora — metal riscado por trajes, uma vigia
redonda para o nada, ciclo de pressurização que soa como sentença.

```text
materiais:
  paredes ........ metal escovado desgastado, roughness 0.7, metallic 0.8
                   + riscos verticais (decal mochilas traje, 40 riscos, roughness 0.95)
  portas .......... blindada dupla, roughness 0.45, metallic 0.9
                    + vedação borracha #0C0D0E, roughness 1.0 (luz de selo #33FF66 / #FFB000)
  piso ............ chapa antiderrapante, roughness 0.75 + canaletas drenagem
  vigia ........... olho-de-boi Ø 30 cm, vidro roughness 0.05, aro 8 parafusos
iluminação:
  geral ........... 60 lux, âmbar #FFB000 funcional (MENOR lux — claustrofobia)
  ciclo ........... pressurização: âmbar 60 lux → verde #33FF66 100 lux (3 s fade)
  emergência ...... #FF2222, 1.2 Hz, strobe teto 50 lux + giro (único ambiente c/ strobe)
detalhes:
  fios expostos ... NENHUM visível (eclusa é selada — cabos embutidos; vender opressão limpa)
  vazamento ....... ar: jato sibilante em 1 vedação (partículas finas 50/s, cone 10°)
  poeira .......... 30 partículas/m³ (MENOR — ar filtrado do ciclo; quase limpa)
  marcas .......... handprints decal no vidro (2 pares, lado de dentro, roughness 0.6)
áudio visual:
  lanterna na vigia: flare circular (ghost, 3 % intensidade) — o nada reflete de volta
  ciclo de ar move a poeira: 30 → 5/m³ em 3 s (vende pressurização sem UI)
```

**Notas de implementação:** ciclo de luz = timeline 3 s (`amber→green`);
strobe emergência com limite acessível (≤ 3 flashes/s, duty 30 %).

---

### 3.6 Matriz comparativa dos 5 ambientes

| Ambiente | lux geral | Cor dominante | roughness base | poeira (part./m³) | Emergência | Marca visual única |
|---|---|---|---|---|---|---|
| Ponte | 80 | `#BFD4E6` fria | 0.7 | 80 | `#FF2222` 1.2 Hz | vigia Terra + cadeira virada |
| Medbay | 220 | `#E8ECF0` neutra | 0.35–0.85 | 60 | `#FF2222` 1.2 Hz | luz cirúrgica 800 lux |
| Reator | 120 | `#2A7FFF` + `#FFB000` | 0.7 | 150 | `#FF2222` ciclo 2 s | Cherenkov + heat-haze |
| Hidroponia | 150 | `#FF4FD8`/`#7A28FF` | 0.5–0.9 | 200 | `#FF2222` 1.2 Hz | névoa rosa + pólen |
| Eclusa | 60 | `#FFB000` âmbar | 0.7 | 30 | `#FF2222` strobe | ciclo pressurização 3 s |

---

## 4. Referências de implementação Unity vs Godot

### 4.1 Pipeline recomendado

| Aspecto | Unity HDRP | Unity URP (alvo perf) | Godot 4 Forward+ |
|---|---|---|---|
| Pós CRT | `CustomPostProcess` + Bloom nativo | `RendererFeature` fullscreen (§2.3) | `ColorRect` + `echoes_crt.gdshader` |
| Partículas poeira | VFX Graph (GPU, 200/m³ ok) | Shuriken + billboard shader | `GPUParticles3D` (amount = densidade × volume) |
| Decals sujeira | Decal Projector | Decal (URP 12+) / mesh decal | `Decal` node (Forward+ suporta) |
| Volumetric fog | `Fog Volume` denso local | Fog global barato + fake cone mesh | `VolumetricFog` + `FogVolume` (hidroponia/reator) |
| Luz emergência | `Light` + timeline 1.2 Hz | idem (2 lights, sombras OFF) | `OmniLight3D` + AnimationPlayer |
| Feed 320×240 | `RenderTexture 320×240` @10 Hz + Point | idem | `SubViewport 320×240` + update 10 Hz |

### 4.2 Poeira que reage à lanterna (receita única, dois motores)

1. Poeira = billboard `additive`, opacidade base 0.08, tamanho 1–3 px.
2. No shader da partícula: `d = distância ao eixo do cone da lanterna`
   (passar posição/direção da lanterna como uniform global por frame).
3. `brilho *= 1 + 3 × smoothstep(raio_cone, 0, d)` — forward scattering fake.
4. Reator: adicionar repulsão (`pos += normal × 0.05` fora do eixo).
   Hidroponia: adicionar drift (`pos.x += sin(t×0.5 Hz) × 0.1`).
5. Orçamento: teto de **400 partículas visíveis** por ambiente
   (densidade/m³ × volume frustum, com clamp). Godot: `amount 400`;
   Unity VFX: `capacity 400`.

### 4.3 Found footage barato (sem segunda câmera cara)

- Godot: 1 `SubViewport` 320×240 compartilhado, revezando entre CAMs
  (só a CAM do PiP renderiza; as demais = frame congelado + timestamp andando).
- Unity: 1 `RenderTexture` reaproveitada + `Camera.Render()` sob demanda a 10 Hz.
- Posterização + ruído no shader do painel (não na câmera) — custo 1 draw.

---

## 5. Proveniência e referências

1. **Alien: Isolation — terminais lo-fi.** Os terminais Seegson de tela verde
   fosca e digitação lenta são a referência direta do nosso `HUD-TERM`:
   texto que demora = sistema que pensa. Discussões de UI catalogadas no
   GameUIDatabase (entrada "Alien: Isolation — Seegson terminals") e em
   threads de análise de UI no Reddit (r/gameUI, tópicos sobre diegetic
   terminals em Isolation) — ambos destacam fósforo verde sobre fundo quase
   preto e uso de CRT curvature como âncora diegética.
2. **Observation (No Code, 2019) — SAM OS / UI da IA.** A interface da IA
   SAM operando câmeras da estação é o modelo do nosso `HUD-FEED` + feeds
   baixa-resolução: múltiplas CAMs com overlays heterogêneos, manipulação
   direta de sistemas pelo "olho" da IA, e a virada em que a ferramenta de
   ajuda se torna o vetor do horror. Referência de layout: feed principal +
   barra de sistemas + memória de câmera.
3. **Taxonomia de diegese em UI (GameDeveloper, 2018).** Artigo "Diegetic UI
   taxonomy" (GameDeveloper.com, 2018) — classificação em
   diegético / espacial / meta / não-diegético. Nosso contrato: tudo que o
   jogador lê rotineiramente (`HUD-TERM`, `HUD-VIT`, `HUD-MAP`) é **diegético**
   (existe no mundo, o astronauta também vê); banner de emergência e prompts
   de tecla são **espaciais/meta** admitidos (exceções listadas, não regra).
4. **CRT e found footage.** Parâmetros de scanline/flicker calibrados contra
   capturas de PVM/BVM (manuais Sony, 480 linhas visíveis) e contra a
   gramática found footage (resolução degradada + timestamp + REC como
   marcadores de "verdade" — o susto mora no grão, não no polígono).

---

## 6. Checklist de aceitação R6

- [ ] Paleta com os 5 hex exatos (`#33FF66`, `#FFB000`, `#1A1D21`, `#8A9199`,
      `#FF2222`) + regra dos 70/15/10/5 auditável por histograma.
- [ ] 2 famílias tipográficas nomeadas, com tamanhos/tracking/exemplos;
      nenhuma terceira fonte em mock ou build.
- [ ] Shader CRT com os 9 parâmetros (§2.3) implementado em Unity **e** Godot
      com os mesmos números (line frequency 480, flicker 59.94 Hz, vignette).
- [ ] Estática dirigida por `stress` (tabela §2.4) + modo acessível.
- [ ] Feeds 320×240 @ 10 fps com ruído + timestamp (found footage) em ≥ 3 CAMs.
- [ ] Wireframe ASCII com os 5 painéis (`HUD-FEED/TERM/VIT/MAP/LOG`).
- [ ] Tabela estresse × glitch/saturação/jitter (§2.7) ligada ao `StressDirector`.
- [ ] 5 ambientes com roughness, lux, cor, Hz de emergência, poeira/m³ e
      comportamento na lanterna — Ponte, Medbay, Reator, Hidroponia, Eclusa.
- [ ] Vocabulário de produção em todos os ambientes (nenhum adjetivo sem número).
- [ ] Tabela Unity HDRP × URP × Godot Forward+ preenchida (partículas, decals, fog).

*Fim de U3 — Direção de Arte e Identidade Visual. Próxima unidade consome este
documento como contrato: nenhum asset entra no jogo sem citar sua linha aqui.*
