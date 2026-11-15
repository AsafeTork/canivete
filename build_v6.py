#!/usr/bin/env python3
"""V6 MEGA - aplica síntese dos 5 agentes (story+design+agency+tech+auditor)."""
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
NAVY=RGBColor(0x0E,0x1B,0x2A); PAPER=RGBColor(0xF7,0xF5,0xF0)
INK=RGBColor(0x14,0x1E,0x28); MUTED=RGBColor(0x5A,0x6B,0x76)
COPPER=RGBColor(0xB4,0x5F,0x1E); WHITE=RGBColor(0xFF,0xFF,0xFF)
GREEN=RGBColor(0x00,0xE6,0x76); LINE=RGBColor(0xE2,0xDC,0xD0)
M=Inches(0.6); GW=Inches(0.4); COL=(prs.slide_width-2*M-GW)/2
def set_bg(s,c):
    f=s.background.fill; f.solid(); f.fore_color.rgb=c
def set_alpha(shape,val):
    try:
        s=shape.fill._xPr.find(f"{{{A}}}solidFill"); sr=s.find(f"{{{A}}}srgbClr")
        for a in sr.findall(f"{{{A}}}alpha"): sr.remove(a)
        al=etree.SubElement(sr,f"{{{A}}}alpha"); al.set("val",str(val))
    except Exception: pass
def set_alt(shape,text):
    try:
        shape._element.cNvPr.set("descr",text)
    except Exception:
        try: shape._element._nvPr.cNvPr.set("descr",text)
        except Exception: pass
def eyebrow(s,top,kicker,num=""):
    t=s.shapes.add_textbox(M,top,prs.slide_width-2*M,Inches(0.35))
    p=t.text_frame.paragraphs[0]; p.text=f"{num}  •  {kicker}".upper() if num else kicker.upper()
    p.font.size=Pt(11); p.font.bold=True; p.font.color.rgb=COPPER; p.font.name="Calibri"
    ln=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,M,top+Inches(0.32),prs.slide_width-2*M,Pt(1))
    ln.fill.solid(); ln.fill.fore_color.rgb=LINE; ln.line.fill.background()
    return t
def atitle(s,top,text,sz=32):
    t=s.shapes.add_textbox(M,top,Inches(11.5),Inches(1.1))
    t.text_frame.word_wrap=True; p=t.text_frame.paragraphs[0]
    p.text=text; p.font.size=Pt(sz); p.font.bold=True; p.font.color.rgb=INK; p.font.name="Calibri"
    return t
def bullets(s,left,top,w,h,lines):
    t=s.shapes.add_textbox(left,top,w,h); t.text_frame.word_wrap=True
    for i,ln in enumerate(lines):
        p=t.text_frame.paragraphs[0] if i==0 else t.text_frame.add_paragraph()
        p.text="▸ "+ln; p.font.size=Pt(20); p.font.color.rgb=INK; p.font.name="Calibri"; p.space_after=Pt(8)
    return t
def src(s,text):
    t=s.shapes.add_textbox(M,prs.slide_height-Inches(0.5),Inches(9),Inches(0.3))
    p=t.text_frame.paragraphs[0]; p.text="Fonte: "+text; p.font.size=Pt(10); p.font.color.rgb=MUTED; p.font.name="Calibri"
def pag(s,n,total,sec=""):
    t=s.shapes.add_textbox(prs.slide_width-M-Inches(2.4),prs.slide_height-Inches(0.5),Inches(2.4),Inches(0.3))
    p=t.text_frame.paragraphs[0]; p.text=f"{sec}  {n:02d}/{total:02d}"; p.font.size=Pt(10); p.font.color.rgb=MUTED; p.font.name="Calibri"; p.alignment=PP_ALIGN.RIGHT
    bar=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,M,prs.slide_height-Inches(0.28),prs.slide_width-2*M,Pt(3))
    bar.fill.solid(); bar.fill.fore_color.rgb=LINE; bar.line.fill.background()
    fl=s.shapes.add_shape(MSO_SHAPE.RECTANGLE,M,prs.slide_height-Inches(0.28),(prs.slide_width-2*M)*n/total,Pt(3))
    fl.fill.solid(); fl.fill.fore_color.rgb=COPPER; fl.line.fill.background()
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
def fade(s,shape,delay=0,dur=450):
    try:
        e=s._element; tm=e.find(f"{{{P}}}timing")
        if tm is None:
            tm=etree.SubElement(e,f"{{{P}}}timing"); tn=etree.SubElement(tm,f"{{{P}}}tnLst")
            par=etree.SubElement(tn,f"{{{P}}}par")
            ctn=etree.SubElement(par,f"{{{P}}}cTn",id="1",dur="indef",restart="never",nodeType="tmrPar")
            ch=etree.SubElement(ctn,f"{{{P}}}childTnLst")
            seq=etree.SubElement(ch,f"{{{P}}}seq",concurrent="1",nextAc="seek")
            c2=etree.SubElement(seq,f"{{{P}}}cTn",id="2",dur="indef",nodeType="mainSeq")
            s._lst=etree.SubElement(c2,f"{{{P}}}childTnLst")
        import random; a=str(random.randint(1000,99999)); b=str(random.randint(1000,99999)); c=str(random.randint(1000,99999))
        par=etree.SubElement(s._lst,f"{{{P}}}par")
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
def pic(s,fn,l,t,w,h,alt):
    p=s.shapes.add_picture(os.path.join(IMG,fn),l,t,w,h); set_alt(p,alt); return p
