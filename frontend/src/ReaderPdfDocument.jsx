import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function PdfPage({ pdf, number, zoom, fitMode, width, highlights, onError }) {
  const shell = useRef(null);
  const container = useRef(null);
  const canvas = useRef(null);
  const textLayer = useRef(null);
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 900 });

  useEffect(() => {
    const node = shell.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '1000px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || page) return undefined;
    let active = true;
    pdf.getPage(number).then(value => { if (active) setPage(value); }).catch(error => { if (active) onError(error?.message || 'A PDF page could not be opened.'); });
    return () => { active = false; };
  }, [visible, page, pdf, number, onError]);

  useEffect(() => {
    if (!page) return;
    const base = page.getViewport({ scale: 1 });
    const fitWidth = Math.max(260, width - 36) / base.width;
    const fitPage = Math.min(fitWidth, Math.max(320, window.innerHeight * .72) / base.height);
    const scale = Math.max(.35, Math.min(3, fitMode === 'width' ? fitWidth : fitMode === 'page' ? fitPage : zoom));
    const viewport = page.getViewport({ scale });
    setSize({ width: viewport.width, height: viewport.height });
    if (!visible || !canvas.current || !textLayer.current) return undefined;
    let active = true;
    let renderTask;
    let layerTask;
    const target = canvas.current;
    const outputScale = window.devicePixelRatio || 1;
    target.width = Math.floor(viewport.width * outputScale);
    target.height = Math.floor(viewport.height * outputScale);
    target.style.width = `${Math.floor(viewport.width)}px`;
    target.style.height = `${Math.floor(viewport.height)}px`;
    const layer = textLayer.current;
    layer.replaceChildren();
    Object.assign(layer.style, { width: `${Math.floor(viewport.width)}px`, height: `${Math.floor(viewport.height)}px` });
    layer.style.setProperty('--scale-factor', String(scale));
    layer.style.setProperty('--total-scale-factor', String(scale));
    layer.style.setProperty('--user-unit', '1');
    layer.style.setProperty('--scale-round-x', '1px');
    layer.style.setProperty('--scale-round-y', '1px');
    renderTask = page.render({ canvas: target, viewport, transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null });
    page.getTextContent().then(content => {
      if (!active) return;
      layerTask = new TextLayer({ textContentSource: content, container: layer, viewport });
      return layerTask.render();
    }).catch(error => { if (active && error?.name !== 'RenderingCancelledException') onError(error?.message || 'PDF text selection is unavailable.'); });
    renderTask.promise.catch(error => { if (active && error?.name !== 'RenderingCancelledException') onError(error?.message || 'A PDF page could not be rendered.'); });
    return () => { active = false; renderTask?.cancel(); layerTask?.cancel(); };
  }, [page, visible, width, zoom, fitMode, onError]);

  return <div ref={shell} className="pdf-page-shell" data-page-number={number} style={{ width: size.width || 'min(100%, 850px)', minHeight: size.height }}><div ref={container} className="pdf-page-container" style={{ width: size.width || '100%', height: size.height }}>{visible && page ? <><canvas ref={canvas} aria-label={`PDF page ${number}`}/><div ref={textLayer} className="textLayer"/><PdfHighlightOverlay containerRef={container} textLayerRef={textLayer} highlights={highlights} active={visible}/></> : <span className="pdf-page-placeholder">Page {number}</span>}</div></div>;
}

function textRangeAtOffsets(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  let total = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;
  while ((node = walker.nextNode())) {
    const next = total + node.nodeValue.length;
    if (!startNode && start >= total && start <= next) { startNode = node; startOffset = start - total; }
    if (end >= total && end <= next) { endNode = node; endOffset = end - total; break; }
    total = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

function PdfHighlightOverlay({ containerRef, textLayerRef, highlights, active }) {
  const [rects, setRects] = useState([]);
  useEffect(() => {
    const container = containerRef.current;
    const layer = textLayerRef.current;
    if (!active || !container || !layer || !highlights.length) { setRects([]); return undefined; }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = container.getBoundingClientRect();
        const next = [];
        highlights.forEach(item => {
          const range = textRangeAtOffsets(layer, Number(item.start_offset), Number(item.end_offset));
          if (!range) return;
          Array.from(range.getClientRects()).forEach((rect, index) => {
            if (rect.width && rect.height) next.push({ id: item.id, index, color: item.color, left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height });
          });
        });
        setRects(next);
      });
    };
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(layer, { childList: true, subtree: true, characterData: true });
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    measure();
    return () => { mutationObserver.disconnect(); resizeObserver.disconnect(); cancelAnimationFrame(frame); };
  }, [containerRef, textLayerRef, highlights, active]);
  if (!rects.length) return null;
  return <div className="pdf-highlight-overlay" aria-hidden="true">{rects.map(rect => <span key={`${rect.id}-${rect.index}`} className={`pdf-highlight-overlay-mark reader-highlight-${rect.color}`} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}/>)}</div>;
}

