# Page snapshot

```yaml
- generic [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e12]:
    - navigation [ref=e13]:
      - generic [ref=e15]:
        - link "ExplainAnything" [ref=e16] [cursor=pointer]:
          - /url: /
          - img [ref=e17]
          - heading "ExplainAnything" [level=1] [ref=e19]
        - generic [ref=e20]:
          - link "Home" [ref=e21] [cursor=pointer]:
            - /url: /
          - link "My Library" [ref=e22] [cursor=pointer]:
            - /url: /userlibrary
          - link "Explore" [ref=e23] [cursor=pointer]:
            - /url: /explanations
          - link "Settings" [ref=e24] [cursor=pointer]:
            - /url: /settings
          - button "Logout" [ref=e25]
    - main [ref=e28]:
      - generic [ref=e29]:
        - heading "Explain Anything" [level=1] [ref=e30]
        - paragraph [ref=e31]: Learn about any topic, simply explained
      - generic [ref=e35]:
        - textbox "What would you like to learn?" [ref=e36]: quantum entanglement
        - button "Search" [active] [ref=e37] [cursor=pointer]
```