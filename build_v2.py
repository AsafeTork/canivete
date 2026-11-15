#!/usr/bin/env python3
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from lxml import etree

prs = Presentation()
prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
prs.core_properties.title = "Quimica das Placas-Mae Equipe 7 - estilo Prezi Espartana"
BG = RGBColor(0x14,0x1F,0x18)
BEGE = RGBColor(0xE8,0xDC,0xC4)
GREEN = RGBColor(0x00,0xE6,0x76)
COPPER = RGBColor(0xC9,0x7B,0x2D)
GOLD = RGBColor(0xFF,0xD5,0x4F)
WHITE = RGBColor(0xFF,0xFF,0xFF)
GRAY = RGBColor(0x8A,0x9B,0xA6)
DARK = RGBColor(0x0E,0x2A,0x1E)
CARD_BG = RGBColor(0x1E,0x35,0x28)
blank = prs.slide_layouts[6]

def set_bg(s,c):
    f=s.background.fill; f.solid(); f.fore_color.rgb=c
def txt(s,l,t,w,h,tx,sz=18,b=False,c=WHITE,a=PP_ALIGN.LEFT):
    tb=s.shapes.add_textbox(l,t,w,h); tf=tb.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=tx; p.font.size=Pt(sz); p.font.bold=b; p.font.color.rgb=c; p.font.name="Calibri"; p.alignment=a
    return tb
def morph(slide,dur=1500):
    try:
        MC="http://schemas.openxmlformats.org/markup-compatibility/2006"
        P14="http://schemas.microsoft.com/office/powerpoint/2010/main"
        P15="http://schemas.microsoft.com/office/powerpoint/2012/main"
        P="http://schemas.openxmlformats.org/presentationml/2006/main"
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
def minicard(slide,l,t,w,h,num,titulo,cor,name):
    sh=slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,l,t,w,h)
    sh.fill.solid(); sh.fill.fore_color.rgb=CARD_BG
    sh.line.color.rgb=cor; sh.line.width=Pt(1.5); sh.shadow.inherit=False
    if name: sh.name=name
    tf=sh.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=f"{num} {titulo}"; p.font.size=Pt(9); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"; p.alignment=PP_ALIGN.CENTER
    tf.vertical_anchor=MSO_ANCHOR.MIDDLE
    return sh
def videoph(slide,l,t,w,h,titulo,full=False):
    sh=slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,l,t,w,h)
    sh.fill.solid(); sh.fill.fore_color.rgb=RGBColor(0x05,0x12,0x1A); sh.line.fill.background()
    tf=sh.text_frame; tf.word_wrap=True; tf.paragraphs[0].alignment=PP_ALIGN.CENTER
    p=tf.paragraphs[0]; p.text=f"VIDEO  {titulo}\nESPACO VIDEO EM LOOP"; p.font.size=Pt(18 if not full else 26); p.font.bold=True; p.font.color.rgb=GREEN; p.font.name="Calibri"
    q=tf.add_paragraph(); q.text="Inserir > Video > Automatico + Repetir ate parar + Tela cheia"; q.font.size=Pt(10); q.font.color.rgb=GRAY; q.font.name="Calibri"; q.alignment=PP_ALIGN.CENTER
    ov=slide.shapes.add_shape(MSO_SHAPE.OVAL,l+w/2-Inches(0.4),t+h/2-Inches(0.1),Inches(0.8),Inches(0.8))
    ov.fill.solid(); ov.fill.fore_color.rgb=GREEN; ov.line.fill.background()
    ov.text_frame.word_wrap=True; ov.text_frame.paragraphs[0].text="▶"; ov.text_frame.paragraphs[0].font.size=Pt(28); ov.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER
    return sh

