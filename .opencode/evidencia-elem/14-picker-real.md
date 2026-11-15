# Ficha 14 — teste real do picker (Chrome do dono, aba 667025619)

Data: 2026-10-29 · página-alvo: http://127.0.0.1:8932/pick-test.html
Extensão 1.9.2 reconectada após `reload-extension` + reload da aba.

**Observação sobre as capturas:** o `n_ubrowser_shot` devolve a imagem INLINE
na sessão (base64) e NÃO persiste arquivo em disco. As screenshots do gesto
real (seleção, badges, caixa grupo+prompt, hover com tag de camada) estão na
sessão desta data; em disco ficam apenas as previews estáticas 10–12 e esta
ficha textual, que registra cada resultado medido.

## Matriz de gestos (todas verdes, medida via attr/evaluate na aba real)

| gesto | resultado medido |
|---|---|
| hover sob modal (botão `pointer-events:none`) | tag `camada 1/3 · Tab` |
| Tab → | `camada 2/5 · Tab` (entra na pilha deep) |
| Tab → | `camada 3/5 · Tab` |
| Shift+Tab → | `camada 2/5 · Tab` |
| clique em `Comprar` (trusted) | caixa `novo pack · 1 elemento(s)` |
| fill grupo+nota + Enter | report persiste; caixa some |
| `n_elemreports_list` | report `ermvtjkuqc5zu9` · grupo `smoke-uiux` · `text=Comprar [tag=button] rect 84×34 @ 83,164` |
| ✕ por seleção | hd `2→1 elemento(s)`, badge some (unmarks 2→1) |
| Cancelar | `{note:false, unmark:0, outlines:0}` — tudo limpo |

## Achado e correção (bug do stack stale)

- **Antes do fix**: clique direto em `Comprar` (sem mousemove prévio) gravou
  `text=escondido` (elemento do ponto do hover anterior, depth stale) —
  ficha `ermvtjgaij5w4a` é o antes.
- **Fix** (`extension/content.js`, onClick): exige `ev.isTrusted` e recalcula
  `ubElemStackAt` quando o ponto do clique difere >8px do ponto do hover.
- **Depois**: report novo aponta `text=Comprar @83,164` (elemento exato
  clicado) — ficha `ermvtjkuqc5zu9` é o depois. `node --check` ok.

## Badges acoplados (medido)

Seleções `BUTTON:Comprar@41,147` e `BUTTON:Salvar@41,275` →
✕ em `118,139` (r.right−8) e `102,267` — canto superior direito de cada
outline, conforme SPEC.

captura 10:03 > última edição content.js 07:50 ✓ · revalidado pós-paleta 10:35 (ficha 15)
