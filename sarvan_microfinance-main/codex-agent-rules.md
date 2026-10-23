# ⚠️ CODEX AGENT RULES — SHARED MULTI-DEVELOPER PROJECT

> **CRITICAL:** This is a shared project. Multiple developers may be working on the same repository at the same time.
>
> Your highest priority is to **complete only the assigned task without disturbing, overwriting, reverting, refactoring, or otherwise affecting anyone else's work**.
>
> These rules are mandatory. If completing a task appears to require violating any rule, **STOP and ask the user for permission before proceeding.**
>
> **When uncertain, do not assume. Ask first.**

---

## 1. STRICT TASK SCOPE

Only work on the exact task or feature explicitly requested by the user.

- Do not make unrelated changes.
- Do not fix unrelated bugs.
- Do not perform cleanup.
- Do not refactor unrelated code.
- Do not reformat unrelated files.
- Do not rename files, folders, functions, variables, components, routes, or APIs unless explicitly requested.
- Do not make "helpful" improvements outside the requested task.
- Do not expand the task scope based on assumptions.

If another change would be useful but is not required for the assigned task, **leave it untouched**.

---

## 2. SHARED PROJECT — PROTECT OTHER DEVELOPERS' WORK

Assume other developers have active work in the repository at all times.

Never:

- Overwrite another developer's changes.
- Revert another developer's changes.
- Delete another developer's code.
- Modify unrelated uncommitted changes.
- Resolve unrelated conflicts automatically.
- Replace a file simply because your preferred implementation is different.
- Restore files to an earlier Git version without permission.

Before editing a file, verify that the change is necessary for the current task.

If a required file contains existing modifications that appear unrelated to the assigned task, **preserve them exactly**.

If safely editing the file would risk overwriting another developer's work, **STOP and ask the user.**

---

## 3. EXISTING CODE MUST BE PRESERVED

Existing working code should be considered protected.

Do not modify existing:

- Business logic
- Application flows
- Navigation flows
- UI behavior
- API contracts
- Request formats
- Response formats
- Authentication logic
- Authorization logic
- Permission logic
- Validation logic
- Shared utilities
- Existing components
- Existing services
- Existing controllers

unless the current task explicitly requires that specific change.

Do not refactor or optimize existing code as a side effect.

If modifying existing behavior is necessary but was not explicitly requested, **STOP and explain what must change and why. Wait for approval.**

---

## 4. DATABASE SAFETY — CRITICAL

Treat all database-related operations as high risk.

### 4.1 Never perform without explicit user permission

Do not:

- Create migrations.
- Run migrations.
- Modify migrations.
- Create tables.
- Alter tables.
- Drop tables.
- Add/remove/rename columns.
- Modify indexes.
- Modify constraints.
- Modify relationships.
- Run seed scripts.
- Run cleanup scripts.
- Perform bulk updates/deletes.
- Reset databases.
- Recreate databases.

### 4.2 Production database

**Never modify the live/production database.**

Do not perform:

- Production schema changes.
- Production data changes.
- Production cleanup.
- Production seed operations.
- Production migrations.
- Destructive database commands.

If the requested feature requires a schema change, first provide the proposed change and explain why it is required.

Then **wait for explicit user approval before writing or running the migration.**

Never assume database permission from a previous task.

---

## 5. BACKEND AND API PROTECTION

Do not change existing backend behavior unless explicitly requested.

This includes:

- Existing endpoints
- Controllers
- Services
- Middleware
- Authentication
- Authorization
- Permissions
- Request validation
- Response structures
- Error structures
- Status codes
- Existing integrations

Prefer **additive implementation** where possible.

For example, prefer adding a new isolated function/component/file rather than changing unrelated existing functionality.

If an existing backend flow must change, ask for permission first unless that change was explicitly part of the user's request.

---

## 6. FRONTEND PROTECTION

Do not modify unrelated pages or components.

Do not change:

- Existing navigation
- Existing forms
- Existing validations
- Existing API integrations
- Existing state management
- Existing shared components
- Existing styles outside the assigned feature
- Existing responsive behavior

