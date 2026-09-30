import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { InputOptions, InputSource, PreparedInput, SourceKind } from './types.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;

async function readLimited(file: string): Promise<Buffer> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) {
    throw new Error(`Input file must be nonempty and at most ${MAX_FILE_BYTES} bytes: ${file}`);
  }
  return fs.readFile(file);
}

function limitText(value: string, name: string): string {
  const text = value.trim();
  if (!text || text.length > MAX_TEXT_CHARS)
    throw new Error(`Input text must contain 1-${MAX_TEXT_CHARS} characters: ${name}`);
  return text;
}

async function loadDocument(file: string): Promise<InputSource> {
  const extension = path.extname(file).toLowerCase();
  if (!['.txt', '.md', '.pdf', '.docx'].includes(extension)) throw new Error(`Unsupported document format: ${file}`);
  const bytes = await readLimited(file);
  let content: string;
  if (extension === '.txt' || extension === '.md') content = bytes.toString('utf8');
  else if (extension === '.docx') content = (await mammoth.extractRawText({ buffer: bytes })).value;
  else {
    const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      pages.push(text.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    content = pages.join('\n');
    await loadingTask.destroy();
  }
  return { kind: 'document', name: path.basename(file), text: limitText(content, file) };
}

async function loadImage(file: string, kind: SourceKind): Promise<InputSource> {
  const bytes = await readLimited(file);
  const extension = path.extname(file).toLowerCase();
  const png = extension === '.png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const jpeg = ['.jpg', '.jpeg'].includes(extension) && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    extension === '.webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error(`Unsupported or invalid image format: ${file}`);
  const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp';
  return { kind, name: path.basename(file), dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
}

async function loadTemplate(file: string): Promise<InputSource> {
  if (!file.toLowerCase().endsWith('.model.json')) return loadImage(file, 'template');
  const text = limitText((await readLimited(file)).toString('utf8'), file);
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { nodes?: unknown }).nodes)) {
    throw new Error(`Invalid Diagram DSL template: ${file}`);
  }
  return { kind: 'template', name: path.basename(file), text };
}

export async function prepareInput(options: InputOptions): Promise<PreparedInput> {
  if (options.document && options.image) throw new Error('Use one primary file: --document or --image');
  if (!options.text?.trim() && !options.document && !options.image)
    throw new Error('Provide --text, --document, or --image');
  const sources: InputSource[] = [];
  if (options.document) sources.push(await loadDocument(path.resolve(options.document)));
  if (options.image) sources.push(await loadImage(path.resolve(options.image), 'image'));
  if (options.text?.trim())
    sources.push({ kind: 'request', name: 'request', text: limitText(options.text, 'request') });
  if (options.template) sources.push(await loadTemplate(path.resolve(options.template)));
  return { sources };
}
