# Ficha 15 — Fase 5: varredura e correção de paleta (Ácido-Noir)

Data: 2026-10-29 · alvos: `extension/content.js`, `extension/popup.html`, `src/assets/painel.html`

## Varredura (grep de hex, antes → depois)

| hex fora da SPEC | onde | corrigido para |
|---|---|---|
| `#7c3aed`/`#a855f7` (roxo) | cursor ubPulseLoop + SVG fill (content.js) | `#c2ff3d` (glow+lâmina), stroke `#0b0b0b` |
| `#f97316` + `rgba(249,115,22,.35)` (laranja) | highlight temporário (content.js) | `#c2ff3d` + `rgba(194,255,61,.35)` |
| `#b3ec2f` | hover do CTA acento (popup `#mark`, picker `button.primary`) | `filter:brightness(.92)` — sem novo hex |
| `#333333` (`--hairline-strong`) | painel (borda do drawer mobile) | token removido; usa `--hairline` |
| `#14161a` | fundo `.rr-player` (painel) | `#141414` (card) |
| `#f2f3f0`/`#262a31`/`#f97316` | comentário obsoleto de estilo (content.js) | atualizado p/ `#faf9f5`/`#262626`/`#c2ff3d` + referência docs/DESIGN.md |

`#1a1a1a` mantido: hover do card previsto na SPEC (DESIGN.md §Estados).

## Depois da correção

- Varredura final: só os 9 tokens medidos + `#1a1a1a` (SPEC). Nada fora da paleta.
- `node --check extension/content.js` → ok. `reload-extension` → 1.9.2 reconectada.
- Smoke: `SMOKE: 30 pass, 0 fail` (`smoke-last.json` 13:25Z).
- E2E pós-paleta (aba 667025707, perfil Asafe): elem_pick → clique trusted →
  `sel:1`, caixa `novo pack · 1 elemento(s)` → fill grupo+nota + Enter → report
  `ermvtl5oi5vlgl` persiste → apagado. Cancel/off: `{note:false, outlines:0}`.
- Nota de método: clique trusted só dispara em aba visível (ativar antes); evento
  dispatch sintético é bloqueado por `isTrusted` (fix da Fase 3, intacto).

captura 10:37 > última edição 10:24 ✓
