// Run once online with a generated, non-sensitive image. Real document parsing
// is always offline; downloaded OCR assets remain inside this project.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.KORDOC_MODEL_CACHE=join(dirname(fileURLToPath(import.meta.url)),'.models');
process.env.KORDOC_OFFLINE='0';
const { default:sharp }=await import('sharp');
const { parse }=await import('kordoc');
const image=await sharp(Buffer.from('<svg width="900" height="180"><rect width="900" height="180" fill="white"/><text x="30" y="100" font-size="56" fill="black">SYNTHETIC OCR MODEL SETUP</text></svg>')).png().toBuffer();
const result=await parse(image,{ocr:true,images:false});
if (!result.success || !result.markdown.trim()) { console.error({code:result.code,error:result.error,warnings:result.warnings?.map(w=>w.code)}); throw new Error('OCR_MODEL_SETUP_FAILED'); }
console.log('Offline OCR models prepared successfully.');
