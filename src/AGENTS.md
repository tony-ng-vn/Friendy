# Source Agent Instructions

This directory contains the Friendy application and agent source.

- Use TypeScript types and runtime validation at boundaries where untrusted text, env vars, or model output enters the system.
- Add or update tests before changing behavior.
- Keep comments focused on intent, constraints, or tradeoffs. Do not narrate obvious code.
- Prefer small modules with one clear responsibility over adding more branches to large files.
- Run targeted tests for touched modules before full verification.

Common commands:

```bash
npm test -- src/<path-to-test>
npm run build
```