topicos=[
    {"num":"01","titulo":"ORIGEM","sub":"Ponto a ponto -> IBM PC 1981","texto":"- Fios caoticos, solda manual.\n- 1981 IBM PC 5150: trilhas cobre impressas.\n- Isolantes fenolicos -> epoxi.","video":"Origem Fios vs IBM PC","cor":COPPER},
    {"num":"02","titulo":"LINHA DO TEMPO","sub":"1950 -> 1981 -> 1995 -> 2006","texto":"- 1950 Fenolite 1 camada.\n- 1981 IBM PC dupla face.\n- 1995 ATX multicamadas.\n- 2006 RoHS sem chumbo.","video":"Linha do tempo","cor":GREEN},
    {"num":"03","titulo":"SUBSTRATO","sub":"Fenolite vs FR-4","texto":"- Fenolite: papel+fenolica, fragil, Tg 120C.\n- FR-4: fibra vidro+epoxi bromada, Tg 180C, V-0.","video":"Fenolite x FR-4","cor":GOLD},
    {"num":"04","titulo":"CONDUTORES","sub":"Cu trilhas - Au contatos","texto":"- Cu: condutivo, oxida.\n- Au: inerte, ENIG 0,05um em slots.","video":"Cobre + Ouro","cor":GOLD},
    {"num":"05","titulo":"SOLDA","sub":"Sn-Pb -> SAC RoHS","texto":"- Sn-Pb 183C toxico.\n- SAC305 Sn/Ag/Cu 217C ecologica.","video":"Solda SAC","cor":GREEN},
    {"num":"06","titulo":"DESEMPENHO","sub":"Multicamadas = GHz","texto":"- Distancia mm, menos ruido.\n- MHz -> GHz + PCIe 5.0.","video":"Velocidade","cor":COPPER},
    {"num":"07","titulo":"TABELA","sub":"Comparativa","texto":"Fenolite x FR-4 / Sn-Pb x SAC.\nVer quadro detalhado.","video":"Tabela","cor":GREEN,"tabela":True},
    {"num":"08","titulo":"FUTURO","sub":"Bioplaca Grafeno","texto":"- Celulose compostavel.\n- Biometalurgia recupera Au.\n- Grafeno 5000 W/mK.","video":"Futuro","cor":GOLD},
]

def overview(slide, titulo_principal, subtitulo):
    set_bg(slide,BG); morph(slide)
    # bloco esquerda estilo Espartana
    txt(slide,Inches(0.5),Inches(0.4),Inches(3.8),Inches(1.4),titulo_principal,34,True,BEGE,PP_ALIGN.LEFT)
    txt(slide,Inches(0.5),Inches(2.2),Inches(3.8),Inches(1.6),"Equipe 7\nQuimica + Tecnologia\nApresentacao estilo Prezi",14,False,BEGE,PP_ALIGN.LEFT)
    txt(slide,Inches(0.5),Inches(3.9),Inches(3.8),Inches(0.6),"Overview -> zoom em cada card -> 50/50 -> video fullscreen loop -> volta",10,False,GRAY,PP_ALIGN.LEFT)
    # imagem gigante centro-direita (como capacete espartano)
    slide.shapes.add_picture("/home/tork/Projetos/canivete/placa_central.png",Inches(4.6),Inches(0.2),Inches(5.2),Inches(7.1))
    # clusters de minicards SOBRE a imagem (igual Espartana: topo, direita, base)
    clusters=[(5.0,0.5),(6.8,0.5),(8.6,1.2),(8.8,2.8),(8.8,4.2),(6.2,5.8),(7.8,5.8),(5.0,4.5)]
    for i,t in enumerate(topicos):
        x,y=clusters[i]
        minicard(slide,Inches(x),Inches(y),Inches(1.9),Inches(0.55),t["num"],t["titulo"],t["cor"],name=f"!!CARD_{t['num']}_{t['titulo']}")
    # marca hub para morph
    hub=slide.shapes.add_shape(MSO_SHAPE.OVAL,Inches(4.6),Inches(0.2),Pt(1),Pt(1))
    hub.name="!!HUB_CENTRO"; hub.fill.background(); hub.line.fill.background()

