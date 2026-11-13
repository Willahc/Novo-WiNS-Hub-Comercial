# gerar-proposta.py — Construtora Rodrigues Santos
# Gera proposta.pdf (2 págs) conforme skill proposta-pdf + pdf (Anthropic).
# Uso: python gerar-proposta.py

import os
from datetime import date, timedelta
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate, Paragraph,
                                 Spacer, Table, TableStyle, HRFlowable)

# ── paleta (do contexto.md): verde-musgo + grafite + off-white ────────────────
VERDE      = HexColor("#3D6B45")
VERDE_ESC  = HexColor("#2A4A30")
GRAFITE    = HexColor("#14181A")
OFF        = HexColor("#FAF8F5")
CINZA      = HexColor("#5A6360")
VERDE_CLARO= HexColor("#EDF3EE")

HOJE = date.today()
VALIDADE = HOJE + timedelta(days=7)
d = lambda v: v.strftime("%d/%m/%Y")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proposta.pdf")

# Seus dados vêm de meus-dados.json (na pasta do cliente ou na raiz agencia-ia\).
# Preencha UMA vez e toda proposta futura nasce com eles.
def _meus_dados():
    d = os.path.dirname(os.path.abspath(__file__))
    for caminho in [
        os.path.join(d, "meus-dados.json"),
        os.path.join(d, "..", "..", "meus-dados.json"),
    ]:
        if os.path.exists(caminho):
            with open(caminho, encoding="utf-8") as f:
                import json
                return json.load(f)
    return {}

_MEUS = _meus_dados()
SEU_NOME  = _MEUS.get("nome", "[SEU NOME]")
TEU_TEL   = _MEUS.get("telefone", "[SEU TELEFONE / WHATSAPP]")
CHAVE_PIX = _MEUS.get("pix", "[SUA CHAVE PIX]")

# ── estilos ──────────────────────────────────────────────────────────────────
def st(name, **kw):
    base = dict(fontName="Helvetica", fontSize=10, leading=14, textColor=GRAFITE)
    base.update(kw)
    return ParagraphStyle(name, **base)

sT1    = st("t1",  fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=white)
sT2    = st("t2",  fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=VERDE_ESC)
sTxt   = st("txt", fontSize=9.5, leading=13.5, textColor=GRAFITE, alignment=TA_JUSTIFY)
sSmall = st("small", fontSize=8.5, leading=11.5, textColor=CINZA)
sCell  = st("cell", fontSize=9, leading=12, textColor=GRAFITE)
sCellB = st("cellB", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=GRAFITE)
sCellW = st("cellW", fontName="Helvetica-Bold", fontSize=9.5, leading=12, textColor=white)
sFlag  = st("flag", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=white, alignment=TA_CENTER)
sPreco = st("preco", fontName="Helvetica-Bold", fontSize=15, leading=18, textColor=VERDE_ESC, alignment=TA_CENTER)
sOpt   = st("opt", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=GRAFITE, alignment=TA_CENTER)

# ── fundo de página: capa verde no topo + rodapé ────────────────────────────
def fundo(canv, doc):
    canv.saveState()
    w, h = A4
    # header
    canv.setFillColor(GRAFITE)
    canv.rect(0, h - 110, w, 110, fill=1, stroke=0)
    canv.setFillColor(white)
    canv.setFont("Helvetica-Bold", 13)
    canv.drawString(50, h - 58, "CONSTRUTORA RODRIGUES SANTOS")
    canv.setFont("Helvetica", 9)
    canv.setFillColor(HexColor("#A3C9AA"))
    canv.drawString(50, h - 74, "PROPOSTA COMERCIAL — Evolução da presença digital")
    canv.drawString(50, h - 88, f"Mogi Guaçu · SP — emitida em {d(HOJE)} · válida até {d(VALIDADE)}")
    canv.setFillColor(VERDE)
    canv.rect(0, h - 118, w, 8, fill=1, stroke=0)
    # footer
    canv.setFillColor(GRAFITE)
    canv.rect(0, 0, w, 42, fill=1, stroke=0)
    canv.setFillColor(HexColor("#A3C9AA"))
    canv.setFont("Helvetica", 7.5)
    canv.drawString(50, 27, f"Elaborada por: {SEU_NOME}  ·  {TEU_TEL}")
    canv.drawString(50, 17, f"Contato comercial do cliente: Anderson Silva · (11) 98348-5444 · comercial@construtorarodriguessantos.com.br")
    canv.setFillColor(VERDE)
    canv.rect(0, 42, w, 3, fill=1, stroke=0)
    canv.restoreState()

