import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import JSZip from 'jszip';
import { markdownToHwpx } from 'kordoc';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

test('real local HTTP → MCP → kordoc formats and access boundaries', async () => {
  const proc = spawn(process.execPath, ['server.mjs'], {cwd:import.meta.dirname,stdio:['ignore','pipe','pipe']});
  proc.stderr.on('data',()=>{});
  try {
    await once(proc.stdout, 'data');
    const base='http://127.0.0.1:43127'; const origin='http://localhost:3000';
    const denied=await fetch(`${base}/health`,{headers:{Origin:'https://untrusted.invalid'}});
    assert.equal(denied.status,403);
    const health=await fetch(`${base}/health`,{headers:{Origin:origin}}).then(r=>r.json());
    const headers={Origin:origin,'X-Chutjul-Token':health.token,'X-Document-Extension':'docx'};
    assert.equal((await fetch(`${base}/parse`,{method:'POST',headers:{...headers,'X-Chutjul-Token':'invalid'},body:'x'})).status,403);
    assert.equal((await fetch(`${base}/parse`,{method:'POST',headers:{...headers,'X-Document-Extension':'exe'},body:'x'})).status,415);
    const zip=new JSZip(); zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>SYNTHETIC DOCX 개인정보 파기 안내</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>30일</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
    const slides=new JSZip(); slides.file('[Content_Types].xml','<Types/>'); slides.file('ppt/presentation.xml','<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'); slides.file('ppt/slides/slide1.xml','<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>SYNTHETIC PPTX</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>');
    const sheets=new JSZip(); sheets.file('[Content_Types].xml','<Types/>'); sheets.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SYNTHETIC" sheetId="1" r:id="rId1"/></sheets></workbook>'); sheets.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>'); sheets.file('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SYNTHETIC XLSX</t></is></c><c r="B1" t="inlineStr"><is><t>30일</t></is></c></row></sheetData></worksheet>');
    const pdf=await PDFDocument.create(); const page=pdf.addPage(); page.drawText('SYNTHETIC PDF retention policy',{x:40,y:700,font:await pdf.embedFont(StandardFonts.Helvetica),size:14});
    const cases=[['docx',await zip.generateAsync({type:'nodebuffer'})],['hwpx',Buffer.from(await markdownToHwpx('# SYNTHETIC HWPX\n\n개인정보 파기 기준\n\n| 항목 | 기준 |\n|---|---|\n| 보유기간 | 30일 |'))],['pptx',await slides.generateAsync({type:'nodebuffer'})],['xlsx',await sheets.generateAsync({type:'nodebuffer'})],['pdf',await pdf.save()]];
    const svg=Buffer.from('<svg width="1200" height="240"><rect width="1200" height="240" fill="white"/><text x="50" y="130" font-size="72" fill="black">SYNTHETIC OCR DOCUMENT</text></svg>');
    const png=await sharp(svg).png().toBuffer();
    cases.push(['png',png],['jpg',await sharp(svg).jpeg().toBuffer()],['webp',await sharp(svg).webp().toBuffer()]);
    const scan=await PDFDocument.create();const scanPage=scan.addPage([600,120]);scanPage.drawImage(await scan.embedPng(png),{x:0,y:0,width:600,height:120});
    cases.push(['pdf',await scan.save()]);
    for (const [ext,body] of cases) {
      const response=await fetch(`${base}/parse`,{method:'POST',headers:{...headers,'X-Document-Extension':ext},body});
      const result=await response.json();
      assert.equal(response.status,200,`${ext}: ${result.error || 'unexpected status'}`);
      assert.ok(result.markdown.includes('SYNTHETIC'),ext);
      assert.ok(result.chunks.length>0,`${ext}: chunks`);
      assert.equal(result.parser,'kordoc@4.21.25');
    }
    assert.equal((await fetch(`${base}/parse`,{method:'POST',headers,body:'invalid zip'})).status,422);
    assert.deepEqual(await readdir(new URL('.work/',import.meta.url)),[],'temporary originals removed');
  } finally { proc.kill(); await once(proc,'exit'); }
});
