# Login Screen Redesign Plan

## Overview
Transform the bare HTML login screen into a modern, polished form with essential UX improvements, using shadcn/ui components and maintaining project standards.

**Design Direction**: Modern & Minimal with Subtle animations
**Priority**: Quick Polish - focus on essential improvements
**Features**: Password visibility toggle, inline validation, remember me, forgot password

---

## Current State Analysis

### Login Page (`/src/app/login/page.tsx`)
- **Current**: 14 lines of bare HTML
- **Issues**:
  - Zero styling (no Tailwind despite it being project standard)
  - No client-side validation
  - Errors redirect to separate `/error` page (poor UX)
  - No loading states
  - No password visibility toggle
  - Missing features: remember me, forgot password
  - Type casting without validation (has TODO comment)
  - Uses console.error instead of project logger

### Error Page (`/src/app/error/page.tsx`)
- **Current**: Needs investigation and cleanup
- **Issues**: Generic error display, likely needs better styling and messaging for auth-specific errors

### Server Actions (`/src/app/login/actions.ts`)
- **Current**: Basic implementation with TODOs
- **Issues**:
  - Redirects to error page instead of returning errors
  - No input validation (TODO comment acknowledges this)
  - Uses console.error instead of project logger
  - Type casting FormData without validation

---

## Phase 1: Setup shadcn/ui Foundation

### 1.1 Initialize shadcn/ui
```bash
npx shadcn@latest init
```
**Configuration**:
- Style: Default
- Base color: Slate (or match existing theme)
- CSS variables: Yes
- TypeScript: Yes (strict mode)
- Tailwind config: Use existing
- Components location: `@/components/ui`

### 1.2 Install Core Components
```bash
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add label
npx shadcn@latest add form
npx shadcn@latest add card
npx shadcn@latest add checkbox
npx shadcn@latest add spinner
```

**Component Rationale**:
- `button` - Modern button with variants (primary/secondary/outline)
- `input` - Styled input fields with error states
- `label` - Properly associated labels
- `form` - react-hook-form + Zod integration (project standard)
- `card` - Container for login form
- `checkbox` - Remember me functionality
- `spinner` - Loading state indicator (circle variant for subtle effect)

### 1.3 Additional Dependencies
```bash
npm install react-hook-form zod @hookform/resolvers lucide-react
```
**Note**: Check if these are already installed

---

## Phase 2: Login Page Restructure

### 2.1 New Component Structure
**File**: `/src/app/login/page.tsx`

```
LoginPage
├── Card (centered container)
│   ├── CardHeader
│   │   ├── Logo/Title
│   │   └── Subtitle/Description
│   ├── CardContent
│   │   └── Form (react-hook-form + Zod)
│   │       ├── Email Field
│   │       │   ├── Label
│   │       │   ├── Input
│   │       │   └── Error Message (inline)
│   │       ├── Password Field
│   │       │   ├── Label
│   │       │   ├── Input (with Eye icon toggle)
│   │       │   └── Error Message (inline)
│   │       ├── Remember Me Checkbox
│   │       ├── Forgot Password Link
│   │       └── Form-level Error Display
│   └── CardFooter
│       ├── Submit Button (Login - with spinner on loading)
│       ├── Separator ("or")
│       └── Signup Button (Secondary variant)
```

### 2.2 Key Features Implementation

#### Password Visibility Toggle
- Eye icon button (lucide-react: `Eye` / `EyeOff`)
- Toggles input type between `password` and `text`
- Icon changes based on state
- Accessible (proper aria-label)

#### Inline Validation (Zod Schema)
```typescript
const loginSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password is too long'),
  rememberMe: z.boolean().optional()
});
```

#### Loading States
- Disable all form inputs during submission
- Show spinner in submit button
- Prevent double submission
- Visual feedback (button opacity/cursor changes)

#### Error Handling
- Inline field errors (below each input)
- Form-level errors (at top of form, styled alert)
- No more redirects to `/error` page
- User-friendly error messages

#### Remember Me
- Checkbox with label
- Persist preference (localStorage or cookie)
- Pass to server action

