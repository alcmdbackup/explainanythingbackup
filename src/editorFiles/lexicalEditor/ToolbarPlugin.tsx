/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SELECTION_CHANGE_COMMAND,
  FORMAT_TEXT_COMMAND,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $getNodeByKey
} from "lexical";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $wrapNodes, $isAtNodeEnd } from "@lexical/selection";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode
} from "@lexical/list";
import { createPortal } from "react-dom";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode
} from "@lexical/rich-text";
import {
  $createCodeNode,
  $isCodeNode,
  getDefaultCodeLanguage,
  getCodeLanguages
} from "@lexical/code";

const LowPriority = 1;

const supportedBlockTypes = new Set([
  "paragraph",
  "quote",
  "code",
  "h1",
  "h2",
  "ul",
  "ol"
]);

const blockTypeToBlockName = {
  code: "Code Block",
  h1: "Large Heading",
  h2: "Small Heading",
  h3: "Heading",
  h4: "Heading",
  h5: "Heading",
  ol: "Numbered List",
  paragraph: "Normal",
  quote: "Quote",
  ul: "Bulleted List"
};

function Divider() {
  return <div className="divider w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />;
}

function positionEditorElement(editor: HTMLElement, rect: DOMRect | null) {
  if (rect === null) {
    editor.style.opacity = "0";
    editor.style.top = "-1000px";
    editor.style.left = "-1000px";
  } else {
    editor.style.opacity = "1";
    editor.style.top = `${rect.top + rect.height + window.pageYOffset + 10}px`;
    editor.style.left = `${
      rect.left + window.pageXOffset - editor.offsetWidth / 2 + rect.width / 2
    }px`;
  }
}