unless required by the current task.

Do not redesign or "improve" unrelated UI.

Keep frontend changes localized to the requested feature.

---

## 7. GIT SAFETY — EXTREMELY IMPORTANT

This repository may contain work from multiple developers.

### 7.1 Allowed read-only Git operations

You may use commands such as:

```bash
git status
git diff
git diff -- <specific-file>
git log
git branch
```

when necessary to understand the state of files related to the assigned task.

### 7.2 Never perform without explicit permission

Do not:

```bash
git reset
git reset --hard
git clean
git restore
git checkout -- <file>
git revert
git rebase
git merge
git cherry-pick
git stash
git stash pop
git commit
git push
git pull
```

Do not automatically resolve merge conflicts.

Do not switch branches if doing so could affect existing uncommitted work.

Do not force push under any circumstance unless the user explicitly requests it and confirms the target branch.

**Never discard uncommitted changes.**

If Git reports changes that were not created as part of the current task, assume they belong to another developer and leave them untouched.

### 7.3 Branches, commits, pushes, and pull requests

Unless explicitly requested, the agent must not:

- Create branches.
- Switch branches.
- Rename branches.
- Delete branches.
- Commit changes.
- Amend commits.
- Push changes.
- Force push.
- Pull changes.
- Merge branches.
- Rebase branches.
- Cherry-pick commits.
- Create pull requests.
- Merge pull requests.

Implementation permission does **not** automatically include Git publishing permission.

For example, being asked to:

> "Implement the customer search feature."

authorizes implementation within the approved scope. It does **not** automatically authorize:

```bash
git commit
git push
git merge
```

These actions require separate explicit instructions.

If the user explicitly requests a branch, commit, push, or pull request, follow the project's existing naming and commit conventions if they can be determined from minimal read-only inspection. Do not invent or change repository-wide Git conventions.

---

## 8. FILE SAFETY

Do not:

- Delete files.
- Move files.
- Rename files.
- Replace entire existing files unnecessarily.
- Reformat entire files for a small change.
- Change generated files unless explicitly required.
- Modify unrelated configuration files.

When editing an existing file, make the **smallest possible targeted change**.

Preserve unrelated code exactly.

---

## 9. CONFIGURATION AND ENVIRONMENT SAFETY

Do not modify without explicit permission:

- `.env`
- `.env.*`
- Build configuration
- Deployment configuration
- Docker configuration
- CI/CD pipelines
- Server configuration
- Production configuration
- Linter configuration
- Formatter configuration
- Package manager configuration
- Shared global configuration

Never expose, print, copy, commit, or include in responses:

- Passwords
- API keys
- Access tokens
- Private keys
- Database credentials
- Production secrets
- Environment secrets

### 9.1 Read-only dependency and configuration inspection

The agent may **read** dependency and configuration files when they are directly relevant to the assigned task, including:

- `package.json`
- `package-lock.json`
- `yarn.lock`
- `pnpm-lock.yaml`
- `requirements.txt`
- `pyproject.toml`
- `Podfile`
- Gradle files
- Build configuration
- TypeScript configuration
- Framework configuration

Reading these files to determine existing versions, scripts, configuration, or compatibility is allowed.

> **Reading does not grant permission to modify them.**

Any modification to dependencies or protected configuration still requires explicit permission unless the user specifically requested that modification.

Only inspect files directly relevant to the current task. Do not scan configuration files unnecessarily.

---

## 10. DEPENDENCY SAFETY

Do not install, remove, upgrade, or downgrade packages unless explicitly requested.

Do not modify dependency files such as:

- `package.json`
- lock files
- `requirements.txt`
- `pyproject.toml`
- `Podfile`
- Gradle dependencies
- other package/dependency manifests

unless required and explicitly approved.

If a new dependency appears necessary, explain:

1. What dependency is required.
2. Why it is required.
3. What files it will affect.

Then wait for approval.

---

## 11. MINIMAL CONTEXT READING

Do not scan or index the entire repository unnecessarily.

Only inspect:

- Files directly related to the assigned task.
- Their immediate dependencies when necessary.
- Specific configuration required to understand the feature.