#### Forgot Password
- Link below password field
- Routes to `/forgot-password` (create if doesn't exist)
- Subtle styling (muted text, underline on hover)

### 2.3 Styling Approach
- **Layout**: Centered card on page, max-width 400px
- **Background**: Subtle gradient or solid (match app theme)
- **Spacing**: Consistent padding/margins using Tailwind
- **Typography**: Match existing app hierarchy
- **Colors**: Use CSS variables from shadcn (--primary, --muted, etc.)
- **Responsive**: Mobile-friendly (full width on small screens)

### 2.4 Accessibility Requirements
- Proper ARIA labels on all inputs
- Error messages associated with fields (aria-describedby)
- Keyboard navigation (tab order, enter to submit)
- Focus management (focus on error field)
- Screen reader friendly error announcements
- Proper contrast ratios (WCAG AA)

---

## Phase 3: Error Page Cleanup

### 3.1 Current Error Page Investigation
**File**: `/src/app/error/page.tsx`

**Tasks**:
1. Review current implementation
2. Identify if it's used for non-auth errors too
3. Determine if it should be removed entirely or improved

### 3.2 Error Page Options

#### Option A: Remove Error Page (Preferred)
- All auth errors handled inline on login page
- Generic app errors use global error boundary
- Cleaner user experience

#### Option B: Improve Error Page
If kept for other purposes:
- Better styling (use Card component)
- Categorize error types (auth vs system errors)
- Helpful messaging with actions
- Link back to login or home
- Match app design system

### 3.3 Implementation
- Update login/signup actions to return errors instead of redirecting
- Remove error page route if no longer needed
- Add global error boundary if not present

---

## Phase 4: Server Actions Update

### 4.1 Actions Refactor
**File**: `/src/app/login/actions.ts`

**Changes**:
1. **Remove error page redirects**
   ```typescript
   // Before:
   redirect(`/error?message=${result.error.message}`);

   // After:
   return { error: result.error.message };
   ```

2. **Add Zod validation**
   ```typescript
   const validatedFields = loginSchema.safeParse({
     email: formData.get('email'),
     password: formData.get('password'),
   });

   if (!validatedFields.success) {
     return { error: 'Invalid input fields' };
   }
   ```

3. **Replace console.error with logger**
   ```typescript
   // Before:
   console.error(result.error);

   // After:
   logger.error('Login failed', { error: result.error });
   ```

4. **Type-safe responses**
   ```typescript
   type AuthResult =
     | { success: true; redirectUrl: string }
     | { success: false; error: string };
   ```

5. **Handle remember me**
   ```typescript
   // Set cookie/session duration based on rememberMe flag
   ```

### 4.2 Error Message Improvements
- User-friendly messages (not raw Supabase errors)
- Specific errors: "Invalid email or password" vs "Something went wrong"
- Security: Don't reveal if email exists (timing attacks)
- Helpful suggestions: "Check your email/password"

---

## Phase 5: Validation & Types

### 5.1 Create Validation Schema
**File**: `/src/app/login/validation.ts` (new)

```typescript
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password is too long'),
  rememberMe: z.boolean().optional().default(false)
});

export const signupSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password is too long')
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[a-z]/, 'Password must contain lowercase letter')
    .regex(/[0-9]/, 'Password must contain number'),
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword']
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
```

### 5.2 Form Integration
- Use react-hook-form with zodResolver
- Real-time validation on blur/change
- Show errors immediately after field interaction
- Clear errors on successful validation

---

## Phase 6: Testing

### 6.1 Update Existing Tests
**File**: `/src/app/login/page.test.tsx`

**Updates needed**:
- Update selectors for new shadcn components
- Test new form structure
- Mock react-hook-form
- Mock server actions with new return types

### 6.2 New Test Cases

#### Unit Tests
1. **Password visibility toggle**
   - Click toggles input type
   - Icon changes between Eye/EyeOff
   - Password value persists

2. **Form validation**
   - Required field validation
   - Email format validation
   - Password length validation
   - Error message display

3. **Loading states**
   - Form disabled during submission
   - Spinner shows in button
   - Prevents double submission

4. **Remember me**
   - Checkbox toggles correctly
   - Value passed to server action

5. **Error handling**
   - Inline errors display
   - Form-level errors display
   - Errors clear on re-submit

#### Integration Tests
1. Successful login flow
2. Failed login with error display
3. Signup redirect
4. Forgot password link navigation

### 6.3 Accessibility Testing
- Test keyboard navigation
- Test screen reader announcements
- Test focus management
- Test error associations

---

## Phase 7: Polish & Quality Assurance

### 7.1 Code Quality
```bash
# Lint
npx eslint src/app/login --ext .ts,.tsx --fix

# Type check
npx tsc --noEmit

# Format
npx prettier --write src/app/login
```

### 7.2 Visual QA
- [ ] Consistent with rest of app design
- [ ] Responsive on mobile/tablet/desktop
- [ ] Dark mode support (if app has it)
- [ ] Loading states smooth
- [ ] Animations subtle and polished
- [ ] No layout shift
- [ ] Proper spacing/alignment

### 7.3 Manual Testing Checklist
- [ ] Login with valid credentials
- [ ] Login with invalid email
- [ ] Login with invalid password
- [ ] Login with empty fields
- [ ] Toggle password visibility
- [ ] Check remember me
- [ ] Click forgot password
- [ ] Click signup
- [ ] Test on mobile viewport
- [ ] Test keyboard navigation
- [ ] Test with screen reader

---

## Component Selection (shadcn MCP)

### Selected Components
✅ **button** - Core component, multiple variants
✅ **input** - Styled inputs with error states
✅ **label** - Proper form labels
✅ **form** - react-hook-form integration
✅ **card** - Login container
✅ **checkbox** - Remember me feature
✅ **spinner** (circle variant) - Subtle loading indicator

### Rejected Components
❌ **aurora-background** - Too flashy for "Modern & Minimal"
❌ **3d-card** - Too elaborate for "Quick Polish"
❌ **ripple-button** - Using standard button for consistency
❌ **liquid-button** - Too animated for "Subtle" requirement
❌ **animated-beam** - Unnecessary visual complexity
❌ **text-reveal** - Not aligned with minimal approach

### Rationale
Focus on essential, production-ready components that improve UX without visual gimmicks. Maintain consistency with rest of application.

---

## Technical Decisions

### Architecture
- ✅ Use Next.js 15 server actions (existing pattern)
- ✅ Client component for form interactivity
- ✅ Server-side validation (defense in depth)
- ✅ Type-safe throughout (TypeScript strict mode)

### State Management
- react-hook-form for form state (shadcn/ui standard)
- No global state needed (form is isolated)
- Local state for password visibility toggle

### Validation
- ✅ Zod for schema validation (project standard)
- Client-side for UX (immediate feedback)
- Server-side for security (never trust client)
- Shared schema between client/server

### Styling
- ✅ Tailwind CSS exclusively (project standard)
- shadcn/ui components use CSS variables
- Responsive utilities (sm:, md:, lg:)
- No custom CSS files

### Dependencies
- Minimal additions (react-hook-form, zod)
- shadcn/ui components (no heavy libraries)
- lucide-react for icons (already in shadcn)
- No external animation libraries

---

## File Changes Summary

### Modified Files
1. `/src/app/login/page.tsx` - Complete restructure (~150 lines)
2. `/src/app/login/actions.ts` - Add validation, fix error handling
3. `/src/app/login/page.test.tsx` - Update tests for new structure
4. `/src/app/error/page.tsx` - Remove or improve (TBD)

### New Files
1. `/src/app/login/validation.ts` - Zod schemas and types
2. `/src/components/ui/*` - shadcn components (~7 components)
3. `/components.json` - shadcn configuration
4. `/src/app/forgot-password/page.tsx` - Forgot password flow (optional)

### Configuration Changes
1. `tailwind.config.ts` - May need updates for shadcn
2. `tsconfig.json` - Ensure paths configured for @/ alias

---

## Implementation Checklist

### Setup Phase
- [ ] Initialize shadcn/ui with `npx shadcn@latest init`
- [ ] Install required components (button, input, label, form, card, checkbox, spinner)
- [ ] Verify dependencies (react-hook-form, zod, lucide-react)
- [ ] Verify Tailwind configuration

### Development Phase
- [ ] Create validation schemas (`validation.ts`)
- [ ] Restructure login page with shadcn components
- [ ] Add password visibility toggle
- [ ] Implement inline validation
- [ ] Add remember me checkbox
- [ ] Add forgot password link
- [ ] Update server actions (remove redirects, add validation)
- [ ] Replace console.error with logger
- [ ] Handle error page (remove or improve)

### Testing Phase
- [ ] Update existing tests
- [ ] Add new test cases
- [ ] Run test suite (`npm test`)
- [ ] Manual QA testing
- [ ] Accessibility testing

### Polish Phase
- [ ] Run linter and fix issues
- [ ] Run type check
- [ ] Visual regression check
- [ ] Mobile/responsive testing
- [ ] Dark mode verification (if applicable)

### Deployment
- [ ] Code review
- [ ] Merge to main
- [ ] Deploy to staging
- [ ] Final QA on staging
- [ ] Deploy to production

---

## Success Metrics

### User Experience
- ✅ No more error page redirects (inline errors only)
- ✅ Immediate validation feedback
- ✅ Clear loading states
- ✅ Password visibility control
- ✅ Remember me option
- ✅ Accessible to all users

### Code Quality
- ✅ Type-safe throughout
- ✅ Proper validation (client + server)
- ✅ Follows project standards (Tailwind, Zod, logger)
- ✅ Well-tested (>80% coverage)
- ✅ No console.error usage
- ✅ No TODO comments

### Design
- ✅ Matches app design system
- ✅ Modern and polished
- ✅ Responsive on all devices
- ✅ Subtle, professional animations
- ✅ Consistent with "Modern & Minimal" direction

---

## Timeline Estimate

**Total**: ~4-6 hours

- Setup shadcn/ui: 30min
- Login page restructure: 2-3 hours
- Server actions update: 1 hour
- Error page cleanup: 30min
- Testing: 1-2 hours
- Polish & QA: 30min-1 hour

---

## Notes

- Prioritize inline error handling over error page redesign
- Keep animations subtle (circle spinner only)
- Focus on essential features (no over-engineering)
- Maintain consistency with existing codebase patterns
- Ensure accessibility compliance (WCAG AA minimum)
- Use project standards throughout (Tailwind, Zod, logger)

---

## Future Enhancements (Out of Scope)

These are nice-to-haves for future iterations:

- Social login buttons (Google, GitHub)
- Email verification flow
- Password strength indicator
- Rate limiting UI feedback
- Biometric login option
- Multi-factor authentication
- Login history/device management
- Animated background (aurora) for premium feel
- More elaborate animations (3D cards, ripple effects)

Keep current implementation focused on core improvements.