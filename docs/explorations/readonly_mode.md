Short answer: **yes**—you can fully prevent focus/caret in Lexical by switching to read-only (or programmatically blurring), and you can also *visually* hide the caret/focus ring with CSS if you still want the editor to be editable.

## Options (from “most locked down” to “cosmetic only”)

1. **Make the editor read-only (no focus, no caret, no editing)**

* In React: set `initialConfig={{ editable: false }}` on `LexicalComposer`, or toggle later with `editor.setEditable(false)`. Under the hood Lexical sets the root `contentEditable=false`, which prevents the caret entirely. ([Lexical][1])

```tsx
<LexicalComposer initialConfig={{ namespace: 'x', editable: false, theme, onError }}>
  {/* ... */}
</LexicalComposer>
```

2. **Programmatically remove focus (blur)**

* Call `editor.blur()` (e.g., on Escape or when closing a modal). This clears focus/selection, so the caret disappears. ([Lexical][2])

```ts
editor.registerCommand(KEY_ESCAPE_COMMAND, () => {
  editor.blur();
  return true;
}, COMMAND_PRIORITY_EDITOR);
```

3. **Keep editable, but hide the blinking caret (visual only)**

* CSS: `caret-color: transparent;` on the contentEditable element (works across modern browsers). The editor still accepts input; you’re just hiding the caret. ([MDN Web Docs][3])

```css
.myEditorContentEditable {
  caret-color: transparent;
}
```

4. **Suppress the visible focus ring but keep keyboard focus (visual only)**

* Prefer styling with `:focus-visible` rather than removing outlines universally, so keyboard users still get an indicator elsewhere in your UI. ([MDN Web Docs][4])

```css
.myEditorContentEditable:focus-visible {
  outline: none; /* or your custom ring */
}
```

## Notes & trade-offs

* **Accessibility:** Hiding focus styles or the caret can confuse keyboard/screen-reader users. If you must hide the caret, consider read-only mode instead—there’s no ambiguity then. ([Lexical][1])
* **Selection handling:** When blurred/read-only, Lexical’s selection becomes `null` (no active caret). If you rely on selection-based plugins, account for this state. ([Lexical][5])
* **Granular control:** You can mix approaches—e.g., editable + `editor.blur()` while a palette is open, then restore focus later.

If you share your component snippet (how you render `ContentEditable` / `LexicalComposer`), I can point to the exact element to target with the CSS or show a small toggleable read-only plugin.

[1]: https://lexical.dev/docs/concepts/read-only?utm_source=chatgpt.com "Read Mode / Edit Mode"
[2]: https://lexical.dev/docs/api/modules/lexical?utm_source=chatgpt.com "Lexical"
[3]: https://developer.mozilla.org/en-US/docs/Web/CSS/caret-color?utm_source=chatgpt.com "caret-color - CSS | MDN - Mozilla"
[4]: https://developer.mozilla.org/en-US/docs/Web/CSS/%3Afocus-visible?utm_source=chatgpt.com ":focus-visible - CSS | MDN - Mozilla"
[5]: https://lexical.dev/docs/concepts/selection?utm_source=chatgpt.com "Selection"
