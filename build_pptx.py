#!/usr/bin/env python3
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.oxml.ns import qn
from lxml import etree

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
prs.core_properties.title = "A Quimica das Placas-Mae - Equipe 7"

BG = RGBColor(0x0B,0x1D,0x2A)
BG2 = RGBColor(0x10,0x2E,0x3A)
GREEN = RGBColor(0x00,0xE6,0x76)
COPPER = RGBColor(0xC9,0x7B,0x2D)
GOLD = RGBColor(0xFF,0xD5,0x4F)
WHITE = RGBColor(0xFF,0xFF,0xFF)
LIGHT = RGBColor(0xD6,0xE8,0xDC)
GRAY = RGBColor(0x8A,0x9B,0xA6)
DARK_CARD = RGBColor(0x14,0x38,0x4A)
blank = prs.slide_layouts[6]

def set_bg(slide, color):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color

def txt(slide,l,t,w,h,text,sz=18,bold=False,color=WHITE,align=PP_ALIGN.LEFT):
    tx = slide.shapes.add_textbox(l,t,w,h)
    tf = tx.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=text
    p.font.size=Pt(sz); p.font.bold=bold; p.font.color.rgb=color; p.font.name="Calibri"
    p.alignment=align
    return tx

def card(slide,l,t,w,h,num,titulo,cor_borda,name=None):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,l,t,w,h)
    sh.fill.solid(); sh.fill.fore_color.rgb=DARK_CARD
    sh.line.color.rgb=cor_borda; sh.line.width=Pt(2.25)
    sh.shadow.inherit=False
    if name: sh.name=name
    tf=sh.text_frame; tf.word_wrap=True
    p1=tf.paragraphs[0]; p1.text=f"{num}  {titulo}"
    p1.font.size=Pt(13); p1.font.bold=True; p1.font.color.rgb=WHITE; p1.font.name="Calibri"
    p1.alignment=PP_ALIGN.CENTER
    tf.vertical_anchor=MSO_ANCHOR.MIDDLE
    return sh

def video_ph(slide,l,t,w,h,titulo,full=False):
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,l,t,w,h)
    sh.fill.solid(); sh.fill.fore_color.rgb=RGBColor(0x05,0x12,0x1A)
    sh.line.fill.background()
    sh.name="VIDEO_"+titulo[:15]
    tf=sh.text_frame; tf.word_wrap=True
    tf.paragraphs[0].alignment=PP_ALIGN.CENTER
    p=tf.paragraphs[0]
    p.text=f"VIDEO  {titulo}\nESPACO VIDEO EM LOOP"
    p.font.size=Pt(20 if not full else 28); p.font.bold=True; p.font.color.rgb=GREEN; p.font.name="Calibri"
    p2=tf.add_paragraph()
    p2.text="Inserir > Video > Este Dispositivo - Marcar: Repetir ate parar + Reproduzir Automaticamente"
    p2.font.size=Pt(11); p2.font.color.rgb=GRAY; p2.font.name="Calibri"
    p2.alignment=PP_ALIGN.CENTER
    play = slide.shapes.add_shape(MSO_SHAPE.OVAL, l+w/2-Inches(0.45), t+h/2-Inches(0.1), Inches(0.9), Inches(0.9))
    play.fill.solid(); play.fill.fore_color.rgb=GREEN
    play.line.fill.background()
    play.text_frame.word_wrap=True
    play.text_frame.paragraphs[0].text="\u25b6"
    play.text_frame.paragraphs[0].font.size=Pt(32)
    play.text_frame.paragraphs[0].font.bold=True
    play.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER
    return sh

def set_morph(slide, dur_ms=1500):
    try:
        MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
        P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
        P15 = "http://schemas.microsoft.com/office/powerpoint/2012/main"
        sld = slide._element
        # limpa transicoes antigas
        for tag in [f"{{http://schemas.openxmlformats.org/presentationml/2006/main}}transition",
                    f"{{{MC}}}AlternateContent"]:
            for x in sld.findall(tag):
                sld.remove(x)
        ac = etree.SubElement(sld, f"{{{MC}}}AlternateContent")
        # declara Requires via atributo com namespace mc? usa set simples
        choice = etree.SubElement(ac, f"{{{MC}}}Choice")
        choice.set("Requires", "p15")
        trans = etree.SubElement(choice, f"{{http://schemas.openxmlformats.org/presentationml/2006/main}}transition", spd="slow")
        trans.set(f"{{{P14}}}dur", str(dur_ms))
        etree.SubElement(trans, f"{{{P15}}}morph", option="byObject")
        fb = etree.SubElement(ac, f"{{{MC}}}Fallback")
        t2 = etree.SubElement(fb, f"{{http://schemas.openxmlformats.org/presentationml/2006/main}}transition", spd="slow")
        etree.SubElement(t2, f"{{http://schemas.openxmlformats.org/presentationml/2006/main}}fade", thruBlk="1")
    except Exception as e:
        print("morph fail:", e)

