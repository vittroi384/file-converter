import type { LandingTemplates, Fmt } from './landings.ts';
import type { LandingCopy } from './types.ts';

const name: Record<Fmt, string> = { heic: 'HEIC', jpg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', psd: 'PSD', svg: 'SVG', pdf: 'PDF', xlsx: 'Excel (XLSX)', csv: 'CSV', json: 'JSON', yaml: 'YAML' };
const facts: Record<Fmt, string> = {
  heic: 'HEIC is the format iPhones save photos in by default. Many Windows apps and websites still cannot open it.',
  jpg: 'JPG is the most widely supported photo format — every phone, browser and office app opens it.',
  png: 'PNG is lossless and keeps transparency, which makes it ideal for screenshots, logos and graphics, but large for photos.',
  webp: 'WebP is a modern web format; photos are usually 25–35% smaller than JPG at similar quality.',
  avif: 'AVIF is the newest widely supported image format and often the smallest, but some older apps cannot open it.',
  psd: 'PSD is the Adobe Photoshop document format. LocalConvert reads its merged image, or combines visible layers if the file was saved without one.',
  svg: 'SVG is a vector format. Converting it to PNG renders it at a fixed size so it can be used anywhere images are accepted.',
  pdf: 'PDF keeps the exact layout of a document across devices.',
  xlsx: 'XLSX is the Microsoft Excel workbook format.',
  csv: 'CSV is plain text with comma-separated values; almost every tool can import it.',
  json: 'JSON is the standard data format of web APIs and JavaScript apps.',
  yaml: 'YAML is a human-friendly data format often used for configuration files.',
};
const privacyQ = { q: 'Are my files uploaded to a server?', a: 'No. The conversion runs inside your browser tab, and the site’s security policy blocks connections to other servers, so the file cannot leave your device.' };
const costQ = { q: 'Is it free? Is there a size limit?', a: 'It is free with no account and no ads. There is no fixed size limit; very large files are limited only by your device’s memory, and the page tells you if a file is too large for it.' };
const iosQ = { q: 'Does it work on iPhone and Android?', a: 'Yes, in Safari, Chrome, Samsung Internet and other modern browsers. On Android you can also share files to the installed app from the share menu (iPhone does not support that).' };

function build(d: Parameters<LandingTemplates['build']>[0]): LandingCopy {
  switch (d.kind) {
    case 'convert': {
      const f = name[d.from], t = name[d.to];
      return {
        title: `${f} to ${t} converter — free, no upload`,
        metaDescription: `Convert ${f} to ${t} in your browser. Files never leave your device, no sign-up, no ads, batch conversion with one ZIP download.`,
        intro: `${facts[d.from]} ${facts[d.to]} Drop your ${f} files below to convert them to ${t} right here.`,
        steps: [`Drop or choose your ${f} files (several at once is fine).`, `${t} is already selected — optionally pick a smaller width or quality.`, `Click convert and download each file or everything as a ZIP.`],
        faq: [
          privacyQ,
          { q: `Will ${t} lose quality?`, a: d.to === 'png' ? 'PNG is lossless, so nothing is lost in the conversion itself.' : `${t} is compressed. The default quality is chosen to look the same as the original; pick “High” if you need more.` },
          ...(d.from === 'heic' ? [{ q: 'Is the photo orientation kept?', a: 'Yes. Rotation stored in the photo is applied, and location data (GPS) is not copied into the new file.' }] : []),
          iosQ, costQ,
        ],
      };
    }
    case 'compress': {
      const f = d.fmt ? name[d.fmt] : 'image';
      return {
        title: `Compress ${f} files — smallest size that looks the same`,
        metaDescription: `Reduce ${f} file size without visible quality loss. LocalConvert measures similarity (SSIM) to find the smallest file automatically — in your browser, no upload.`,
        intro: `Instead of guessing a quality number, LocalConvert tries a few settings and measures how close each result is to the original with SSIM, then keeps the smallest one that still passes. It usually needs only 3–4 tries.${d.fmt === 'png' ? ' PNG photos are saved as WebP, which is typically several times smaller.' : ''}`,
        steps: ['Drop your images.', 'Choose how strict to be: near original, balanced or smallest.', 'Download the results — files that are already small are kept as they are.'],
        faq: [privacyQ, { q: 'How much smaller will my photos get?', a: 'It depends on the photo. In our tests a 220 KB JPG became 130 KB (−41%) at the “balanced” setting with no visible difference.' }, { q: 'Can I compress many photos at once?', a: 'Yes. Batches run on several CPU cores in parallel and download as one ZIP.' }, iosQ],
      };
    }
    case 'resize':
      return {
        title: 'Resize images — free, in your browser',
        metaDescription: 'Make photos smaller in pixels for email, social media or the web. High-quality Lanczos resizing, no upload, no sign-up.',
        intro: 'Pick a target width (4K, Full HD, social media or small). Photos are scaled with the high-quality Lanczos filter, and very large photos are decoded at a reduced size first so even 50-megapixel images fit in memory.',
        steps: ['Drop your images.', 'Choose a width and output format.', 'Download the resized images or a ZIP.'],
        faq: [privacyQ, { q: 'Is the aspect ratio kept?', a: 'Yes. Images are only made smaller, never stretched or enlarged.' }, iosQ, costQ],
      };
    case 'merge-pdf':
      return {
        title: 'Merge PDF files — free, no upload',
        metaDescription: 'Combine several PDFs (and images) into one PDF in your browser. Reorder by dragging. Pages are copied without recompression.',
        intro: 'Pages are copied as they are, so text stays sharp and nothing is recompressed. You can mix PDFs and photos; each photo becomes a page.',
        steps: ['Drop two or more PDF files.', 'Drag them (or use the arrows) into the order you want.', 'Click merge and download one PDF.'],
        faq: [privacyQ, { q: 'Can I merge password-protected PDFs?', a: 'Not yet — encrypted PDFs are detected and reported instead of producing a broken file.' }, costQ],
      };
    case 'split-pdf':
      return {
        title: 'Split PDF — extract pages, free',
        metaDescription: 'Split a PDF into single pages or custom ranges like 1-3,5,8- in your browser. No upload.',
        intro: 'Leave the range empty to get one file per page, or type ranges such as 1-3, 4-6 or 8- (to the end).',
        steps: ['Drop a PDF.', 'Type page ranges or leave empty for one file per page.', 'Download the files as a ZIP.'],
        faq: [privacyQ, { q: 'Does splitting reduce quality?', a: 'No. Pages are copied without any re-encoding.' }, costQ],
      };
    case 'compress-pdf':
      return {
        title: 'Compress PDF — make scanned PDFs small enough to email',
        metaDescription: 'Shrink PDFs by recompressing the photos inside while keeping text sharp. Runs in your browser, no upload.',
        intro: 'Scanned documents are mostly photos. LocalConvert recompresses and downsizes those images in parallel and leaves text and vector graphics untouched. In our test a 1.9 MB scan became 0.46 MB (−76%).',
        steps: ['Drop a PDF.', 'Choose light, normal or strong compression.', 'Download the smaller PDF — if it would not get smaller, the original is kept.'],
        faq: [privacyQ, { q: 'Will the text become blurry?', a: 'No. Only embedded photos are recompressed; text stays as text.' }, { q: 'Which PDFs shrink the most?', a: 'Scans and PDFs with large photos. Text-only PDFs are usually already small.' }, costQ],
      };
    case 'pdf-to-image': {
      const t = name[d.to];
      return {
        title: `PDF to ${t} — every page as an image`,
        metaDescription: `Convert PDF pages to ${t} images at screen or print resolution, in your browser. Choose pages like 1-3,5. No upload.`,
        intro: `Each page is rendered with Mozilla’s PDF engine (pdf.js) at 96, 150 or 300 DPI and saved as ${t}. ${facts[d.to]}`,
        steps: ['Drop a PDF.', 'Pick a resolution and, optionally, which pages.', `Download the ${t} files as a ZIP.`],
        faq: [privacyQ, { q: 'What resolution should I use?', a: '150 DPI is good for screens and most documents; 300 DPI for printing.' }, costQ],
      };
    }
    case 'images-to-pdf':
      return {
        title: 'JPG to PDF — combine photos into one PDF',
        metaDescription: 'Turn photos into a single PDF in your browser. JPGs are embedded without recompression, so quality is unchanged. No upload.',
        intro: 'JPG files are placed into the PDF byte-for-byte, so there is no quality loss. Choose “photo size” pages or A4 pages with margins. HEIC photos from iPhones work too.',
        steps: ['Drop your photos.', 'Put them in order and choose the page size.', 'Download one PDF.'],
        faq: [privacyQ, { q: 'Does the PDF get blurry?', a: 'No. JPGs are embedded as they are; other formats are converted at high quality.' }, iosQ],
      };
    case 'data': {
      const f = name[d.from], t = name[d.to];
      return {
        title: `${f} to ${t} converter — keeps leading zeros and accents`,
        metaDescription: `Convert ${f} to ${t} in your browser. Detects the text encoding, keeps phone numbers and codes with leading zeros, no upload.`,
        intro: `${facts[d.from]} ${facts[d.to]} Values like 007 or 010-1234 stay as text instead of turning into numbers, and CSV files from Excel in other encodings (such as Korean EUC-KR) are detected automatically.`,
        steps: [`Drop your ${f} file.`, `${t} is already selected.`, 'Download the converted file.'],
        faq: [privacyQ, { q: 'Will Excel open the CSV correctly?', a: 'Yes. CSV files are saved with a UTF-8 marker so Excel shows non-English text correctly.' }, { q: 'What about nested JSON?', a: 'Nested objects become dotted column names like address.city when converting to a table.' }],
      };
    }
  }
}

export const landingEn: LandingTemplates = { name, facts, build };