def videobar(s,left,top,w,vid):
    vb=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,left,top,w,Inches(1.15))
    vb.fill.solid(); vb.fill.fore_color.rgb=NAVY; vb.line.fill.background()
    vb.text_frame.word_wrap=True; tf=vb.text_frame; tf.paragraphs[0].alignment=PP_ALIGN.CENTER
    p=tf.paragraphs[0]; p.text=f"▶  {vid}  •  LOOP"; p.font.size=Pt(12); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
    q=tf.add_paragraph(); q.alignment=PP_ALIGN.CENTER
    q.text="Este Dispositivo MP4 H.264+AAC • Automático • Tela cheia • Repetir • Ocultar • Rebobinar (720p)"; q.font.size=Pt(9); q.font.color.rgb=RGBColor(0xC8,0xD6,0xDD); q.font.name="Calibri"
    return vb

TOTAL=21; n=0
def new(c):
    global n; s=prs.slides.add_slide(blank); set_bg(s,c); n+=1; return s

# 01 CAPA (sem Morph! 7 palavras Airbnb + Big Idea Duarte)
s=new(NAVY)
k=s.shapes.add_textbox(M,Inches(0.5),Inches(6),Inches(0.3))
k.text_frame.paragraphs[0].text="EQUIPE 7 • QUÍMICA APLICADA"; k.text_frame.paragraphs[0].font.size=Pt(12); k.text_frame.paragraphs[0].font.bold=True; k.text_frame.paragraphs[0].font.color.rgb=COPPER; k.text_frame.paragraphs[0].font.name="Calibri"
t=s.shapes.add_textbox(M,Inches(0.85),Inches(7.4),Inches(1.2))
t.text_frame.word_wrap=True; p=t.text_frame.paragraphs[0]; p.text="A química invisível que liga cada chip."; p.font.size=Pt(42); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
st=s.shapes.add_textbox(M,Inches(2.2),Inches(7.4),Inches(0.9))
st.text_frame.word_wrap=True; p=st.text_frame.paragraphs[0]; p.text="Do fio caótico ao IBM PC (1981). Do Fenolite ao FR-4. Do chumbo ao SAC. E ao futuro verde. 9 slides • 12 min • fonte ≥20pt."; p.font.size=Pt(15); p.font.color.rgb=RGBColor(0xC8,0xD6,0xDD); p.font.name="Calibri"
pp=pic(s,"ibm_pc_small.jpg",M+Inches(7.9),Inches(0.5),Inches(4.5),Inches(5.6),"Foto da placa-mae do IBM PC 5150 de 1981 com trilhas de cobre")
ag=s.shapes.add_textbox(M+Inches(7.9),Inches(6.2),Inches(4.5),Inches(0.3))
ag.text_frame.paragraphs[0].text="IBM PC 5150, 1981. Foto: Wikimedia Commons."; ag.text_frame.paragraphs[0].font.size=Pt(10); ag.text_frame.paragraphs[0].font.color.rgb=RGBColor(0x8A,0x9B,0xA6); ag.text_frame.paragraphs[0].font.name="Calibri"
s.notes_slide.placeholders[1].text_frame.text="CAPA sem Morph. Big Idea em 1 frase. STAR no fim: placa real na mão."
pag(s,n,TOTAL,"CAPA")

