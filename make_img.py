#!/usr/bin/env python3
"""Gera imagem central estilo placa-mae para overview tipo Prezi Espartana"""
from PIL import Image, ImageDraw
import random
W,H = 900,1000
img = Image.new("RGB",(W,H),"#122419")
d = ImageDraw.Draw(img)
# placa verde central
d.rounded_rectangle([120,80,780,920], radius=40, fill="#0E4D2E", outline="#00E676", width=6)
# trilhas cobre
random.seed(7)
for _ in range(60):
    x1 = random.randint(150,750); y1 = random.randint(120,880)
    x2 = x1 + random.choice([-120,-60,60,120]); y2 = y1 + random.choice([-80,0,80])
    d.line([x1,y1,x2,y1], fill="#C97B2D", width=5)
    d.line([x2,y1,x2,y2], fill="#C97B2D", width=5)
    d.ellipse([x2-12,y2-12,x2+12,y2+12], fill="#FFD54F", outline="#7A4A12", width=3)
# chips pretos
for (x,y,w,h) in [(300,250,180,120),(380,550,220,140),(250,730,140,90)]:
    d.rounded_rectangle([x,y,x+w,y+h], radius=10, fill="#0A0A0A", outline="#8A9BA6", width=3)
    d.text((x+20,y+30),"CPU", fill="#00E676")
# slots ouro
for i in range(4):
    y=150+i*70
    d.rectangle([620,y,740,y+30], fill="#FFD54F", outline="#7A4A12", width=2)
d.text((150,900),"QUIMICA DAS PLACAS", fill="#E8DCC4")
img.save("/home/tork/Projetos/canivete/placa_central.png")
print("OK placa_central.png", img.size)
