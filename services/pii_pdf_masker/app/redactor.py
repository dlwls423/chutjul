from __future__ import annotations
import io
from dataclasses import dataclass
import pymupdf
from .detector import detect_pii

class RedactionError(ValueError): pass
@dataclass
class RedactionResult:
    pdf_bytes: bytes
    detection_count: int

def redact_pdf(source, custom_terms=None, mask_text='[REDACTED]', max_pages=100):
    terms=custom_terms or []
    if not source.startswith(b'%PDF-'): raise RedactionError('The uploaded file is not a PDF.')
    try: doc=pymupdf.open(stream=source,filetype='pdf')
    except Exception as exc: raise RedactionError('The PDF is invalid or unsupported.') from exc
    with doc:
        if doc.needs_pass: raise RedactionError('Password-protected PDFs are not supported.')
        if doc.page_count>max_pages: raise RedactionError(f'PDF exceeds the {max_pages}-page limit.')
        count=0
        for number,page in enumerate(doc):
            text=page.get_text('text',sort=True)
            if not text.strip() and page.get_images(full=True): raise RedactionError(f'Page {number+1} is image-only; OCR or manual review is required.')
            detected=detect_pii(text,terms);count+=len(detected);seen=set()
            for item in detected:
                for rect in page.search_for(item.text,quads=False):
                    key=tuple(round(x,2) for x in rect)
                    if key in seen: continue
                    seen.add(key);page.add_redact_annot(rect,text=mask_text,fontname='helv',fontsize=max(5,min(9,rect.height*.55)),fill=(0,0,0),text_color=(1,1,1),cross_out=False)
            if detected: page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS,graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED)
        doc.set_metadata({})
        for index in reversed(range(doc.embfile_count())): doc.embfile_del(index)
        for page in doc: page.clean_contents(sanitize=True)
        output=io.BytesIO();doc.save(output,garbage=4,clean=True,deflate=True,encryption=pymupdf.PDF_ENCRYPT_NONE)
    result=output.getvalue()
    with pymupdf.open(stream=result,filetype='pdf') as check: remaining=detect_pii('\n'.join(p.get_text('text') for p in check),terms)
    if remaining: raise RedactionError(f'Redaction verification failed: {sorted({x.kind for x in remaining})}')
    return RedactionResult(result,count)
