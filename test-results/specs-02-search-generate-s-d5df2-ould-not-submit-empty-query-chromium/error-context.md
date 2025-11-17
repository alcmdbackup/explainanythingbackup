# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - navigation [ref=e3]:
      - generic [ref=e5]:
        - heading "Explain Anything" [level=1] [ref=e6]
        - generic [ref=e7]:
          - link "Home" [ref=e8] [cursor=pointer]:
            - /url: /
          - link "My Library" [ref=e9] [cursor=pointer]:
            - /url: /userlibrary
          - link "All explanations" [ref=e10] [cursor=pointer]:
            - /url: /explanations
          - button "Logout" [ref=e11]
    - main [ref=e14]:
      - heading "Explain Anything" [level=1] [ref=e16]
      - generic [ref=e20]:
        - textbox "Learn about any topic" [active] [ref=e21]
        - button "Search Topic" [ref=e22]
  - button "Open Next.js Dev Tools" [ref=e28] [cursor=pointer]:
    - img [ref=e29]
  - alert [ref=e32]
```