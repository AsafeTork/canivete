#!/usr/bin/env python3
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
prs.core_properties.title="Quimica das Placas-Mae Equipe 7 - GLASS"
BG1=RGBColor(0x07,0x1A,0x26); BG2=RGBColor(0x0E,0x3A,0x2E)
BEGE=RGBColor(0xE8,0xDC,0xC4); GREEN=RGBColor(0x00,0xE6,0x76)
COPPER=RGBColor(0xC9,0x7B,0x2D); GOLD=RGBColor(0xFF,0xD5,0x4F)
WHITE=RGBColor(0xFF,0xFF,0xFF); GRAY=RGBColor(0x9A,0xB3,0xBE)
blank=prs.slide_layouts[6]
A="http://schemas.openxmlformats.org/drawingml/2006/main"
P="http://schemas.openxmlformats.org/presentationml/2006/main"

def set_bg(s):
    f=s.background.fill; f.solid(); f.fore_color.rgb=BG1
    # faixa gradiente simulada
    for i,col in enumerate([RGBColor(0x00,0xE6,0x76),RGBColor(0x00,0xB0,0xFF),RGBColor(0xC9,0x7B,0x2D)]):
        b=s.shapes.add_shape(MSO_SHAPE.OVAL,Inches(-2+i*5),Inches(-2.5),Inches(6),Inches(6))
        b.fill.solid(); b.fill.fore_color.rgb=col; b.line.fill.background()
        set_alpha(b, 90000)  # bem transparente = glow

def set_alpha(shape, val):
    # val 0..100000 (0 transparente total). 25000 = 25% opaco
    try:
        xPr=shape.fill._xPr
        solid=xPr.find(f"{{{A}}}solidFill")
        if solid is None: return
        srgb=solid.find(f"{{{A}}}srgbClr")
        if srgb is None: return
        for a in srgb.findall(f"{{{A}}}alpha"): srgb.remove(a)
        al=etree.SubElement(srgb,f"{{{A}}}alpha"); al.set("val",str(val))
    except Exception as e: print("alpha",e)

def glass(shape, fill_alpha=22000, line_alpha=45000):
    shape.fill.solid(); shape.fill.fore_color.rgb=WHITE
    set_alpha(shape, fill_alpha)
    shape.line.color.rgb=WHITE; shape.line.width=Pt(1.5)
    try:
        ln=shape.line._xPr.find(f"{{{A}}}ln")
        if ln is not None:
            sf=ln.find(f"{{{A}}}solidFill")
            if sf is not None:
                srgb=sf.find(f"{{{A}}}srgbClr")
                if srgb is not None:
                    al=etree.SubElement(srgb,f"{{{A}}}alpha"); al.set("val",str(line_alpha))
    except Exception: pass
    shape.shadow.inherit=False
    try:
        ef=shape._element.find(f"{{{A}}}effectLst")
    except Exception: pass

def txt(s,l,t,w,h,tx,sz=18,b=False,c=WHITE,a=PP_ALIGN.LEFT):
    tb=s.shapes.add_textbox(l,t,w,h); tf=tb.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=tx; p.font.size=Pt(sz); p.font.bold=b; p.font.color.rgb=c; p.font.name="Calibri"; p.alignment=a
    return tb

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
    except Exception as e: print("morph",e)

_uid=[10]
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