export default function ReaderPdfDocument({ bytes, page, zoom, fitMode, highlights = [], onPageChange, onVisiblePageChange, onError }) {
  const [pdf, setPdf] = useState(null);
  const [width, setWidth] = useState(850);
  const [renderError, setRenderError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState([]);
  const content = useRef(null);
  useEffect(() => {
    let active = true;
    const task = getDocument({ data: bytes });
    task.promise.then(value => { if (active) setPdf(value); else value.destroy(); }).catch(error => { if (active) { const message = error?.message || 'The PDF could not be rendered.'; setRenderError(message); onError(message); } });
    return () => { active = false; task.destroy().catch(() => {}); };
  }, [bytes, onError]);
  useEffect(() => {
    const node = content.current;
    if (!node) return undefined;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !page) return;
    content.current?.querySelector(`[data-page-number="${page}"]`)?.scrollIntoView({ block: 'start' });
  }, [pdf]);
  useEffect(() => {
    if (!pdf || !onVisiblePageChange) return undefined;
    const root = content.current?.closest('.book-reader');
    if (!root) return undefined;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const marker = root.getBoundingClientRect().top + Math.min(root.clientHeight * .35, 220);
        let current = 1;
        root.querySelectorAll('[data-page-number]').forEach(node => {
          if (node.getBoundingClientRect().top <= marker) current = Number(node.dataset.pageNumber) || current;
        });
        onVisiblePageChange(current);
      });
    };
    root.addEventListener('scroll', update, { passive: true });
    update();
    return () => { root.removeEventListener('scroll', update); cancelAnimationFrame(frame); };
  }, [pdf, onVisiblePageChange]);
  async function search(event) {
    event.preventDefault();
    const term = searchTerm.trim().toLocaleLowerCase();
    if (!pdf || !term) return;
    setSearching(true); setMatches([]);
    try {
      const found = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const current = await pdf.getPage(number);
        const text = (await current.getTextContent()).items.map(item => item.str || '').join(' ').toLocaleLowerCase();
        if (text.includes(term)) found.push(number);
      }
      setMatches(found);
      if (found.length) onPageChange(found[0]);
    } catch (error) { setRenderError(error?.message || 'Document search failed.'); }
    finally { setSearching(false); }
  }
  return <div className="pdf-reader-content" ref={content}>
    <form className="pdf-search" onSubmit={search}><label>Find in this book<input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search text in the PDF"/></label><button className="secondary" disabled={searching || !searchTerm.trim()}>{searching ? 'Searching…' : 'Search'}</button>{searching && <span>Searching pages…</span>}{matches.length > 0 && <span>{matches.length} page{matches.length === 1 ? '' : 's'} found</span>}{matches.length === 0 && searchTerm && !searching && <span>Search to find matches</span>}</form>
    {matches.length > 0 && <div className="pdf-search-matches">{matches.slice(0, 30).map(number => <button type="button" key={number} className="link-button" onClick={() => onPageChange(number)}>Page {number}</button>)}</div>}
    {renderError && <p className="reader-render-error" role="alert">{renderError}</p>}
    <div className="pdf-document-scroll">{pdf ? Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={`${bytes.length}-${index + 1}`} pdf={pdf} number={index + 1} zoom={zoom} fitMode={fitMode} width={width} highlights={highlights.filter(item => Number(item.page) === index + 1)} onError={onError}/>) : <p className="loading-state">Preparing PDF viewer…</p>}</div>
  </div>;
}