function FloatingLinkEditor({ editor }: { editor: any }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mouseDownRef = useRef(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [isEditMode, setEditMode] = useState(false);
  const [lastSelection, setLastSelection] = useState<any>(null);

  const updateLinkEditor = useCallback(() => {
    const selection = $getSelection();
    console.log("🔍 FloatingLinkEditor updateLinkEditor called, selection:", selection);
    if ($isRangeSelection(selection)) {
      const node = getSelectedNode(selection);
      const parent = node.getParent();
      console.log("🔍 Node:", node, "Parent:", parent);
      if ($isLinkNode(parent)) {
        console.log("✅ Found link in parent, URL:", parent.getURL());
        setLinkUrl(parent.getURL());
      } else if ($isLinkNode(node)) {
        console.log("✅ Found link in node, URL:", node.getURL());
        setLinkUrl(node.getURL());
      } else {
        console.log("❌ No link found, clearing URL");
        setLinkUrl("");
      }
    }
    const editorElem = editorRef.current;
    const nativeSelection = window.getSelection();
    const activeElement = document.activeElement;

    if (editorElem === null || nativeSelection === null) {
      return;
    }

    const rootElement = editor.getRootElement();
    if (
      selection !== null &&
      !nativeSelection.isCollapsed &&
      rootElement !== null &&
      rootElement.contains(nativeSelection.anchorNode)
    ) {
      const domRange = nativeSelection.getRangeAt(0);
      let rect;
      if (nativeSelection.anchorNode === rootElement) {
        let inner = rootElement;
        while (inner.firstElementChild != null) {
          inner = inner.firstElementChild;
        }
        rect = inner.getBoundingClientRect();
      } else {
        rect = domRange.getBoundingClientRect();
      }

      if (!mouseDownRef.current) {
        positionEditorElement(editorElem, rect);
      }
      setLastSelection(selection);
    } else if (!activeElement || activeElement.className !== "link-input") {
      positionEditorElement(editorElem, null);
      setLastSelection(null);
      setEditMode(false);
      setLinkUrl("");
    }

    return true;
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }: { editorState: any }) => {
        editorState.read(() => {
          updateLinkEditor();
        });
      }),

      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateLinkEditor();
          return true;
        },
        LowPriority
      )
    );
  }, [editor, updateLinkEditor]);

  useEffect(() => {
    editor.getEditorState().read(() => {
      updateLinkEditor();
    });
  }, [editor, updateLinkEditor]);

  useEffect(() => {
    if (isEditMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditMode]);

  return (
    <div ref={editorRef} className="link-editor absolute z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg p-2 min-w-64">
      {isEditMode ? (
        <input
          ref={inputRef}
          className="link-input w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={linkUrl}
          onChange={(event) => {
            setLinkUrl(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (lastSelection !== null) {
                if (linkUrl !== "") {
                  editor.dispatchCommand(TOGGLE_LINK_COMMAND, linkUrl);
                }
                setEditMode(false);
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              setEditMode(false);
            }
          }}
        />
      ) : (
        <>
          <div className="link-input flex items-center gap-2">
            <a href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm truncate">
              {linkUrl}
            </a>
            <button
              className="link-edit px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
              role="button"
              tabIndex={0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setEditMode(true);
              }}
            >
              Edit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Select({ onChange, className, options, value }: { 
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  className: string;
  options: string[];
  value: string;
}) {
  return (
    <select className={className} onChange={onChange} value={value}>
      <option hidden={true} value="" />
      {options.map((option: string) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function getSelectedNode(selection: any) {
  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();
  if (anchorNode === focusNode) {
    return anchorNode;
  }
  const isBackward = selection.isBackward();
  if (isBackward) {
    return $isAtNodeEnd(focus) ? anchorNode : focusNode;
  } else {
    return $isAtNodeEnd(anchor) ? focusNode : anchorNode;
  }
}

function BlockOptionsDropdownList({
  editor,
  blockType,
  toolbarRef,
  setShowBlockOptionsDropDown
}: {
  editor: any;
  blockType: string;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  setShowBlockOptionsDropDown: (show: boolean) => void;
}) {
  const dropDownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    const dropDown = dropDownRef.current;

    if (toolbar !== null && dropDown !== null) {
      const { top, left } = toolbar.getBoundingClientRect();
      dropDown.style.top = `${top + 40}px`;
      dropDown.style.left = `${left}px`;
    }
  }, [dropDownRef, toolbarRef]);

  useEffect(() => {
    const dropDown = dropDownRef.current;
    const toolbar = toolbarRef.current;

    if (dropDown !== null && toolbar !== null) {
      const handle = (event: MouseEvent) => {
        const target = event.target as Node;

        if (!dropDown.contains(target) && !toolbar.contains(target)) {
          setShowBlockOptionsDropDown(false);
        }
      };
      document.addEventListener("click", handle);

      return () => {
        document.removeEventListener("click", handle);
      };
    }
  }, [dropDownRef, setShowBlockOptionsDropDown, toolbarRef]);

  const formatParagraph = () => {
    if (blockType !== "paragraph") {
      editor.update(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
          $wrapNodes(selection, () => $createParagraphNode());
        }
      });
    }
    setShowBlockOptionsDropDown(false);
  };

  const formatLargeHeading = () => {
    if (blockType !== "h1") {
      editor.update(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
          $wrapNodes(selection, () => $createHeadingNode("h1"));
        }
      });
    }
    setShowBlockOptionsDropDown(false);
  };

  const formatSmallHeading = () => {
    if (blockType !== "h2") {
      editor.update(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
          $wrapNodes(selection, () => $createHeadingNode("h2"));
        }
      });
    }
    setShowBlockOptionsDropDown(false);
  };

  const formatBulletList = () => {
    if (blockType !== "ul") {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND);
    } else {
      editor.dispatchCommand(REMOVE_LIST_COMMAND);
    }
    setShowBlockOptionsDropDown(false);
  };

  const formatNumberedList = () => {
    if (blockType !== "ol") {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND);
    } else {
      editor.dispatchCommand(REMOVE_LIST_COMMAND);
    }
    setShowBlockOptionsDropDown(false);
  };

  const formatQuote = () => {
    if (blockType !== "quote") {
      editor.update(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
          $wrapNodes(selection, () => $createQuoteNode());
        }
      });
    }
    setShowBlockOptionsDropDown(false);
  };

  const formatCode = () => {
    if (blockType !== "code") {
      editor.update(() => {
        const selection = $getSelection();

        if ($isRangeSelection(selection)) {
          $wrapNodes(selection, () => $createCodeNode());
        }
      });
    }
    setShowBlockOptionsDropDown(false);
  };

  return (
    <div className="dropdown absolute z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg p-1 min-w-48" ref={dropDownRef}>
      <button className="item w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-between" onClick={formatParagraph}>
        <div className="flex items-center gap-2">
          <span className="icon paragraph text-sm">¶</span>
          <span className="text text-sm">Normal</span>
        </div>
        {blockType === "paragraph" && <span className="active text-blue-500">✓</span>}
      </button>
      <button className="item w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-between" onClick={formatLargeHeading}>
        <div className="flex items-center gap-2">
          <span className="icon large-heading text-sm font-bold">H1</span>
          <span className="text text-sm">Large Heading</span>
        </div>
        {blockType === "h1" && <span className="active text-blue-500">✓</span>}
      </button>
      <button className="item w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-between" onClick={formatSmallHeading}>
        <div className="flex items-center gap-2">
          <span className="icon small-heading text-sm font-bold">H2</span>
          <span className="text text-sm">Small Heading</span>
        </div>
        {blockType === "h2" && <span className="active text-blue-500">✓</span>}
      </button>
      <button className="item w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-between" onClick={formatBulletList}>
        <div className="flex items-center gap-2">
          <span className="icon bullet-list text-sm">•</span>
          <span className="text text-sm">Bullet List</span>
        </div>
        {blockType === "ul" && <span className="active text-blue-500">✓</span>}
      </button>
      <button className="item w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-between" onClick={formatNumberedList}>
        <div className="flex items-center gap-2">
          <span className="icon numbered-list text-sm">1.</span>
          <span className="text text-sm">Numbered List</span>
        </div>
        {blockType === "ol" && <span className="active text-blue-500">✓</span>}
      </button>
      <button className="item w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-between" onClick={formatQuote}>
        <div className="flex items-center gap-2">
          <span className="icon quote text-sm">&quot;</span>
          <span className="text text-sm">Quote</span>
        </div>
        {blockType === "quote" && <span className="active text-blue-500">✓</span>}
      </button>
      <button className="item w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-between" onClick={formatCode}>
        <div className="flex items-center gap-2">
          <span className="icon code text-sm font-mono">&lt;/&gt;</span>
          <span className="text text-sm">Code Block</span>
        </div>
        {blockType === "code" && <span className="active text-blue-500">✓</span>}
      </button>
    </div>
  );
}

