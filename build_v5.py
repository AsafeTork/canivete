#!/usr/bin/env python3
"""V5 AGENCY - sistema das agencias caras: McKinsey+Apple+Duarte+Slidebean."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from lxml import etree
import os
IMG=os.path.expanduser("~/Downloads/ppt_imgs")
prs=Presentation()
prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
blank=prs.slide_layouts[6]
A="http://schemas.openxmlformats.org/drawingml/2006/main"
P="http://schemas.openxmlformats.org/presentationml/2006/main"
# Sistema de cor restrito (Apple: 1 acento; McKinsey: muted)
NAVY=RGBColor(0x0E,0x1B,0x2A); PAPER=RGBColor(0xF7,0xF5,0xF0)
INK=RGBColor(0x14,0x1E,0x28); MUTED=RGBColor(0x5A,0x6B,0x76)
COPPER=RGBColor(0xB4,0x5F,0x1E); GOLD=RGBColor(0x8A,0x6D,0x1B)
LINE=RGBColor(0xE2,0xDC,0xD0); WHITE=RGBColor(0xFF,0xFF,0xFF)
GREEN=RGBColor(0x0E,0x6B,0x3C)
# Grid: margens 0.6, gutter 0.4 (12-col simplificado p/ 2 col 50/50)
M=Inches(0.6); GW=Inches(0.4)
COL=(prs.slide_width-2*M-GW)/2

def set_bg(slide, color):
    f=slide.background.fill; f.solid(); f.fore_color.rgb=color
def eyebrow(slide, top, kicker, num=""):
    t=slide.shapes.add_textbox(M,top,prs.slide_width-2*M,Inches(0.35))
    tf=t.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=f"{num}  •  {kicker}".upper() if num else kicker.upper()
    p.font.size=Pt(10); p.font.bold=True; p.font.color.rgb=COPPER; p.font.name="Calibri"
    p.alignment=PP_ALIGN.LEFT
    #тики linha fina abaixo
    ln=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,M,top+Inches(0.32),prs.slide_width-2*M,Pt(1))
    ln.fill.solid(); ln.fill.fore_color.rgb=LINE; ln.line.fill.background()
    return t
def action_title(slide, top, text):
    # McKinsey: frase conclusao <=15 palavras, 2 linhas max, 26pt
    t=slide.shapes.add_textbox(M,top,Inches(7.6),Inches(1.0))
    tf=t.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=text; p.font.size=Pt(26); p.font.bold=True; p.font.color.rgb=INK; p.font.name="Calibri"
    p.alignment=PP_ALIGN.LEFT; p.space_after=Pt(2); p.line_spacing=1.0
    return t
def body(slide, left, top, w, h, lines, size=14):
    t=slide.shapes.add_textbox(left,top,w,h); tf=t.text_frame; tf.word_wrap=True
    for i,ln in enumerate(lines):
        p=tf.paragraphs[0] if i==0 else tf.add_paragraph()
        p.text=ln; p.font.size=Pt(size); p.font.color.rgb=INK; p.font.name="Calibri"; p.space_after=Pt(6)
    return t
def source(slide, text):
    t=slide.shapes.add_textbox(M,prs.slide_height-Inches(0.5),Inches(8),Inches(0.3))
    p=t.text_frame.paragraphs[0]; p.text="Fonte: "+text; p.font.size=Pt(8); p.font.color.rgb=MUTED; p.font.name="Calibri"
def pag(slide, n, total, section=""):
    t=slide.shapes.add_textbox(prs.slide_width-M-Inches(2.2),prs.slide_height-Inches(0.5),Inches(2.2),Inches(0.3))
    p=t.text_frame.paragraphs[0]; p.text=f"{section}  {n:02d} / {total:02d}"; p.font.size=Pt(8); p.font.color.rgb=MUTED; p.font.name="Calibri"; p.alignment=PP_ALIGN.RIGHT
    # barra progresso fina
    bar=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,M,prs.slide_height-Inches(0.28),prs.slide_width-2*M,Pt(3))
    bar.fill.solid(); bar.fill.fore_color.rgb=LINE; bar.line.fill.background()
    fill=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,M,prs.slide_height-Inches(0.28),(prs.slide_width-2*M)*n/total,Pt(3))
    fill.fill.solid(); fill.fill.fore_color.rgb=COPPER; fill.line.fill.background()
def morph(slide,dur=1200):
    try:
        MC="http://schemas.openxmlformats.org/markup-compatibility/2006"
        P14="http://schemas.microsoft.com/office/powerpoint/2010/main"
        P15="http://schemas.microsoft.com/office/powerpoint/2012/main"
        sld=slide._element
        for tag in [f"{{{P}}}transition",f"{{{MC}}}AlternateContent"]:
            for x in sld.findall(tag): sld.remove(x)
        ac=etree.SubElement(sld,f"{{{MC}}}AlternateContent")
        ch=etree.SubElement(ac,f"{{{MC}}}Choice"); ch.set("Requires","p15")
        tr=etree.SubElement(ch,f"{{{P}}}transition",spd="med"); tr.set(f"{{{P14}}}dur",str(dur))
        etree.SubElement(tr,f"{{{P15}}}morph",option="byObject")
        fb=etree.SubElement(ac,f"{{{MC}}}Fallback")
        t2=etree.SubElement(fb,f"{{{P}}}transition",spd="med")
        etree.SubElement(t2,f"{{{P}}}fade",thruBlk="1")
    except Exception: pass
def fade(slide, shape, delay=0, dur=450):
    try:
        sld=slide._element
        tm=sld.find(f"{{{P}}}timing")
        if tm is None:
            tm=etree.SubElement(sld,f"{{{P}}}timing")
            tn=etree.SubElement(tm,f"{{{P}}}tnLst"); par=etree.SubElement(tn,f"{{{P}}}par")
            ctn=etree.SubElement(par,f"{{{P}}}cTn",id="1",dur="indef",restart="never",nodeType="tmrPar")
            ch=etree.SubElement(ctn,f"{{{P}}}childTnLst")
            seq=etree.SubElement(ch,f"{{{P}}}seq",concurrent="1",nextAc="seek")
            c2=etree.SubElement(seq,f"{{{P}}}cTn",id="2",dur="indef",nodeType="mainSeq")
            lst=etree.SubElement(c2,f"{{{P}}}childTnLst"); slide._lst=lst
        lst=slide._lst
        import random
        a=str(random.randint(1000,99999)); b=str(random.randint(1000,99999)); c=str(random.randint(1000,99999))
        par=etree.SubElement(lst,f"{{{P}}}par")
        ctn=etree.SubElement(par,f"{{{P}}}cTn",id=a,fill="hold")
        st=etree.SubElement(ctn,f"{{{P}}}stCondLst"); etree.SubElement(st,f"{{{P}}}cond",delay="indef")
        ch=etree.SubElement(ctn,f"{{{P}}}childTnLst"); p2=etree.SubElement(ch,f"{{{P}}}par")
        c2=etree.SubElement(p2,f"{{{P}}}cTn",id=b,fill="hold")
        s2=etree.SubElement(c2,f"{{{P}}}stCondLst"); etree.SubElement(s2,f"{{{P}}}cond",delay=str(delay))
        c3=etree.SubElement(c2,f"{{{P}}}childTnLst")
        ae=etree.SubElement(c3,f"{{{P}}}animEffect",transition="in",filter="fade")
        bh=etree.SubElement(ae,f"{{{P}}}cBhvr")
        etree.SubElement(bh,f"{{{P}}}cTn",id=c,dur=str(dur),fill="hold")
        te=etree.SubElement(bh,f"{{{P}}}tgtEl"); etree.SubElement(te,f"{{{P}}}spTgt",spid=str(shape.shape_id))
    except Exception: pass

def hero_card(slide, imgfile, left, top, w, h, caption):
    pic=slide.shapes.add_picture(os.path.join(IMG,imgfile),left,top,w,h)
    # moldura fina + legenda (Apple: hero domina, sem cards competindo)
    cap=slide.shapes.add_textbox(left,top+h+Pt(2),w,Inches(0.3))
    p=cap.text_frame.paragraphs[0]; p.text=caption; p.font.size=Pt(8); p.font.color.rgb=MUTED; p.font.name="Calibri"
    return pic

slides=[]  # (titulo-acao, slide) p/ teste dos titulos
TOTAL=18
n=0
def new(bgcolor):
    global n; s=prs.slides.add_slide(blank); set_bg(s,bgcolor); n+=1; return s

# 01 CAPA dark navy hero (Apple hero + Duarte what-is)
s=new(NAVY); morph(s,1400)
k=s.shapes.add_textbox(M,Inches(0.5),Inches(6),Inches(0.3))
k.text_frame.paragraphs[0].text="EQUIPE 7 • QUÍMICA APLICADA"; k.text_frame.paragraphs[0].font.size=Pt(11); k.text_frame.paragraphs[0].font.bold=True; k.text_frame.paragraphs[0].font.color.rgb=COPPER; k.text_frame.paragraphs[0].font.name="Calibri"
t=s.shapes.add_textbox(M,Inches(0.85),Inches(7.4),Inches(1.1))
t.text_frame.word_wrap=True; p=t.text_frame.paragraphs[0]; p.text="A química invisível que liga cada chip."; p.font.size=Pt(40); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
st=s.shapes.add_textbox(M,Inches(2.1),Inches(7.4),Inches(0.8))
st.text_frame.word_wrap=True; p=st.text_frame.paragraphs[0]; p.text="Da montagem com fios caóticos ao IBM PC (1981), do Fenolite ao FR-4, do chumbo ao SAC — e ao futuro verde."; p.font.size=Pt(14); p.font.color.rgb=RGBColor(0xC8,0xD6,0xDD); p.font.name="Calibri"
s.shapes.add_picture(os.path.join(IMG,"ibm_pc_small.jpg"),M+Inches(7.9),Inches(0.5),Inches(4.5),Inches(5.6))
ag=s.shapes.add_textbox(M+Inches(7.9),Inches(6.2),Inches(4.5),Inches(0.3))
ag.text_frame.paragraphs[0].text="IBM PC 5150, 1981 — trilhas de cobre impressas. Foto: Wikimedia Commons."; ag.text_frame.paragraphs[0].font.size=Pt(8); ag.text_frame.paragraphs[0].font.color.rgb=RGBColor(0x8A,0x9B,0xA6); ag.text_frame.paragraphs[0].font.name="Calibri"
s.notes_slide.placeholders[1].text_frame.text="CAPA (Duarte what-is): tese em 1 frase. Sem Morph aqui; Zoom de Resumo a partir do próximo."
pag(s,n,TOTAL,"CAPA")

data=[
 ("01","ORIGEM","Fios soltos viraram circuito impresso em 1981.",["Ponto a ponto: sem padrão, falha alta","IBM PC: cobre impresso, repetível","So-what: confiabilidade em massa"],"ibm_pc_small.jpg","Origem: fios vs IBM PC 5150","Wikimedia Commons, IBM PC 5150"),
 ("02","LINHA DO TEMPO","Quatro datas explicam a placa moderna.",["1950 Fenolite → 1981 IBM PC","1995 ATX multicamadas → 2006 RoHS","So-what: cada salto resolveu um limite químico"],"vec_tempo.jpg","Linha do tempo 1950–2006","Elaboração própria"),
 ("03","SUBSTRATO","Papel fenólico quebrou; vidro + epóxi ficou.",["Fenolite: barato, frágil, 120 °C","FR-4: V-0, estável, 180 °C","So-what: base define temperatura e camadas"],"fr4.jpg","Fenolite × FR-4","Foto PCB: Wikimedia; vetor próprio"),
 ("04","CONDUTORES","Cobre conduz, ouro garante o contato.",["Cu: 5,96×10⁷ S/m, oxida","Au ENIG: inerte, 0,05 µm","So-what: ouro onde o dedo encosta"],"vec_cobre.jpg","Trilhas Cu + contatos Au","Vetor próprio"),
 ("05","SOLDA","O chumbo saiu por lei — e por saúde.",["Sn-Pb 183 °C, saturnismo","SAC Sn/Ag/Cu 217 °C, RoHS","So-what: solda verde exige forno mais quente"],"vec_solda.jpg","Sn-Pb × SAC305","Vetor próprio; RoHS 2006/UE"),
 ("06","DESEMPENHO","Encurtar o caminho acelerou o chip.",["Multicamadas: mm, plano-terra","Ruído menor → GHz + PCIe 5.0","So-what: química permite velocidade"],"vec_desemp.jpg","Multicamadas → velocidade","Vetor próprio"),
 ("07","TABELA","Base e solda, frente a frente.",["Comparativo visual ao lado","Foco: temperatura e limite","So-what: escolha = trade-off"],"vec_ouro.jpg","Tabela comparativa","Elaboração própria"),
 ("08","FUTURO","A próxima placa volta para a terra.",["Celulose compostável","Bio-Au + grafeno 5000 W/mK","So-what: ciclo fechado"],"vec_futuro.jpg","Bioplaca • grafeno","Vetor próprio"),
]

for num,sec,title,bullets,img,vid,src in data:
    # A conteúdo (McKinsey: action title + 1 prova + fonte)
    sa=new(PAPER); morph(sa)
    eyebrow(sa,Inches(0.35),sec,f"{num} / 08"); fade(sa,sa.shapes[0],0)
    at=action_title(sa,Inches(0.7),title); fade(sa,at,120); slides.append(title)
    # coluna esq evidência textual curta
    body(sa,M,Inches(1.85),COL,Inches(3.2),["▸ "+b for b in bullets],14)
    # coluna dir UMA imagem hero (Apple) + barra vídeo 50/50
    pic=hero_card(sa,img,M+COL+GW,Inches(1.85),COL,Inches(3.2),f"{vid}.")
    fade(sa,pic,250)
    if num=="07":
        tsh=sa.shapes.add_table(5,3,int(M+COL+GW),int(Inches(5.25)),int(COL),int(Inches(1.4)))
        tbl=tsh.table
        for j,hdr in enumerate(["","Fenolite / Sn-Pb","FR-4 / SAC"]):
            c=tbl.cell(0,j); c.text=hdr
            for par in c.text_frame.paragraphs: par.font.size=Pt(9); par.font.bold=True; par.font.color.rgb=WHITE
            c.fill.solid(); c.fill.fore_color.rgb=NAVY
        rows=[["Base","Papel, frágil","Vidro+epóxi V-0"],["Temp","120 °C / 183 °C","180 °C / 217 °C"],["Camadas","1","4–12"],["Limite","Quebra / Pb","Custo / calor"]]
        for i,row in enumerate(rows,start=1):
            for j,v in enumerate(row):
                c=tbl.cell(i,j); c.text=v
                for par in c.text_frame.paragraphs: par.font.size=Pt(8); par.font.color.rgb=INK
                c.fill.solid(); c.fill.fore_color.rgb=WHITE if i%2 else RGBColor(0xEF,0xE9,0xDD)
    else:
        vb=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,M+COL+GW,Inches(5.25),COL,Inches(1.05))
        vb.fill.solid(); vb.fill.fore_color.rgb=NAVY; vb.line.fill.background()
        vb.text_frame.word_wrap=True; tf=vb.text_frame; tf.paragraphs[0].alignment=PP_ALIGN.CENTER
        p=tf.paragraphs[0]; p.text=f"▶  {vid}  •  LOOP"; p.font.size=Pt(11); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
        q=tf.add_paragraph(); q.alignment=PP_ALIGN.CENTER; q.text="Este Dispositivo • Automático • Tela cheia • Repetir • Ocultar • Rebobinar"; q.font.size=Pt(8); q.font.color.rgb=RGBColor(0xC8,0xD6,0xDD); q.font.name="Calibri"
    source(sa,src); pag(sa,n,TOTAL,sec)
    sa.notes_slide.placeholders[1].text_frame.text=f"Fala ({sec}): {title} Detalhe na voz, não no slide."
    # B fullscreen vídeo (imagem bleed = lugar do vídeo real)
    sb=new(RGBColor(0,0,0))
    # sem eyebrow: foco total (Apple hero)
    big=sb.shapes.add_picture(os.path.join(IMG,img),Inches(0),Inches(0),prs.slide_width,prs.slide_height)
    leg=sb.shapes.add_textbox(M,prs.slide_height-Inches(0.9),Inches(8),Inches(0.5))
    leg.text_frame.word_wrap=True; p=leg.text_frame.paragraphs[0]
    p.text=f"{num} {sec} — substituir por vídeo em loop: Automático + Tela cheia + Repetir + Ocultar + Rebobinar"; p.font.size=Pt(11); p.font.color.rgb=WHITE; p.font.name="Calibri"
    sb.notes_slide.placeholders[1].text_frame.text="Quiosque: Configurar apresentação → Quiosque + Repetir até Esc."
    pag(sb,n,TOTAL,sec)

# 18 FECHO (Duarte new bliss)
f=new(NAVY); morph(f,1500)
t=f.shapes.add_textbox(M,Inches(0.6),Inches(7),Inches(1.2))
t.text_frame.word_wrap=True; p=t.text_frame.paragraphs[0]; p.text="Do chumbo ao verde: a química decide o futuro."; p.font.size=Pt(36); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
st=f.shapes.add_textbox(M,Inches(2.0),Inches(7),Inches(0.8))
st.text_frame.word_wrap=True; p=st.text_frame.paragraphs[0]; p.text="Equipe 7 • Fenolite → FR-4 • Cu/Au • Sn-Pb → SAC • Celulose + bio-Au + grafeno"; p.font.size=Pt(13); p.font.color.rgb=RGBColor(0xC8,0xD6,0xDD); p.font.name="Calibri"
f.shapes.add_picture(os.path.join(IMG,"vec_futuro.jpg"),M+Inches(7.9),Inches(0.8),Inches(4.5),Inches(4.5))
pag(f,n,TOTAL,"FIM")
print("titles test:")
for t in slides: print("-",t)
out=os.path.expanduser("~/Downloads/Quimica-das-Placas-Mae-Equipe7-AGENCY.pptx")
prs.save(out)
print("OK",out,n)
