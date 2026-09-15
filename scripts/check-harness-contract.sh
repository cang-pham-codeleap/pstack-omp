#!/usr/bin/env bash
# Guards the contract this plugin claims: one tree that reads correctly on omp and on claude code.
# Runs in CI, and locally before a push.
set -uo pipefail
cd "$(dirname "$0")/.."

status=0
fail() {
  echo "error: $1" >&2
  status=1
}

# A role model has to be a value claude code resolves: `sonnet`, `opus`, `haiku`, `fable`, `inherit`,
# or a full model id. Anything else and the agent silently runs on the inherited model, which
# collapses the four review-panel seats onto one. An agent with no model field is fine, and follows
# the main conversation.
for f in agents/*.md; do
  model=$(sed -n 's/^model:[[:space:]]*//p' "$f" | head -n 1)
  [ -z "$model" ] && continue
  case "$model" in
    sonnet | opus | haiku | fable | inherit) ;;
    *) fail "$f: model '$model' is not a claude code alias (sonnet, opus, haiku, fable, inherit)" ;;
  esac
done

# A skill is loaded by name on both harnesses. A bare `skill://<name>` read resolves on omp only, so
# the prose names the skill instead. A path inside a skill keeps its `skill://` form, because a name
# would not resolve for a file.
reads=$(grep -rnE 'skill://[a-z0-9-]+`' --include='*.md' . || true)
if [ -n "$reads" ]; then
  fail "a skill read must name the skill, because skill://<name> resolves on omp only:
$reads"
fi

# The phrase that named omp's config as the only path to a role's model.
legacy=$(grep -rn 'configured by the \*\*setup-pstack\*\*' --include='*.md' . || true)
if [ -n "$legacy" ]; then
  fail "state the harness instead of naming omp's config alone:
$legacy"
fi

# Where the prose names an omp-only tool, it either points at the map of equivalents or spells the
# claude code branch out itself.
while IFS= read -r f; do
  case "$f" in
    ./skills/poteto-mode/references/harness-surface.md) continue ;;
  esac
  grep -q -e 'harness-surface.md' -e '\.claude/skills' "$f" ||
    fail "$f names an omp-only tool without pointing at skills/poteto-mode/references/harness-surface.md"
done < <(grep -rlE '`browser`|`hub`|`manage_skill`' --include='*.md' .)

if [ "$status" -eq 0 ]; then
  echo "harness contract holds"
fi
exit "$status"
