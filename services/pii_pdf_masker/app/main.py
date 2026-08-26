from __future__ import annotations
import hmac,json,os
from fastapi import Depends,FastAPI,File,Form,Header,HTTPException,UploadFile
from fastapi.responses import Response
from .redactor import RedactionError,redact_pdf

app=FastAPI(title='Chutjul private PDF PII masker',docs_url=None,redoc_url=None)
API_KEY=os.environ.get('MASKER_API_KEY','')
MAX_MB=int(os.environ.get('MAX_UPLOAD_MB','100'))
MAX_PAGES=int(os.environ.get('MAX_PAGES','300'))

def authorize(authorization:str|None=Header(None)):
    supplied=authorization.removeprefix('Bearer ').strip() if authorization else ''
    if not API_KEY or not hmac.compare_digest(supplied,API_KEY): raise HTTPException(401,'Unauthorized')
def terms(raw):
    try: value=json.loads(raw)
    except json.JSONDecodeError as exc: raise HTTPException(400,'Invalid custom_terms_json') from exc
    if not isinstance(value,list) or not all(isinstance(x,str) for x in value): raise HTTPException(400,'Invalid custom_terms_json')
    return value

@app.get('/health')
def health(): return {'status':'ok'}
@app.post('/v1/mask',dependencies=[Depends(authorize)])
async def mask(file:UploadFile=File(...),custom_terms_json:str=Form('[]')):
    if file.content_type not in {'application/pdf','application/octet-stream'}: raise HTTPException(415,'Only PDF uploads are supported.')
    body=await file.read(MAX_MB*1024*1024+1)
    if len(body)>MAX_MB*1024*1024: raise HTTPException(413,f'File exceeds {MAX_MB} MB.')
    try: result=redact_pdf(body,custom_terms=terms(custom_terms_json),max_pages=MAX_PAGES)
    except RedactionError as exc: raise HTTPException(422,str(exc)) from exc
    return Response(result.pdf_bytes,media_type='application/pdf',headers={'X-Redaction-Count':str(result.detection_count),'Cache-Control':'no-store'})
