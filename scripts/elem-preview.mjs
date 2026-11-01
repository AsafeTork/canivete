// Preview estático do overlay de marcação (elem reports) p/ verificação visual.
// Extrai o CSS REAL de extension/content.js (fonte única) e monta duas cenas:
// 1) novo pack — hover do picker + caixa de anotação `.note` ACOPLADA ao contorno, campo único;
// 2) pack editável — `.editor` acoplado (nota, lista de elementos ±, Salvar/+elemento/Apagar).
// Gera desktop (1280) + 375 (iframe) p/ as fichas em .opencode/evidencia-elem/.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const m = src.match(/st\.textContent = \[([\s\S]*?)\]\.join\(""\);/);
if (!m) { console.error("CSS do overlay não encontrado em content.js"); process.exit(1); }
const cssLines = m[1].split("\n").map((l) => l.trim()).filter((l) => l.startsWith('"')).map((l) => JSON.parse(l.replace(/,$/, "")));
const css = cssLines.join("\n");

const shell = (body, extra = "") => `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>preview elem overlay</title>
<style>
  body{margin:0;font:450 15px/22px system-ui,sans-serif;background:#faf9f5;color:#141413}
  header{padding:24px;border-bottom:1px solid #e8e6dc;font-weight:650}
  main{padding:24px;max-width:640px}
  .card{border:1px solid #e8e6dc;border-radius:6px;padding:16px;margin-bottom:16px;background:#fff}
  button.buy{background:#141413;color:#faf9f5;border:0;border-radius:6px;padding:12px 24px;font:550 15px system-ui;cursor:pointer}
</style>
</head><body>
<header>Loja de exemplo — preview do overlay</header>
<main>${body}</main>
<style>${css}</style>
<div id="ubrowser-elem"></div>
<script>
(function(){
  const root = document.getElementById("ubrowser-elem");
  ${extra}
})();
</script></body></html>`;

const pageCards = `
  <div class="card"><h2>Tênis Runner Pro</h2><p>O mais rápido da casa. Entrega em 2 dias úteis.</p>
  <button class="buy">Comprar agora</button></div>
  <div class="card"><h2>Resumo do pedido</h2><p>Frete: R$ 24,90 · Prazo: 2 dias úteis</p>
  <button class="buy">Pagar</button></div>`;

// cena 1 — novo pack: 2 selecionados (contorno ácido + ✕ no canto), hover sobre o 2º card,
// .note acoplada com grupo (escopo) + prompt + Cancelar
const sceneNew = `
  const btns = document.querySelectorAll("button.buy");
  btns.forEach((b,i)=>b.setAttribute("data-ub-elem", String(i+1)));
  const r1 = btns[0].getBoundingClientRect();
  const chip=(n,nota,x,y)=>{const c=document.createElement("div");c.className="chip";const b=document.createElement("b");b.textContent=String(n);c.appendChild(b);const s=document.createElement("span");s.textContent=nota;c.appendChild(s);c.title="editar pack — nota, elementos, apagar";c.style.left=x+"px";c.style.top=y+"px";root.appendChild(c);};
  chip(1,"os dois botões não respondem ao clique", Math.round(r1.left), Math.round(r1.top-20));
  // ✕ pendente no canto de cada selecionado (desmarcar sem sair do gesto)
  btns.forEach((b)=>{const rb=b.getBoundingClientRect();const x=document.createElement("button");x.className="unmark";x.textContent="✕";x.title="desmarcar";x.style.left=Math.max(2,Math.round(rb.right-8))+"px";x.style.top=Math.max(2,Math.round(rb.top-8))+"px";root.appendChild(x);});
  // hover do picker sobre o 2º card (estado de apontar)
  const hv=document.createElement("div");hv.className="hover";const tg=document.createElement("span");tg.className="tag";tg.textContent="selecionar";hv.appendChild(tg);
  const r3=document.querySelectorAll(".card")[1].getBoundingClientRect();
  hv.style.left=Math.round(r3.left-4)+"px";hv.style.top=Math.round(r3.top-4)+"px";hv.style.width=Math.round(r3.width+8)+"px";hv.style.height=Math.round(r3.height+8)+"px";
  root.appendChild(hv);
  // caixa de anotação ACOPLADA ao contorno do 1º selecionado (grupo + prompt, Enter salva)
  const note=document.createElement("div");note.className="note";
  const hd=document.createElement("div");hd.className="hd";hd.textContent="novo pack · 2 elemento(s)";note.appendChild(hd);
  const gi=document.createElement("input");gi.maxLength=60;gi.placeholder="grupo (escopo): ex: checkout";gi.value="checkout";note.appendChild(gi);
  const ta=document.createElement("textarea");ta.rows=2;ta.placeholder="o que está errado? Enter salva · Esc cancela";ta.value="os dois botões não respondem ao clique";note.appendChild(ta);
  const err=document.createElement("div");err.className="err";note.appendChild(err);
  const row=document.createElement("div");row.className="row";
  const cx=document.createElement("button");cx.textContent="Cancelar";row.appendChild(cx);note.appendChild(row);
  root.appendChild(note);
  let left = r1.right + 14;
  if (left + note.offsetWidth > innerWidth - 8) { left = Math.max(8, r1.left - note.offsetWidth - 14); note.classList.add("left"); }
  note.style.left = Math.round(left) + "px"; note.style.top = Math.round(r1.top) + "px";
  ta.focus();`;

