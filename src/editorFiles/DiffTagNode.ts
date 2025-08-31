import type {EditorConfig, LexicalEditor, NodeKey} from "lexical";
import {ElementNode, LexicalNode} from "lexical";

type DiffTag = "ins" | "del";

export class DiffTagNode extends ElementNode {
  __tag: DiffTag;

  static getType(): string {
    return "diff-tag";
  }

  static clone(node: DiffTagNode): DiffTagNode {
    return new DiffTagNode(node.__tag, node.__key);
  }

  constructor(tag: DiffTag, key?: NodeKey) {
    super(key);
    this.__tag = tag;
  }

  // Render as the actual HTML tag so copy/paste & export are obvious.
  createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement(this.__tag);
    el.classList.add(this.__tag === "ins" ? "diff-ins" : "diff-del");
    return el;
  }
  updateDOM(prev: DiffTagNode, dom: HTMLElement): boolean {
    if (prev.__tag !== this.__tag) {
      const next = document.createElement(this.__tag);
      next.className = dom.className;
      while (dom.firstChild) next.appendChild(dom.firstChild);
      dom.replaceWith(next);
      return true;
    }
    return false;
  }
  isInline(): boolean {
    return true;
  }

  /** Map HTML → this node during $generateNodesFromDOM */
  static importDOM() {
    const conv = (tag: DiffTag) => ({
      conversion: () => ({node: new DiffTagNode(tag)}),
      priority: 1 as const, // higher than default text conversion
    });
    return {
      ins: () => conv("ins"),
      del: () => conv("del"),

      // Optional: support <span data-diff="ins|del"> or class-based marks
      span: (el: HTMLElement) => {
        const data = el.getAttribute?.("data-diff");
        const hasIns = el.classList?.contains("diff-ins");
        const hasDel = el.classList?.contains("diff-del");
        if (data === "ins" || hasIns) return conv("ins");
        if (data === "del" || hasDel) return conv("del");
        return null;
      },
    };
  }

  /** Map this node → HTML when exporting DOM */
  exportDOM(_editor: LexicalEditor) {
    const element = document.createElement(this.__tag);
    element.classList.add(this.__tag === "ins" ? "diff-ins" : "diff-del");
    return {element};
  }

  // JSON round-trip (editorState persistence)
  static importJSON(json: any): DiffTagNode {
    return new DiffTagNode(json.tag as DiffTag);
  }
  exportJSON() {
    return {...super.exportJSON(), type: "diff-tag", version: 1, tag: this.__tag};
  }
}

// Helpers
export function $createInsNode() { return new DiffTagNode("ins"); }
export function $createDelNode() { return new DiffTagNode("del"); }
export function $isDiffTagNode(n?: LexicalNode | null): n is DiffTagNode { return n instanceof DiffTagNode; }