data=[
 ("01","ORIGEM","Fios soltos viraram circuito impresso em 1981.",["Ponto a ponto: sem padrão","IBM PC: cobre repetível","SCQA: como ligar tudo sem fio?"],"ibm_pc_small.jpg","Foto IBM PC 5150 1981 trilhas de cobre","Origem: fios vs IBM PC","Wikimedia Commons, IBM PC 5150"),
 ("02","LINHA DO TEMPO","Quatro datas explicam a placa moderna.",["1950 Fenolite → 1981 IBM","1995 ATX → 2006 RoHS","Eixo da sparkline geral"],"vec_tempo.jpg","Vetor timeline 1950 1981 1995 2006","Linha do tempo","Elaboração própria"),
 ("03","SUBSTRATO","Papel quebrou; vidro com epóxi ficou.",["Fenolite: frágil, 120 °C","FR-4: V-0, 180 °C"],"fr4.jpg","Foto real de PCB FR-4 fresada","Fenolite × FR-4","Wikimedia Commons"),
 ("04","CONDUTORES","Cobre conduz, ouro garante o contato.",["Cu 59,6 MS/m, oxida","Au ENIG inerte 0,05 µm"],"vec_cobre.jpg","Vetor trilhas de cobre com pads de ouro","Cobre + ouro","Vetor próprio"),
 ("05","SOLDA","O chumbo saiu por lei e por saúde.",["Sn-Pb 183 °C tóxico","SAC 217 °C RoHS"],"vec_solda.jpg","Vetor comparando solda com chumbo e sem chumbo","Sn-Pb × SAC305","Vetor próprio; RoHS UE 2006"),
 ("06","DESEMPENHO","Encurtar o caminho acelerou o chip.",["Multicamadas em mm","GHz + PCIe 5.0"],"vec_desemp.jpg","Vetor de placa multicamadas","Multicamadas → GHz","Vetor próprio"),
 ("07","TABELA","Base e solda, frente a frente MECE.",["Material • Temp • Limite","Trade-off honesto"],"vec_ouro.jpg","Vetor de contatos de ouro para tabela","Tabela comparativa","Elaboração própria"),
 ("08","FUTURO","A próxima placa volta para a terra.",["Celulose compostável","Bio-Au + grafeno"],"vec_futuro.jpg","Vetor de grafeno e bioplaca","Bioplaca • grafeno","Vetor próprio"),
]
for num,sec,title,bl,img,alt,vid,sr in data:
    sa=new(PAPER); morph(sa)
    e=eyebrow(sa,Inches(0.35),sec,f"{num} / 08"); fade(sa,e,0)
    at=atitle(sa,Inches(0.7),title); fade(sa,at,120)
    b=bullets(sa,M,Inches(1.9),COL,Inches(3.0),bl); fade(sa,b,300)
    im=pic(sa,img,M+COL+GW,Inches(1.9),COL,Inches(2.9),alt); fade(sa,im,400)
    if num=="07":
        tsh=sa.shapes.add_table(5,3,int(M+COL+GW),int(Inches(5.0)),int(COL),int(Inches(1.5)))
        tbl=tsh.table
        for j,hdr in enumerate(["","Fenolite / Sn-Pb","FR-4 / SAC"]):
            c=tbl.cell(0,j); c.text=hdr
            for par in c.text_frame.paragraphs: par.font.size=Pt(10); par.font.bold=True; par.font.color.rgb=WHITE
            c.fill.solid(); c.fill.fore_color.rgb=NAVY
        rows=[["Base","Papel, frágil","Vidro+epóxi V-0"],["Temp","120 °C / 183 °C","180 °C / 217 °C"],["Camadas","1","4–12"],["Limite","Quebra / Pb","Custo / calor"]]
        for i,row in enumerate(rows,start=1):
            for j,v in enumerate(row):
                c=tbl.cell(i,j); c.text=v
                for par in c.text_frame.paragraphs: par.font.size=Pt(10)
                c.fill.solid(); c.fill.fore_color.rgb=WHITE if i%2 else RGBColor(0xEF,0xE9,0xDD)
    else:
        vb=videobar(sa,M+COL+GW,Inches(5.0),COL,vid); fade(sa,vb,500)
    src(sa,sr); pag(sa,n,TOTAL,sec)
    sa.notes_slide.placeholders[1].text_frame.text=f"Fala {sec}: {title} Detalhe na voz."
    sb=new(RGBColor(0,0,0)); morph(sb)
    big=pic(sb,img,Inches(0),Inches(0),prs.slide_width,prs.slide_height,alt+" em tela cheia, lugar do vídeo em loop")
    leg=sb.shapes.add_textbox(M,prs.slide_height-Inches(1.0),Inches(10),Inches(0.6))
    leg.text_frame.word_wrap=True; p=leg.text_frame.paragraphs[0]
    p.text=f"{num} {sec} — substituir por MP4 H.264+AAC: Automático + Tela cheia + Repetir + Ocultar + Rebobinar"; p.font.size=Pt(12); p.font.color.rgb=WHITE; p.font.name="Calibri"
    sb.notes_slide.placeholders[1].text_frame.text="Quiosque: Quiosque + Repetir até Esc. Online toca 1x (limite)."
    pag(sb,n,TOTAL,sec)

