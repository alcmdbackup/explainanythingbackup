// npm i diff
import * as Diff from "diff";

/** Each atom is emitted in reading order. No external offsets needed. */
export type Atom =
  | { kind: "orig"; text: string; deleted?: boolean }   // from originalText
  | { kind: "insert"; text: string };                   // virtual addition (not in originalText)

/** Main entry: returns an atom stream that fully covers the original text with layered edits. */
export function createUnifiedDiff(originalText: string, modifiedText: string) {
  const SIMILARITY_THRESHOLD = 0.7;

  // 1) First pass: line-level diff
  const parts = Diff.diffLines(originalText, modifiedText);

  const atoms: Atom[] = [];

  for (let i = 0; i < parts.length; i++) {
    const cur = parts[i];

    if (!cur.added && !cur.removed) {
      // Equal block: emit as original
      if (cur.value) atoms.push({ kind: "orig", text: cur.value });
      continue;
    }

    // Try to pair neighbor remove/add (in either order) and refine
    const next = parts[i + 1];
    const isRemAdd = cur.removed && next?.added;
    const isAddRem = cur.added && next?.removed;

    if ((isRemAdd || isAddRem) && areSimilar(cur.value, next!.value, SIMILARITY_THRESHOLD)) {
      const removedText = isRemAdd ? cur.value : next!.value;
      const addedText   = isRemAdd ? next!.value : cur.value;

      // 2) Refinement at word-level: output a mixed stream of orig/insert atoms
      pushWordLevelAtoms(removedText, addedText, atoms);

      i++; // consume the paired neighbor
      continue;
    }

    // Unpaired blocks
    if (cur.removed) {
      // Entire span existed in original and is now deleted
      if (cur.value) atoms.push({ kind: "orig", text: cur.value, deleted: true });
      continue;
    }

    if (cur.added) {
      // Pure insertion between surrounding original spans
      if (cur.value) atoms.push({ kind: "insert", text: cur.value });
      continue;
    }
  }

  // 3) Normalize small neighbors for cleaner rendering
  const normalized = coalesceAtoms(atoms);
  return { atoms: normalized };
}

/* ---------------------------------------
   Refinement & utilities
----------------------------------------*/

/**
 * Word-level refinement using diffWordsWithSpace:
 * - equal => { kind: 'orig', text }
 * - removed => { kind: 'orig', text, deleted: true }
 * - added => { kind: 'insert', text }
 *
 * This keeps the original text slices intact while placing inserts inline.
 */
function pushWordLevelAtoms(removedText: string, addedText: string, out: Atom[]) {
  const inner = Diff.diffWordsWithSpace(removedText, addedText);
  for (const p of inner) {
    if (p.added) {
      if (p.value) out.push({ kind: "insert", text: p.value });
    } else if (p.removed) {
      if (p.value) out.push({ kind: "orig", text: p.value, deleted: true });
    } else {
      if (p.value) out.push({ kind: "orig", text: p.value });
    }
  }
}

/** Pairing heuristic: Sørensen–Dice similarity on word tokens. */
function areSimilar(a: string, b: string, threshold: number): boolean {
  return diceOnWords(a, b) >= threshold;
}

function diceOnWords(a: string, b: string): number {
  const wa = tokenizeWords(a);
  const wb = tokenizeWords(b);
  if (wa.length === 0 && wb.length === 0) return 1;

  const A = new Map<string, number>();
  const B = new Map<string, number>();
  for (const w of wa) A.set(w, (A.get(w) ?? 0) + 1);
  for (const w of wb) B.set(w, (B.get(w) ?? 0) + 1);

  let overlap = 0, countA = 0, countB = 0;
  for (const [, c] of A) countA += c;
  for (const [, c] of B) countB += c;
  for (const [w, ca] of A) overlap += Math.min(ca, B.get(w) ?? 0);

  return (2 * overlap) / (countA + countB);
}