topicos = [
    {"num":"01","titulo":"ORIGEM","sub":"Do ponto a ponto ao IBM PC (1981)","texto":"- Montagem ponto a ponto: fios caoticos, solda manual, sem padronizacao.\n- 1981 IBM PC 5150: placa-mae verde com trilhas de cobre impressas.\n- Quimica: isolantes fenolicos -> epoxi; padronizacao permite massa.\n- Salto: confiabilidade + repetibilidade do circuito impresso.","video":"Origem - Fios vs IBM PC 5150","cor":COPPER},
    {"num":"02","titulo":"LINHA DO TEMPO","sub":"1950 -> 1981 -> 1995 -> 2006","texto":"- 1950 Fenolite (papel + resina fenolica): barato, fragil, 1 camada.\n- 1981 IBM PC: FR-4 inicial, dupla face.\n- 1995 Padrao ATX + multicamadas (4-12 camadas).\n- 2006 Diretiva RoHS (UE): proibicao do chumbo na solda.","video":"Linha do tempo 1950-2006","cor":GREEN},
    {"num":"03","titulo":"SUBSTRATO (BASE)","sub":"Fenolite vs FR-4","texto":"- FENOLITE: papel kraft + resina fenolica. Barato, quebradico, absorve umidade, Tg ~120C.\n- FR-4: fibra de vidro + resina epoxi bromada (retardante chama). Rigido, Tg 130-180C, multicamadas.\n- Quimica: epoxi = reticulado; bromo = UL94 V-0.","video":"Fenolite x FR-4 microscopia","cor":GOLD},
    {"num":"04","titulo":"CONDUTORES","sub":"Cobre nas trilhas - Ouro nos contatos","texto":"- COBRE (Cu): alta condutividade, barato, trilhas por fotolitografia + FeCl3.\n- Problema: oxida (CuO) -> aumenta resistencia.\n- OURO (Au): inercia quimica, nao oxida, camada ENIG em slots/RAM/PCIe.\n- Quimica: Au nao reage com O2/H2O; garante contato.","video":"Trilhas cobre + ouro","cor":GOLD},
    {"num":"05","titulo":"A SOLDA","sub":"Sn-Pb -> SAC ecologica (RoHS)","texto":"- Sn-Pb 60/40: fusao 183C, facil - porem Pb toxico (saturnismo).\n- SAC305 (Sn 96,5% + Ag 3% + Cu 0,5%): fusao 217-220C, RoHS compliant.\n- Desafio: maior temperatura exige FR-4 alto Tg + fluxo sem halogenio.","video":"Solda Sn-Pb vs SAC","cor":GREEN},
    {"num":"06","titulo":"DESEMPENHO","sub":"FR-4 + multicamadas = velocidade","texto":"- Multicamadas reduzem distancia CPU-RAM de cm -> mm.\n- Planos de terra internos reduzem ruido e crosstalk.\n- Dk FR-4 (~4,4) + trilhas curtas = menor atraso.\n- Resultado: MHz (1981) -> GHz + PCIe 5.0.","video":"Multicamadas + velocidade","cor":COPPER},
    {"num":"07","titulo":"TABELA COMPARATIVA","sub":"Substrato + Solda","texto":"TABELA (ver quadro):\n- Fenolite: barato, fragil, 105C max.\n- FR-4: retardante chama, 150-180C, multicamadas.\n- Sn-Pb: 183C, toxico. SAC: 217C, ecologica.","video":"Tabela Fenolite/FR-4/Sn-Pb/SAC","cor":GREEN, "tabela":True},
    {"num":"08","titulo":"O FUTURO","sub":"Bioplacas - Biometalurgia - Grafeno","texto":"- Placas de celulose/PLA biodegradaveis: compostavel.\n- Biometalurgia: bacterias recuperam Au/Cu do lixo eletronico.\n- Grafeno: 5000 W/mK, dissipacao termica + flexivel.\n- Quimica verde fecha o ciclo.","video":"Bioplaca + grafeno + ouro","cor":GOLD},
]
TOTAL = 1 + len(topicos)*2 + 1