Do not explore unrelated folders "to understand the project."

If additional project context is required, ask the user which files or modules are relevant rather than scanning broadly.

---

## 12. COMMAND EXECUTION SAFETY

Before running a command, consider whether it could:

- Modify files.
- Modify the database.
- Delete data.
- Change dependencies.
- Change Git state.
- Affect another developer's work.
- Affect external services.
- Affect production.

If yes and the action was not explicitly requested, **do not run it. Ask first.**

Prefer read-only inspection commands whenever possible.

---

## 13. TESTING SAFETY

You may run targeted, non-destructive tests related to the assigned feature when safe.

Do not run tests or scripts that:

- Modify production data.
- Reset databases.
- Run migrations.
- Seed databases.
- Delete data.
- Trigger real payments.
- Send real emails/messages.
- Affect production services.
- Modify external systems.

If you cannot determine whether a test is destructive, **do not run it until the user confirms.**

Do not fix unrelated test failures.

### 13.1 Testing environment safety

Assume that databases, APIs, services, queues, storage systems, payment systems, email systems, and other external resources may contain real or shared data unless their isolation is clearly established.

Do not assume a database is safe merely because the application is running locally.

Before running tests that can modify state, verify that the target environment is clearly:

- Local and isolated, or
- A dedicated test environment.

If this cannot be verified, do not run state-changing tests.

Read-only and isolated unit tests may be run when they are directly related to the assigned task.

Never allow tests to:

- Modify production data.
- Modify an unknown database.
- Run unapproved migrations.
- Send real emails.
- Send real SMS messages.
- Trigger real notifications.
- Process real payments.
- Modify cloud resources.
- Modify external services.
- Delete or overwrite shared data.

When environment safety cannot be determined:

> **STOP and ask the user before running the test.**

---

## 14. MINIMUM CHANGE PRINCIPLE

For every task, use the smallest change necessary to satisfy the requirement.

If the task can be completed by changing:

- 1 file instead of 3 → change 1.
- 5 lines instead of 50 → change 5.
- One component instead of a shared component → prefer the isolated component.

Avoid increasing the blast radius of the change.

---

## 15. EXPLICIT REQUEST VS. NECESSARY EXISTING-CODE CHANGE

A request to implement a feature does **not** automatically authorize modifications to every existing/shared file that could help implement it.

**Example:**

User requests:

> "Add validation to the signup form."

The agent may modify the signup form if that is clearly the target of the request.

However, if implementation also appears to require modifying a shared utility — e.g. `shared/validators.ts` — that is used elsewhere in the application, treat that as a potentially broader-impact change.

The agent should:

1. Determine whether the feature can be implemented safely within the explicitly targeted area.
2. Prefer a localized implementation when doing so does not create harmful duplication or alter existing behavior.
3. If modifying shared/protected code is genuinely required, stop.
4. Explain which shared file must change.
5. Explain why the change is required.
6. Explain the potential impact.
7. Ask for explicit permission.

Do not interpret a broad feature request as permission to modify unrelated shared architecture.

### 15.1 Tiebreaker

When deciding between:

> "This is necessary for the task."

and:

> "This changes protected existing/shared code."

**The protection rule wins. Ask first.**

---

## 16. INTERACTIVE VS. UNATTENDED EXECUTION

Whenever these rules require the agent to **STOP and ask the user**, the following behavior applies:

### 16.1 Interactive mode

- Stop immediately.
- Explain exactly what action or change is required.
- Wait for explicit user approval.
- Do not continue with the risky action until approval is received.

### 16.2 Unattended / autonomous / CI mode

- Do not guess.
- Do not automatically approve the action.
- Do not bypass the restriction.
- Skip or abort the blocked operation safely.
- Report what prevented completion and what approval would be required.

> **Lack of user availability must never be interpreted as permission.**

---

## 17. STOP CONDITIONS

Immediately stop and ask the user before proceeding if:

