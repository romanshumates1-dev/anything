import Link from 'next/link';
import { getLegalDoc } from '@/lib/legal';
import { notFound } from 'next/navigation';

/**
 * One shared server-rendered layout for every /legal/* page. Reads the doc
 * from the markdown single source (src/lib/legal.ts), renders a table of
 * contents from its ## headings, and shows the version / effective date plus
 * an attorney-review banner. Replaces the old split of hardcoded TSX pages +
 * the LegalDocRenderer component + the orphaned legal_documents DB seed.
 */

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string; id: string }
  | { kind: 'h3'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'p'; text: string };

// Minimal, safe markdown -> block parser. Legal docs use only headings,
// paragraphs, unordered lists, blockquotes, and **bold** — no HTML, no raw
// interpolation, so there's no injection surface.
function parseBlocks(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) { blocks.push({ kind: 'p', text: para.join(' ') }); para = []; }
  };
  const flushList = () => {
    if (list.length) { blocks.push({ kind: 'ul', items: list }); list = []; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    if (line.startsWith('### ')) { flushPara(); flushList(); blocks.push({ kind: 'h3', text: line.slice(4) }); continue; }
    if (line.startsWith('## ')) { flushPara(); flushList(); const t = line.slice(3); blocks.push({ kind: 'h2', text: t, id: slugify(t) }); continue; }
    if (line.startsWith('# ')) { flushPara(); flushList(); blocks.push({ kind: 'h1', text: line.slice(2) }); continue; }
    if (line.startsWith('> ')) { flushPara(); flushList(); blocks.push({ kind: 'quote', text: line.slice(2) }); continue; }
    if (/^\s*[-*]\s+/.test(line)) { flushPara(); list.push(line.replace(/^\s*[-*]\s+/, '')); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return blocks;
}

// Render **bold** inline without dangerouslySetInnerHTML.
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

export function LegalDocPage({ slug }: { slug: string }) {
  const doc = getLegalDoc(slug);
  if (!doc) notFound();

  const blocks = parseBlocks(doc.body);
  const toc = blocks.filter((b): b is Extract<Block, { kind: 'h2' }> => b.kind === 'h2');

  return (
    <div className="py-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">{doc.title}</h1>
          <p className="mt-2 text-sm text-gray-500">
            Version {doc.version}
            {doc.effectiveDate ? ` · Effective ${doc.effectiveDate}` : ''}
          </p>
          <p className="mt-3 inline-block rounded bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            TEMPLATE — requires attorney review before launch
          </p>
        </div>

        {toc.length > 1 && (
          <nav className="mb-10 rounded-lg border bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Contents</p>
            <ul className="space-y-1">
              {toc.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="text-sm text-blue-700 hover:underline">{h.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="prose prose-gray max-w-none">
          {blocks.map((b, i) => {
            switch (b.kind) {
              case 'h1':
                return null; // title already rendered from frontmatter
              case 'h2':
                return <h2 key={i} id={b.id} className="text-2xl font-bold text-gray-900 mt-8 scroll-mt-24">{b.text}</h2>;
              case 'h3':
                return <h3 key={i} className="text-lg font-semibold text-gray-900 mt-6">{b.text}</h3>;
              case 'ul':
                return (
                  <ul key={i} className="list-disc pl-6 mt-3 space-y-1 text-gray-600">
                    {b.items.map((it, j) => <li key={j}>{renderInline(it, `${i}-${j}`)}</li>)}
                  </ul>
                );
              case 'quote':
                return <blockquote key={i} className="border-l-4 border-amber-300 bg-amber-50 pl-4 py-2 my-4 text-sm text-gray-700">{renderInline(b.text, `${i}`)}</blockquote>;
              default:
                return <p key={i} className="text-gray-600 mt-3">{renderInline(b.text, `${i}`)}</p>;
            }
          })}
        </div>

        <div className="mt-12 pt-6 border-t">
          <Link href="/trust" className="text-sm text-blue-700 hover:underline">← Back to Compliance Center</Link>
        </div>
      </div>
    </div>
  );
}
