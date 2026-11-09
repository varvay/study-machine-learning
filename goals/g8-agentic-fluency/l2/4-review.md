---
title: Reviewing agent output in practice
---

L1 listed the typical errors: invented APIs, edits outside the task, tests weakened to pass, "done" without evidence, insecure code, and code that is almost right (G8.4 L1). Here is a review routine that catches them, and the tools that help.

**Machines first.** GitHub's guide to reviewing AI-generated code: "Always run automated tests and static analysis tools first." Static analysis checks code without running it: the compiler, the type checker, linters (tools that flag suspicious patterns and style breaks), and security scanners. They cost nothing to rerun, so your attention goes to what they cannot see.

**Then read in this order**, from GitHub's 2026 guide to reviewing agent pull requests:

1. **Scope** — `git diff --stat` lists the files changed. Anything the task did not name needs a reason.
2. **CI and test changes** — a deleted, skipped, or loosened test, or a lowered coverage threshold, is a red flag: the agent may have made the check pass without doing the work.
3. **Duplicated utilities** — agents often write a new helper where one already exists; the guide finds "more redundancy and more technical debt per change" in agent code.
4. **One critical path, end to end** — follow one real request through the change, reading every line it touches.
5. **Security boundaries** — input validation, authorization checks, queries built from strings, secrets, new network calls.
6. **Evidence** — the test output, run by you.

The checks the steps call for, as commands:

```bash
git diff --stat                    # 1. files touched
git diff -- '*Test*.java'          # 2. what changed in the tests
git diff main -- pom.xml           #    new dependencies
./mvnw verify                      # 6. the evidence, run by you
```

For every new dependency, check that it exists, is the package you meant, and is maintained: a hallucinated name may have been registered by an attacker (G8.5 L1).

**Make the agent show its work.** The Claude Code docs: "Have Claude show evidence rather than asserting success." Ask for it directly:

```text
List each acceptance criterion, the test that covers it, and that test's output.
List every file you changed that the task did not name, and why.
```

**A second reviewer with a fresh context.** The agent that wrote the code reviews it with the same blind spots. Two ways around that:

- **A review subagent** — a read-only reviewer such as the `code-reviewer` in G8.3 L2: `Use the code-reviewer agent on the current diff.`
- **`/code-review`** — a skill bundled with Claude Code that reviews the current diff with several agents and reports the bugs it finds; `--comment` posts them on the pull request.

The docs warn against the opposite failure: "Chasing every finding leads to over-engineering." Fix the findings that are bugs; treat style notes as optional.

**AI review on pull requests.**

| Tool | What it does |
|---|---|
| Claude Code GitHub Action | a workflow runs the `code-review` plugin on each pull request and posts inline comments, or answers `@claude review this` in a comment (G8.6 L2) |
| Claude Code Review | Anthropic's managed service on Team and Enterprise: "a fleet of specialized agents" review each pull request, and a verification step filters out false positives. Findings are tagged Important, Nit, or Pre-existing, and "don't approve or block your PR". Tuned with a `REVIEW.md`; averages $15–25 a review |
| GitHub Copilot code review | request Copilot as a reviewer, or turn on automatic reviews; by default its approval does not count toward required approvals |
| CodeRabbit | a third-party reviewer configured with `.coderabbit.yaml` |

AI review adds a reviewer next to the human one: keep a human approval required on the main branch.

**The bar.** Before you commit, apply Willison's rule (G8.4 L1): you can explain what every changed line does. When you cannot, ask Claude to explain it, then check the explanation against the code.

Sources: [GitHub Docs — Review AI-generated code](https://docs.github.com/en/copilot/tutorials/review-ai-generated-code) · [GitHub Blog — Agent pull requests are everywhere: here's how to review them](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/) · [Claude Code — Best practices](https://code.claude.com/docs/en/best-practices) · [Claude Code — Skills (bundled skills)](https://code.claude.com/docs/en/skills) · [Claude Code — GitHub Actions](https://code.claude.com/docs/en/github-actions) · [Claude Code — Code Review](https://code.claude.com/docs/en/code-review) · [GitHub Docs — Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review) · [CodeRabbit docs](https://docs.coderabbit.ai/)