function tokenizeWords(s: string): string[] {
  // Unicode-friendly word-ish tokens; tweak as needed.
  const m = s.toLowerCase().match(/\p{L}[\p{L}\p{N}_'-]*|\p{N}+/gu);
  return m ?? [];
}

/** Merge adjacent atoms of same kind to keep the stream compact. */
function coalesceAtoms(atoms: Atom[]): Atom[] {
  if (atoms.length === 0) return atoms;
  const out: Atom[] = [];
  let prev = atoms[0];

  for (let i = 1; i < atoms.length; i++) {
    const cur = atoms[i];

    // Merge adjacent 'orig' with same deleted flag
    if (
      prev.kind === "orig" &&
      cur.kind === "orig" &&
      !!prev.deleted === !!cur.deleted
    ) {
      prev = { ...prev, text: prev.text + cur.text };
      continue;
    }

    // Merge adjacent 'insert's
    if (prev.kind === "insert" && cur.kind === "insert") {
      prev = { kind: "insert", text: prev.text + cur.text };
      continue;
    }

    out.push(prev);
    prev = cur;
  }
  out.push(prev);
  return out;
}

/* ---------------------------------------
   CriticMarkup renderer for markdown export
----------------------------------------*/

/**
 * Render atoms to CriticMarkup that preserves the original text exactly.
 * - Unchanged: plain text
 * - Deleted: {--deleted text--}
 * - Inserted: {++inserted text++}
 * - Returns markdown-compatible CriticMarkup syntax
 */
export function renderAnnotatedMarkdown(
  atoms: Atom[]
): string {
  const content = atoms
    .map((a) => {
      if (a.kind === "orig" && !a.deleted) return a.text;
      if (a.kind === "orig" && a.deleted)
        return `{--${a.text}--}`;
      // insert
      return `{++${a.text}++}`;
    })
    .join("");
  
  return content;
}

import type { TextMatchTransformer, ElementTransformer } from "@lexical/markdown";
import { $createTextNode, TextNode, LexicalNode } from "lexical";
import { DiffTagNode, $createDiffTagNode, $isDiffTagNode } from "./DiffTagNode";



/**
 * Custom transformer for CriticMarkup syntax
 * - Parses {--deleted text--} into DiffTagNode with "del" tag
 * - Parses {++inserted text++} into DiffTagNode with "ins" tag
 * - Parses {~~old~>new~~} into DiffTagNode with "update" tag
 * - Uses proper text replacement mechanism for accurate node positioning
 * - Used by Lexical markdown import to convert CriticMarkup to DiffTagNodes
 */
export const CRITIC_MARKUP: TextMatchTransformer = {
  type: "text-match",
  trigger: "{",
  // Match {++...++}, {--...--}, or {~~...~>...~~}, non-greedy, multiline
  regExp: /\{([+-~]{2})([\s\S]+?)\1\}/,
  importRegExp: /\{([+-~]{2})([\s\S]+?)\1\}/,
  replace: (textNode, match) => {
    console.log("🔍 CRITIC_MARKUP replace called");
    console.log("📝 TextNode content:", JSON.stringify(textNode.getTextContent()));
    console.log("📝 TextNode content length:", textNode.getTextContent().length);
    console.log("📝 TextNode key:", textNode.getKey());
    console.log("🎯 Full match:", JSON.stringify(match[0]));
    console.log("🎯 Full match length:", match[0].length);
    console.log("🏷️ Marks:", match[1]);
    console.log("📄 Inner content length:", match[2]?.length);
    console.log("📄 Inner content preview:", JSON.stringify(match[2]?.substring(0, 100)));
    console.log("🔍 Match index in TextNode:", textNode.getTextContent().indexOf(match[0]));
    
    // match[0] = full "{++...++}", "{--...--}", or "{~~...~>...~~}"
    // match[1] = "++", "--", or "~~"
    // match[2] = inner content
    const marks = match[1]!;
    let inner = match[2] ?? "";

    // Convert \n back to actual newlines if they were normalized during preprocessing
    if (inner.includes('\\n')) {
      inner = inner.replace(/\\n/g, '\n');
    }

    if (marks === "~~") {
      // Handle update syntax: {~~old~>new~~}
      const updateParts = inner.split('~>');
      if (updateParts.length === 2) {
        const [beforeText, afterText] = updateParts;
        console.log("🏷️ Creating DiffTagNode with tag: update");
        console.log("📝 Before text:", JSON.stringify(beforeText));
        console.log("📝 After text:", JSON.stringify(afterText));
        
        const diff = $createDiffTagNode("update", beforeText, afterText);
        
        // Simply replace the text node with our diff node
        console.log("🔄 Replacing text node with update diff node");
        textNode.replace(diff);
        console.log("✅ Replace operation completed for update");
        return;
      } else {
        console.log("⚠️ Malformed update syntax, falling back to regular text");
        // Fallback: treat as regular text
        return;
      }
    }

    // Handle insert/delete syntax: {++...++} or {--...--}
    const tag = marks === "++" ? "ins" : "del";
    console.log("🏷️ Creating DiffTagNode with tag:", tag);
    
    const diff = $createDiffTagNode(tag);
    const textNodeContent = $createTextNode(inner);
    console.log("📝 Created TextNode with content length:", textNodeContent.getTextContent().length);
    
    diff.append(textNodeContent);
    console.log("🔗 Appended TextNode to DiffTagNode");
    console.log("📊 DiffTagNode children count:", diff.getChildrenSize());
    console.log("📊 DiffTagNode text content length:", diff.getTextContent().length);

    // Simply replace the text node with our diff node
    // Lexical will handle the text replacement automatically
    console.log("🔄 Replacing text node with diff node");
    textNode.replace(diff);
    console.log("✅ Replace operation completed");
  },
  // We only handle import; exporting is done by an Element transformer for DiffTagNode
  export: () => {
    console.log("🚫 CRITIC_MARKUP export called (should not happen)");
    return null;
  },
  dependencies: [DiffTagNode]
};

/**
 * Element transformer for DiffTagNode to handle markdown export
 * - Converts DiffTagNode instances to CriticMarkup syntax during export
 * - Handles both "ins" and "del" tag types
 * - Used by Lexical markdown export to convert DiffTagNodes to text
 */
export const DIFF_TAG_ELEMENT: ElementTransformer = {
  type: "element",
  dependencies: [DiffTagNode], // ✅ Specify DiffTagNode as dependency
  export: (node: LexicalNode) => {
    console.log("📤 DIFF_TAG_ELEMENT export called");
    console.log("🔍 Node type:", node.getType());
    console.log("🔍 Node key:", node.getKey());
    console.log("🔍 Is DiffTagNode?", $isDiffTagNode(node));
    
    if ($isDiffTagNode(node)) {
      console.log("✅ Processing DiffTagNode for export");
      const result = node.exportMarkdown();
      console.log("🎯 DIFF_TAG_ELEMENT export result:", JSON.stringify(result));
      return result;
    }
    
    console.log("❌ Not a DiffTagNode, returning null");
    return null;
  },
  regExp: /^$/, // This won't be used for import, only export
  replace: () => {
    // This won't be called since we only handle export
    return false;
  }
};

/**
 * Debug function to test CRITIC_MARKUP regex matching
 * - Tests the regex pattern against a given text
 * - Logs all matches found
 * - Helps identify why certain text might not be matched
 */
export function debugCriticMarkupMatching(text: string): void {
  console.log("🔍 Debugging CRITIC_MARKUP matching for text:");
  console.log("📝 Text length:", text.length);
  console.log("📝 Text preview:", text.substring(0, 200) + "...");
  
  const regex = /\{([+-~]{2})([\s\S]+?)\1\}/g;
  let match;
  let matchCount = 0;
  
  while ((match = regex.exec(text)) !== null) {
    matchCount++;
    console.log(`🎯 Match ${matchCount}:`);
    console.log("  Full match:", match[0]);
    console.log("  Marks:", match[1]);
    console.log("  Inner content length:", match[2]?.length);
    console.log("  Inner content preview:", match[2]?.substring(0, 100) + "...");
    console.log("  Match index:", match.index);
    
    // Special handling for update patterns
    if (match[1] === "~~") {
      const updateParts = match[2]?.split('~>');
      if (updateParts && updateParts.length === 2) {
        console.log("  Update - Before text:", updateParts[0]);
        console.log("  Update - After text:", updateParts[1]);
      } else {
        console.log("  ⚠️  Malformed update pattern");
      }
    }
    console.log("---");
  }
  
  console.log(`📊 Total matches found: ${matchCount}`);
}

/**
 * Preprocesses markdown to normalize multiline CriticMarkup
 * - Converts multiline CriticMarkup to single-line format
 * - Preserves newlines within CriticMarkup content as \n
 * - Ensures existing single-line CriticMarkup remains unchanged
 * - Used before passing markdown to Lexical to prevent text node splitting issues
 */
export function preprocessCriticMarkup(markdown: string): string {
  // Regex to match multiline CriticMarkup patterns
  // This matches {--...--}, {++...++}, or {~~...~>...~~} that may span multiple lines
  const multilineCriticMarkupRegex = /\{([+-~]{2})([\s\S]*?)\1\}/g;
  
  return markdown.replace(multilineCriticMarkupRegex, (match, marks, content) => {
    // Check if the content contains actual newlines (not just \n characters)
    if (content.includes('\n')) {
      // Replace actual newlines with \n characters to preserve them in single-line format
      const normalizedContent = content.replace(/\n/g, '\\n');
      return `{${marks}${normalizedContent}${marks}}`;
    }
    // If no newlines, return the original match unchanged
    return match;
  });
}

/**
 * Debug function to analyze text node structure
 * - Helps understand how text is being split into TextNodes
 * - Shows the full text content and how it's fragmented
 */
export function debugTextNodeStructure(editor: any): void {
  console.log("🔍 Debugging TextNode structure:");
  
  // Get all text nodes in the editor
  const textNodes: any[] = [];
  editor.getEditorState().read(() => {
    const root = editor.getEditorState()._nodeMap.get('root');
    if (root) {
      const traverse = (node: any) => {
        if (node.getType() === 'text') {
          textNodes.push({
            key: node.getKey(),
            content: node.getTextContent(),
            length: node.getTextContent().length,
            contentJson: JSON.stringify(node.getTextContent())
          });
        }
        node.getChildren().forEach(traverse);
      };
      traverse(root);
    }
  });
  
  console.log("📊 Found", textNodes.length, "TextNodes:");
  textNodes.forEach((node, index) => {
    console.log(`  ${index + 1}. Key: ${node.key}, Length: ${node.length}`);
    console.log(`      Content: ${node.contentJson}`);
  });
}