// cena 2 — pack editável: .editor acoplado com grupo + nota + 2 elementos na lista
const sceneEditor = `
  const btns = document.querySelectorAll("button.buy");
  btns.forEach((b,i)=>b.setAttribute("data-ub-elem", String(i+1)));
  const r1 = btns[0].getBoundingClientRect();
  const ed=document.createElement("div");ed.className="editor";
  const hd=document.createElement("div");hd.className="hd";hd.textContent="pack · 2 elemento(s)";ed.appendChild(hd);
  const ta=document.createElement("textarea");ta.rows=2;ta.value="os dois botões não respondem ao clique";ed.appendChild(ta);
  const gi=document.createElement("input");gi.maxLength=60;gi.placeholder="grupo (escopo): ex: checkout";gi.value="checkout";ed.appendChild(gi);
  const ul=document.createElement("ul");
  [['#1 button "Comprar agora"'],['#2 button "Pagar" [pay-btn]']].forEach(([t])=>{
    const li=document.createElement("li");const nm=document.createElement("span");nm.className="nm";nm.textContent=t;nm.title=t;
    const rm=document.createElement("button");rm.textContent="✕";rm.title="remover do pack";
    li.appendChild(nm);li.appendChild(rm);ul.appendChild(li);
  });
  ed.appendChild(ul);
  const err=document.createElement("div");err.className="err";ed.appendChild(err);
  const btns2=document.createElement("div");btns2.className="btns";
  [["Salvar","primary"],["+ elemento",""],["Apagar","danger"],["Fechar",""]].forEach(([t,c])=>{const b=document.createElement("button");b.textContent=t;if(c)b.className=c;btns2.appendChild(b);});
  ed.appendChild(btns2);
  root.appendChild(ed);
  let left = r1.right + 14;
  if (left + ed.offsetWidth > innerWidth - 8) { left = Math.max(8, r1.left - ed.offsetWidth - 14); ed.classList.add("left"); }
  ed.style.left = Math.round(left) + "px"; ed.style.top = Math.round(r1.top) + "px";`;

const page = shell(pageCards, sceneNew);
const pageEditor = shell(pageCards, sceneEditor);
const page375 = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:375px;height:667px}</style></head>
<body><iframe src="elem-preview.html"></iframe></body></html>`;

mkdirSync(new URL("../.opencode/evidencia-elem/", import.meta.url), { recursive: true });
writeFileSync("/tmp/opencode/elem-preview.html", page);
writeFileSync("/tmp/opencode/elem-preview-editor.html", pageEditor);
writeFileSync("/tmp/opencode/elem-preview-375.html", page375);
console.log("previews escritos: /tmp/opencode/elem-preview*.html (css extraído:", cssLines.length, "linhas)");
