"use client";
import { useEffect, useRef, useState } from "react";
import { getDocumentProxy } from "unpdf";

type HighlightBox = { left: number; top: number; width: number; height: number; text: string };
function normalize(value: string) { return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, "").trim(); }

export default function PdfSearchViewer({ url, pageNumber, terms }: { url: string; pageNumber: number; terms: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [boxes, setBoxes] = useState<HighlightBox[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const termKey = terms.join("|");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setBoxes([]);
    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("PDF_LOAD_FAILED");
        const proxy = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
        const page = await proxy.getPage(pageNumber);
        const scale = 1.35;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("CANVAS_NOT_SUPPORTED");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const content = await page.getTextContent();
        const wanted = terms.map(normalize).filter(Boolean);
        const highlights: HighlightBox[] = [];
        for (const raw of content.items as Array<Record<string, unknown>>) {
          const text = String(raw.str || "");
          if (!text || !wanted.some((term) => normalize(text).includes(term))) continue;
          const transform = raw.transform as number[] | undefined;
          if (!transform?.length) continue;
          const fontHeight = Math.max(8, Math.hypot(transform[2], transform[3]) * scale);
          highlights.push({ left: transform[4] * scale, top: viewport.height - transform[5] * scale - fontHeight, width: Math.max(10, Number(raw.width || text.length * fontHeight * .5) * scale), height: fontHeight * 1.15, text });
        }
        if (!cancelled) { setSize({ width: viewport.width, height: viewport.height }); setBoxes(highlights); setLoading(false); }
        proxy.destroy?.();
      } catch { if (!cancelled) { setError("PDF 페이지를 표시하지 못했습니다."); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [url, pageNumber, termKey]);
  return <div className="custom-pdf-scroll">
    {loading && <div className="pdf-render-state">{pageNumber}쪽을 불러오는 중…</div>}
    {error && <div className="pdf-render-state error">{error}</div>}
    <div className="custom-pdf-page" style={{ width: size.width || undefined, height: size.height || undefined }}>
      <canvas ref={canvasRef} />
      {boxes.map((box, index) => <span className="pdf-word-highlight" title={box.text} key={`${box.left}-${box.top}-${index}`} style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />)}
    </div>
  </div>;
}
