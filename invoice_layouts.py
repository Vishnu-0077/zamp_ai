"""Supplier-specific invoice stationery and image-only scan transport."""
import io
import random
import pymupdf
from PIL import Image, ImageEnhance, ImageFilter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

SCAN_IDS = {3, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 43, 47}
STYLES = {
    'V001': ('northstar-navy', '#18364c', 'Helvetica', 'Helvetica-Bold'),
    'V002': ('harbor-teal', '#087e8b', 'Helvetica', 'Helvetica-Bold'),
    'V003': ('cedar-traditional', '#3c5236', 'Times-Roman', 'Times-Bold'),
    'V004': ('summit-dispatch', '#333333', 'Courier', 'Courier-Bold'),
    'V005': ('brightline-editorial', '#a73556', 'Helvetica', 'Helvetica-Bold'),
    'UNKNOWN': ('apex-basic', '#555555', 'Helvetica', 'Helvetica-Bold'),
}


def render(fields, vendor_id, reissued=False):
    style, accent, regular, bold = STYLES[vendor_id]
    out = io.BytesIO()
    p = canvas.Canvas(out, pagesize=(612, 792), invariant=1)
    p.setTitle('Invoice ' + fields.get('number', ''))
    def text(x, y, value, size=10, strong=False, color='#243242', right=False):
        p.setFont(bold if strong else regular, size)
        p.setFillColor(HexColor(color))
        (p.drawRightString if right else p.drawString)(x, y, str(value))
    def rect(x,y,w,h,color):
        p.setFillColor(HexColor(color)); p.rect(x,y,w,h,fill=1,stroke=0)
    def line(y, color='#d4dae0'):
        p.setStrokeColor(HexColor(color)); p.setLineWidth(.6); p.line(42,y,570,y)
    def money(key):
        return f"{fields.get('currency', '')} {fields[key]:,.2f}".strip()
    # The layout is chosen by vendor, never by individual invoice ID.
    if vendor_id == 'V001':
        rect(0,682,612,110,accent)
        text(42,744,'N /',27,True,'#ffffff')
        text(108,744,fields['vendor'],21,True,'#ffffff')
        text(108,720,'WORKPLACE ESSENTIALS',9,False,'#c8dde9')
        text(570,646,'INVOICE',25,True,accent,True)
    elif vendor_id == 'V002':
        rect(0,0,16,792,accent)
        text(42,742,'HARBOR',31,True,accent)
        text(43,722,'IT SERVICES  /  MANAGED SOLUTIONS',9)
        text(570,743,'INVOICE',24,True,accent,True)
        line(700,accent)
    elif vendor_id == 'V003':
        # Centered traditional letterhead.
        p.setFont(bold,29); p.setFillColor(HexColor(accent))
        p.setFillColor(HexColor(accent)); p.drawCentredString(306,745,fields['vendor'])
        p.setFont(regular,11); p.drawCentredString(306,721,'Commercial cleaning & property care')
        line(701,accent); text(42,666,'INVOICE',20,True,accent)
    elif vendor_id == 'V004':
        text(42,746,'SUMMIT PACKAGING',23,True,accent)
        text(42,724,'WAREHOUSE / CUSTOMER ACCOUNTS',10)
        text(42,697,'================================================',10)
        text(42,669,'SALES INVOICE / DISPATCH COPY',14,True)
    elif vendor_id == 'V005':
        rect(42,728,52,30,accent)
        text(48,737,'BL.',19,True,'#ffffff')
        text(108,738,fields['vendor'],23,True,accent)
        text(108,718,'PRINT  /  DESIGN  /  PRODUCTION',9)
        text(42,657,'Invoice.',37,True,accent)
        line(698,accent)
    else:
        text(42,745,fields['vendor'],24,True)
        text(42,708,'COMMERCIAL INVOICE',18,True)
    if vendor_id in ('V003', 'V004'):
        if vendor_id == 'V003':
            # A small contractor's letter-style invoice, without a product grid.
            y=629
            for key,label in [('number','Invoice reference'),('date','Date'),('due_date','Payment due'),('po','Your order')]:
                if key in fields:
                    text(42,y,label+': '+fields[key],12); y-=23
            text(42,501,'To: Example Manufacturing Ltd / Accounts Payable',12)
            text(42,478,'200 Foundry Lane, Portland, OR 97205',10)
            line(454,accent)
            text(42,425,'Charges for services provided',15,True,accent)
            text(42,394,fields['description'],12)
            text(42,365,f"{fields['quantity']} visits at {money('unit_price')} per visit",12)
            text(42,315,'Service charges',12); text(360,315,money('subtotal'),12,right=True)
            text(42,287,'Tax at 10%',12); text(360,287,money('tax'),12,right=True)
            if 'total' in fields:
                line(269,accent)
                text(42,244,'Total payable',15,True,accent); text(360,244,money('total'),15,True,accent,True)
            text(42,197,'Terms: '+fields['terms'],11)
            y=159
            for key in ('contact','address','phone'):
                if key in fields: text(42,y,fields[key],10); y-=18
        else:
            # A dense warehouse export with fixed-width rows and remittance slip.
            y=626
            for key,label in [('number','DOC NO'),('date','DOC DATE'),('due_date','DUE'),('po','CUSTOMER ORDER')]:
                if key in fields: text(42,y,f'{label:16} {fields[key]}',11); y-=19
            text(42,525,'SOLD TO: EXAMPLE MANUFACTURING LTD',11,True)
            text(42,507,'         ACCOUNTS PAYABLE / PORTLAND',10)
            for y in (483,442,365): line(y,accent)
            text(42,461,'QTY   DESCRIPTION                         RATE    VALUE',9,True)
            text(42,418,f"{fields['quantity']:3}   {fields['description']}",10)
            text(455,391,f"{fields['unit_price']:,.2f}",10,right=True)
            text(570,391,f"{fields['subtotal']:,.2f}",10,right=True)
            text(42,337,'GOODS VALUE',11); text(570,337,money('subtotal'),11,right=True)
            text(42,313,'SALES TAX 10%',11); text(570,313,money('tax'),11,right=True)
            if 'total' in fields:
                text(42,278,'INVOICE TOTAL',13,True); text(570,278,money('total'),13,True,right=True)
            text(42,239,'TERMS: '+fields['terms'],10)
            line(208,accent)
            text(42,184,'REMITTANCE ADVICE - QUOTE DOCUMENT NUMBER',10,True)
            text(42,160,fields.get('number',''),11)
            y=134
            for key in ('contact','address','phone'):
                if key in fields: text(42,y,fields[key],9); y-=16
        line(70)
        text(42,51,'Fictional demo invoice - not payable.',8,color='#727c86')
        text(570,51,'Page 1 of 1',8,color='#727c86',right=True)
        p.save()
        return out.getvalue()
    # Fixed supplier address/contact across repeat invoices; omissions stay absent.
    if 'address' in fields:
        text(42,615,fields['address'],9)
    if 'contact' in fields:
        text(42,599,fields['contact'] + ' | Accounts receivable',9)
    if 'phone' in fields:
        text(42,583,fields['phone'],9)
    text(42,546,'BILL TO',9,True,accent)
    text(42,527,'Example Manufacturing Ltd',12,True)
    text(42,510,'Accounts Payable',10)
    text(42,493,'200 Foundry Lane, Portland, OR 97205',9)
    details=[('number','Invoice no.'),('date','Issued'),('due_date','Due date'),('po','Customer PO')]
    for n,(key,label) in enumerate(details):
        if key in fields:
            text(348,613-n*25,label,9)
            text(570,613-n*25,fields[key],10,True,right=True)
    if reissued:
        text(570,493,'COPY - original invoice reference retained',8,color=accent,right=True)
    if vendor_id == 'V004':
        # Plain monospaced export, not a modern billing app table.
        line(464,accent)
        text(42,445,'ITEM / DESCRIPTION',10,True)
        text(360,445,'QTY',10,True)
        text(456,445,'RATE',10,True,right=True)
        text(570,445,'EXTENSION',10,True,right=True)
    else:
        rect(42,428,528,35,accent)
        text(54,441,'DESCRIPTION',9,True,'#ffffff')
        text(368,441,'QTY',9,True,'#ffffff',True)
        text(460,441,'UNIT PRICE',9,True,'#ffffff',True)
        text(558,441,'AMOUNT',9,True,'#ffffff',True)
    # Wrap item description before numeric columns.
    words=fields['description'].split(); parts=[]; current=''
    for word in words:
        proposed=(current+' '+word).strip()
        if p.stringWidth(proposed,regular,10)>275:
            parts.append(current); current=word
        else:
            current=proposed
    parts.append(current)
    for n,part in enumerate(parts): text(54,406-n*16,part,10)
    text(368,406,fields['quantity'],10,right=True)
    text(460,406,f"{fields['unit_price']:,.2f}",10,right=True)
    text(558,406,f"{fields['subtotal']:,.2f}",10,right=True)
    line(366)
    text(350,337,'Subtotal',10); text(558,337,money('subtotal'),10,right=True)
    text(350,311,'Tax (10%)',10); text(558,311,money('tax'),10,right=True)
    if 'total' in fields:
        rect(336,250,234,40,'#edf1f4')
        text(348,265,'AMOUNT DUE',11,True,accent)
        text(558,265,money('total'),13,True,accent,True)
    if 'currency' in fields:
        text(558,228,'Currency: '+fields['currency'],9,right=True)
    text(42,195,'PAYMENT TERMS',9,True,accent)
    text(42,176,fields['terms'],10)
    text(42,154,'Please use your agreed payment method and quote the invoice reference.',9)
    text(42,129,'Thank you for your business.',11,True,accent)
    line(70)
    text(42,51,'Fictional demo invoice - not payable.',8,color='#727c86')
    text(570,51,'Page 1 of 1',8,color='#727c86',right=True)
    p.save()
    return out.getvalue()


def scan_pdf(data, idx):
    """Rasterize every mark, including the footer; add no hidden text layer."""
    with pymupdf.open(stream=data, filetype='pdf') as doc:
        pix=doc[0].get_pixmap(dpi=180, colorspace=pymupdf.csGRAY)
        image=Image.frombytes('L',(pix.width,pix.height),pix.samples)
    # Mild transport variation retains all fields at readable resolution.
    variation=idx % 3
    if variation == 1:
        image=ImageEnhance.Contrast(image).enhance(.88)
        image=image.rotate(.65, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=255)
    elif variation == 2:
        image=image.filter(ImageFilter.GaussianBlur(.35))
        rng=random.Random(idx)
        pixels=image.load()
        for _ in range(2200):
            x,y=rng.randrange(image.width),rng.randrange(image.height)
            pixels[x,y]=max(0,pixels[x,y]-rng.randrange(8,35))
    out=io.BytesIO()
    image.convert('RGB').save(out,'PDF',resolution=180,quality=90)
    return out.getvalue()
