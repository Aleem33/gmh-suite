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
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><style>${SLIP_STYLE}</style></head><body>${slipHtml}</body></html>`);
  doc.close();
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  window.setTimeout(() => iframe.remove(), 2000);
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
