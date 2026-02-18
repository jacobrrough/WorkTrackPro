---
name: local-first-dev-guardian
description: Enforces local-first development workflow for WorkTrack Pro. Always reminds to test with npm run dev first, only push when features are confirmed working locally, and warns before suggesting git push. Use when implementing features, fixing bugs, or making code changes.
---

# Local-First Dev Guardian

## Core Mission

**ALWAYS develop and test locally before pushing to GitHub.** This prevents wasting Netlify build minutes and ensures features work before deployment.

## Mandatory Workflow

### Before Any Code Changes

1. **Always remind**: "Let's test this locally with `npm run dev` first"
2. **Never suggest**: Pushing untested code to GitHub
3. **Always verify**: Feature works at `http://localhost:3000` before considering push

### Development Process

```
1. Make code changes
2. Run: npm run dev
3. Test locally at http://localhost:3000
4. Verify feature works completely
5. Only then: consider git push (with warning)
```

### When to Push

**✅ Safe to push:**
- Feature is complete and tested locally
- Bug is fixed and verified locally  
- User explicitly says "this is ready to push" or "push this"

**❌ Never push:**
- "To test" or "to see if it works"
- Before local testing
- When user hasn't confirmed it's ready
- For debugging purposes

## Warning Before Git Push

**ALWAYS warn before suggesting git push:**

```
⚠️ Before pushing: Have you tested this locally with `npm run dev`? 
Only push if the feature is confirmed working locally.
```

Or:

```
⚠️ Remember: Netlify auto-deploys from GitHub main. 
Only push if you've tested locally and confirmed it works.
```

## Reminders to Include

When implementing features, always include reminders like:

- "Let's test this with `npm run dev` first"
- "Make sure to test locally before pushing"
- "After testing locally, we can push when you're ready"
- "This will need local testing before deployment"

## Anti-Patterns to Prevent

**❌ Never say:**
- "Let's push this to test it"
- "We can push and see if it works"
- "I'll push this now"
- Suggesting git push without local testing reminder

**✅ Always say:**
- "Let's test locally first with `npm run dev`"
- "After you've tested locally and confirmed it works, we can push"
- "Remember to test at localhost:3000 before pushing"

## Integration with WorkTrack Pro

This skill complements the existing WorkTrack Pro skill which covers:
- Local-first development patterns
- Environment variables (`.env.local`)
- Netlify auto-deploy workflow

The Guardian enforces these patterns by **always reminding** and **warning before push**.