/**
 * Advanced toolbar plugin for rich text editing
 * 
 * • Provides block type controls (paragraph, headings, lists, quotes, code)
 * • Includes text formatting (bold, italic, underline, strikethrough, code)
 * • Supports link creation and editing with floating editor
 * • Code language selection for code blocks
 * • Dropdown menus for block type selection
 * • Uses Lexical commands for all formatting operations
 * • Hides when in plain text mode (isMarkdownMode = false)
 * • Used by: LexicalEditor for comprehensive rich text editing
 */
export default function ToolbarPlugin({ isMarkdownMode = true }: { isMarkdownMode?: boolean }) {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [blockType, setBlockType] = useState("paragraph");
  const [selectedElementKey, setSelectedElementKey] = useState<string | null>(null);
  const [showBlockOptionsDropDown, setShowBlockOptionsDropDown] = useState(
    false
  );
  const [codeLanguage, setCodeLanguage] = useState("");
  const [isLink, setIsLink] = useState(false);
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      const elementKey = element.getKey();
      const elementDOM = editor.getElementByKey(elementKey);
      if (elementDOM !== null) {
        setSelectedElementKey(elementKey);
        if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType(anchorNode, ListNode);
          const type = parentList ? parentList.getTag() : element.getTag();
          setBlockType(type);
        } else {
          const type = $isHeadingNode(element)
            ? element.getTag()
            : element.getType();
          setBlockType(type);
          if ($isCodeNode(element)) {
            setCodeLanguage(element.getLanguage() || getDefaultCodeLanguage());
          }
        }
      }
      // Update text format
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsUnderline(selection.hasFormat("underline"));
      setIsStrikethrough(selection.hasFormat("strikethrough"));
      setIsCode(selection.hasFormat("code"));

      // Update links
      const node = getSelectedNode(selection);
      const parent = node.getParent();
      if ($isLinkNode(parent) || $isLinkNode(node)) {
        setIsLink(true);
      } else {
        setIsLink(false);
      }
    }
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        LowPriority
      )
    );
  }, [editor, updateToolbar]);

  const codeLanguges = useMemo(() => getCodeLanguages(), []);
  const onCodeLanguageSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      editor.update(() => {
        if (selectedElementKey !== null) {
          const node = $getNodeByKey(selectedElementKey);
          if ($isCodeNode(node)) {
            node.setLanguage(e.target.value);
          }
        }
      });
    },
    [editor, selectedElementKey]
  );

  const insertLink = useCallback(() => {
    console.log("🔗 Link button clicked, isLink:", isLink);
    
    editor.update(() => {
      const selection = $getSelection();
      console.log("📝 Current selection:", selection);
      
      if (!isLink) {
        console.log("🚀 Dispatching TOGGLE_LINK_COMMAND with https://");
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, "https://");
      } else {
        console.log("🗑️ Dispatching TOGGLE_LINK_COMMAND with null to remove link");
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      }
    });
  }, [editor, isLink]);

  // Hide toolbar when in plain text mode
  if (!isMarkdownMode) {
    return null;
  }

  return (
    <div className="toolbar flex flex-wrap gap-1 p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-800 mb-2" ref={toolbarRef}>
      {supportedBlockTypes.has(blockType) && (
        <>
          <button
            className="toolbar-item block-controls px-3 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors flex items-center gap-2"
            onClick={() =>
              setShowBlockOptionsDropDown(!showBlockOptionsDropDown)
            }
            aria-label="Formatting Options"
          >
            <span className={"icon block-type " + blockType + " text-sm"} />
            <span className="text text-sm">{blockTypeToBlockName[blockType as keyof typeof blockTypeToBlockName]}</span>
            <i className="chevron-down text-xs">▼</i>
          </button>
          {showBlockOptionsDropDown &&
            createPortal(
              <BlockOptionsDropdownList
                editor={editor}
                blockType={blockType}
                toolbarRef={toolbarRef}
                setShowBlockOptionsDropDown={setShowBlockOptionsDropDown}
              />,
              document.body
            )}
          <Divider />
        </>
      )}
      {blockType === "code" ? (
        <>
          <Select
            className="toolbar-item code-language px-3 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
            onChange={onCodeLanguageSelect}
            options={codeLanguges}
            value={codeLanguage}
          />
          <i className="chevron-down inside text-xs ml-1">▼</i>
        </>
      ) : (
        <>
          <button
            onClick={() => {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
            }}
            className={`toolbar-item spaced px-3 py-1 rounded transition-colors ${isBold ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'}`}
            aria-label="Format Bold"
          >
            <i className="format bold font-bold">B</i>
          </button>
          <button
            onClick={() => {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
            }}
            className={`toolbar-item spaced px-3 py-1 rounded transition-colors ${isItalic ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'}`}
            aria-label="Format Italics"
          >
            <i className="format italic italic">I</i>
          </button>
          <button
            onClick={() => {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
            }}
            className={`toolbar-item spaced px-3 py-1 rounded transition-colors ${isUnderline ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'}`}
            aria-label="Format Underline"
          >
            <i className="format underline underline">U</i>
          </button>
          <button
            onClick={() => {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
            }}
            className={`toolbar-item spaced px-3 py-1 rounded transition-colors ${isStrikethrough ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'}`}
            aria-label="Format Strikethrough"
          >
            <i className="format strikethrough line-through">S</i>
          </button>
          <button
            onClick={() => {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code");
            }}
            className={`toolbar-item spaced px-3 py-1 rounded transition-colors ${isCode ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'}`}
            aria-label="Insert Code"
          >
            <i className="format code font-mono text-sm">&lt;/&gt;</i>
          </button>
          <button
            onClick={insertLink}
            className={`toolbar-item spaced px-3 py-1 rounded transition-colors ${isLink ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'}`}
            aria-label="Insert Link"
          >
            <i className="format link">🔗</i>
          </button>
          {isLink &&
            createPortal(<FloatingLinkEditor editor={editor} />, document.body)}
        </>
      )}
    </div>
  );
}