doc = BaseDocTemplate(OUT, pagesize=A4,
                      topMargin=135, bottomMargin=60, leftMargin=50, rightMargin=50)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=fundo)])

story = []

# ── 1. Diagnóstico ──────────────────────────────────────────────────────────
story.append(Paragraph("1. Diagnóstico — o que impacta a construtora hoje", sT2))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "A Construtora Rodrigues Santos <b>já tem um forte portfólio</b> — Heineken, "
    "PepsiCo, Hydro, Eucatex e SAAE são provas de padrão industrial que poucos "
    "concorrentes na região têm. O ponto é que esse portfólio <b>não está "
    "exposto</b> na frente de quem pesquisa:", sTxt))
story.append(Spacer(1, 4))
for item in [
    "Site atual hospedado em endereço de terceiros (<i>willahc.github.io</i>) — passa pouca "
    "autoridade para um gerente industrial ou engenheiro de compras;",
    "Sem domínio próprio: quem busca <b>\"construtora Mogi Guaçu\"</b> ou <b>\"manutenção "
    "industrial Sorocaba\"</b> não encontra a empresa competindo na primeira página;",
    "Página sem foco em conversão: orçamento exige formulário completo em "
    "computador, enquanto a maioria decide por celular no WhatsApp;",
    "Google Business Profile sem as fotos das obras — perde o aparecimento "
    "no Maps, onde síndicos e PMEs buscam na hora.",
]:
    story.append(Paragraph(f"• {item}", sCell))
story.append(Spacer(1, 8))
story.append(HRFlowable(width="100%", thickness=0.8, color=VERDE, spaceAfter=8))

# ── 2. Solução proposta ────────────────────────────────────────────────────
story.append(Paragraph("2. Solução proposta", sT2))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Publicação da <b>versão nova do site</b> já desenvolvida como "
    "demonstração — abertura com equipe em campo e logos dos clientes "
    "industriais, galeria das obras executadas, botão de WhatsApp com "
    "mensagem pré-preenchida por tipo de serviço — adicionais de domínio "
    "próprio e presença local no Google.", sTxt))
story.append(Spacer(1, 8))

# ── 3. Comparativo das 3 opções (página 1) ─────────────────────────────────
story.append(Paragraph("3. Investimento — escolha uma opção", sT2))
story.append(Spacer(1, 6))

dados = [
    ["O que está incluso", "Opção 1\nEssencial", "Opção 2\nCompleta ✦", "Opção 3\nCrescimento"],
    ["Site novo (demo já pronta)", "✓", "✓", "✓"],
    ["Domínio próprio (.com.br)", "✓", "✓", "✓"],
    ["WhatsApp com msg pré-preenchida", "✓", "✓", "✓"],
    ["SEO local (Mogi Guaçu / Itu / Sorocaba)", "—", "✓", "✓"],
    ["Google Business Profile + fotos das obras", "—", "✓", "✓"],
    ["Gestão mensal: hospedagem, manutenção,\nfotos novas trimestrais, relatório", "—", "—", "✓"],
]
tabela = Table(dados, colWidths=[None, 100, 100, 100])
tabela.setStyle(TableStyle([
    ("BACKGROUND", (1, 0), (-1, 0), VERDE),
    ("BACKGROUND", (2, 0), (2, 0), VERDE_ESC),
    ("TEXTCOLOR",  (0, 0), (-1, 0), white),
    ("FONTNAME",   (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE",   (0, 0), (-1, 0), 8.5),
    ("FONTNAME",   (0, 1), (-1, -1), "Helvetica"),
    ("FONTSIZE",   (0, 1), (-1, -1), 8.5),
    ("ALIGN",      (1, 1), (-1, -1), "CENTER"),
    ("TEXTCOLOR",  (0, 1), (0, -1), GRAFITE),
    ("GRID",       (0, 0), (-1, -1), 0.5, HexColor("#D9DED9")),
    ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, OFF]),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("BACKGROUND", (2, 1), (2, -1), HexColor("#F0F6F1")),
]))
story.append(tabela)
story.append(Spacer(1, 10))

