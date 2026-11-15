#!/usr/bin/env python3
"""V7 CLEAN - identidade visual, simples, organizado, sem texto explicativo."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE
from lxml import etree
import os
IMG=os.path.expanduser("~/Downloads/ppt_imgs")
prs=Presentation()
prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
blank=prs.slide_layouts[6]
A="http://schemas.openxmlformats.org/drawingml/2006/main"
P="http://schemas.openxmlformats.org/presentationml/2006/main"
# IDENTIDADE VISUAL EQUIPE 7 — paleta fixa 60-30-10
NAVY=RGBColor(0x0E,0x1B,0x2A)    # 25% fundos escuros (capa/fecho/fullscreen)
PAPER=RGBColor(0xF7,0xF5,0xF0)   # 60% fundo claro
INK=RGBColor(0x14,0x1E,0x28)     # texto
MUTED=RGBColor(0x6B,0x7A,0x85)   # apoio
COPPER=RGBColor(0xB4,0x5F,0x1E)  # 10% acento único
LINE=RGBColor(0xE4,0xDD,0xD1)    # divisórias
WHITE=RGBColor(0xFF,0xFF,0xFF)   # bordas finas
M=Inches(0.7); GW=Inches(0.5); COL=(prs.slide_width-2*M-GW)/2
TOTAL=18; n=0
def new(c):
    global n; s=prs.slides.add_slide(blank)
    f=s.background.fill; f.solid(); f.fore_color.rgb=c; n+=1; return s
def frame(shape,w=1.0):
    # borda branca fina padrão da identidade
    shape.line.color.rgb=WHITE; shape.line.width=Pt(w)
def alt(shape,t):
    try: shape._element.cNvPr.set("descr",t)
    except Exception: pass
def kick(s,top,txt):
    t=s.shapes.add_textbox(M,top,Inches(11),Inches(0.32))
    p=t.text_frame.paragraphs[0]; p.text=txt.upper()
    p.font.size=Pt(11); p.font.bold=True; p.font.color.rgb=COPPER; p.font.name="Calibri"
    r=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,M,top+Inches(0.3),prs.slide_width-2*M,Pt(1))
    r.fill.solid(); r.fill.fore_color.rgb=LINE; r.line.fill.background()
def title(s,top,txt):
    t=s.shapes.add_textbox(M,top,Inches(11.4),Inches(1.0))
    t.text_frame.word_wrap=True; p=t.text_frame.paragraphs[0]
    p.text=txt; p.font.size=Pt(32); p.font.bold=True; p.font.color.rgb=INK; p.font.name="Calibri"
def bullets(s,l,t,w,h,ls):
    t=s.shapes.add_textbox(l,t,w,h); t.text_frame.word_wrap=True
    for i,x in enumerate(ls):
        p=t.text_frame.paragraphs[0] if i==0 else t.text_frame.add_paragraph()
        p.text="▸  "+x; p.font.size=Pt(20); p.font.color.rgb=INK; p.font.name="Calibri"; p.space_after=Pt(10)
def cap(s,left,top,w,txt):
    t=s.shapes.add_textbox(left,top,w,Inches(0.32))
    p=t.text_frame.paragraphs[0]; p.text=txt; p.font.size=Pt(10); p.font.color.rgb=MUTED; p.font.name="Calibri"
def num(s,sec):
    t=s.shapes.add_textbox(prs.slide_width-M-Inches(2.2),prs.slide_height-Inches(0.45),Inches(2.2),Inches(0.3))
    p=t.text_frame.paragraphs[0]; p.text=f"{sec}  {n:02d}/{TOTAL:02d}"; p.font.size=Pt(10); p.font.color.rgb=MUTED; p.font.name="Calibri"; p.alignment=PP_ALIGN.RIGHT
def morph(s,dur=1200):
    try:
        MC="http://schemas.openxmlformats.org/markup-compatibility/2006"
        P14="http://schemas.microsoft.com/office/powerpoint/2010/main"
        P15="http://schemas.microsoft.com/office/powerpoint/2012/main"
        e=s._element
        for tag in [f"{{{P}}}transition",f"{{{MC}}}AlternateContent"]:
            for x in e.findall(tag): e.remove(x)
        ac=etree.SubElement(e,f"{{{MC}}}AlternateContent")
        ch=etree.SubElement(ac,f"{{{MC}}}Choice"); ch.set("Requires","p15")
        tr=etree.SubElement(ch,f"{{{P}}}transition",spd="med"); tr.set(f"{{{P14}}}dur",str(dur))
        etree.SubElement(tr,f"{{{P15}}}morph",option="byObject")
        fb=etree.SubElement(ac,f"{{{MC}}}Fallback")
        t2=etree.SubElement(fb,f"{{{P}}}transition",spd="med")
        etree.SubElement(t2,f"{{{P}}}fade",thruBlk="1")
    except Exception: pass

# 01 CAPA — marca + tese + hero com borda branca fina
s=new(NAVY)
m=s.shapes.add_textbox(M,Inches(0.45),Inches(2.2),Inches(0.35))
m.text_frame.paragraphs[0].text="EQUIPE 7"; m.text_frame.paragraphs[0].font.size=Pt(12); m.text_frame.paragraphs[0].font.bold=True; m.text_frame.paragraphs[0].font.color.rgb=COPPER; m.text_frame.paragraphs[0].font.name="Calibri"
t=s.shapes.add_textbox(M,Inches(0.85),Inches(6.6),Inches(1.5))
t.text_frame.word_wrap=True; p=t.text_frame.paragraphs[0]; p.text="A química que liga cada chip."; p.font.size=Pt(44); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
st=s.shapes.add_textbox(M,Inches(2.6),Inches(6.6),Inches(1.0))
st.text_frame.word_wrap=True; p=st.text_frame.paragraphs[0]; p.text="Do fio ao IBM PC. Do Fenolite ao FR-4. Do chumbo ao verde."; p.font.size=Pt(16); p.font.color.rgb=RGBColor(0xC8,0xD6,0xDD); p.font.name="Calibri"
im=s.shapes.add_picture(os.path.join(IMG,"ibm_pc_small.jpg"),M+Inches(7.3),Inches(0.6),Inches(4.6),Inches(5.7)); frame(im,1.5); alt(im,"Placa-mae IBM PC 5150 de 1981")
cap(s,M+Inches(7.3),Inches(6.4),Inches(4.6),"IBM PC 5150, 1981 — Wikimedia Commons")
num(s,"CAPA"); s.notes_slide.placeholders[1].text_frame.text="Fala: tese em 1 frase."

data=[
 ("01","ORIGEM","Fios viraram circuito em 1981.",["Sem padrão, falha alta","Cobre impresso, repetível","Massa confiável"],"ibm_pc_small.jpg","IBM PC 5150, 1981","Wikimedia Commons"),
 ("02","TEMPO","Quatro datas, uma placa.",["1950 Fenolite → 1981 IBM","1995 ATX → 2006 RoHS"],"vec_tempo.jpg","Linha do tempo","Próprio"),
 ("03","BASE","Papel quebrou; vidro ficou.",["Fenolite: frágil, 120 °C","FR-4: V-0, 180 °C"],"fr4.jpg","PCB FR-4 real","Wikimedia Commons"),
 ("04","CONDUTORES","Cobre conduz, ouro protege.",["Cu 59,6 MS/m, oxida","Au inerte, contato"],"vec_cobre.jpg","Trilhas de cobre","Próprio"),
 ("05","SOLDA","Adeus chumbo.",["Sn-Pb 183 °C, tóxico","SAC 217 °C, RoHS"],"vec_solda.jpg","Solda ecológica","Próprio"),
 ("06","VELOCIDADE","Perto é rápido.",["Multicamadas em mm","GHz + PCIe 5.0"],"vec_desemp.jpg","Multicamadas","Próprio"),
 ("07","TABELA","Base e solda lado a lado.",["Ver quadro"],"vec_ouro.jpg","Contatos de ouro","Próprio"),
 ("08","FUTURO","A placa volta à terra.",["Celulose compostável","Bio-Au + grafeno"],"vec_futuro.jpg","Grafeno e bioplaca","Próprio"),
]
for u,sec,ti,bl,img,leg,sr in data:
    sa=new(PAPER); morph(sa)
    kick(sa,Inches(0.4),f"{u} / 08   {sec}")
    title(sa,Inches(0.78),ti)
    bullets(sa,M,Inches(2.0),COL,Inches(3.4),bl)
    im=sa.shapes.add_picture(os.path.join(IMG,img),M+COL+GW,Inches(2.0),COL,Inches(3.4)); frame(im,1.0); alt(im,leg)
    cap(sa,M+COL+GW,Inches(5.5),COL,leg+" — "+sr)
    if u=="07":
        tsh=sa.shapes.add_table(5,3,int(M),int(Inches(3.9)),int(COL),int(Inches(1.6)))
        tb=tsh.table
        for j,h in enumerate(["","Fenolite / Sn-Pb","FR-4 / SAC"]):
            c=tb.cell(0,j); c.text=h
            for par in c.text_frame.paragraphs: par.font.size=Pt(11); par.font.bold=True; par.font.color.rgb=WHITE
            c.fill.solid(); c.fill.fore_color.rgb=NAVY
        rows=[["Base","Papel, frágil","Vidro+epóxi"],["Temp","120 / 183 °C","180 / 217 °C"],["Camadas","1","4–12"],["Limite","Quebra / Pb","Custo / calor"]]
        for i,r in enumerate(rows,start=1):
            for j,v in enumerate(r):
                c=tb.cell(i,j); c.text=v
                for par in c.text_frame.paragraphs: par.font.size=Pt(11)
                c.fill.solid(); c.fill.fore_color.rgb=WHITE if i%2 else RGBColor(0xEF,0xE9,0xDD)
    else:
        vb=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,M,Inches(3.9),COL,Inches(1.6))
        vb.fill.solid(); vb.fill.fore_color.rgb=NAVY; vb.line.fill.background()
        vb.text_frame.word_wrap=True; tf=vb.text_frame; tf.paragraphs[0].alignment=PP_ALIGN.CENTER
        p=tf.paragraphs[0]; p.text="▶  Vídeo em loop"; p.font.size=Pt(14); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
    num(sa,sec); sa.notes_slide.placeholders[1].text_frame.text=f"{sec}: {ti}"
    sb=new(RGBColor(0,0,0)); morph(sb)
    big=sb.shapes.add_picture(os.path.join(IMG,img),Inches(0.35),Inches(0.3),prs.slide_width-Inches(0.7),prs.slide_height-Inches(0.6)); frame(big,1.0); alt(big,leg+" em tela cheia")
    num(sb,sec)

f=new(NAVY); morph(f,1500)
t=f.shapes.add_textbox(M,Inches(0.7),Inches(7),Inches(1.3))
t.text_frame.word_wrap=True; p=t.text_frame.paragraphs[0]; p.text="Do chumbo ao verde."; p.font.size=Pt(44); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
st=f.shapes.add_textbox(M,Inches(2.1),Inches(7),Inches(0.8))
st.text_frame.word_wrap=True; p=st.text_frame.paragraphs[0]; p.text="Equipe 7 • FR-4 • Cu/Au • SAC • Futuro"; p.font.size=Pt(15); p.font.color.rgb=RGBColor(0xC8,0xD6,0xDD); p.font.name="Calibri"
im=f.shapes.add_picture(os.path.join(IMG,"vec_futuro.jpg"),M+Inches(7.3),Inches(0.9),Inches(4.6),Inches(4.6)); frame(im,1.5)
num(f,"FIM")
out=os.path.expanduser("~/Downloads/Quimica-das-Placas-Mae-Equipe7-CLEAN.pptx")
prs.save(out); print("OK",out,n)
