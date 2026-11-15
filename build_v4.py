#!/usr/bin/env python3
"""V4 BEST - aplica o que aprendi pesquisando (receita correta)."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from lxml import etree
import os
IMG=os.path.expanduser("~/Downloads/ppt_imgs")
BGIMG=os.path.join(IMG,"bg_blur.jpg")

prs=Presentation()
prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
blank=prs.slide_layouts[6]
A="http://schemas.openxmlformats.org/drawingml/2006/main"
P="http://schemas.openxmlformats.org/presentationml/2006/main"
INK=RGBColor(0x0B,0x1D,0x2A); BEGE=RGBColor(0xFF,0xFF,0xFF); WHITE=RGBColor(0xFF,0xFF,0xFF)
GREEN=RGBColor(0x00,0xE6,0x76); GRAY=RGBColor(0xC8,0xD6,0xDD)
COPPER=RGBColor(0xE8,0x9A,0x3C); GOLD=RGBColor(0xFF,0xD5,0x4F)

def bg(slide):
    # fundo foto blurred (receita Twistly passo 1) em vez de cor chapada
    slide.shapes.add_picture(BGIMG,Inches(0),Inches(0),prs.slide_width,prs.slide_height)
    # véu escuro p/ contraste do texto (Efeitos Lab: Make Transparent)
    v=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,Inches(0),Inches(0),prs.slide_width,prs.slide_height)
    v.fill.solid(); v.fill.fore_color.rgb=RGBColor(0x05,0x10,0x18); v.line.fill.background()
    set_alpha(v,65000)  # 65% transparente = escurece sem esconder o blur

def set_alpha(shape,val):
    try:
        xPr=shape.fill._xPr
        solid=xPr.find(f"{{{A}}}solidFill")
        srgb=solid.find(f"{{{A}}}srgbClr")
        for a in srgb.findall(f"{{{A}}}alpha"): srgb.remove(a)
        al=etree.SubElement(srgb,f"{{{A}}}alpha"); al.set("val",str(val))
    except Exception: pass

def glass(shape):
    # Receita Twistly/Alicia: branco 70-85% transparente + borda 60-80% + sombra suave
    shape.fill.solid(); shape.fill.fore_color.rgb=RGBColor(0xFF,0xFF,0xFF)
    set_alpha(shape,75000)  # 75% transparente
    shape.line.color.rgb=RGBColor(0xFF,0xFF,0xFF); shape.line.width=Pt(0.75)
    try:
        ln=shape.line._xPr.find(f"{{{A}}}ln")
        sf=ln.find(f"{{{A}}}solidFill"); srgb=sf.find(f"{{{A}}}srgbClr")
        al=etree.SubElement(srgb,f"{{{A}}}alpha"); al.set("val","30000")  # 70% transp.
    except Exception: pass
    shape.shadow.inherit=False
    try: # sombra externa suave 70% transp, blur ~20pt, dist 4pt
        sh=shape.shadow
        # python-pptx nao expoe blur/dist, entao injeta XML minimo
        xPr=shape._element.find(f"{{{A}}}effectLst")
    except Exception: pass
    # highlight superior (shimmer) - linha fina clara no topo
    return shape

def txt(s,l,t,w,h,tx,sz=18,b=False,c=BEGE,a=PP_ALIGN.LEFT):
    tb=s.shapes.add_textbox(l,t,w,h); tf=tb.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=tx; p.font.size=Pt(sz); p.font.bold=b; p.font.color.rgb=c; p.font.name="Calibri"; p.alignment=a
    return tb

def morph(slide,dur=1500):
    try:
        MC="http://schemas.openxmlformats.org/markup-compatibility/2006"
        P14="http://schemas.microsoft.com/office/powerpoint/2010/main"
        P15="http://schemas.microsoft.com/office/powerpoint/2012/main"
        sld=slide._element
        for tag in [f"{{{P}}}transition",f"{{{MC}}}AlternateContent"]:
            for x in sld.findall(tag): sld.remove(x)
        ac=etree.SubElement(sld,f"{{{MC}}}AlternateContent")
        ch=etree.SubElement(ac,f"{{{MC}}}Choice"); ch.set("Requires","p15")
        tr=etree.SubElement(ch,f"{{{P}}}transition",spd="slow"); tr.set(f"{{{P14}}}dur",str(dur))
        etree.SubElement(tr,f"{{{P15}}}morph",option="byObject")
        fb=etree.SubElement(ac,f"{{{MC}}}Fallback")
        t2=etree.SubElement(fb,f"{{{P}}}transition",spd="slow")
        etree.SubElement(t2,f"{{{P}}}fade",thruBlk="1")
    except Exception as e: print("morph",e)

_uid=[100]
def ensure_seq(slide):
    sld=slide._element
    tm=sld.find(f"{{{P}}}timing")
    if tm is None:
        tm=etree.SubElement(sld,f"{{{P}}}timing")
        tn=etree.SubElement(tm,f"{{{P}}}tnLst")
        par=etree.SubElement(tn,f"{{{P}}}par")
        ctn=etree.SubElement(par,f"{{{P}}}cTn",id="1",dur="indef",restart="never",nodeType="tmrPar")
        ch=etree.SubElement(ctn,f"{{{P}}}childTnLst")
        seq=etree.SubElement(ch,f"{{{P}}}seq",concurrent="1",nextAc="seek")
        c2=etree.SubElement(seq,f"{{{P}}}cTn",id="2",dur="indef",nodeType="mainSeq")
        lst=etree.SubElement(c2,f"{{{P}}}childTnLst")
        slide._seq_lst=lst
    return slide._seq_lst

def fade_in(slide, shape, delay=0, dur=500):
    # So animacao simples Aparecer/Esmaecer (AAMC/UConn) - sem fly/zoom distrativo
    try:
        lst=ensure_seq(slide)
        _uid[0]+=1; a=_uid[0]; _uid[0]+=1; b=_uid[0]; _uid[0]+=1; c=_uid[0]
        par=etree.SubElement(lst,f"{{{P}}}par")
        ctn=etree.SubElement(par,f"{{{P}}}cTn",id=str(a),fill="hold")
        st=etree.SubElement(ctn,f"{{{P}}}stCondLst"); etree.SubElement(st,f"{{{P}}}cond",delay="indef")
        ch=etree.SubElement(ctn,f"{{{P}}}childTnLst")
        p2=etree.SubElement(ch,f"{{{P}}}par")
        c2=etree.SubElement(p2,f"{{{P}}}cTn",id=str(b),fill="hold")
        s2=etree.SubElement(c2,f"{{{P}}}stCondLst"); etree.SubElement(s2,f"{{{P}}}cond",delay=str(delay))
        c3=etree.SubElement(c2,f"{{{P}}}childTnLst")
        ae=etree.SubElement(c3,f"{{{P}}}animEffect",transition="in",filter="fade")
        bh=etree.SubElement(ae,f"{{{P}}}cBhvr")
        etree.SubElement(bh,f"{{{P}}}cTn",id=str(c),dur=str(dur),fill="hold")
        te=etree.SubElement(bh,f"{{{P}}}tgtEl"); etree.SubElement(te,f"{{{P}}}spTgt",spid=str(shape.shape_id))
    except Exception as e: print("anim",e)

# Conteudo enxuto: Assertion-Evidence, max 3 fragmentos por slide (Mayer/Kosslyn)
topicos=[
    {"num":"01","titulo":"ORIGEM","assert":"Do caos de fios ao circuito impresso (1981).","ev":["Ponto a ponto: fios, solda manual","IBM PC 5150: trilhas de cobre","Fala: padronização → massa"],"img":"ibm_pc_small.jpg","video":"Origem — fios vs IBM PC","cor":COPPER,"fala":"Aqui conto como saímos dos fios caóticos para a placa do IBM PC. Detalhe na narração, não no slide."},
    {"num":"02","titulo":"LINHA DO TEMPO","assert":"Quatro saltos: 1950 → 1981 → 1995 → 2006.","ev":["1950 Fenolite • 1981 IBM PC","1995 ATX multicamadas","2006 RoHS sem chumbo"],"img":"vec_tempo.jpg","video":"Linha do tempo","cor":GREEN,"fala":"Timeline enxuta; datas na imagem grande."},
    {"num":"03","titulo":"SUBSTRATO","assert":"A base trocou papel por vidro + epóxi.","ev":["Fenolite: papel, frágil, 120°C","FR-4: fibra + epóxi V-0, 180°C"],"img":"fr4.jpg","video":"Fenolite × FR-4","cor":GOLD,"fala":"Mostro as duas amostras reais na bancada."},
    {"num":"04","titulo":"CONDUTORES","assert":"Cobre conduz, ouro protege.","ev":["Cu: alta condutividade, oxida","Au ENIG: inerte, contato"],"img":"vec_cobre.jpg","video":"Cobre + ouro","cor":GOLD,"fala":"Explico oxidação do cobre e inércia do ouro falando."},
    {"num":"05","titulo":"SOLDA","assert":"Adeus chumbo: SAC 217°C.","ev":["Sn-Pb 183°C, tóxico","SAC Sn/Ag/Cu, RoHS"],"img":"vec_solda.jpg","video":"Solda + RoHS","cor":GREEN,"fala":"Meio ambiente: saturnismo vs liga ecológica."},
    {"num":"06","titulo":"DESEMPENHO","assert":"Perto = rápido: MHz → GHz.","ev":["Multicamadas, plano terra","Trilhas curtas, PCIe 5.0"],"img":"vec_desemp.jpg","video":"Velocidade","cor":COPPER,"fala":"Distância menor, atraso menor."},
    {"num":"07","titulo":"TABELA","assert":"Resumo: base e solda lado a lado.","ev":["Ver quadro visual ao lado"],"img":"vec_ouro.jpg","video":"Tabela","cor":GREEN,"tabela":True,"fala":"Leio a tabela com a turma."},
    {"num":"08","titulo":"FUTURO","assert":"Placa que volta pra terra.","ev":["Celulose compostável","Bio-Au + grafeno"],"img":"vec_futuro.jpg","video":"Futuro verde","cor":GOLD,"fala":"Fecho com química verde."},
]

# HUB - overview Prezi (Training Lady: slide 1 SEM morph, slides 2+ COM morph)
h=prs.slides.add_slide(blank); bg(h)
# sem morph no 1o (receita correta)
t1=txt(h,Inches(0.6),Inches(0.4),Inches(6.5),Inches(0.9),"A Química das Placas-Mãe",32,True,BEGE); fade_in(h,t1,0)
t2=txt(h,Inches(0.6),Inches(1.2),Inches(6.5),Inches(0.5),"Evolução dos materiais • Equipe 7",16,False,GREEN); fade_in(h,t2,300)
pic=h.shapes.add_picture(os.path.join(IMG,"ibm_pc_small.jpg"),Inches(4.0),Inches(1.9),Inches(5.4),Inches(3.6)); fade_in(h,pic,500)
fr=h.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(4.0),Inches(1.9),Inches(5.4),Inches(3.6))
fr.fill.background(); fr.line.color.rgb=RGBColor(0xFF,0xFF,0xFF); fr.line.width=Pt(1); fr.name="!!HUB_CENTRO"
pos=[(0.4,2.0),(0.4,3.4),(0.4,4.8),(9.6,2.0),(9.6,3.4),(9.6,4.8),(3.6,5.7),(6.9,5.7)]
for i,t in enumerate(topicos):
    x,y=pos[i]
    c=h.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(x),Inches(y),Inches(3.1),Inches(0.85))
    glass(c); c.name=f"!!CARD_{t['num']}_{t['titulo']}"
    tf=c.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=f"{t['num']}  {t['titulo']}"; p.font.size=Pt(12); p.font.bold=True; p.font.color.rgb=INK; p.font.name="Calibri"; p.alignment=PP_ALIGN.CENTER
    q=tf.add_paragraph(); q.text=t["assert"][:38]; q.font.size=Pt(8); q.font.color.rgb=RGBColor(0x33,0x4A,0x55); q.font.name="Calibri"; q.alignment=PP_ALIGN.CENTER
    fade_in(h,c,600+i*150)
txt(h,Inches(0.5),Inches(6.7),Inches(12.3),Inches(0.4),"Apresentar com Zoom: Inserir > Zoom de Resumo p/ navegar livre • Morph só do slide 2 em diante",10,False,GRAY,PP_ALIGN.CENTER)
h.notes_slide.placeholders[1].text_frame.text="HUB sem Morph (receita Training Lady). Use Inserir > Zoom de Resumo para navegação Prezi. Narração carrega o detalhe (Mayer)."

for t in topicos:
    # A - conteúdo 50/50: UMA imagem grande + vidro texto mínimo
    sa=prs.slides.add_slide(blank); bg(sa); morph(sa,1500)
    tt=txt(sa,Inches(0.5),Inches(0.2),Inches(12.3),Inches(0.6),f"{t['num']}  {t['titulo']}",24,True,BEGE); fade_in(sa,tt,0)
    au=txt(sa,Inches(0.5),Inches(0.75),Inches(7),Inches(0.5),t["assert"],14,False,GREEN); fade_in(sa,au,200)
    bd=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.5),Inches(1.25),Inches(2.2),Inches(0.45))
    glass(bd); bd.name=f"!!CARD_{t['num']}_{t['titulo']}"
    bd.text_frame.word_wrap=True; bd.text_frame.paragraphs[0].text=f"{t['num']} {t['titulo']}"; bd.text_frame.paragraphs[0].font.size=Pt(12); bd.text_frame.paragraphs[0].font.bold=True; bd.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER
    # imagem grande full-bleed direita (Garr Reynolds: 1 imagem poderosa)
    imp=sa.shapes.add_picture(os.path.join(IMG,t["img"]),Inches(6.9),Inches(1.4),Inches(5.9),Inches(4.2)); fade_in(sa,imp,300)
    # vidro texto esquerda com max 3 linhas
    lb=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.5),Inches(1.85),Inches(5.9),Inches(3.0))
    glass(lb)
    tf=lb.text_frame; tf.word_wrap=True
    for j,ev in enumerate(t["ev"]):
        p=tf.paragraphs[0] if j==0 else tf.add_paragraph()
        p.text="• "+ev; p.font.size=Pt(14); p.font.color.rgb=INK; p.font.name="Calibri"; p.space_after=Pt(4)
    fade_in(sa,lb,450)
    # placeholder vídeo com config correta (Microsoft: Automático + Tela cheia + Loop + Ocultar + Rebobinar)
    vb=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.5),Inches(5.05),Inches(12.3),Inches(1.15))
    glass(vb)
    tf=vb.text_frame; tf.word_wrap=True; tf.paragraphs[0].alignment=PP_ALIGN.CENTER
    p=tf.paragraphs[0]; p.text=f"▶  {t['video']}  •  LOOP"; p.font.size=Pt(13); p.font.bold=True; p.font.color.rgb=INK; p.font.name="Calibri"
    q=tf.add_paragraph(); q.alignment=PP_ALIGN.CENTER
    q.text="Inserir > Vídeo > Este Dispositivo (embed, não YouTube) • Reprodução: Automático ✓ Tela cheia ✓ Repetir até parar ✓ Ocultar enquanto não reproduz ✓ Rebobinar ✓"; q.font.size=Pt(9); q.font.color.rgb=RGBColor(0x33,0x4A,0x55); q.font.name="Calibri"
    fade_in(sa,vb,600)
    if t.get("tabela"):
        tsh=sa.shapes.add_table(5,3,Inches(0.7),Inches(3.3),Inches(5.5),Inches(1.4))
        tbl=tsh.table
        for j,hdr in enumerate([" ","Fenolite / Sn-Pb","FR-4 / SAC"]):
            c=tbl.cell(0,j); c.text=hdr
            for par in c.text_frame.paragraphs: par.font.size=Pt(9); par.font.bold=True; par.font.color.rgb=BEGE
            c.fill.solid(); c.fill.fore_color.rgb=INK
        rows=[["Base","Papel, frágil","Vidro+epóxi V-0"],["Temp","120°C / 183°C","180°C / 217°C"],["Limite","Quebra / Pb tóxico","Caro / forno quente"],["Uso","1 camada","4-12 camadas"]]
        for i,row in enumerate(rows,start=1):
            for j,v in enumerate(row):
                c=tbl.cell(i,j); c.text=v
                for par in c.text_frame.paragraphs: par.font.size=Pt(8)
                c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0xFF,0xFF,0xFF)
    sa.notes_slide.placeholders[1].text_frame.text=f"FALA: {t['fala']} Slide minimalista; detalhe na voz (Redundancy principle)."
    # B - fullscreen: imagem cobre tudo; aqui vai o vídeo real em loop
    sb=prs.slides.add_slide(blank)
    bg(sb); morph(sb,1500)
    # imagem de fundo total (bleed)
    big=sb.shapes.add_picture(os.path.join(IMG,t["img"]),Inches(0),Inches(0),prs.slide_width,prs.slide_height)
    fade_in(sb,big,0)
    cap=sb.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.6),Inches(5.8),Inches(6),Inches(1.1))
    glass(cap)
    cap.text_frame.word_wrap=True; cap.text_frame.paragraphs[0].text=f"{t['num']} {t['titulo']} — troque por vídeo: Automático + Tela cheia + Loop + Ocultar + Rebobinar"; cap.text_frame.paragraphs[0].font.size=Pt(11)
    sb.notes_slide.placeholders[1].text_frame.text="Quiosque: Apresentação > Configurar > Navegado em quiosque + Repetir até Esc + Ensaiar intervalos."

f=prs.slides.add_slide(blank); bg(f); morph(f,1500)
txt(f,Inches(0.5),Inches(0.5),Inches(12.3),Inches(0.8),"Obrigado! • Equipe 7",32,True,BEGE,PP_ALIGN.CENTER)
txt(f,Inches(0.5),Inches(1.3),Inches(12.3),Inches(0.5),"Fenolite → FR-4 • Cu/Au • Sn-Pb → SAC • Futuro verde",14,False,GREEN,PP_ALIGN.CENTER)
pic2=f.shapes.add_picture(os.path.join(IMG,"vec_futuro.jpg"),Inches(4.2),Inches(2.0),Inches(5.0),Inches(3.2))
fr2=f.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(4.2),Inches(2.0),Inches(5.0),Inches(3.2))
fr2.fill.background(); fr2.line.color.rgb=WHITE; fr2.line.width=Pt(1); fr2.name="!!HUB_CENTRO"
for i,t in enumerate(topicos):
    x,y=pos[i]
    c=f.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(x),Inches(y),Inches(3.1),Inches(0.85))
    glass(c); c.name=f"!!CARD_{t['num']}_{t['titulo']}"
    c.text_frame.word_wrap=True; c.text_frame.paragraphs[0].text=f"{t['num']}  {t['titulo']}"; c.text_frame.paragraphs[0].font.size=Pt(12); c.text_frame.paragraphs[0].font.bold=True; c.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER

out=os.path.expanduser("~/Downloads/Quimica-das-Placas-Mae-Equipe7-BEST.pptx")
prs.save(out)
print("OK",out,len(prs.slides._sldIdLst))