# 19 FECHO new bliss + STAR
f=new(NAVY); morph(f,1500)
t=f.shapes.add_textbox(M,Inches(0.6),Inches(7),Inches(1.2))
t.text_frame.word_wrap=True; p=t.text_frame.paragraphs[0]; p.text="Do chumbo ao verde: a química decide o futuro."; p.font.size=Pt(38); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
st=f.shapes.add_textbox(M,Inches(2.0),Inches(7),Inches(0.8))
st.text_frame.word_wrap=True; p=st.text_frame.paragraphs[0]; p.text="STAR: segure uma placa real. Equipe 7 • Fenolite → FR-4 • Cu/Au • Sn-Pb → SAC • Celulose + bio-Au + grafeno"; p.font.size=Pt(14); p.font.color.rgb=RGBColor(0xC8,0xD6,0xDD); p.font.name="Calibri"
pic(f,"vec_futuro.jpg",M+Inches(7.9),Inches(0.8),Inches(4.5),Inches(4.5),"Vetor do futuro: grafeno e bioplaca")
pag(f,n,TOTAL,"FIM")
# 20 ANEXO A processo agência
a=new(PAPER); morph(a)
eyebrow(a,Inches(0.35),"Anexo A — Processo","19 / 22")
atitle(a,Inches(0.7),"Agência cara: roteiro antes do PowerPoint.",30)
bullets(a,M,Inches(1.9),Inches(11.5),Inches(4.5),["Discovery 1h: público, objetivo, CVI","Story em Word: SCQA + títulos-conclusão","Conceito: 3-4 slides amostra aprovados","Build + 2-3 rounds + template .potx"])
src(a,"Slidebean, BrightCarbon, Duarte"); pag(a,n,TOTAL,"ANEXO")
# 21 ANEXO B preços verificados
b=new(PAPER); morph(b)
eyebrow(b,Inches(0.35),"Anexo B — Preços verificados set/2026","20 / 22")
atitle(b,Inches(0.7),"Quanto custa slide premium (pesquisado).",30)
tsh=b.shapes.add_table(6,3,int(M),int(Inches(1.9)),int(Inches(11.5)),int(Inches(3.6)))
tbl=tsh.table
for j,hdr in enumerate(["Serviço","Preço lista","Fonte"]):
    c=tbl.cell(0,j); c.text=hdr
    for par in c.text_frame.paragraphs: par.font.size=Pt(11); par.font.bold=True; par.font.color.rgb=WHITE
    c.fill.solid(); c.fill.fore_color.rgb=NAVY
rows=[["Slidebean redesign 20 sl.","$799 (4 dias)","slidebean.com 13/09/26"],["Sprint estratégia 30 sl.","desde $6.000","slidebean.com"],["24Slides redesign","$39-43/slide","24slides.com"],["BrightCarbon 20 sl.","$10.200 / £7.200","brightcarbon.com"],["Duarte workshop","$990","duarte.com"]]
for i,row in enumerate(rows,start=1):
    for j,v in enumerate(row):
        c=tbl.cell(i,j); c.text=v
        for par in c.text_frame.paragraphs: par.font.size=Pt(11)
        c.fill.solid(); c.fill.fore_color.rgb=WHITE if i%2 else RGBColor(0xEF,0xE9,0xDD)
src(b,"Fetches 13/09/2026"); pag(b,n,TOTAL,"ANEXO")
# 22 ANEXO C checklist QA 15 itens
c=new(PAPER); morph(c)
eyebrow(c,Inches(0.35),"Anexo C — Checklist QA","21 / 22")
atitle(c,Inches(0.7),"Teste antes do palco (falhou = reprova).",30)
bullets(c,M,Inches(1.9),COL,Inches(4.5),["Morph só do slide 2 em diante","!! únicos, mesmo tipo, sem chart","Vídeo embed H.264 720p Autom+Full+Loop","Imagens JPEG/EMF 150ppi + alt text"])
bullets(c,M+COL+GW,Inches(1.9),COL,Inches(4.5),["Títulos únicos + ordem de leitura","Fade simples, contraste 4.5:1","Quiosque + Repetir até Esc","Shift+F5 sem lag em desktop"])
src(c,"Microsoft Support + W3C"); pag(c,n,TOTAL,"ANEXO")

out=os.path.expanduser("~/Downloads/Quimica-das-Placas-Mae-Equipe7-MEGA.pptx")
prs.save(out)
print("OK",out,n)