# linha de preços (ancoragem)
precos = Table([
    [Paragraph("R$ 2.000<br/>à vista", sPreco),
     Paragraph("R$ 3.500<br/>50% + 50% na entrega", sPreco),
     Paragraph("R$ 3.500<br/>+ R$ 700/mês", sPreco)],
    [Paragraph("ESSENCIAL", sFlag), Paragraph("COMPLETA · RECOMENDADA", sFlag), Paragraph("CRESCIMENTO", sFlag)],
], colWidths=[164, 164, 164])
precos.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), VERDE_CLARO),
    ("BACKGROUND", (1, 0), (1, -1), HexColor("#DDEBD9")),
    ("BACKGROUND", (0, 1), (-1, 1), VERDE_ESC),
    ("BACKGROUND", (1, 1), (1, 1), VERDE),
    ("BOX",        (0, 0), (-1, -1), 0.8, VERDE),
    ("INNERGRID",  (0, 0), (-1, -1), 3, white),
    ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 9),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
]))
story.append(precos)
story.append(Spacer(1, 14))

# ── 4. Prazo e garantia (página 2) ──────────────────────────────────────────
story.append(Paragraph("4. Prazo e forma de entrega", sT2))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "<b>Demo pronta para avaliar em 48 horas</b> — a versão nova já existe "
    "(foi construída com as fotos e dados de vocês) e pode ser colocada no ar "
    "hoje para aprovação.<br/><br/>"
    "Entrega final em <b>5 dias úteis</b> após aprovação: domínio configurado, "
    "redirecionamento automático da URL antiga, Google Business atualizado e "
    "detalhes de acabamento. Todo acompanhamento pelo WhatsApp, com relatório "
    "ao final de cada etapa.", sTxt))
story.append(Spacer(1, 12))

story.append(Paragraph("5. Garantia", sT2))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "<b>Ajustes ilimitados</b> até o site ficar exatamente como a construtora "
    "quiser — cores, textos, fotos, ordem das seções. A aprovação de vocês é "
    "o último e único requisito de entrega.", sTxt))
story.append(Spacer(1, 12))

story.append(Paragraph("6. Como aprovar", sT2))
story.append(Spacer(1, 6))
story.append(Paragraph(
    f'1. Responda <b>"opção 2"</b> (ou a opção de sua preferência) no WhatsApp: <b>(11) 98348-5444</b><br/>'
    f"2. Envie <b>50% de entrada</b> via Pix: <b>{CHAVE_PIX}</b><br/>"
    "3. O site de teste entra no ar em até 2 dias úteis para revisão final", sTxt))
story.append(Spacer(1, 14))
story.append(HRFlowable(width="100%", thickness=0.8, color=VERDE, spaceAfter=6))
story.append(Paragraph(
    f"Proposta personalizada para a Construtora Rodrigues Santos · gerada em {d(HOJE)} "
    f"· válida até {d(VALIDADE)} · valores em reais, sem taxa de manutenção "
    "nas opções 1 e 2 · depois da validade, refaço o orçamento conforme agenda.",
    sSmall))

doc.build(story)

pendentes = [r for r, v in [("nome", SEU_NOME), ("telefone", TEU_TEL), ("pix", CHAVE_PIX)]
             if str(v).startswith("[")]
if pendentes:
    print("[AVISO] Preencha meus-dados.json antes de enviar:", ", ".join(pendentes))
    print("        modelo em agencia-ia\\meus-dados.exemplo.json")
print("[OK] proposta.pdf gerado:", os.path.abspath(OUT), f"({os.path.getsize(OUT)} bytes)")