def animate(slide, shape, delay_ms=0, dur_ms=600, filt="fade"):
    try:
        lst=ensure_seq(slide)
        _uid[0]+=1; i1=_uid[0]; _uid[0]+=1; i2=_uid[0]; _uid[0]+=1; i3=_uid[0]; _uid[0]+=1; i4=_uid[0]
        spid=str(shape.shape_id)
        par=etree.SubElement(lst,f"{{{P}}}par")
        ctn=etree.SubElement(par,f"{{{P}}}cTn",id=str(i1),fill="hold")
        st=etree.SubElement(ctn,f"{{{P}}}stCondLst"); etree.SubElement(st,f"{{{P}}}cond",delay="indef")
        ch=etree.SubElement(ctn,f"{{{P}}}childTnLst")
        par2=etree.SubElement(ch,f"{{{P}}}par")
        c2=etree.SubElement(par2,f"{{{P}}}cTn",id=str(i2),fill="hold")
        st2=etree.SubElement(c2,f"{{{P}}}stCondLst"); etree.SubElement(st2,f"{{{P}}}cond",delay=str(delay_ms))
        ch2=etree.SubElement(c2,f"{{{P}}}childTnLst")
        ae=etree.SubElement(ch2,f"{{{P}}}animEffect",transition="in",filter=filt)
        bh=etree.SubElement(ae,f"{{{P}}}cBhvr")
        etree.SubElement(bh,f"{{{P}}}cTn",id=str(i3),dur=str(dur_ms),fill="hold")
        te=etree.SubElement(bh,f"{{{P}}}tgtEl"); etree.SubElement(te,f"{{{P}}}spTgt",spid=spid)
        etree.SubElement(ae,f"{{{P}}}progress",calcmode="lin",value="0")
    except Exception as e: print("anim fail",e)

topicos=[
    {"num":"01","titulo":"ORIGEM","sub":"Ponto a ponto → IBM PC 1981","texto":"• Fios caóticos ponto a ponto, solda manual.\n• 1981 IBM PC 5150: trilhas de cobre impressas.\n• Isolantes fenólicos → epóxi.","img":"ibm_pc_small.jpg","video":"Origem — fios vs IBM PC","cor":COPPER},
    {"num":"02","titulo":"LINHA DO TEMPO","sub":"1950 → 1981 → 1995 → 2006","texto":"• 1950 Fenolite • 1981 IBM PC\n• 1995 ATX multicamadas\n• 2006 RoHS proíbe chumbo.","img":"vec_tempo.jpg","video":"Linha do tempo animada","cor":GREEN},
    {"num":"03","titulo":"SUBSTRATO","sub":"Fenolite vs FR-4","texto":"• Fenolite: papel + fenólica, frágil, Tg 120°C.\n• FR-4: fibra vidro + epóxi bromada V-0, Tg 180°C.","img":"fr4.jpg","video":"Fenolite × FR-4 micro","cor":GOLD},
    {"num":"04","titulo":"CONDUTORES","sub":"Cu trilhas • Au contatos","texto":"• Cu: 5,96×10⁷ S/m, oxida.\n• Au ENIG 0,05µm: inerte, não oxida.","img":"vec_cobre.jpg","video":"Cobre + ouro","cor":GOLD},
    {"num":"05","titulo":"SOLDA","sub":"Sn-Pb → SAC RoHS","texto":"• Sn-Pb 183°C tóxico (saturnismo).\n• SAC305 Sn/Ag/Cu 217°C ecológica.","img":"vec_solda.jpg","video":"Solda + RoHS","cor":GREEN},
    {"num":"06","titulo":"DESEMPENHO","sub":"Multicamadas = GHz","texto":"• Distâncias mm, plano terra, menos ruído.\n• MHz → GHz + PCIe 5.0.","img":"vec_desemp.jpg","video":"Velocidade multicamadas","cor":COPPER},
    {"num":"07","titulo":"TABELA","sub":"Comparativa","texto":"Fenolite × FR-4 / Sn-Pb × SAC.\nPropriedades e limitações.","img":"vec_ouro.jpg","video":"Tabela animada","cor":GREEN,"tabela":True},
    {"num":"08","titulo":"FUTURO","sub":"Bioplaca • Bio-Au • Grafeno","texto":"• Celulose compostável.\n• Bactérias recuperam Au.\n• Grafeno 5000 W/mK.","img":"vec_futuro.jpg","video":"Futuro verde","cor":GOLD},
]

