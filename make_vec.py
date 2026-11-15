#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont
import os
D=os.path.expanduser("~/Downloads/ppt_imgs")
def font(sz):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf","/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"]:
        if os.path.exists(p):
            from PIL import ImageFont as F
            return F.truetype(p,sz)
    from PIL import ImageFont as F
    return F.load_default()

def save_vec(name, draw_fn, size=(900,650), bg="#0E2A1E"):
    im=Image.new("RGB",size,bg); d=ImageDraw.Draw(im)
    draw_fn(d,size)
    fp=os.path.join(D,name); im.save(fp, quality=90); print(name, im.size)

def d_cobre(d,s):
    W,H=s
    d.rectangle([0,0,W,H],fill="#0B3D24")
    for i in range(7):
        y=60+i*80
        d.line([40,y,W-40,y],fill="#C97B2D",width=10)
        for x in range(120,W-60,160):
            d.ellipse([x-14,y-14,x+14,y+14],fill="#FFD54F",outline="#7A4A12",width=3)
    d.text((40,20),"Cu • TRILHAS DE COBRE",fill="#FFFFFF",font=font(30))

def d_ouro(d,s):
    W,H=s
    d.rectangle([0,0,W,H],fill="#10202E")
    for i in range(6):
        x=80+i*120
        d.rectangle([x,180,x+80,480],fill="#FFD54F",outline="#7A4A12",width=4)
        d.text((x+8,490),f"P{i+1}",fill="white",font=font(22))
    d.text((80,60),"Au • CONTATOS OURO ENIG",fill="white",font=font(30))
    d.text((80,110),"inerte • nao oxida",fill="#FFD54F",font=font(24))

def d_solda(d,s):
    W,H=s
    d.rectangle([0,0,W//2,H],fill="#3A1212"); d.rectangle([W//2,0,W,H],fill="#0E3A1E")
    d.text((40,40),"Sn-Pb 183C",fill="#FF8A80",font=font(34)); d.text((40,90),"TOXICO Pb",fill="white",font=font(28))
    d.ellipse([120,250,380,510],fill="#B0BEC5",outline="#FF5252",width=8)
    d.text((W//2+40,40),"SAC 217C",fill="#69F0AE",font=font(34)); d.text((W//2+40,90),"Sn Ag Cu RoHS",fill="white",font=font(28))
    d.ellipse([W//2+120,250,W//2+380,510],fill="#ECEFF1",outline="#00E676",width=8)

def d_tempo(d,s):
    W,H=s
    d.rectangle([0,0,W,H],fill="#1A2332")
    d.line([60,330,W-60,330],fill="#00E676",width=6)
    items=[("1950","Fenolite"),("1981","IBM PC"),("1995","ATX multi"),("2006","RoHS")]
    for i,(a,b) in enumerate(items):
        x=110+i*220
        d.ellipse([x-40,290,x+40,370],fill="#FFD54F",outline="white",width=4)
        d.text((x-40,390),a,fill="white",font=font(28)); d.text((x-70,430),b,fill="#69F0AE",font=font(24))

def d_desemp(d,s):
    W,H=s
    d.rectangle([0,0,W,H],fill="#241A30")
    for i in range(4):
        y=140+i*110
        d.rounded_rectangle([80,y,W-80,y+70],radius=15,fill="#2E3B4E",outline="#00E676",width=3)
        d.text((110,y+15),f"Camada {i+1} • GND/Sinal",fill="white",font=font(26))
    d.text((80,40),"MULTICAMADAS MHz->GHz",fill="white",font=font(28))

def d_futuro(d,s):
    W,H=s
    d.rectangle([0,0,W,H],fill="#0E2A24")
    for x in range(100,W-60,90):
        for y in range(150,H-60,80):
            d.ellipse([x,y,x+50,y+50],fill="#69F0AE",outline="white",width=2)
            if x+90<W: d.line([x+50,y+25,x+90,y+25],fill="white",width=2)
    d.text((60,40),"GRAFENO • CELULOSE • BIO-Au",fill="white",font=font(28))

save_vec("vec_cobre.jpg",d_cobre)
save_vec("vec_ouro.jpg",d_ouro)
save_vec("vec_solda.jpg",d_solda)
save_vec("vec_tempo.jpg",d_tempo)
save_vec("vec_desemp.jpg",d_desemp)
save_vec("vec_futuro.jpg",d_futuro)
