# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]: Welcome back
      - generic [ref=e6]: Enter your email and password to login
    - generic [ref=e7]:
      - generic [ref=e8]:
        - generic [ref=e9]:
          - text: Email
          - textbox "Email" [disabled] [ref=e10]:
            - /placeholder: name@example.com
            - text: invalid@email.com
        - generic [ref=e11]:
          - text: Password
          - generic [ref=e12]:
            - textbox "Password" [disabled] [ref=e13]:
              - /placeholder: ••••••••
              - text: wrongpassword
            - button "Show password" [disabled] [ref=e14]:
              - img [ref=e15]
        - generic [ref=e18]:
          - generic [ref=e19]:
            - checkbox "Remember me" [disabled] [ref=e20]
            - checkbox [disabled]
            - generic [ref=e21]: Remember me
          - link "Forgot password?" [ref=e22] [cursor=pointer]:
            - /url: /forgot-password
      - generic [ref=e23]:
        - button "Logging in..." [disabled]:
          - img
          - text: Logging in...
        - generic [ref=e28]: or
        - button "Don't have an account? Sign up" [disabled]
  - button "Open Next.js Dev Tools" [ref=e34] [cursor=pointer]:
    - img [ref=e35]
  - alert [ref=e39]
```