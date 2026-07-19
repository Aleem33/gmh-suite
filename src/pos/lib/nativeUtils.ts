import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const SLIP_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: white; font-family: monospace; }
  @page { size: 80mm auto; margin: 4mm; }
`;

export async function printOrShare(slipHtml: string, filename = 'slip.html'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await shareTextFile(
      `<!DOCTYPE html><html><head><style>${SLIP_STYLE}</style></head><body>${slipHtml}</body></html>`,
      filename,
      'Receipt'
    );
    return;
  }
  iframePrint(slipHtml);
}

export async function printPageOrShare(pageTitle = 'Receipt'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Share.share({
      title: pageTitle,
      text: `${pageTitle} is ready in GMH Suite.`,
    });
    return;
  }
  window.print();
}

export interface PrintFrameSize {
  width: string;
  height: string;
}

const DEFAULT_PRINT_FRAME_SIZE: PrintFrameSize = {
  width: '210mm',
  height: '297mm',
};

export async function printHtmlOrShare(
  fullHtml: string,
  filename = 'print.html',
  title = 'Print',
  frameSize: PrintFrameSize = DEFAULT_PRINT_FRAME_SIZE
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await shareTextFile(fullHtml, filename, title);
    return;
  }
  iframePrintDocument(fullHtml, frameSize);
}

export function shouldUsePharmacyPdfPreview() {
  if (Capacitor.isNativePlatform()) return true;
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const coarseNarrowScreen = window.matchMedia?.('(max-width: 900px) and (pointer: coarse)').matches ?? false;
  return mobileUserAgent || coarseNarrowScreen;
}

export async function previewOrSharePdf(pdf: Blob, filename: string, title: string): Promise<void> {
  const safeName = filename.replace(/[\\/:*?"<>|]+/g, '-').replace(/\.html?$/i, '.pdf');
  const pdfName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  if (Capacitor.isNativePlatform()) {
    const base64 = await blobToBase64(pdf);
    await Filesystem.writeFile({
      path: pdfName,
      data: base64,
      directory: Directory.Cache,
    });
    const file = await Filesystem.getUri({
      path: pdfName,
      directory: Directory.Cache,
    });
    await Share.share({
      title,
      url: file.uri,
      dialogTitle: `${title} PDF`,
    });
    return;
  }

  const url = URL.createObjectURL(pdf);
  const preview = window.open(url, '_blank');
  if (preview) {
    try {
      preview.opener = null;
    } catch {
      // Some mobile browsers expose a read-only opener.
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 300000);
    return;
  }
  window.location.assign(url);
}

export async function downloadOrShare(
  content: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8;'
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await shareTextFile(content, filename, filename);
    return;
  }
  const bom = mimeType.includes('csv') && !content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const blob = new Blob([bom + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function iframePrint(slipHtml: string) {
  const fullHtml = `<!DOCTYPE html><html><head><style>${SLIP_STYLE}</style></head><body>${slipHtml}</body></html>`;
  iframePrintDocument(fullHtml);
}

function iframePrintDocument(fullHtml: string, frameSize: PrintFrameSize = DEFAULT_PRINT_FRAME_SIZE) {
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: frameSize.width,
    height: frameSize.height,
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  });

  let cleanupTimer: number | undefined;
  let cleanedUp = false;
  let printStarted = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
    iframe.remove();
  };

  iframe.onload = async () => {
    if (printStarted) return;
    printStarted = true;
    const printWindow = iframe.contentWindow;
    if (!printWindow) {
      cleanup();
      return;
    }

    try {
      if (printWindow.document.fonts?.ready) {
        await printWindow.document.fonts.ready;
      }
    } catch {
      // The invoice can still print with the browser's fallback font.
    }

    printWindow.addEventListener('afterprint', cleanup, { once: true });
    cleanupTimer = window.setTimeout(cleanup, 120000);
    printWindow.requestAnimationFrame(() => {
      printWindow.requestAnimationFrame(() => {
        printWindow.focus();
        printWindow.print();
      });
    });
  };

  iframe.srcdoc = fullHtml;
  document.body.appendChild(iframe);
}

async function shareTextFile(content: string, filename: string, title: string): Promise<void> {
  const safeName = filename.replace(/[\\/:*?"<>|]+/g, '-');
  await Filesystem.writeFile({
    path: safeName,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  const file = await Filesystem.getUri({
    path: safeName,
    directory: Directory.Cache,
  });
  await Share.share({
    title,
    url: file.uri,
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Unable to read PDF file.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      if (commaIndex < 0) {
        reject(new Error('Unable to encode PDF file.'));
        return;
      }
      resolve(result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(blob);
  });
}