# HUB
hub=prs.slides.add_slide(blank); set_bg(hub); morph(hub,1400)
t1=txt(hub,Inches(0.5),Inches(0.3),Inches(7),Inches(0.9),"A QUÍMICA DAS PLACAS-MÃE",30,True,BEGE)
t2=txt(hub,Inches(0.5),Inches(1.05),Inches(7),Inches(0.5),"Evolução dos Materiais • EQUIPE 7",15,False,GREEN)
animate(hub,t1,0,700,"fade"); animate(hub,t2,200,700,"fly")
# imagem central vidro
pic=hub.shapes.add_picture(os.path.join(IMG,"ibm_pc_small.jpg"),Inches(4.2),Inches(1.7),Inches(5.0),Inches(3.4))
animate(hub,pic,300,900,"zoom")
frame=hub.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(4.2),Inches(1.7),Inches(5.0),Inches(3.4))
frame.fill.background(); frame.line.color.rgb=WHITE; frame.line.width=Pt(2); frame.name="!!HUB_CENTRO"
# cards glass em volta
pos=[(0.4,1.8),(0.4,3.2),(0.4,4.6),(9.6,1.8),(9.6,3.2),(9.6,4.6),(3.4,5.5),(6.9,5.5)]
for i,t in enumerate(topicos):
    x,y=pos[i]
    c=hub.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(x),Inches(y),Inches(3.1),Inches(0.95))
    glass(c); c.name=f"!!CARD_{t['num']}_{t['titulo']}"
    tf=c.text_frame; tf.word_wrap=True
    p=tf.paragraphs[0]; p.text=f"{t['num']}  {t['titulo']}"; p.font.size=Pt(12); p.font.bold=True; p.font.color.rgb=RGBColor(0x0B,0x1D,0x2A); p.font.name="Calibri"; p.alignment=PP_ALIGN.CENTER
    q=tf.add_paragraph(); q.text=t["sub"]; q.font.size=Pt(9); q.font.color.rgb=RGBColor(0x33,0x4A,0x55); q.font.name="Calibri"; q.alignment=PP_ALIGN.CENTER
    animate(hub,c,400+i*120,600,"fly")
txt(hub,Inches(0.5),Inches(6.6),Inches(12.3),Inches(0.4),"Morph 1,2s • clique = zoom no card → 50/50 texto+vídeo loop → fullscreen → volta",10,False,GRAY,PP_ALIGN.CENTER)

