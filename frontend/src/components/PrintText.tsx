import { Children, cloneElement, isValidElement, useMemo, useRef } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useInView, useReducedMotion } from "framer-motion";

/** Prints headings once on entry while exposing one complete, stable AT label. */
export default function PrintText({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useInView(ref, { once: true, amount: 0.25 });
  const reduced = useReducedMotion();
  const { label, ink } = useMemo(() => {
    let order = 0;
    const plain = (nodes: ReactNode): string =>
      Children.toArray(nodes)
        .map((node) => {
          if (typeof node === "string" || typeof node === "number")
            return String(node);
          if (isValidElement<{ children?: ReactNode }>(node)) {
            return node.type === "br" ? " " : plain(node.props.children);
          }
          return "";
        })
        .join(" ");
    const print = (nodes: ReactNode): ReactNode =>
      Children.map(nodes, (node) => {
        if (typeof node === "string" || typeof node === "number") {
          return String(node)
            .split(/(\s+)/)
            .map((word, wordIndex) => {
              if (/^\s+$/.test(word)) return word;
              return (
                <span className="print-word" key={`${wordIndex}-${word}`}>
                  {Array.from(word).map((letter) => {
                    const index = order++;
                    return (
                      <span
                        key={index}
                        className="print-glyph"
                        style={
                          {
                            "--print-delay": `${Math.min(index * 0.027, 1.6)}s`,
                          } as CSSProperties
                        }
                      >
                        {letter}
                      </span>
                    );
                  })}
                </span>
              );
            });
        }
        if (
          isValidElement<{ children?: ReactNode }>(node) &&
          node.props.children !== undefined
        ) {
          return cloneElement(node as ReactElement<{ children?: ReactNode }>, {
            children: print(node.props.children),
          });
        }
        return node;
      });
    return {
      label: plain(children).replace(/\s+/g, " ").trim(),
      ink: print(children),
    };
  }, [children]);
  return (
    <span
      ref={ref}
      className="printing-text"
      data-printed={visible || !!reduced}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{ink}</span>
      <span className="printing-caret" aria-hidden="true" />
    </span>
  );
}