# SLIDE 1 HUB
s = prs.slides.add_slide(blank)
set_bg(s, BG); set_morph(s)
txt(s,Inches(0.5),Inches(0.15),Inches(12.3),Inches(0.7),"A QUIMICA DAS PLACAS-MAE - EVOLUCAO DOS MATERIAIS",26,True,WHITE,PP_ALIGN.CENTER)
txt(s,Inches(0.5),Inches(0.75),Inches(12.3),Inches(0.4),"EQUIPE 7  -  50/50 texto + video em loop  -  Zoom Morph tipo Prezi",13,False,GREEN,PP_ALIGN.CENTER)
centro = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(4.3),Inches(1.5),Inches(4.7),Inches(3.6))
centro.fill.solid(); centro.fill.fore_color.rgb=RGBColor(0x0E,0x2A,0x1E)
centro.line.color.rgb=GREEN; centro.line.width=Pt(3)
centro.name="!!HUB_CENTRO"
tf=centro.text_frame; tf.word_wrap=True
p=tf.paragraphs[0]; p.alignment=PP_ALIGN.CENTER
p.text="TEMA CENTRAL\nQUIMICA DAS\nPLACAS-MAE"; p.font.size=Pt(26); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
p2=tf.add_paragraph(); p2.alignment=PP_ALIGN.CENTER
p2.text="IBM PC 1981 - FR-4 - Cu/Au - SAC - RoHS"; p2.font.size=Pt(12); p2.font.color.rgb=GOLD; p2.font.name="Calibri"
tf.vertical_anchor=MSO_ANCHOR.MIDDLE
txt(s,Inches(4.3),Inches(5.15),Inches(4.7),Inches(0.35),"Morph faz o ZOOM ate o card",10,False,GRAY,PP_ALIGN.CENTER)
pos=[(0.4,1.4),(0.4,3.3),(0.4,5.2),(9.7,1.4),(9.7,3.3),(9.7,5.2),(3.2,5.6),(7.1,5.6)]
for i,t in enumerate(topicos):
    x,y=pos[i]
    card(s,Inches(x),Inches(y),Inches(3.2),Inches(0.85),t["num"],t["titulo"],t["cor"],name=f"!!CARD_{t['num']}_{t['titulo']}")
txt(s,Inches(0.5),Inches(6.55),Inches(12.3),Inches(0.35),"Transicoes > Morph 1,5s em todos - Clique = zoom card -> 50/50 -> zoom video fullscreen loop -> zoom-out HUB",10,False,LIGHT,PP_ALIGN.CENTER)
s.notes_slide.placeholders[1].text_frame.text="HUB: nomes !! mantidos para Morph reconhecer o zoom. Transicao Morph 1,5s Objetos."

idx=2
for t in topicos:
    sa = prs.slides.add_slide(blank)
    set_bg(sa, BG if int(t["num"])%2==1 else BG2); set_morph(sa)
    hub = sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(5.9),Inches(0.15),Inches(1.5),Inches(0.55))
    hub.fill.solid(); hub.fill.fore_color.rgb=DARK_CARD
    hub.line.color.rgb=t["cor"]; hub.line.width=Pt(1.5); hub.name="!!HUB_CENTRO"
    hub.text_frame.word_wrap=True
    hub.text_frame.paragraphs[0].text=f"{t['num']} {t['titulo']}"
    hub.text_frame.paragraphs[0].font.size=Pt(11); hub.text_frame.paragraphs[0].font.bold=True
    hub.text_frame.paragraphs[0].font.color.rgb=WHITE
    hub.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER
    cd = sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.4),Inches(0.9),Inches(3.0),Inches(0.7))
    cd.fill.solid(); cd.fill.fore_color.rgb=t["cor"]; cd.line.fill.background()
    cd.name=f"!!CARD_{t['num']}_{t['titulo']}"
    cd.text_frame.word_wrap=True
    cd.text_frame.paragraphs[0].text=f"{t['num']} - {t['titulo']}"
    cd.text_frame.paragraphs[0].font.size=Pt(16); cd.text_frame.paragraphs[0].font.bold=True
    cd.text_frame.paragraphs[0].font.color.rgb=RGBColor(0,0,0)
    cd.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER
    cd.text_frame.vertical_anchor=MSO_ANCHOR.MIDDLE
    lb = sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.4),Inches(1.8),Inches(5.9),Inches(4.7))
    lb.fill.solid(); lb.fill.fore_color.rgb=WHITE; lb.line.fill.background()
    tf=lb.text_frame; tf.word_wrap=True
    q=tf.paragraphs[0]; q.text=t["sub"]; q.font.size=Pt(16); q.font.bold=True; q.font.color.rgb=RGBColor(0x0B,0x1D,0x2A); q.font.name="Calibri"
    pb=tf.add_paragraph(); pb.text=""; pb.font.size=Pt(6)
    pc=tf.add_paragraph(); pc.text=t["texto"]; pc.font.size=Pt(12); pc.font.color.rgb=RGBColor(0x1A,0x1A,0x1A); pc.font.name="Calibri"
    if t.get("tabela"):
        tbl_shape = sa.shapes.add_table(5,3,Inches(0.6),Inches(4.6),Inches(5.5),Inches(1.6))
        tbl=tbl_shape.table
        hdr=["Propriedade","Fenolite / Sn-Pb","FR-4 / SAC"]
        dados=[["Substrato","Papel+fenolica, fragil","Fibra vidro+epoxi, V-0"],["T max/Fusao","~120C / 183C (Pb)","150-180C / 217C"],["Camadas","1, absorve agua","4-12, estavel"],["Limite","Quebra/umidade-Toxico","Caro / forno quente"]]
        for j,h in enumerate(hdr):
            c=tbl.cell(0,j); c.text=h
            for par in c.text_frame.paragraphs: par.font.size=Pt(9); par.font.bold=True; par.font.color.rgb=WHITE
            c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0x0B,0x1D,0x2A)
        for i,row in enumerate(dados, start=1):
            for j,val in enumerate(row):
                c=tbl.cell(i,j); c.text=val
                for par in c.text_frame.paragraphs: par.font.size=Pt(8)
                c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0xE8,0xF5,0xE9) if i%2==0 else WHITE
    video_ph(sa,Inches(6.9),Inches(1.8),Inches(6.0),Inches(4.7),t["video"],False)
    txt(sa,Inches(0.4),Inches(6.55),Inches(12.5),Inches(0.35),f"Proximo clique -> ZOOM video fullscreen loop  -  Depois volta ao HUB  -  {t['num']}/08",10,False,GRAY,PP_ALIGN.CENTER)
    sa.notes_slide.placeholders[1].text_frame.text=f"Slide {t['titulo']}: esquerda texto, direita video loop. Inserir > Video, marcar Loop."
    idx+=1
    sb = prs.slides.add_slide(blank)
    set_bg(sb, RGBColor(0,0,0)); set_morph(sb)
    txt(sb,Inches(0.5),Inches(0.2),Inches(12.3),Inches(0.6),f"{t['num']} - {t['titulo']}  VIDEO TELA CHEIA (LOOP)",18,True,GREEN,PP_ALIGN.CENTER)
    video_ph(sb,Inches(0.5),Inches(1.0),Inches(12.3),Inches(5.5),t["video"],True)
    txt(sb,Inches(0.5),Inches(6.7),Inches(12.3),Inches(0.4),"Reproducao > Automatico + Repetir ate parar + Tela cheia - Proximo = volta ao HUB",11,False,GRAY,PP_ALIGN.CENTER)
    sb.notes_slide.placeholders[1].text_frame.text=f"Video fullscreen {t['titulo']} loop."
    idx+=1

