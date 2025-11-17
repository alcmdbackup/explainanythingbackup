# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - navigation [ref=e3]:
      - generic [ref=e5]:
        - heading "Explain Anything" [level=1] [ref=e6]
        - generic [ref=e9]:
          - textbox "Search any topic..." [ref=e10]: quantum entanglement
          - button "Search" [ref=e11]
        - generic [ref=e12]:
          - link "Home" [ref=e13] [cursor=pointer]:
            - /url: /
          - link "My Library" [ref=e14] [cursor=pointer]:
            - /url: /userlibrary
          - link "All explanations" [ref=e15] [cursor=pointer]:
            - /url: /explanations
          - button "Logout" [ref=e16]
    - main [ref=e18]:
      - generic [ref=e24]:
        - heading "AI Suggestions" [level=3] [ref=e26]
        - generic [ref=e27]:
          - generic [ref=e28]:
            - generic [ref=e29]: What would you like to improve?
            - textbox "What would you like to improve?" [ref=e30]:
              - /placeholder: Describe what you'd like to improve about this content...
          - button "Get AI Suggestions" [disabled] [ref=e31]
          - generic [ref=e32]:
            - paragraph [ref=e33]: • Describe the improvements you'd like to see
            - paragraph [ref=e34]: • AI will analyze and enhance your content
            - paragraph [ref=e35]: • Changes will be applied directly to the editor
  - button "Open Next.js Dev Tools" [ref=e41] [cursor=pointer]:
    - img [ref=e42]
  - alert [ref=e45]
```