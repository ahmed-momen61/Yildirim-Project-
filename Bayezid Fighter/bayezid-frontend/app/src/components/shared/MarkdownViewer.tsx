import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-slate-300
      prose-headings:text-cyan-400 prose-headings:font-mono prose-headings:tracking-widest prose-headings:uppercase
      prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline
      prose-code:text-rose-400 prose-code:bg-slate-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
      prose-pre:bg-slate-950 prose-pre:border prose-pre:border-slate-800
      prose-strong:text-slate-100
      prose-blockquote:border-l-cyan-500 prose-blockquote:bg-cyan-500/10 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:text-cyan-100 prose-blockquote:not-italic
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