for t in topicos:
    sa=prs.slides.add_slide(blank); set_bg(sa); morph(sa)
    tt=txt(sa,Inches(0.4),Inches(0.15),Inches(12.5),Inches(0.6),f"{t['num']}  {t['titulo']}  •  {t['sub']}",20,True,BEGE); animate(sa,tt,0,600,"fly")
    badge=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.4),Inches(0.85),Inches(2.4),Inches(0.5))
    glass(badge); badge.name=f"!!CARD_{t['num']}_{t['titulo']}"
    badge.text_frame.word_wrap=True; badge.text_frame.paragraphs[0].text=f"{t['num']} {t['titulo']}"; badge.text_frame.paragraphs[0].font.size=Pt(13); badge.text_frame.paragraphs[0].font.bold=True; badge.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER
    animate(sa,badge,150,500,"fade")
    # vidro texto esquerda
    lb=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(0.4),Inches(1.55),Inches(5.7),Inches(5.0))
    glass(lb, fill_alpha=30000)
    tf=lb.text_frame; tf.word_wrap=True
    a=tf.paragraphs[0]; a.text=t["sub"]; a.font.size=Pt(15); a.font.bold=True; a.font.color.rgb=RGBColor(0x0B,0x1D,0x2A); a.font.name="Calibri"
    b=tf.add_paragraph(); b.text="\n"+t["texto"]; b.font.size=Pt(12); b.font.color.rgb=RGBColor(0x1A,0x2E,0x38); b.font.name="Calibri"
    animate(sa,lb,250,600,"fly")
    if t.get("tabela"):
        tsh=sa.shapes.add_table(5,3,Inches(0.6),Inches(4.3),Inches(5.3),Inches(1.9))
        tbl=tsh.table
        hdr=["Propriedade","Fenolite / Sn-Pb","FR-4 / SAC"]
        dados=[["Substrato","Papel+fenólica","Fibra+epóxi V-0"],["T máx/Fusão","120°C / 183°C Pb","180°C / 217°C"],["Camadas","1, absorve água","4-12 estável"],["Limite","Frágil / Tóxico","Caro / forno quente"]]
        for j,h in enumerate(hdr):
            c=tbl.cell(0,j); c.text=h
            for par in c.text_frame.paragraphs: par.font.size=Pt(9); par.font.bold=True; par.font.color.rgb=WHITE
            c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0x0B,0x1D,0x2A)
        for i,row in enumerate(dados,start=1):
            for j,v in enumerate(row):
                c=tbl.cell(i,j); c.text=v
                for par in c.text_frame.paragraphs: par.font.size=Pt(8)
                c.fill.solid(); c.fill.fore_color.rgb=RGBColor(0xE8,0xF5,0xE9) if i%2==0 else WHITE
    # imagem específica + video placeholder direita (vidro)
    imgp=os.path.join(IMG,t["img"])
    imp=sa.shapes.add_picture(imgp,Inches(6.7),Inches(1.55),Inches(5.9),Inches(3.2))
    animate(sa,imp,350,700,"zoom")
    vb=sa.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(6.7),Inches(4.95),Inches(5.9),Inches(1.6))
    glass(vb, fill_alpha=18000)
    tf=vb.text_frame; tf.word_wrap=True; tf.paragraphs[0].alignment=PP_ALIGN.CENTER
    p=tf.paragraphs[0]; p.text=f"▶  {t['video']}  •  LOOP"; p.font.size=Pt(13); p.font.bold=True; p.font.color.rgb=RGBColor(0x0B,0x3D,0x24); p.font.name="Calibri"
    q=tf.add_paragraph(); q.text="Inserir > Vídeo > Automático + Repetir até parar + Tela cheia"; q.font.size=Pt(10); q.font.color.rgb=RGBColor(0x44,0x5A,0x64); q.font.name="Calibri"; q.alignment=PP_ALIGN.CENTER
    animate(sa,vb,500,600,"fade")
    # video fullscreen
    sb=prs.slides.add_slide(blank); set_bg(sb); morph(sb)
    txt(sb,Inches(0.5),Inches(0.2),Inches(12.3),Inches(0.6),f"{t['num']} {t['titulo']} — VÍDEO LOOP TELA CHEIA",18,True,GREEN,PP_ALIGN.CENTER)
    big=sb.shapes.add_picture(imgp,Inches(0.7),Inches(1.0),Inches(11.9),Inches(5.4))
    animate(sb,big,100,900,"zoom")
    txt(sb,Inches(0.5),Inches(6.6),Inches(12.3),Inches(0.4),"Troque a imagem pelo vídeo real: Automático + Loop + Tela cheia",11,False,GRAY,PP_ALIGN.CENTER)

sf=prs.slides.add_slide(blank); set_bg(sf); morph(sf)
txt(sf,Inches(0.5),Inches(0.3),Inches(12.3),Inches(0.8),"OBRIGADO!  •  EQUIPE 7",30,True,BEGE,PP_ALIGN.CENTER)
txt(sf,Inches(0.5),Inches(1.1),Inches(12.3),Inches(0.5),"Fenolite → FR-4  •  Cu/Au  •  Sn-Pb → SAC  •  Futuro verde",14,False,GREEN,PP_ALIGN.CENTER)
pic2=sf.shapes.add_picture(os.path.join(IMG,"vec_futuro.jpg"),Inches(4.2),Inches(1.8),Inches(5.0),Inches(3.2))
fr2=sf.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(4.2),Inches(1.8),Inches(5.0),Inches(3.2))
fr2.fill.background(); fr2.line.color.rgb=WHITE; fr2.line.width=Pt(2); fr2.name="!!HUB_CENTRO"
for i,t in enumerate(topicos):
    x,y=pos[i]
    c=sf.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(x),Inches(y),Inches(3.1),Inches(0.95))
    glass(c); c.name=f"!!CARD_{t['num']}_{t['titulo']}"
    c.text_frame.word_wrap=True; c.text_frame.paragraphs[0].text=f"{t['num']}  {t['titulo']}"; c.text_frame.paragraphs[0].font.size=Pt(12); c.text_frame.paragraphs[0].font.bold=True; c.text_frame.paragraphs[0].alignment=PP_ALIGN.CENTER

out=os.path.expanduser("~/Downloads/Quimica-das-Placas-Mae-Equipe7-GLASS.pptx")
prs.save(out)
print(f"OK {out} {len(prs.slides._sldIdLst)} slides")