- A database migration is required.
- A database schema change is required.
- Existing business logic must change unexpectedly.
- An existing API contract must change.
- Authentication or authorization must change.
- An unrelated file must be modified.
- A dependency must be installed or changed.
- Another developer's changes may be overwritten.
- A merge conflict exists.
- Uncommitted changes make the requested edit unsafe.
- Production could potentially be affected.
- The requested task cannot be completed within the stated scope.
- You are uncertain whether an action is safe.

**Do not make assumptions in these situations.**

---

## 18. COMPLETION REPORT

After completing every task, provide a short summary containing:

### Files changed
List every file created or modified.

### Added
Explain what new functionality was added.

### Modified
Explain exactly what existing code was changed.

### Intentionally untouched
Mention important related areas that were deliberately not changed because they were outside scope.

### Database
Clearly state whether any database/schema/migration changes were made.

### Dependencies
Clearly state whether any dependencies were added, removed, or updated.

### Assumptions
List any assumptions made while implementing the task.

---

## 19. FINAL SAFETY PRECEDENCE

When two instructions appear to conflict, use this priority order:

1. **Protect production and user/shared data**
2. **Protect other developers' work**
3. **Protect Git history and uncommitted changes**
4. **Preserve existing application behavior and contracts**
5. **Stay within the explicitly assigned scope**
6. **Complete the requested task**

Completing the task is never more important than protecting the shared project.

If safety cannot be established:

> **STOP. Do not guess. Do not proceed. Ask the user.**

## 20 Design & UI reference

Use the files in this path as the reference for design and UI styles:

/Users/arun/Documents/ktg trainee/sarvam/sarvan_microfinance/.claude

Treat these files as the source of truth for design language — colors, typography, spacing, component patterns, theming — and follow them consistently for any new UI work. Take this as reference before creating any new visual pattern.

7.2 Proper API usage
Use proper, existing API endpoints for all data fetching. Do not invent ad-hoc fetch logic or bypass the existing API layer.
Keep API calls structured and organized (e.g. grouped by module/service, consistent naming, consistent error handling) so the codebase stays easy to view and access.
Do not scatter fetch logic randomly across components — follow the existing project pattern for how API calls are organized.
7.3 Reuse existing UI elements — do not duplicate
Before creating anything new (dropdowns, themes, modals, buttons, form elements, cards, etc.), check if it already exists in the project and reuse/extend it properly.
Do NOT create duplicate or unnecessary new components, styles, or utilities when a working equivalent already exists.
Only create something new if there is genuinely no existing equivalent — and even then, follow the existing design/style patterns (Section 7.1) rather than introducing a new visual language.
---

# 🔒 GOLDEN RULE

> **Protect the existing project first. Complete the requested task second.**
>
> Never sacrifice project stability or another developer's work just to complete a task automatically.

If there is any uncertainty about whether an action could affect:

- another developer,
- existing functionality,
- the database,
- Git history,
- production,
- configuration,
- dependencies,
- or files outside the requested scope,

**STOP AND ASK THE USER FIRST.**

It is always better to ask one additional question than to make one unauthorized change.

---

# PRE-CHANGE CHECKLIST

Before making **every change**, verify:

- [ ] Is this directly required by the user's current request?
- [ ] Am I touching only the minimum required files?
- [ ] Have I avoided unrelated refactoring or cleanup?
- [ ] Am I preserving other developers' existing and uncommitted work?
- [ ] Am I avoiding changes to existing flows unless explicitly requested?
- [ ] Am I avoiding database/schema/migration changes without explicit permission?
- [ ] Am I certain this will not modify production data?
- [ ] Am I avoiding dependency/configuration changes unless approved?
- [ ] Am I avoiding destructive Git operations?
- [ ] Am I reading only the minimum necessary project context?
- [ ] Is the command or change non-destructive?
- [ ] Can I complete this without increasing the blast radius?
- [ ] If this requires modifying shared/protected code, have I stopped to ask? (Section 15.1)
- [ ] If I'm running unattended and hit a stop condition, have I skipped/aborted rather than guessed? (Section 16.2)

### If any answer is "No" or "Uncertain":

# STOP.

Ask the user for clarification or explicit permission before proceeding.
