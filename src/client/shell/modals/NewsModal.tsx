import { useCallback, useRef, useState } from "react";
import { getApiBase } from "../../Api";
import { translateText } from "../../Utils";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

function normalizeMarkdown(md: string): string {
  // Basic normalization: ensure headings have space after #
  return md.replace(/^(#{1,6})([^\s#])/gm, "$1 $2");
}

export function NewsModal() {
  const { showPage } = useNavigation();
  const [markdown, setMarkdown] = useState("Loading...");
  const initialized = useRef(false);

  const onOpen = useCallback(async () => {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const response = await fetch(`${getApiBase()}/changelog.md`);
      if (response.ok) {
        const text = await response.text();
        setMarkdown(normalizeMarkdown(text));
      } else {
        setMarkdown("Failed to load changelog.");
      }
    } catch {
      setMarkdown("Failed to load changelog.");
    }
  }, []);

  // Simple markdown to HTML (handles headings, bold, links, lists, paragraphs)
  const renderMarkdown = (md: string) => {
    const lines = md.split("\n");
    const elements: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        elements.push(<Tag key={i}>{text}</Tag>);
        i++;
        continue;
      }
      // List items
      if (line.match(/^\s*[-*]\s/)) {
        const listItems: React.ReactNode[] = [];
        while (i < lines.length && lines[i].match(/^\s*[-*]\s/)) {
          listItems.push(<li key={i}>{lines[i].replace(/^\s*[-*]\s/, "")}</li>);
          i++;
        }
        elements.push(<ul key={`ul-${i}`}>{listItems}</ul>);
        continue;
      }
      // Empty lines
      if (!line.trim()) {
        i++;
        continue;
      }
      // Paragraph
      elements.push(<p key={i}>{line}</p>);
      i++;
    }
    return elements;
  };

  return (
    <ModalPage pageId="page-news" onOpen={onOpen}>
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white" aria-label={translateText("common.back")}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("main.news")}</h2>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 prose prose-invert prose-sm max-w-none
          [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-white [&_h1]:border-b [&_h1]:border-white/10 [&_h1]:pb-2
          [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-blue-200
          [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-blue-100
          [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1
          [&_li]:text-gray-300 [&_li]:leading-relaxed
          [&_p]:text-gray-300 [&_p]:mb-3
          scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {renderMarkdown(markdown)}
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