sf = prs.slides.add_slide(blank)
set_bg(sf, BG); set_morph(sf)
txt(sf,Inches(0.5),Inches(0.15),Inches(12.3),Inches(0.7),"VOLTAMOS AO INICIO - QUIMICA DAS PLACAS-MAE",26,True,WHITE,PP_ALIGN.CENTER)
txt(sf,Inches(0.5),Inches(0.75),Inches(12.3),Inches(0.4),"EQUIPE 7  -  Fenolite -> FR-4  -  Cu/Au  -  Sn-Pb -> SAC  -  Futuro verde",13,False,GOLD,PP_ALIGN.CENTER)
c2 = sf.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(4.3),Inches(1.5),Inches(4.7),Inches(3.6))
c2.fill.solid(); c2.fill.fore_color.rgb=RGBColor(0x0E,0x2A,0x1E)
c2.line.color.rgb=GREEN; c2.line.width=Pt(3); c2.name="!!HUB_CENTRO"
tf=c2.text_frame; tf.word_wrap=True
p=tf.paragraphs[0]; p.alignment=PP_ALIGN.CENTER
p.text="OBRIGADO!\nQUIMICA + TECNOLOGIA"; p.font.size=Pt(26); p.font.bold=True; p.font.color.rgb=WHITE; p.font.name="Calibri"
p2=tf.add_paragraph(); p2.alignment=PP_ALIGN.CENTER
p2.text="Perguntas? Equipe 7"; p2.font.size=Pt(14); p2.font.color.rgb=GREEN; p2.font.name="Calibri"
tf.vertical_anchor=MSO_ANCHOR.MIDDLE
for i,t in enumerate(topicos):
    x,y=pos[i]
    card(sf,Inches(x),Inches(y),Inches(3.2),Inches(0.85),t["num"],t["titulo"],t["cor"],name=f"!!CARD_{t['num']}_{t['titulo']}")
txt(sf,Inches(0.5),Inches(6.55),Inches(12.3),Inches(0.35),"FIM - Morph faz zoom-out de volta - Obrigado, Equipe 7!",11,False,LIGHT,PP_ALIGN.CENTER)

out="/home/tork/Projetos/canivete/Quimica-das-Placas-Mae-Equipe7.pptx"
prs.save(out)
print(f"OK salvo em {out} com {len(prs.slides._sldIdLst)} slides")