s0=prs.slides.add_slide(blank)
overview(s0,"A Quimica das Placas-Mae","Evolucao dos Materiais")
s0.notes_slide.placeholders[1].text_frame.text="Overview estilo Prezi Espartana: titulo esquerda, imagem gigante centro, minicards sobre imagem. Morph faz zoom."
for t in topicos:
    sa=prs.slides.add_slide(blank); set_bg(sa,BG); morph(sa)
    txt(sa,Inches(0.4),Inches(0.15),Inches(12.5),Inches(0.6),f"{t['num']}  {t['titulo']}  -  {t['sub']}",20,True,BEGE,PP_ALIGN.LEFT)
    cd=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.4),Inches(0.85),Inches(2.6),Inches(0.55))
    cd.fill.solid(); cd.fill.fore_color.rgb=t["cor"]; cd.line.fill.background(); cd.name=f"!!CARD_{t['num']}_{t['titulo']}"
    cd.text_frame.word_wrap=True; cd.text_frame.paragraphs[0].text=f"{t['num']} {t['titulo']}"; cd.text_frame.paragraphs[0].font.size=Pt(14); cd.text_frame.paragraphs[0].font.bold=True; cd.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER
    lb=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.4),Inches(1.6),Inches(5.9),Inches(5.1))
    lb.fill.solid(); lb.fill.fore_color.rgb=WHITE; lb.line.fill.background()
    tf=lb.text_frame; tf.word_wrap=True
    q=tf.paragraphs[0]; q.text=t["sub"]; q.font.size=Pt(16); q.font.bold=True; q.font.color.rgb=RGBColor(0x0B,0x1D,0x2A); q.font.name="Calibri"
    pc=tf.add_paragraph(); pc.text="\n"+t["texto"]; pc.font.size=Pt(13); pc.font.color.rgb=RGBColor(0x1A,0x1A,0x1A); pc.font.name="Calibri"
    if t.get("tabela"):
        tsh=sa.shapes.add_table(5,3,Inches(0.6),Inches(4.4),Inches(5.5),Inches(2.0))
        tbl=tsh.table
        hdr=["Propriedade","Fenolite / Sn-Pb","FR-4 / SAC"]
        dados=[["Substrato","Papel+fenolica","Fibra+epoxi V-0"],["T max/Fusao","120C / 183C Pb","180C / 217C"],["Camadas","1, agua","4-12"],["Limite","Fragil/Toxico","Caro/quente"]]
        for j,h in enumerate(hdr):
            c=tbl.cell(0,j); c.text=h
            for par in c.text_frame.paragraphs: par.font.size=Pt(9); par.font.bold=True; par.font.color.rgb=WHITE
            c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0x0B,0x1D,0x2A)
        for i,row in enumerate(dados,start=1):
            for j,v in enumerate(row):
                c=tbl.cell(i,j); c.text=v
                for par in c.text_frame.paragraphs: par.font.size=Pt(8)
                c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0xE8,0xF5,0xE9) if i%2==0 else WHITE
    videoph(sa,Inches(6.9),Inches(1.6),Inches(6.0),Inches(5.1),t["video"],False)
    sa.notes_slide.placeholders[1].text_frame.text=f"{t['titulo']} 50/50 loop."
    sb=prs.slides.add_slide(blank); set_bg(sb,RGBColor(0,0,0)); morph(sb)
    txt(sb,Inches(0.5),Inches(0.2),Inches(12.3),Inches(0.6),f"{t['num']} {t['titulo']} - VIDEO LOOP TELA CHEIA",18,True,GREEN,PP_ALIGN.CENTER)
    videoph(sb,Inches(0.5),Inches(1.0),Inches(12.3),Inches(5.5),t["video"],True)
    txt(sb,Inches(0.5),Inches(6.7),Inches(12.3),Inches(0.4),"Automatico + Repetir ate parar - proximo volta ao overview",11,False,GRAY,PP_ALIGN.CENTER)
sf=prs.slides.add_slide(blank)
overview(sf,"Obrigado! Equipe 7","Quimica das Placas-Mae")
out="/home/tork/Projetos/canivete/Quimica-das-Placas-Mae-Equipe7-PREZI.pptx"
prs.save(out)
print(f"OK {out} {len(prs.slides._sldIdLst)} slides")
